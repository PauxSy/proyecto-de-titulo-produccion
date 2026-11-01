import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

// HU-08: el stock_actual de cada producto debe coincidir con la suma de sus lotes activos.
// Los productos cargados antes de existir los lotes tienen stock sin respaldo: se crea un lote de carga inicial
// por la diferencia, con la fecha de vencimiento y el responsable acordados.
const FECHA_VENCIMIENTO_CARGA_INICIAL = '2026-12-31';
const ID_ADMIN_CARGA_INICIAL = 1;

try {
  await client.query('BEGIN');

  await client.query(`
    ALTER TABLE lote
      ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'RECEPCION';
  `);
  await client.query(`
    ALTER TABLE lote
      DROP CONSTRAINT IF EXISTS lote_origen_check,
      ADD CONSTRAINT lote_origen_check CHECK (origen IN ('RECEPCION', 'CARGA_INICIAL'));
  `);

  // Misma función de scripts/add-anulacion-lote.mjs más dos reglas: el origen no se puede cambiar
  // y un lote de carga inicial no se puede anular (HU-19 solo aplica a lotes recién recepcionados).
  await client.query(`
    CREATE OR REPLACE FUNCTION lote_validar_anulacion() RETURNS trigger AS $$
    DECLARE
      n_mermas INTEGER;
      n_salidas INTEGER;
    BEGIN
      IF OLD.estado = 'ANULADO' THEN
        RAISE EXCEPTION 'El lote % ya está anulado y no se puede modificar', OLD.numero_lote
          USING ERRCODE = 'restrict_violation', CONSTRAINT = 'lote_anulado_inmutable';
      END IF;

      IF NEW.origen IS DISTINCT FROM OLD.origen THEN
        RAISE EXCEPTION 'El origen del lote % no se puede modificar', OLD.numero_lote
          USING ERRCODE = 'restrict_violation', CONSTRAINT = 'lote_origen_inmutable';
      END IF;

      IF NEW.estado = 'ANULADO' THEN
        IF OLD.origen = 'CARGA_INICIAL' THEN
          RAISE EXCEPTION 'No se puede anular el lote %: corresponde a la carga inicial del inventario', OLD.numero_lote
            USING ERRCODE = 'restrict_violation', CONSTRAINT = 'lote_carga_inicial_no_anulable';
        END IF;

        SELECT COUNT(*) INTO n_mermas FROM merma WHERE id_lote = OLD.id;
        IF n_mermas > 0 THEN
          RAISE EXCEPTION 'No se puede anular el lote %: tiene % merma(s) asociada(s)', OLD.numero_lote, n_mermas
            USING ERRCODE = 'restrict_violation', CONSTRAINT = 'lote_anulacion_sin_mermas';
        END IF;

        SELECT COUNT(*) INTO n_salidas FROM movimiento WHERE id_lote = OLD.id AND tipo <> 'INGRESO';
        IF n_salidas > 0 THEN
          RAISE EXCEPTION 'No se puede anular el lote %: fue utilizado en % salida(s) por comanda', OLD.numero_lote, n_salidas
            USING ERRCODE = 'restrict_violation', CONSTRAINT = 'lote_anulacion_sin_consumo';
        END IF;

        IF OLD.cantidad_disponible <> OLD.cantidad_inicial THEN
          RAISE EXCEPTION 'No se puede anular el lote %: registra salidas (disponible % de %)',
            OLD.numero_lote, OLD.cantidad_disponible, OLD.cantidad_inicial
            USING ERRCODE = 'restrict_violation', CONSTRAINT = 'lote_anulacion_sin_salidas';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  const admin = await client.query(
    `SELECT id FROM usuario WHERE id = $1 AND rol = 'Administrador' AND activo`,
    [ID_ADMIN_CARGA_INICIAL]
  );
  if (admin.rowCount === 0) {
    throw new Error(`El usuario ${ID_ADMIN_CARGA_INICIAL} no es un Administrador activo`);
  }

  const diferencias = `
    SELECT p.id, COALESCE(p.stock_actual, 0) - COALESCE(SUM(l.cantidad_disponible), 0) AS diferencia
    FROM producto p
    LEFT JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
    GROUP BY p.id
  `;

  // Un lote con más saldo que el producto no se puede corregir con un lote nuevo: requiere revisión manual
  const negativos = await client.query(`SELECT id, diferencia FROM (${diferencias}) d WHERE diferencia < 0 ORDER BY id`);
  if (negativos.rowCount > 0) {
    throw new Error(`Productos con lotes que superan su stock_actual (revisar a mano): ${JSON.stringify(negativos.rows)}`);
  }

  const lotes = await client.query(
    `
      INSERT INTO lote (id_producto, numero_lote, cantidad_inicial, cantidad_disponible,
                        fecha_recepcion, fecha_vencimiento, origen)
      SELECT d.id, 'LOTE-INICIAL-' || d.id, d.diferencia, d.diferencia, NOW(), $1::date, 'CARGA_INICIAL'
      FROM (${diferencias}) d
      WHERE d.diferencia > 0
      ORDER BY d.id
      RETURNING id, cantidad_inicial
    `,
    [FECHA_VENCIMIENTO_CARGA_INICIAL]
  );

  for (const lote of lotes.rows) {
    await client.query(
      `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario) VALUES ($1, 'INGRESO', $2, NOW(), $3)`,
      [lote.id, lote.cantidad_inicial, ID_ADMIN_CARGA_INICIAL]
    );
  }

  const pendientes = await client.query(`SELECT COUNT(*)::int AS total FROM (${diferencias}) d WHERE diferencia <> 0`);
  if (pendientes.rows[0].total > 0) {
    throw new Error(`Quedaron ${pendientes.rows[0].total} productos descuadrados`);
  }

  await client.query('COMMIT');

  console.log(`OK - lotes de carga inicial creados: ${lotes.rowCount}`);
  const resumen = await client.query(`
    SELECT origen, COUNT(*)::int AS lotes, SUM(cantidad_disponible) AS unidades
    FROM lote WHERE estado = 'ACTIVO' GROUP BY origen ORDER BY origen
  `);
  console.table(resumen.rows);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await p.end();
}
