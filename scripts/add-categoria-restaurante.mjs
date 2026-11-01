import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const pool = new Pool({ connectionString: url });

await pool.query(`
  INSERT INTO configuraciones_globales (clave, valor, tipo, descripcion)
  VALUES (
    'categoria_restaurante',
    'Repostería',
    'texto',
    'Categoría del restaurante usada por Chef IA para sugerir recetas de rescate'
  )
  ON CONFLICT (clave) DO NOTHING
`);

const fila = await pool.query(`SELECT clave, valor FROM configuraciones_globales WHERE clave = 'categoria_restaurante'`);
console.table(fila.rows);
await pool.end();
