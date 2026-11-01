import { useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'

const ETIQUETAS = {
  alerta_vencimiento_rojo_dias: 'Alerta roja de vencimiento (días)',
  alerta_vencimiento_amarillo_dias: 'Alerta amarilla de vencimiento (días)',
  margen_advertencia_stock_porcentaje: 'Margen de advertencia de stock (%)',
}

function AjustesSistema() {
  const [campos, setCampos] = useState([])
  const [valores, setValores] = useState({})
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const res = await fetchConAuth('/configuraciones')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudieron cargar los ajustes.')
        return
      }
      const numericos = (data.data || []).filter((item) => item.tipo === 'entero' || item.tipo === 'decimal')
      setCampos(numericos)
      setValores(Object.fromEntries(numericos.map((item) => [item.clave, String(item.valor)])))
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    const cuerpo = {}
    for (const campo of campos) {
      const texto = String(valores[campo.clave] ?? '').trim()
      if (texto === '' || Number(texto) < 0 || Number.isNaN(Number(texto))) {
        setError('Los umbrales no pueden quedar vacíos ni ser negativos.')
        return
      }
      cuerpo[campo.clave] = campo.tipo === 'entero' ? Number.parseInt(texto, 10) : Number(texto)
    }
    const rojo = cuerpo.alerta_vencimiento_rojo_dias
    const amarillo = cuerpo.alerta_vencimiento_amarillo_dias
    if (rojo !== undefined && amarillo !== undefined && !(rojo < amarillo)) {
      setError('La alerta roja debe ser de menos días que la alerta amarilla.')
      return
    }
    setGuardando(true)
    try {
      const res = await fetchConAuth('/configuraciones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudieron guardar los ajustes.')
        return
      }
      setAviso('Ajustes guardados. Las alertas y la tabla de lotes usan estos días.')
      avisarInventarioActualizado()
      await cargar()
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">⚙️</div>
        <div>
          <h1>Ajustes del Sistema</h1>
          <p className="subtitle">Umbrales globales de alerta. Solo el administrador puede cambiarlos.</p>
        </div>
      </div>
      {cargando && <p className="hint">Cargando ajustes...</p>}
      {error && <div className="error-msg">{error}</div>}
      {aviso && <div className="exito-msg">{aviso}</div>}
      {!cargando && (
        <form onSubmit={guardar}>
          <div className="grid">
            {campos.map((campo) => (
              <div className="campo" key={campo.clave}>
                <label htmlFor={campo.clave}>{ETIQUETAS[campo.clave] || campo.descripcion || campo.clave}</label>
                <input
                  id={campo.clave}
                  type="number"
                  min="0"
                  step={campo.tipo === 'entero' ? '1' : '0.01'}
                  value={valores[campo.clave] ?? ''}
                  onChange={(e) => setValores((prev) => ({ ...prev, [campo.clave]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <button type="submit" className="btn-mini" disabled={guardando || campos.length === 0}>
            {guardando ? 'Guardando...' : 'Guardar ajustes'}
          </button>
        </form>
      )}
    </section>
  )
}

export default AjustesSistema
