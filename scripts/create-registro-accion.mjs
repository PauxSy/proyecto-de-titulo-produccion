import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Cada alta, ingreso, merma, salida o anulación deja fecha, usuario y la acción realizada.

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim()
const pool = new Pool({ connectionString: url })
const client = await pool.connect()

try {
  await client.query('BEGIN')
  await client.query(`
    CREATE TABLE IF NOT EXISTS registro_accion (
      id SERIAL PRIMARY KEY,
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id_usuario INTEGER NOT NULL REFERENCES usuario(id),
      accion VARCHAR(40) NOT NULL CHECK (accion IN (
        'ALTA_INSUMO', 'INGRESO_LOTE', 'MERMA', 'SALIDA_MANUAL', 'SALIDA_COMANDA', 'ANULACION_LOTE'
      )),
      detalle VARCHAR(300) NOT NULL
    );
  `)
  await client.query(`CREATE INDEX IF NOT EXISTS registro_accion_fecha_idx ON registro_accion (fecha DESC);`)
  await client.query('COMMIT')
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'registro_accion'
    ORDER BY ordinal_position
  `)
  console.log('OK - registro_accion')
  console.table(cols.rows)
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
