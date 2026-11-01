import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // Límite de intentos de /login: una fila por email normalizado (exista o no la cuenta, para no revelar
  // cuáles existen). Se borra al iniciar sesión con éxito; las filas viejas las limpia el mismo /login.
  await p.query(`
    CREATE TABLE IF NOT EXISTS login_intento (
      email VARCHAR(254) PRIMARY KEY CHECK (email = LOWER(TRIM(email)) AND email <> ''),
      fallos INTEGER NOT NULL CHECK (fallos >= 0),
      ultimo_fallo TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      bloqueado_hasta TIMESTAMPTZ
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS login_intento_ultimo_fallo_idx ON login_intento (ultimo_fallo);`);

  const cols = await p.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'login_intento' ORDER BY ordinal_position
  `);
  console.log('OK - login_intento:');
  console.table(cols.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
