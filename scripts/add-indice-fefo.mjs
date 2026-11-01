import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-13: la regla FEFO busca los lotes con saldo de un producto ordenados por vencimiento.
  // Índice parcial: solo incluye lotes con saldo, que son los únicos que puede consumir una comanda.
  await p.query(`
    CREATE INDEX IF NOT EXISTS lote_fefo_idx
    ON lote (id_producto, fecha_vencimiento, id)
    WHERE cantidad_disponible > 0;
  `);

  const idx = await p.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'lote' ORDER BY indexname`);
  console.log('OK - índices de lote:');
  console.table(idx.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
