const aIsoLocal = (fecha) => {
  const año = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${año}-${mes}-${dia}`
}

export const hoyLocal = () => {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return aIsoLocal(hoy)
}

const diaSiguiente = (iso) => {
  const fecha = new Date(`${iso}T00:00:00`)
  fecha.setDate(fecha.getDate() + 1)
  return aIsoLocal(fecha)
}

// HU-06: el vencimiento es estrictamente posterior a hoy. Si el ingreso es futuro, también posterior a ese día.
export const minimoVencimiento = (fechaIngreso) => {
  const manana = diaSiguiente(hoyLocal())
  if (!fechaIngreso) return manana
  const despuesDelIngreso = diaSiguiente(fechaIngreso)
  return despuesDelIngreso > manana ? despuesDelIngreso : manana
}

export const esPosteriorAHoy = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso > hoyLocal()

export const noEsPasada = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= hoyLocal()
