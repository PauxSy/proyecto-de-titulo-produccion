import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Deja ~20 insumos alimentarios dentro de la alerta amarilla (0 a 7 días)
// para que Chef IA tenga variedad. Solo cambia fechas de vencimiento.

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
const NO_ALIMENTO = ['Aseo y Limpieza', 'Embalaje', 'Utensilios Descartables']
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
const OBJETIVO = 20

try {
  await client.query('BEGIN')

  const candidatos = await client.query(
    `
      WITH lote_fefo AS (
        SELECT DISTINCT ON (p.id)
               p.id AS producto_id,
               p.nombre,
               p.categoria,
               l.id AS lote_id,
               l.numero_lote,
               l.cantidad_disponible
        FROM producto p
        JOIN lote l ON l.id_producto = p.id
        WHERE l.estado = 'ACTIVO'
          AND l.cantidad_disponible > 0
          AND NOT (p.categoria = ANY($1))
          AND p.nombre !~* $3
          AND p.nombre !~* 'prueba|colorante'
        ORDER BY p.id, l.fecha_vencimiento ASC, l.id ASC
      )
      SELECT *
      FROM lote_fefo
      ORDER BY
        CASE
          WHEN nombre ~* 'pollo|carne|tomate|cebolla|ajo|aji|limon|lima|coco|jengibre|huevo|leche|queso|papa|choclo|manjar'
            THEN 0
          ELSE 1
        END,
        nombre
      LIMIT $2
    `,
    [NO_ALIMENTO, OBJETIVO, NO_PERECIBLE]
  )

  if (candidatos.rowCount === 0) {
    throw new Error('No hay lotes activos de insumos alimentarios para marcar por vencer')
  }

  let n = 0
  for (const item of candidatos.rows) {
    const dias = 1 + (n % 7)
    const actualizado = await client.query(
      `
        UPDATE lote
        SET fecha_vencimiento = (${HOY} + make_interval(days => $2::int))::date
        WHERE id = $1 AND id_producto = $3 AND estado = 'ACTIVO' AND cantidad_disponible > 0
        RETURNING id, numero_lote, fecha_vencimiento::text AS vence, cantidad_disponible::float8 AS disp
      `,
      [item.lote_id, dias, item.producto_id]
    )
    if (actualizado.rowCount !== 1) {
      throw new Error(`No se actualizó el lote ${item.lote_id} (${item.nombre})`)
    }
    n += 1
  }

  const descuadre = await client.query(`
    SELECT p.id
    FROM producto p
    LEFT JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
    GROUP BY p.id, p.stock_actual
    HAVING p.stock_actual <> COALESCE(SUM(l.cantidad_disponible), 0)
  `)
  if (descuadre.rowCount > 0) {
    throw new Error(`El stock dejó de cuadrar en: ${descuadre.rows.map((r) => r.id).join(', ')}`)
  }

  await client.query('COMMIT')

  const ventana = await client.query(
    `
      SELECT p.nombre, SUM(l.cantidad_disponible)::float8 AS cantidad,
             MIN(l.fecha_vencimiento)::text AS vence,
             (MIN(l.fecha_vencimiento) - ${HOY})::int AS dias
      FROM lote l
      JOIN producto p ON p.id = l.id_producto
      WHERE l.estado = 'ACTIVO'
        AND l.cantidad_disponible > 0
        AND l.fecha_vencimiento >= ${HOY}
        AND l.fecha_vencimiento - ${HOY} <= 7
        AND NOT (p.categoria = ANY($1))
      GROUP BY p.id, p.nombre
      ORDER BY MIN(l.fecha_vencimiento), p.nombre
    `,
    [NO_ALIMENTO]
  )

  console.log(`Insumos por vencer (0 a 7 días): ${ventana.rowCount}`)
  console.table(ventana.rows)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
