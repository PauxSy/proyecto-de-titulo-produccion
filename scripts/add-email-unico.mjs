import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-28: la restricción UNIQUE(email) existente distingue mayúsculas; este índice
  // impide registrar "Admin@x.cl" si ya existe "admin@x.cl".
  const dup = await p.query(`
    SELECT LOWER(TRIM(email)) AS email_normalizado, COUNT(*) AS cantidad
    FROM usuario
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
  `);
  if (dup.rowCount > 0) {
    throw new Error(`Hay ${dup.rowCount} correo(s) duplicado(s) sin distinguir mayúsculas. Resolverlos antes de migrar.`);
  }

  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_lower_unico
    ON usuario (LOWER(email));
  `);

  const indices = await p.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'usuario' ORDER BY indexname`);
  console.log('OK - índices de usuario:');
  console.log(JSON.stringify(indices.rows, null, 2));

  const checkRol = await p.query(`
    SELECT pg_get_constraintdef(oid) AS definicion
    FROM pg_constraint
    WHERE conname = 'usuario_rol_check'
  `);
  console.log('Restricción de rol:', checkRol.rows[0]?.definicion);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
