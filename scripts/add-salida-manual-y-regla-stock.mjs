import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // HU-11: la salida manual queda en movimiento (una fila por lote descontado) con el Chef responsable y su motivo
  await client.query(`ALTER TABLE movimiento ADD COLUMN IF NOT EXISTS motivo VARCHAR(200);`);
  await client.query(`
    ALTER TABLE movimiento
      DROP CONSTRAINT IF EXISTS movimiento_tipo_check,
      ADD CONSTRAINT movimiento_tipo_check CHECK (tipo IN ('INGRESO', 'SALIDA_COMANDA', 'SALIDA_MANUAL', 'ANULACION')),
      DROP CONSTRAINT IF EXISTS movimiento_salida_manual_coherente,
      ADD CONSTRAINT movimiento_salida_manual_coherente CHECK (
        tipo <> 'SALIDA_MANUAL'
        OR (id_usuario IS NOT NULL AND motivo IS NOT NULL AND length(trim(motivo)) BETWEEN 5 AND 200)
      );
  `);

  // El trigger de anulación (HU-19) ya cuenta cualquier salida; solo se generaliza el mensaje para incluir las manuales
  const funcion = (await client.query(`SELECT pg_get_functiondef('lote_validar_anulacion'::regproc) AS def`)).rows[0].def;
  const mensajeAnterior = `fue utilizado en % salida(s) por comanda`;
  if (funcion.includes(mensajeAnterior)) {
    await client.query(funcion.replace(mensajeAnterior, `fue utilizado en % salida(s) de cocina (comandas o salidas manuales)`));
  }

  // HU-08: stock_actual siempre igual a la suma de los lotes activos. Es un constraint trigger diferido:
  // se revisa al COMMIT, cuando la transacción ya actualizó tanto el lote como el producto.
  const descuadrados = await client.query(`
    SELECT p.id FROM producto p LEFT JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
    GROUP BY p.id HAVING COALESCE(p.stock_actual, 0) <> COALESCE(SUM(l.cantidad_disponible), 0)
  `);
  if (descuadrados.rowCount > 0) {
    throw new Error(`Hay ${descuadrados.rowCount} productos descuadrados: ejecutar antes scripts/add-lote-carga-inicial.mjs`);
  }

  await client.query(`
    CREATE OR REPLACE FUNCTION producto_validar_stock_lotes() RETURNS trigger AS $$
    DECLARE
      productos INTEGER[];
      fila RECORD;
    BEGIN
      IF TG_TABLE_NAME = 'producto' THEN
        productos := ARRAY[NEW.id];
      ELSIF TG_OP = 'INSERT' THEN
        productos := ARRAY[NEW.id_producto];
      ELSIF TG_OP = 'DELETE' THEN
        productos := ARRAY[OLD.id_producto];
      ELSE
        productos := ARRAY[OLD.id_producto, NEW.id_producto];
      END IF;

      FOR fila IN
        SELECT p.id, COALESCE(p.stock_actual, 0) AS stock,
               COALESCE((SELECT SUM(l.cantidad_disponible) FROM lote l WHERE l.id_producto = p.id AND l.estado = 'ACTIVO'), 0) AS lotes
        FROM producto p WHERE p.id = ANY(productos)
      LOOP
        IF fila.stock <> fila.lotes THEN
          RAISE EXCEPTION 'El stock del producto % (%) no coincide con la suma de sus lotes activos (%)', fila.id, fila.stock, fila.lotes
            USING ERRCODE = 'check_violation', CONSTRAINT = 'producto_stock_igual_lotes';
        END IF;
      END LOOP;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`DROP TRIGGER IF EXISTS producto_stock_igual_lotes_trg ON producto;`);
  await client.query(`
    CREATE CONSTRAINT TRIGGER producto_stock_igual_lotes_trg
      AFTER INSERT OR UPDATE OF stock_actual ON producto
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION producto_validar_stock_lotes();
  `);
  await client.query(`DROP TRIGGER IF EXISTS lote_stock_igual_lotes_trg ON lote;`);
  await client.query(`
    CREATE CONSTRAINT TRIGGER lote_stock_igual_lotes_trg
      AFTER INSERT OR DELETE OR UPDATE OF cantidad_disponible, estado, id_producto ON lote
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION producto_validar_stock_lotes();
  `);

  await client.query('COMMIT');

  const res = await client.query(`
    SELECT conname AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
    WHERE conname IN ('movimiento_tipo_check', 'movimiento_salida_manual_coherente')
    UNION ALL
    SELECT tgname, 'constraint trigger diferido en ' || tgrelid::regclass FROM pg_trigger
    WHERE tgname IN ('producto_stock_igual_lotes_trg', 'lote_stock_igual_lotes_trg')
  `);
  console.log('OK - salida manual y regla de stock:');
  console.table(res.rows);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await p.end();
}
