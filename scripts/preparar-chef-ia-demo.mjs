import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Deja insumos reales dentro de la alerta amarilla (7 días) para que Chef IA
// arme sugerencias. Solo cambia fechas de vencimiento: las cantidades y el
// balance quedan igual. Se puede volver a ejecutar; las fechas se recalculan
// desde el día de hoy en Chile.

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim()
const pool = new Pool({ connectionString: url })
const client = await pool.connect()

const HOY = `(NOW() AT TIME ZONE 'America/Santiago')::date`

const lotes = [
  { id: 236, productoId: 269, dias: 1, nombre: 'Tomate fresco' },
  { id: 125, productoId: 123, dias: 2, nombre: 'Aceite Vegetal Maravilla 1L' },
  { id: 237, productoId: 269, dias: 3, nombre: 'Tomate fresco' },
  { id: 104, productoId: 102, dias: 5, nombre: 'Harina de Trigo Tradicional 1kg' },
  { id: 118, productoId: 116, dias: 6, nombre: 'Crema para Batir UHT 1L' },
  { id: 111, productoId: 109, dias: 6, nombre: 'Cacao Amargo en Polvo 200g' },
  { id: 115, productoId: 113, dias: 7, nombre: 'Manjar Tradicional Repostero 1kg' },
]

try {
  await client.query('BEGIN')

  const azucar = await client.query(`
    SELECT l.id AS lote_id, p.id AS producto_id, p.nombre
    FROM lote l
    JOIN producto p ON p.id = l.id_producto
    WHERE l.estado = 'ACTIVO'
      AND l.cantidad_disponible > 0
      AND p.nombre ~* 'azucar|azúcar'
    ORDER BY l.cantidad_disponible DESC, l.id
    LIMIT 1
  `)
  if (azucar.rowCount === 1) {
    lotes.push({
      id: azucar.rows[0].lote_id,
      productoId: azucar.rows[0].producto_id,
      dias: 4,
      nombre: azucar.rows[0].nombre,
    })
  }

  for (const item of lotes) {
    const actualizado = await client.query(
      `
        UPDATE lote
        SET fecha_vencimiento = (${HOY} + make_interval(days => $2::int))::date
        WHERE id = $1 AND id_producto = $3 AND estado = 'ACTIVO' AND cantidad_disponible > 0
        RETURNING id, numero_lote, fecha_vencimiento::text AS vence, cantidad_disponible::float8 AS disp
      `,
      [item.id, item.dias, item.productoId]
    )
    if (actualizado.rowCount !== 1) {
      throw new Error(`No se actualizó el lote ${item.id} (${item.nombre})`)
    }
  }

  await client.query(
    `
      UPDATE lote
      SET fecha_vencimiento = (${HOY} + 40)::date
      WHERE numero_lote = 'LOT-QA-10KG'
        AND estado = 'ACTIVO'
        AND fecha_vencimiento <= (${HOY} + 7)::date
    `
  )

  const ya = await client.query(
    `SELECT id FROM receta WHERE estado = 'activo' AND LOWER(TRIM(nombre_plato)) = LOWER(TRIM($1))`,
    ['Bruschetta de tomate']
  )
  if (ya.rowCount === 0) {
    const creada = await client.query(
      `INSERT INTO receta (nombre_plato, porciones, rubro) VALUES ($1, $2, $3) RETURNING id`,
      ['Bruschetta de tomate', 2, 'Comida Italiana']
    )
    const recetaId = creada.rows[0].id
    await client.query(
      `
        INSERT INTO ingrediente_receta (id_receta, id_producto, cantidad_requerida, unidad_medida)
        VALUES
          ($1, 269, 2, 'un'),
          ($1, 123, 1, 'un')
      `,
      [recetaId]
    )
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

  const ventana = await client.query(`
    SELECT p.nombre, SUM(l.cantidad_disponible)::float8 AS cantidad,
           MIN(l.fecha_vencimiento)::text AS vence,
           MIN(l.fecha_vencimiento) - ${HOY} AS dias
    FROM lote l
    JOIN producto p ON p.id = l.id_producto
    WHERE l.estado = 'ACTIVO'
      AND l.cantidad_disponible > 0
      AND l.fecha_vencimiento >= ${HOY}
      AND l.fecha_vencimiento - ${HOY} <= 7
      AND NOT (p.categoria = ANY($1))
    GROUP BY p.id, p.nombre
    ORDER BY MIN(l.fecha_vencimiento), p.nombre
  `, [['Aseo y Limpieza', 'Embalaje', 'Utensilios Descartables']])

  console.log('Insumos que Chef IA va a usar:')
  console.table(ventana.rows)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
