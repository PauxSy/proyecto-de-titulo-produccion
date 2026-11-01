import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const pool = new Pool({ connectionString: url });

try {
  const repetidos = await pool.query(`
    SELECT UPPER(TRIM(numero_lote)) AS numero, COUNT(*)::int AS cantidad
    FROM lote
    GROUP BY 1
    HAVING COUNT(*) > 1
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION lote_numero_unico() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM lote
        WHERE UPPER(TRIM(numero_lote)) = UPPER(TRIM(NEW.numero_lote))
          AND id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'Ya existe un lote con el número %', NEW.numero_lote
          USING ERRCODE = 'unique_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS lote_numero_unico_trg ON lote`);
  await pool.query(`
    CREATE TRIGGER lote_numero_unico_trg
    BEFORE INSERT OR UPDATE OF numero_lote ON lote
    FOR EACH ROW EXECUTE FUNCTION lote_numero_unico();
  `);
  console.log('OK - no se puede volver a guardar un número de lote que ya existe');

  if (repetidos.rowCount > 0) {
    console.log('Estos números ya estaban repetidos y se dejan como están:');
    console.table(repetidos.rows);
  } else {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS lote_numero_lote_unico
      ON lote (UPPER(TRIM(numero_lote)))
    `);
    console.log('OK - índice lote_numero_lote_unico');
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
