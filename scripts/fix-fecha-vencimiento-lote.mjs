import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // El CHECK (fecha_vencimiento > CURRENT_DATE) se reevaluaba en cada UPDATE del lote: al vencer, el lote ya no
  // aceptaba mermas, comandas ni anulaciones. Además CURRENT_DATE es UTC y cambia de día a las 21:00 de Chile.
  // El trigger valida solo al ingresar el lote o al cambiar su fecha, con la fecha de Chile.
  await client.query(`
    CREATE OR REPLACE FUNCTION lote_validar_fecha_vencimiento() RETURNS trigger AS $$
    DECLARE
      hoy_chile DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
    BEGIN
      IF TG_OP = 'INSERT' OR NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento THEN
        IF NEW.fecha_vencimiento <= hoy_chile THEN
          RAISE EXCEPTION 'La fecha de vencimiento (%) debe ser posterior a la fecha actual (%)', NEW.fecha_vencimiento, hoy_chile
            USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_fecha_vencimiento';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`DROP TRIGGER IF EXISTS lote_validar_fecha_vencimiento_trg ON lote;`);
  await client.query(`
    CREATE TRIGGER lote_validar_fecha_vencimiento_trg
      BEFORE INSERT OR UPDATE OF fecha_vencimiento ON lote
      FOR EACH ROW EXECUTE FUNCTION lote_validar_fecha_vencimiento();
  `);
  await client.query(`ALTER TABLE lote DROP CONSTRAINT IF EXISTS chk_fecha_vencimiento;`);

  await client.query('COMMIT');

  const trg = await client.query(`
    SELECT trigger_name, action_timing, string_agg(event_manipulation, ' OR ') AS eventos
    FROM information_schema.triggers
    WHERE event_object_table = 'lote'
    GROUP BY trigger_name, action_timing
    ORDER BY trigger_name
  `);
  console.log('OK - triggers de lote:');
  console.table(trg.rows);

  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'lote' AND c.contype = 'c'
    ORDER BY conname
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
