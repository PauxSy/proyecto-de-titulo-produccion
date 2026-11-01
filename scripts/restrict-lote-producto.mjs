import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // Antes era ON DELETE CASCADE: borrar un producto eliminaba sus lotes (y con ellos el respaldo del stock).
  // Con RESTRICT solo se puede borrar un producto que nunca tuvo lotes.
  await client.query(`
    ALTER TABLE lote
      DROP CONSTRAINT IF EXISTS lote_id_producto_fkey,
      ADD CONSTRAINT lote_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES producto(id) ON DELETE RESTRICT;
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS lote_id_producto_idx ON lote (id_producto);`);

  await client.query('COMMIT');

  const res = await client.query(`
    SELECT c.conrelid::regclass::text AS tabla, c.conname AS restriccion, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = 'producto'::regclass
    ORDER BY tabla
  `);
  console.log('OK - claves foráneas hacia producto:');
  console.table(res.rows);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await p.end();
}
