import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// HU-10 / HU-29: el Chef no descuenta stock. Deja una solicitud y Bodega o Administración
// la aprueba. Recién ahí se inserta la merma y se actualizan lote y producto.

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim()
const pool = new Pool({ connectionString: url })
const client = await pool.connect()

try {
  await client.query('BEGIN')
  await client.query(`
    CREATE TABLE IF NOT EXISTS solicitud_merma (
      id SERIAL PRIMARY KEY,
      id_lote INTEGER NOT NULL REFERENCES lote(id) ON DELETE RESTRICT,
      id_solicitante INTEGER NOT NULL REFERENCES usuario(id),
      motivo VARCHAR(50) NOT NULL CHECK (motivo IN ('Vencimiento', 'Rotura/Daño', 'Deterioro', 'Error Operacional', 'Otro')),
      cantidad NUMERIC NOT NULL CHECK (cantidad > 0),
      observacion VARCHAR(300),
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
      fecha_solicitud TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id_revisor INTEGER REFERENCES usuario(id),
      fecha_revision TIMESTAMP,
      motivo_rechazo VARCHAR(300),
      id_merma INTEGER REFERENCES merma(id)
    );
  `)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS solicitud_merma_id_merma_unico
      ON solicitud_merma (id_merma) WHERE id_merma IS NOT NULL;
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS solicitud_merma_estado_idx ON solicitud_merma (estado, fecha_solicitud DESC);`)
  await client.query(`CREATE INDEX IF NOT EXISTS solicitud_merma_solicitante_idx ON solicitud_merma (id_solicitante, fecha_solicitud DESC);`)
  await client.query(`
    ALTER TABLE solicitud_merma
      DROP CONSTRAINT IF EXISTS solicitud_merma_revision_coherente,
      ADD CONSTRAINT solicitud_merma_revision_coherente CHECK (
        (estado = 'pendiente' AND id_revisor IS NULL AND fecha_revision IS NULL AND id_merma IS NULL AND motivo_rechazo IS NULL)
        OR (estado = 'aprobada' AND id_revisor IS NOT NULL AND fecha_revision IS NOT NULL AND id_merma IS NOT NULL AND motivo_rechazo IS NULL)
        OR (estado = 'rechazada' AND id_revisor IS NOT NULL AND fecha_revision IS NOT NULL AND id_merma IS NULL AND motivo_rechazo IS NOT NULL)
      );
  `)
  await client.query('COMMIT')
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'solicitud_merma'
    ORDER BY ordinal_position
  `)
  console.log('OK - solicitud_merma')
  console.table(cols.rows)
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
