import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-12: receta <-> producto es muchos a muchos a través de ingrediente_receta.
  await p.query(`
    CREATE TABLE IF NOT EXISTS receta (
      id SERIAL PRIMARY KEY,
      nombre_plato VARCHAR(150) NOT NULL,
      porciones INTEGER NOT NULL CHECK (porciones > 0),
      rubro VARCHAR(100) NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
      instrucciones TEXT NOT NULL DEFAULT ''
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS ingrediente_receta (
      id SERIAL PRIMARY KEY,
      id_receta INTEGER NOT NULL,
      id_producto INTEGER NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
      cantidad_requerida NUMERIC NOT NULL CHECK (cantidad_requerida > 0),
      unidad_medida VARCHAR(20) NOT NULL
    );
  `);

  // Si las tablas ya existían, se ajustan a las mismas reglas (falla si hay filas que no las cumplen).
  await p.query(`ALTER TABLE receta ADD COLUMN IF NOT EXISTS instrucciones TEXT NOT NULL DEFAULT '';`);
  await p.query(`UPDATE receta SET estado = 'activo' WHERE estado IS NULL;`);
  await p.query(`ALTER TABLE receta ALTER COLUMN estado SET NOT NULL;`);
  await p.query(`
    ALTER TABLE ingrediente_receta
      ALTER COLUMN id_receta SET NOT NULL,
      ALTER COLUMN id_producto SET NOT NULL;
  `);

  // RESTRICT: una receta con ingredientes no se puede borrar físicamente, solo desactivar (soft delete).
  await p.query(`
    ALTER TABLE ingrediente_receta
      DROP CONSTRAINT IF EXISTS ingrediente_receta_id_receta_fkey,
      ADD CONSTRAINT ingrediente_receta_id_receta_fkey
        FOREIGN KEY (id_receta) REFERENCES receta(id) ON DELETE RESTRICT;
  `);
  await p.query(`
    ALTER TABLE ingrediente_receta
      DROP CONSTRAINT IF EXISTS ingrediente_receta_unidad_medida_check,
      ADD CONSTRAINT ingrediente_receta_unidad_medida_check CHECK (unidad_medida IN ('gr', 'ml', 'un'));
  `);
  await p.query(`
    ALTER TABLE ingrediente_receta
      DROP CONSTRAINT IF EXISTS ingrediente_receta_unico,
      ADD CONSTRAINT ingrediente_receta_unico UNIQUE (id_receta, id_producto);
  `);

  // El índice único ya cubre las búsquedas por id_receta; este cubre las búsquedas por producto.
  await p.query(`CREATE INDEX IF NOT EXISTS ingrediente_receta_id_producto_idx ON ingrediente_receta (id_producto);`);

  for (const tabla of ['receta', 'ingrediente_receta']) {
    const cols = await p.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tabla]);
    console.log(`OK - columnas de ${tabla}:`);
    console.table(cols.rows);

    const cons = await p.query(`
      SELECT conname, pg_get_constraintdef(c.oid) AS definicion
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = $1 AND c.contype IN ('p', 'f', 'c', 'u')
      ORDER BY c.contype, conname
    `, [tabla]);
    console.table(cons.rows);
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
