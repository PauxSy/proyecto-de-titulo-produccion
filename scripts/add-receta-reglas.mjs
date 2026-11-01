import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });
const client = await p.connect();

try {
  await client.query('BEGIN');

  // HU-12: el nombre del plato no se repite entre recetas activas (sin distinguir mayúsculas ni espacios extremos).
  // Una receta inactiva puede compartir nombre con una activa; al reactivarla, este índice lo impide.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS receta_nombre_activo_unico
      ON receta (LOWER(TRIM(nombre_plato))) WHERE estado = 'activo';
  `);
  await client.query(`
    ALTER TABLE receta
      DROP CONSTRAINT IF EXISTS receta_nombre_plato_check,
      ADD CONSTRAINT receta_nombre_plato_check CHECK (length(trim(nombre_plato)) >= 2),
      DROP CONSTRAINT IF EXISTS receta_rubro_check,
      ADD CONSTRAINT receta_rubro_check CHECK (length(trim(rubro)) >= 2);
  `);

  // Los ingredientes de una receta ya usada en comandas no se pueden cambiar: el historial (HU-16) calcula
  // los platos de cada salida con ingrediente_receta. Para cambiar la fórmula se crea una receta nueva.
  await client.query(`
    CREATE OR REPLACE FUNCTION ingrediente_receta_validar_receta_usada() RETURNS trigger AS $$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (SELECT 1 FROM movimiento WHERE id_receta = OLD.id_receta) THEN
        RAISE EXCEPTION 'No se pueden modificar los ingredientes de la receta %: ya se usó en comandas', OLD.id_receta
          USING ERRCODE = 'restrict_violation', CONSTRAINT = 'ingrediente_receta_receta_usada';
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (SELECT 1 FROM movimiento WHERE id_receta = NEW.id_receta) THEN
        RAISE EXCEPTION 'No se pueden modificar los ingredientes de la receta %: ya se usó en comandas', NEW.id_receta
          USING ERRCODE = 'restrict_violation', CONSTRAINT = 'ingrediente_receta_receta_usada';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`DROP TRIGGER IF EXISTS ingrediente_receta_validar_receta_usada_trg ON ingrediente_receta;`);
  await client.query(`
    CREATE TRIGGER ingrediente_receta_validar_receta_usada_trg
      BEFORE INSERT OR UPDATE OR DELETE ON ingrediente_receta
      FOR EACH ROW EXECUTE FUNCTION ingrediente_receta_validar_receta_usada();
  `);

  await client.query('COMMIT');

  const cons = await client.query(`
    SELECT conname AS nombre, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'receta' AND c.contype = 'c'
    UNION ALL
    SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'receta_nombre_activo_unico'
    UNION ALL
    SELECT tgname, 'trigger en ' || tgrelid::regclass FROM pg_trigger WHERE tgname = 'ingrediente_receta_validar_receta_usada_trg'
  `);
  console.log('OK - reglas de receta:');
  console.table(cons.rows);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await p.end();
}
