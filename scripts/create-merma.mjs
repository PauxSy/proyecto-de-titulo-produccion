import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-10: cada merma pertenece a un lote y queda asociada al usuario que la registró.
  await p.query(`
    CREATE TABLE IF NOT EXISTS merma (
      id SERIAL PRIMARY KEY,
      id_lote INTEGER NOT NULL REFERENCES lote(id) ON DELETE CASCADE,
      id_usuario INTEGER NOT NULL REFERENCES usuario(id),
      motivo VARCHAR(50) NOT NULL CHECK (motivo IN ('Vencimiento', 'Rotura/Daño', 'Deterioro', 'Error Operacional', 'Otro')),
      cantidad NUMERIC NOT NULL CHECK (cantidad > 0),
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Si la tabla ya existía con columnas opcionales, se vuelven obligatorias (falla si hay filas con NULL).
  await p.query(`
    ALTER TABLE merma
      ALTER COLUMN id_lote SET NOT NULL,
      ALTER COLUMN id_usuario SET NOT NULL,
      ALTER COLUMN fecha SET NOT NULL;
  `);

  // PostgreSQL no indexa las llaves foráneas automáticamente.
  await p.query(`CREATE INDEX IF NOT EXISTS merma_id_lote_idx ON merma (id_lote);`);

  const cols = await p.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'merma'
    ORDER BY ordinal_position
  `);
  console.log('OK - columnas de merma:');
  console.table(cols.rows);

  const cons = await p.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'merma' AND c.contype IN ('p', 'f', 'c')
    ORDER BY c.contype, conname
  `);
  console.table(cons.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
