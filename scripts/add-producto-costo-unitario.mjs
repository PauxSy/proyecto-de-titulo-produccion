import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // HU-15: costo de referencia por unidad de medida del producto, para valorizar las mermas.
  // NULL = sin costo definido (la analítica informa esas cantidades aparte en vez de contarlas como $0).
  await client.query(`ALTER TABLE producto ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12, 2);`);
  await client.query(`
    ALTER TABLE producto
      DROP CONSTRAINT IF EXISTS producto_costo_unitario_check,
      ADD CONSTRAINT producto_costo_unitario_check CHECK (costo_unitario IS NULL OR costo_unitario >= 0);
  `);

  await client.query('COMMIT');

  const res = await client.query(`
    SELECT c.column_name AS columna, c.data_type || '(' || c.numeric_precision || ',' || c.numeric_scale || ')' AS tipo, c.is_nullable AS nulo,
           pg_get_constraintdef(k.oid) AS restriccion,
           (SELECT COUNT(*)::int FROM producto WHERE costo_unitario IS NULL) AS productos_sin_costo
    FROM information_schema.columns c
    LEFT JOIN pg_constraint k ON k.conname = 'producto_costo_unitario_check'
    WHERE c.table_name = 'producto' AND c.column_name = 'costo_unitario'
  `);
  console.log('OK - producto.costo_unitario:');
  console.table(res.rows);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await p.end();
}
