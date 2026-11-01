import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-15: la analítica de mermas siempre filtra por rango de fecha.
  await p.query(`CREATE INDEX IF NOT EXISTS merma_fecha_idx ON merma (fecha);`);

  const idx = await p.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'merma' ORDER BY indexname
  `);
  console.log('OK - índices de merma:');
  console.table(idx.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
