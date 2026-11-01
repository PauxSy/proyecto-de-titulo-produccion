import fs from 'fs'

// Los lotes de prueba quedaron con fechas que ya pasaron y el semáforo los muestra vencidos.
// Mueve los lotes activos vencidos a fechas futuras: uno de cada diez queda por vencer
// (2 a 6 días) y el resto queda vigente. Solo toca los que siguen vencidos a hoy en Chile.

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

const host = new URL(url).hostname
const HOY = `(NOW() AT TIME ZONE 'America/Santiago')::date`

const sql = async (query) => {
  const respuesta = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': url,
    },
    body: JSON.stringify({ query, params: [] }),
  })
  const texto = await respuesta.text()
  if (!respuesta.ok) {
    throw new Error(`La consulta falló (${respuesta.status}): ${texto.slice(0, 400)}`)
  }
  const datos = JSON.parse(texto)
  const filas = datos.rows ?? datos.results?.[0]?.rows ?? []
  if (filas.length > 0 && Array.isArray(filas[0])) {
    const campos = (datos.fields ?? datos.results?.[0]?.fields ?? []).map((campo) => campo.name)
    return filas.map((fila) => Object.fromEntries(campos.map((campo, i) => [campo, fila[i]])))
  }
  return filas
}

const resumen = async () => {
  const filas = await sql(`
    SELECT
      count(*) FILTER (WHERE l.fecha_vencimiento < ${HOY})::int AS vencidos,
      count(*) FILTER (WHERE l.fecha_vencimiento - ${HOY} BETWEEN 0 AND 7)::int AS por_vencer,
      count(*) FILTER (WHERE l.fecha_vencimiento - ${HOY} > 7)::int AS vigentes,
      count(*)::int AS activos
    FROM lote l
    WHERE l.estado = 'ACTIVO' AND l.cantidad_disponible > 0
  `)
  return filas[0]
}

try {
  const antes = await resumen()
  const actualizados = await sql(`
    WITH ordenados AS (
      SELECT id, row_number() OVER (ORDER BY fecha_vencimiento, id) AS n
      FROM lote
      WHERE estado = 'ACTIVO'
        AND cantidad_disponible > 0
        AND fecha_vencimiento < ${HOY}
    )
    UPDATE lote l
    SET fecha_vencimiento = (
      ${HOY} + make_interval(days => (CASE
        WHEN o.n % 10 = 1 THEN 2 + (o.n % 5)
        ELSE 25 + (o.n % 80)
      END)::int)
    )::date
    FROM ordenados o
    WHERE l.id = o.id
    RETURNING l.id
  `)
  const despues = await resumen()
  console.log(`Lotes activos con stock: ${despues.activos}`)
  console.log(`Fechas renovadas: ${actualizados.length}`)
  console.log(`Antes  -> vencidos ${antes.vencidos}, por vencer ${antes.por_vencer}, vigentes ${antes.vigentes}`)
  console.log(`Después -> vencidos ${despues.vencidos}, por vencer ${despues.por_vencer}, vigentes ${despues.vigentes}`)
} catch (error) {
  const mensaje = String(error.message || error).replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***')
  console.error('ERROR:', mensaje)
  process.exitCode = 1
}
