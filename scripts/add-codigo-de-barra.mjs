import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // Según diagrama de clases: codigo_de_barra numeric
  await p.query(`
    ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS codigo_de_barra NUMERIC;
  `);

  // Índice único para coincidencias exactas (HU-04), permitiendo NULL en filas antiguas
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS producto_codigo_de_barra_uq
    ON producto (codigo_de_barra)
    WHERE codigo_de_barra IS NOT NULL;
  `);

  const cols = await p.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'producto'
    ORDER BY ordinal_position
  `);
  console.log('OK - columnas actualizadas:');
  console.log(JSON.stringify(cols.rows, null, 2));
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
