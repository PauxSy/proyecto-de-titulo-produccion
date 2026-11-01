import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // Auditoría de anulaciones: cada anulación exitosa y cada confirmación de seguridad fallida.
  // Los intentos fallidos no siempre tienen un lote válido, por eso id_lote es opcional en ese caso.
  await client.query(`
    CREATE TABLE IF NOT EXISTS log_anulaciones (
      id SERIAL PRIMARY KEY,
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id_usuario INTEGER NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
      id_lote INTEGER REFERENCES lote(id) ON DELETE RESTRICT,
      resultado VARCHAR(30) NOT NULL CHECK (resultado IN ('ANULADO', 'VERIFICACION_FALLIDA')),
      metodo_verificacion VARCHAR(10) NOT NULL CHECK (metodo_verificacion IN ('PASSWORD')),
      motivo VARCHAR(300) NOT NULL CHECK (length(trim(motivo)) >= 5),
      cantidad_revertida NUMERIC,
      stock_anterior NUMERIC,
      stock_posterior NUMERIC,
      CONSTRAINT log_anulaciones_exitosa_completa CHECK (
        resultado <> 'ANULADO'
        OR (id_lote IS NOT NULL AND cantidad_revertida IS NOT NULL AND stock_anterior IS NOT NULL AND stock_posterior IS NOT NULL)
      )
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS log_anulaciones_usuario_fecha_idx ON log_anulaciones (id_usuario, fecha);`);
  await client.query(`CREATE INDEX IF NOT EXISTS log_anulaciones_id_lote_idx ON log_anulaciones (id_lote);`);

  // Solo inserción: el registro de auditoría no se puede modificar ni borrar desde la aplicación.
  await client.query(`
    CREATE OR REPLACE FUNCTION log_anulaciones_inmutable() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'log_anulaciones es de solo inserción: no se permite %', TG_OP
        USING ERRCODE = 'restrict_violation', CONSTRAINT = 'log_anulaciones_inmutable';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`DROP TRIGGER IF EXISTS log_anulaciones_inmutable_trg ON log_anulaciones;`);
  await client.query(`
    CREATE TRIGGER log_anulaciones_inmutable_trg
      BEFORE UPDATE OR DELETE ON log_anulaciones
      FOR EACH ROW EXECUTE FUNCTION log_anulaciones_inmutable();
  `);
  await client.query(`DROP TRIGGER IF EXISTS log_anulaciones_sin_truncate_trg ON log_anulaciones;`);
  await client.query(`
    CREATE TRIGGER log_anulaciones_sin_truncate_trg
      BEFORE TRUNCATE ON log_anulaciones
      FOR EACH STATEMENT EXECUTE FUNCTION log_anulaciones_inmutable();
  `);

  await client.query('COMMIT');

  const cols = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'log_anulaciones'
    ORDER BY table_name, ordinal_position
  `);
  console.log('OK - columnas:');
  console.table(cols.rows);

  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'log_anulaciones' AND c.contype IN ('c', 'f', 'p')
    ORDER BY c.contype, conname
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
