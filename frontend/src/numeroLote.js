export const PREFIJO_LOTE = 'LOT-'

export const MENSAJE_FORMATO_LOTE =
  'Después de LOT- escribe letras o números. El prefijo no se puede borrar.'

const FORMATO = /^LOT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/

export const normalizarNumeroLote = (valor) => String(valor ?? '').trim().toUpperCase()

export const restoNumeroLote = (valor) => {
  let resto = String(valor ?? '').toUpperCase().replace(/\s/g, '')
  if (resto.startsWith(PREFIJO_LOTE)) resto = resto.slice(PREFIJO_LOTE.length)
  return resto.replace(/[^A-Z0-9-]/g, '').slice(0, 40)
}

export const esNumeroLoteValido = (valor) => FORMATO.test(normalizarNumeroLote(valor))
