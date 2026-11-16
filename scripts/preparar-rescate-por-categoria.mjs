import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Acerca a 1–7 días los lotes FEFO de insumos afines a cada categoría de restaurante.
// Permite reutilizar el mismo producto en varias categorías (inventario limitado).
// Solo UPDATE de fechas; no crea tablas ni productos.

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
const POR_CATEGORIA = 4
const DULCES_SALADO = 'papaya|almibar|almíbar|mermelada|cacao|chocolate|manjar|colorante|vainilla|compota|jalea|prueba'

// Preferidos + fallbacks salados (tomate/huevo/harina/aceite) para demos con inventario de pastelería.
const PERFILES = {
  'Repostería': {
    patron: 'azucar|manjar|cacao|chocolate|harina|margarina|mantequilla|manteca|huevo|crema|leche|vainilla|fruta|nuez|almendra|dulce|maicena|miel|mermelada|arandano',
    excluir: 'soya|aji|jengibre|repollo|pescado|prueba',
  },
  'Comida Italiana': {
    patron: 'tomate|harina|queso|albahaca|pasta|cebolla|ajo|crema|oregano|huevo|aceite',
    excluir: DULCES_SALADO,
  },
  'Comida Rápida': {
    patron: 'tomate|queso|pan|harina|carne|pollo|papa|lechuga|huevo|cebolla|aceite',
    excluir: DULCES_SALADO,
  },
  'Comida Tailandesa': {
    patron: 'aji|coco|limon|lima|arroz|pollo|pescado|cebolla|jengibre|ajo|tomate|huevo|aceite|harina',
    excluir: DULCES_SALADO,
  },
  'Comida Chilena': {
    patron: 'tomate|aji|cebolla|carne|pollo|papa|choclo|harina|huevo|poroto|zapallo|aceite|queso',
    excluir: DULCES_SALADO,
  },
  'Comida China': {
    patron: 'arroz|pollo|carne|cebolla|ajo|jengibre|harina|soya|repollo|tomate|huevo|aceite',
    excluir: DULCES_SALADO,
  },
}

try {
  await client.query('BEGIN')

  const actualizados = []
  const fechasAsignadas = new Map() // producto_id -> { dias, vence, lote }
  let n = 0

  for (const [categoria, perfil] of Object.entries(PERFILES)) {
    const candidatos = await client.query(
      `
        WITH fefo AS (
          SELECT DISTINCT ON (p.id)
                 p.id AS producto_id,
                 p.nombre,
                 p.categoria AS categoria_producto,
                 l.id AS lote_id,
                 (l.fecha_vencimiento - ${HOY})::int AS dias
          FROM producto p
          JOIN lote l ON l.id_producto = p.id
          WHERE l.estado = 'ACTIVO'
            AND l.cantidad_disponible > 0
            AND NOT (p.categoria = ANY($1))
            AND p.nombre ~* $2
            AND p.nombre !~* $3
          ORDER BY p.id, l.fecha_vencimiento ASC, l.id ASC
        )
        SELECT *
        FROM fefo
        ORDER BY
          CASE WHEN dias BETWEEN 0 AND 7 THEN 0 ELSE 1 END,
          dias NULLS LAST,
          nombre
        LIMIT $4
      `,
      [NO_ALIMENTO, perfil.patron, perfil.excluir, POR_CATEGORIA * 4]
    )

    let tomados = 0
    for (const item of candidatos.rows) {
      if (tomados >= POR_CATEGORIA) break

      let dias
      let vence
      let lote

      if (fechasAsignadas.has(item.producto_id)) {
        const prev = fechasAsignadas.get(item.producto_id)
        dias = prev.dias
        vence = prev.vence
        lote = prev.lote
      } else if (item.dias != null && item.dias >= 0 && item.dias <= 7) {
        const fila = await client.query(
          `SELECT numero_lote, fecha_vencimiento::text AS vence FROM lote WHERE id = $1`,
          [item.lote_id]
        )
        dias = item.dias
        vence = fila.rows[0]?.vence
        lote = fila.rows[0]?.numero_lote
        fechasAsignadas.set(item.producto_id, { dias, vence, lote })
      } else {
        dias = 1 + (n % 7)
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
        vence = fila.rows[0].vence
        lote = fila.rows[0].numero_lote
        fechasAsignadas.set(item.producto_id, { dias, vence, lote })
        n += 1
      }

      actualizados.push({
        categoria_restaurante: categoria,
        nombre: item.nombre,
        lote,
        vence,
        dias,
      })
      tomados += 1
    }

    if (tomados === 0) {
      console.warn(`Sin candidatos para ${categoria}`)
    }
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

  console.log(`Cobertura por categoría de restaurante (${actualizados.length} filas):`)
  console.table(actualizados)

  const resumen = Object.keys(PERFILES).map((categoria) => ({
    categoria,
    insumos: actualizados.filter((f) => f.categoria_restaurante === categoria).length,
  }))
  console.table(resumen)

  const ventana = await client.query(
    `
      SELECT p.nombre,
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
  console.log(`Total insumos en ventana 0–7 días: ${ventana.rowCount}`)
  console.table(ventana.rows)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
