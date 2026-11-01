import { useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'

function BuscadorInsumo({ seleccionado, onSeleccionar, placeholder = 'Buscar por nombre, SKU o código', bloqueado = false }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const consulta = texto.trim()
    if (consulta.length < 1) {
      setResultados([])
      setBuscando(false)
      return undefined
    }

    let vigente = true
    setBuscando(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetchConAuth(`/inventario/insumos?q=${encodeURIComponent(consulta)}`)
        const data = await res.json().catch(() => ({}))
        if (!vigente) return
        if (!res.ok || !data.success) {
          setError(data.error || 'No se pudo buscar insumos.')
          setResultados([])
          return
        }
        setError('')
        setResultados(data.data || [])
      } catch {
        if (vigente) setError('Error de conexión con el servidor.')
      } finally {
        if (vigente) setBuscando(false)
      }
    }, 300)

    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [texto])

  if (seleccionado) {
    return (
      <div className="insumo-elegido">
        <div>
          <strong>{seleccionado.nombre}</strong>
          <span className="codigo"> {seleccionado.sku}</span>
          {seleccionado.disponible_para_salida !== undefined && (
            <span className="hint" style={{ display: 'block', marginTop: 2 }}>
              Disponible en lotes vigentes: {Number(seleccionado.disponible_para_salida).toLocaleString('es-CL')}
            </span>
          )}
        </div>
        {!bloqueado && (
          <button type="button" className="btn-mini btn-mini-outline" onClick={() => onSeleccionar(null)}>
            Cambiar
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="buscador-insumo">
      <input
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {buscando && <span className="hint">Buscando...</span>}
      {error && <span className="hint" style={{ color: '#b91c1c' }}>{error}</span>}
      {resultados.length > 0 && (
        <ul className="buscador-resultados">
          {resultados.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  onSeleccionar(item)
                  setTexto('')
                  setResultados([])
                }}
              >
                <span>{item.nombre}</span>
                <span className="codigo">{item.sku}</span>
                <span className="codigo">
                  Disp. {Number(item.disponible_para_salida).toLocaleString('es-CL')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!buscando && texto.trim() && resultados.length === 0 && !error && (
        <span className="hint">Ningún insumo coincide con esa búsqueda.</span>
      )}
    </div>
  )
}

export default BuscadorInsumo
