import { PREFIJO_LOTE, restoNumeroLote } from '../numeroLote'

function CampoNumeroLote({ id, value, onChange }) {
  const resto = value.startsWith(PREFIJO_LOTE) ? value.slice(PREFIJO_LOTE.length) : ''

  return (
    <div className="lote-numero">
      <span className="lote-prefijo" aria-hidden="true">{PREFIJO_LOTE}</span>
      <input
        id={id}
        type="text"
        value={resto}
        onChange={(e) => onChange(PREFIJO_LOTE + restoNumeroLote(e.target.value))}
        placeholder="20260925-A1"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label="Resto del número de lote, después de LOT-"
      />
    </div>
  )
}

export default CampoNumeroLote
