import { Pool } from '@neondatabase/serverless'
import fs from 'fs'

// Datos de prueba para Reportes y balances.
// En cada producto con un lote limpio y stock suficiente deja, dentro de los últimos 29 días:
// una entrada, una salida manual, una salida por comanda, una merma y una anulación.
// El lote que ya existía pasa a quedar antes del período, así el stock inicial deja de ser 0.
// El stock final sigue cuadrando con la suma de los lotes activos.
// Si ya se ejecutó (hay lotes DEMO-), no duplica nada.

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim()
const pool = new Pool({ connectionString: url })
const client = await pool.connect()

const hace = (dias) => `NOW() - make_interval(days => ${Number(dias)})`
const motivosMerma = ['Deterioro', 'Rotura/Daño', 'Error Operacional', 'Vencimiento', 'Otro']
const motivosManual = [
  'Uso en producción del día',
  'Preparación de pastelería',
  'Entrega a cocina para el servicio',
  'Porción usada en mise en place',
]

try {
  await client.query('BEGIN')
  await client.query('ALTER TABLE lote DISABLE TRIGGER lote_stock_igual_lotes_trg')
  await client.query('ALTER TABLE producto DISABLE TRIGGER producto_stock_igual_lotes_trg')

  const ya = await client.query(`SELECT 1 FROM lote WHERE numero_lote LIKE 'DEMO-%' LIMIT 1`)
  if (ya.rowCount > 0) {
    await client.query('ROLLBACK')
    console.log('Los datos de prueba del balance ya estaban cargados. No se duplicaron.')
  } else {

  const admin = await client.query(
    `SELECT id FROM usuario WHERE rol = 'Administrador' AND activo ORDER BY id LIMIT 1`
  )
  if (admin.rowCount === 0) throw new Error('No hay un administrador activo para registrar las anulaciones')
  const adminId = admin.rows[0].id

  const chef = await client.query(
    `SELECT id FROM usuario WHERE rol = 'Chef' AND activo ORDER BY id LIMIT 1`
  )
  const chefId = chef.rowCount > 0 ? chef.rows[0].id : adminId

  const receta = await client.query(
    `SELECT id FROM receta WHERE estado = 'activo' ORDER BY id LIMIT 1`
  )
  const recetaId = receta.rowCount > 0 ? receta.rows[0].id : null

  const candidatos = await client.query(`
    SELECT DISTINCT ON (p.id)
           p.id, l.id AS lote_id, l.cantidad_disponible::float8 AS disponible
    FROM producto p
    JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
    WHERE l.cantidad_disponible >= 12
      AND l.cantidad_inicial = l.cantidad_disponible
    ORDER BY p.id, l.cantidad_disponible DESC, l.id
  `)

  let aplicados = 0
  for (const fila of candidatos.rows) {
    const id = Number(fila.id)
    const disponible = Number(fila.disponible)
    const manual = 1 + (id % 4)
    const comanda = 1 + (id % 5)
    const merma = 1 + (id % 3)
    const extra = 2 + (id % 6)
    const anulacion = 2 + (id % 4)
    if (manual + comanda + merma >= disponible) continue

    const loteId = fila.lote_id
    const diasBase = id % 7

    await client.query(
      `UPDATE lote SET fecha_recepcion = ${hace(50 + diasBase)} WHERE id = $1`,
      [loteId]
    )
    await client.query(
      `UPDATE movimiento SET fecha = ${hace(50 + diasBase)} WHERE id_lote = $1 AND tipo = 'INGRESO'`,
      [loteId]
    )
    await client.query(
      `UPDATE lote SET cantidad_disponible = cantidad_disponible - $2 WHERE id = $1`,
      [loteId, manual + comanda + merma]
    )

    await client.query(
      `INSERT INTO merma (id_lote, id_usuario, motivo, cantidad, fecha)
       VALUES ($1, $2, $3, $4, ${hace(4 + diasBase)})`,
      [loteId, chefId, motivosMerma[id % motivosMerma.length], merma]
    )
    await client.query(
      `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario, motivo)
       VALUES ($1, 'SALIDA_MANUAL', $2, ${hace(7 + diasBase)}, $3, $4)`,
      [loteId, manual, chefId, motivosManual[id % motivosManual.length]]
    )
    await client.query(
      `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario, id_receta)
       VALUES ($1, 'SALIDA_COMANDA', $2, ${hace(5 + diasBase)}, $3, $4)`,
      [loteId, comanda, chefId, recetaId]
    )

    const entrada = await client.query(
      `INSERT INTO lote (id_producto, numero_lote, cantidad_inicial, cantidad_disponible, fecha_recepcion, fecha_vencimiento, origen)
       VALUES ($1, $2, $3, $3, ${hace(10 + diasBase)}, (CURRENT_DATE + 90), 'RECEPCION')
       RETURNING id`,
      [id, `DEMO-ENT-${id}`, extra]
    )
    await client.query(
      `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario)
       VALUES ($1, 'INGRESO', $2, ${hace(10 + diasBase)}, $3)`,
      [entrada.rows[0].id, extra, adminId]
    )

    const anulado = await client.query(
      `INSERT INTO lote (id_producto, numero_lote, cantidad_inicial, cantidad_disponible, fecha_recepcion, fecha_vencimiento, origen)
       VALUES ($1, $2, $3, $3, ${hace(6 + diasBase)}, (CURRENT_DATE + 60), 'RECEPCION')
       RETURNING id, cantidad_inicial`,
      [id, `DEMO-ANUL-${id}`, anulacion]
    )
    const loteAnuladoId = anulado.rows[0].id
    await client.query(
      `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario)
       VALUES ($1, 'INGRESO', $2, ${hace(6 + diasBase)}, $3)`,
      [loteAnuladoId, anulacion, adminId]
    )

    const stockAntes = await client.query(`SELECT stock_actual FROM producto WHERE id = $1`, [id])
    const motivoAnulacion = 'Lote de prueba cargado por error y anulado para el balance'
    await client.query(
      `UPDATE lote
       SET estado = 'ANULADO',
           cantidad_disponible = 0,
           fecha_anulacion = ${hace(3 + diasBase)},
           id_usuario_anulacion = $2,
           motivo_anulacion = $3
       WHERE id = $1`,
      [loteAnuladoId, adminId, motivoAnulacion]
    )
    await client.query(
      `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario)
       VALUES ($1, 'ANULACION', $2, ${hace(3 + diasBase)}, $3)`,
      [loteAnuladoId, anulacion, adminId]
    )
    const delta = extra - manual - comanda - merma
    const stockNuevo = await client.query(
      `UPDATE producto
       SET stock_actual = stock_actual + $2, fecha_actualizacion = NOW()
       WHERE id = $1
       RETURNING stock_actual`,
      [id, delta]
    )
    await client.query(
      `INSERT INTO log_anulaciones (id_usuario, id_lote, resultado, metodo_verificacion, motivo,
                                    cantidad_revertida, stock_anterior, stock_posterior, fecha)
       VALUES ($1, $2, 'ANULADO', 'PASSWORD', $3, $4, $5, $6, ${hace(3 + diasBase)})`,
      [adminId, loteAnuladoId, motivoAnulacion, anulacion, stockAntes.rows[0].stock_actual, stockNuevo.rows[0].stock_actual]
    )

    aplicados += 1
  }

  const descuadre = await client.query(`
    SELECT p.id
    FROM producto p
    LEFT JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
    GROUP BY p.id, p.stock_actual
    HAVING COALESCE(p.stock_actual, 0) <> COALESCE(SUM(l.cantidad_disponible), 0)
  `)
  if (descuadre.rowCount > 0) {
    throw new Error(`Stock distinto de los lotes en productos: ${descuadre.rows.map((r) => r.id).join(', ')}`)
  }

  await client.query('ALTER TABLE lote ENABLE TRIGGER lote_stock_igual_lotes_trg')
  await client.query('ALTER TABLE producto ENABLE TRIGGER producto_stock_igual_lotes_trg')
  await client.query('COMMIT')

  const resumen = await client.query(`
    WITH eventos AS (
      SELECT l.fecha_recepcion AS fecha, 'INGRESO' AS tipo FROM lote l
      UNION ALL
      SELECT m.fecha, 'MERMA' FROM merma m
      UNION ALL
      SELECT mv.fecha, mv.tipo FROM movimiento mv WHERE mv.tipo <> 'INGRESO'
    ),
    limites AS (
      SELECT (((NOW() AT TIME ZONE 'America/Santiago')::date - 29)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC' AS inicio,
             ((((NOW() AT TIME ZONE 'America/Santiago')::date + 1)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC') AS fin
    )
    SELECT
      COUNT(*) FILTER (WHERE tipo = 'INGRESO')::int AS entradas,
      COUNT(*) FILTER (WHERE tipo = 'SALIDA_MANUAL')::int AS salidas_manuales,
      COUNT(*) FILTER (WHERE tipo = 'SALIDA_COMANDA')::int AS salidas_comanda,
      COUNT(*) FILTER (WHERE tipo = 'MERMA')::int AS mermas,
      COUNT(*) FILTER (WHERE tipo = 'ANULACION')::int AS anulaciones
    FROM eventos e CROSS JOIN limites li
    WHERE e.fecha >= li.inicio AND e.fecha < li.fin
  `)

  console.log(`Listo. Movimientos de prueba en ${aplicados} productos.`)
  console.log('En el rango de los últimos 30 días:')
  console.table(resumen.rows)
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('ERROR:', err.message)
  process.exitCode = 1
} finally {
  await client.query('ALTER TABLE lote ENABLE TRIGGER lote_stock_igual_lotes_trg').catch(() => {})
  await client.query('ALTER TABLE producto ENABLE TRIGGER producto_stock_igual_lotes_trg').catch(() => {})
  client.release()
  await pool.end()
}
