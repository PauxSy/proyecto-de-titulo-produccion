export const EVENTO_INVENTARIO = 'inventario-actualizado'
export const INTERVALO_INVENTARIO_MS = 8000

export const avisarInventarioActualizado = () => {
  window.dispatchEvent(new Event(EVENTO_INVENTARIO))
}

export const horaLocal = () =>
  new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const cortesVencimiento = (umbrales) => {
  const rojo = Number(umbrales?.rojo)
  const amarillo = Number(umbrales?.amarillo)
  if (!Number.isInteger(rojo) || !Number.isInteger(amarillo)) return null
  return {
    rojo,
    amarillo,
    critico: `Hasta ${rojo} días o vencido`,
    advertencia: rojo + 1 > amarillo ? `Hasta ${amarillo} días` : `De ${rojo + 1} a ${amarillo} días`,
    leyenda: `Cortes del administrador: rojo hasta ${rojo} días, amarillo hasta ${amarillo} días. El resto queda en gris.`,
  }
}
