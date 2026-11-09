import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Saca de la alerta amarilla (0 a 7 días) los secos, aceite, frutos secos,
// cacao, chocolate, almíbar y leches en lata. Les deja 30 días de vida.

const archivo = ['.dev.vars', 'dev.vars'].find((nombre) => fs.existsSync(nombre))
if (!archivo) {
  console.error('No está .dev.vars ni dev.vars')
  process.exit(1)
}
const url = fs.readFileSync(archivo, 'utf8').match(/DATABASE_URL=(.+)/)?.[1]?.trim()
if (!url) {
  console.error(`${archivo} no tiene DATABASE_URL`)
  process.exit(1)
}

const pool = new Pool({ connectionString: url })
const client = await pool.connect()
const HOY = `(NOW() AT TIME ZONE 'America/Santiago')::date`
const NO_PERECIBLE = [
  'harina',
  'az[uú]car',
  'sal fina',
  'sal de mesa',
  'aceite',
  'cacao',
  'almendra',
  'avellana',
  'nuez',
  'mani',
  'pasta de goma',
  'alm[ií]bar',
  'leche evaporada',
  'leche condensada',
  'chocolate',
  'arroz',
  'fideo',
  'pasta',
  'maicena',
  'colorante',
  'vainilla',
  'vinagre',
  'soya',
  'polvos de hornear',
].join('|')

try {
  await client.query('BEGIN')

  const actualizados = await client.query(
    `
      UPDATE lote l
      SET fecha_vencimiento = (${HOY} + 30)
      FROM producto p
      WHERE p.id = l.id_producto
        AND l.estado = 'ACTIVO'
        AND l.cantidad_disponible > 0
        AND l.fecha_vencimiento >= ${HOY}
        AND l.fecha_vencimiento - ${HOY} <= 7
        AND p.nombre ~* $1
      RETURNING p.nombre, l.id AS lote_id, l.numero_lote, l.fecha_vencimiento::text AS vence
    `,
    [NO_PERECIBLE]
  )

  await client.query('COMMIT')

  console.log(`Lotes no perecibles actualizados a 30 días: ${actualizados.rowCount}`)
  console.table(actualizados.rows)

  const quedan = await client.query(`
    SELECT p.nombre, p.categoria,
           l.numero_lote, l.fecha_vencimiento::text AS vence,
           (l.fecha_vencimiento - ${HOY})::int AS dias
    FROM lote l
    JOIN producto p ON p.id = l.id_producto
    WHERE l.estado = 'ACTIVO'
      AND l.cantidad_disponible > 0
      AND l.fecha_vencimiento >= ${HOY}
      AND l.fecha_vencimiento - ${HOY} <= 7
    ORDER BY l.fecha_vencimiento, p.nombre
  `)
  console.log(`Siguen próximos a vencer (perecibles): ${quedan.rowCount}`)
  console.table(quedan.rows)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
