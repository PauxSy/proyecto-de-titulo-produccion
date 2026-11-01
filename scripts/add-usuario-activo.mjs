import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-17 (desactivar usuarios) y HU-22 (usuario desactivado recibe error genérico)
  await p.query(`
    ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
  `);

  const cols = await p.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'usuario'
    ORDER BY ordinal_position
  `);
  console.log('OK - columnas actualizadas:');
  console.log(JSON.stringify(cols.rows, null, 2));

  const usuarios = await p.query(`SELECT id, email, rol, activo FROM usuario ORDER BY id`);
  console.log(JSON.stringify(usuarios.rows, null, 2));
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
