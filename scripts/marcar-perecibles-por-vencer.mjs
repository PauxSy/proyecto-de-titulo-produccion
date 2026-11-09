import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Deja 2 a 3 insumos por categoría de alimento perecible dentro de 1 a 7 días.
// No toca secos, aceite, cacao, frutos secos ni almíbar.

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
const POR_CATEGORIA = 3
const CATEGORIAS = [
  'Frescos',
  'Frutas y Pulpas',
  'Lácteos y Rellenos',
  'Masas Base',
  'Rellenos',
  'Insumos Grasos',
  'Insumos Tradicionales',
  'Repostería Fina',
]
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
  'fondant',
].join('|')

try {
  await client.query('BEGIN')

  const candidatos = await client.query(
    `
      WITH fefo AS (
        SELECT DISTINCT ON (p.id)
               p.id AS producto_id,
               p.nombre,
               p.categoria,
               l.id AS lote_id,
               (l.fecha_vencimiento - ${HOY})::int AS dias
        FROM producto p
        JOIN lote l ON l.id_producto = p.id
        WHERE l.estado = 'ACTIVO'
          AND l.cantidad_disponible > 0
          AND p.categoria = ANY($1)
          AND p.nombre !~* $2
        ORDER BY p.id, l.fecha_vencimiento ASC, l.id ASC
      ),
      ranked AS (
        SELECT *,
               row_number() OVER (
                 PARTITION BY categoria
                 ORDER BY CASE WHEN dias BETWEEN 0 AND 7 THEN 0 ELSE 1 END, nombre
               ) AS n
        FROM fefo
      )
      SELECT *
      FROM ranked
      WHERE n <= $3
      ORDER BY categoria, n
    `,
    [CATEGORIAS, NO_PERECIBLE, POR_CATEGORIA]
  )

  let n = 0
  const actualizados = []
  for (const item of candidatos.rows) {
    if (item.dias >= 0 && item.dias <= 7) continue
    const dias = 1 + (n % 7)
    const fila = await client.query(
      `
        UPDATE lote
        SET fecha_vencimiento = (${HOY} + make_interval(days => $2::int))::date
        WHERE id = $1 AND id_producto = $3 AND estado = 'ACTIVO' AND cantidad_disponible > 0
        RETURNING id, numero_lote, fecha_vencimiento::text AS vence
      `,
      [item.lote_id, dias, item.producto_id]
    )
    if (fila.rowCount !== 1) {
      throw new Error(`No se actualizó el lote ${item.lote_id} (${item.nombre})`)
    }
    actualizados.push({
      categoria: item.categoria,
      nombre: item.nombre,
      lote: fila.rows[0].numero_lote,
      vence: fila.rows[0].vence,
      dias,
    })
    n += 1
  }

  await client.query('COMMIT')

  console.log(`Lotes nuevos en ventana de vencimiento: ${actualizados.length}`)
  console.table(actualizados)

  const ventana = await client.query(
    `
      SELECT p.categoria, p.nombre,
             MIN(l.fecha_vencimiento)::text AS vence,
             (MIN(l.fecha_vencimiento) - ${HOY})::int AS dias
      FROM lote l
      JOIN producto p ON p.id = l.id_producto
      WHERE l.estado = 'ACTIVO'
        AND l.cantidad_disponible > 0
        AND l.fecha_vencimiento >= ${HOY}
        AND l.fecha_vencimiento - ${HOY} <= 7
        AND NOT (p.categoria = ANY($1))
      GROUP BY p.id, p.nombre, p.categoria
      ORDER BY p.categoria, MIN(l.fecha_vencimiento)
    `,
    [['Aseo y Limpieza', 'Embalaje', 'Utensilios Descartables']]
  )
  console.log(`Insumos por vencer ahora: ${ventana.rowCount}`)
  console.table(ventana.rows)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
