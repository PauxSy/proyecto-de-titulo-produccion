import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-07: cada movimiento de stock queda asociado al usuario responsable (igual que merma.id_usuario).
  // Es nullable porque los movimientos anteriores a esta migración no registraron usuario.
  await p.query(`
    ALTER TABLE movimiento
    ADD COLUMN IF NOT EXISTS id_usuario INTEGER REFERENCES usuario(id);
  `);

  const cols = await p.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'movimiento'
    ORDER BY ordinal_position
  `);
  console.log('OK - columnas de movimiento:');
  console.table(cols.rows);

  const fks = await p.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'movimiento' AND c.contype = 'f'
  `);
  console.table(fks.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
