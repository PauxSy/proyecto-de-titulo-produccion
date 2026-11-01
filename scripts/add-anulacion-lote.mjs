import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // HU-19: la anulación es lógica (el lote queda con estado ANULADO y cantidad 0) para conservar la trazabilidad.
  await client.query(`
    ALTER TABLE lote
      ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
      ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMP,
      ADD COLUMN IF NOT EXISTS id_usuario_anulacion INTEGER REFERENCES usuario(id),
      ADD COLUMN IF NOT EXISTS motivo_anulacion VARCHAR(300);
  `);
  await client.query(`
    ALTER TABLE lote
      DROP CONSTRAINT IF EXISTS lote_estado_check,
      ADD CONSTRAINT lote_estado_check CHECK (estado IN ('ACTIVO', 'ANULADO')),
      DROP CONSTRAINT IF EXISTS lote_anulacion_coherente,
      ADD CONSTRAINT lote_anulacion_coherente CHECK (
        (estado = 'ACTIVO' AND fecha_anulacion IS NULL AND id_usuario_anulacion IS NULL AND motivo_anulacion IS NULL)
        OR (estado = 'ANULADO' AND fecha_anulacion IS NOT NULL AND id_usuario_anulacion IS NOT NULL
            AND motivo_anulacion IS NOT NULL AND cantidad_disponible = 0)
      );
  `);

  // Bloqueo de integridad: la base rechaza la anulación si el lote tiene mermas, consumos por comanda
  // u otras salidas, aunque el UPDATE se haga fuera de la API. Un lote anulado ya no se puede modificar.
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

      IF NEW.estado = 'ANULADO' THEN
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
  await client.query(`DROP TRIGGER IF EXISTS lote_validar_anulacion_trg ON lote;`);
  await client.query(`
    CREATE TRIGGER lote_validar_anulacion_trg
      BEFORE UPDATE ON lote
      FOR EACH ROW EXECUTE FUNCTION lote_validar_anulacion();
  `);

  // Antes eran ON DELETE CASCADE: borrar un lote eliminaba en silencio sus mermas y consumos por comanda.
  await client.query(`
    ALTER TABLE merma
      DROP CONSTRAINT IF EXISTS merma_id_lote_fkey,
      ADD CONSTRAINT merma_id_lote_fkey FOREIGN KEY (id_lote) REFERENCES lote(id) ON DELETE RESTRICT;
  `);
  await client.query(`
    ALTER TABLE movimiento
      DROP CONSTRAINT IF EXISTS movimiento_id_lote_fkey,
      ADD CONSTRAINT movimiento_id_lote_fkey FOREIGN KEY (id_lote) REFERENCES lote(id) ON DELETE RESTRICT;
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS merma_id_lote_idx ON merma (id_lote);`);

  await client.query('COMMIT');

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'lote'
    ORDER BY ordinal_position
  `);
  console.log('OK - columnas de lote:');
  console.table(cols.rows);

  const cons = await client.query(`
    SELECT t.relname AS tabla, conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE conname IN ('lote_estado_check', 'lote_anulacion_coherente', 'merma_id_lote_fkey', 'movimiento_id_lote_fkey')
    ORDER BY tabla, conname
  `);
  console.table(cons.rows);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await p.end();
}
