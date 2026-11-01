import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-16: las salidas por comanda guardan la receta que las originó para cruzarlas con ingrediente_receta.
  // Es opcional porque los ingresos y los movimientos anteriores no tienen receta.
  await p.query(`
    ALTER TABLE movimiento
      ADD COLUMN IF NOT EXISTS id_receta INTEGER REFERENCES receta(id) ON DELETE RESTRICT;
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS movimiento_id_receta_idx ON movimiento (id_receta);`);
  await p.query(`CREATE INDEX IF NOT EXISTS movimiento_id_lote_idx ON movimiento (id_lote);`);

  const cols = await p.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'movimiento'
    ORDER BY ordinal_position
  `);
  console.log('OK - columnas de movimiento:');
  console.table(cols.rows);

  const cons = await p.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'movimiento' AND c.contype = 'f'
    ORDER BY conname
  `);
  console.table(cons.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
