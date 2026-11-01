import { useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'

function ComandaForm() {
  const [recetas, setRecetas] = useState([])
  const [recetaId, setRecetaId] = useState('')
  const [ficha, setFicha] = useState(null)
  const [platos, setPlatos] = useState('1')
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      try {
        const res = await fetchConAuth('/recetas?estado=activo')
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.success) setRecetas(data.data || [])
      } catch {
        setError('No se pudieron cargar las recetas activas.')
      }
    }
    cargar()
  }, [])

  useEffect(() => {
    if (!recetaId) {
      setFicha(null)
      return undefined
    }
    let vigente = true
    const cargarFicha = async () => {
      try {
        const res = await fetchConAuth(`/recetas/${recetaId}`)
        const data = await res.json().catch(() => ({}))
        if (!vigente) return
        if (!res.ok || !data.success) {
          setError(data.error || 'No se pudo leer la receta.')
          setFicha(null)
          return
        }
        setFicha(data.data)
      } catch {
        if (vigente) setError('Error de conexión con el servidor.')
      }
    }
    cargarFicha()
    return () => { vigente = false }
  }, [recetaId])

  const confirmar = async (e) => {
    e.preventDefault()
    setError('')
    setResultado(null)
    const cantidad = Number(platos)
    if (!recetaId || !Number.isInteger(cantidad) || cantidad <= 0) {
      setError('Elige una receta activa y una cantidad entera de platos.')
      return
    }

    setGuardando(true)
    try {
      const res = await fetchConAuth('/comandas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receta_id: Number(recetaId), cantidad_platos: cantidad }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        const faltantes = Array.isArray(data.faltantes)
          ? ` ${data.faltantes.map((f) => `${f.producto}: hay ${f.disponible_en_lotes}, se piden ${f.requerido}`).join('. ')}`
          : ''
        setError((data.error || 'No se pudo registrar la comanda.') + faltantes)
        return
      }
      setResultado(data.data)
      avisarInventarioActualizado()
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">🍽️</div>
        <div>
          <h1>Confirmar comanda</h1>
          <p className="subtitle">El stock sale primero del lote que vence antes (FEFO)</p>
        </div>
      </div>

      <p className="hint" style={{ marginBottom: 16 }}>
        Para la prueba: elige <strong>Ensalada de tomate</strong> y 1 plato. El descuento tiene que salir del lote de tomates que vence en 2 días, no del que vence en 5.
      </p>

      {error && <div className="error-msg">{error}</div>}

      <form onSubmit={confirmar}>
        <div className="grid">
          <div className="campo">
            <label htmlFor="recetaComanda">Receta activa *</label>
            <select
              id="recetaComanda"
              className="campo-select"
              value={recetaId}
              onChange={(e) => { setRecetaId(e.target.value); setResultado(null) }}
            >
              <option value="">Selecciona una receta...</option>
              {recetas.map((receta) => (
                <option key={receta.id} value={receta.id}>{receta.nombre_plato}</option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="cantidadPlatos">Cantidad de platos *</label>
            <input
              id="cantidadPlatos"
              type="number"
              min="1"
              step="1"
              value={platos}
              onChange={(e) => setPlatos(e.target.value)}
            />
          </div>
        </div>

        {ficha && (
          <ul className="lista-recetas" style={{ marginBottom: 16 }}>
            {ficha.ingredientes.map((ing) => (
              <li key={ing.producto_id}>
                <span>{ing.producto}</span>
                <span className="codigo">{ing.cantidad_requerida} {ing.unidad_medida} por plato</span>
              </li>
            ))}
          </ul>
        )}

        <button type="submit" className="btn-primary" disabled={guardando}>
          {guardando && <span className="btn-spinner" />}
          Confirmar Comanda
        </button>
      </form>

      {resultado && (
        <div className="exito-msg" style={{ marginTop: 16 }}>
          <strong>{resultado.receta.nombre_plato}</strong>: {resultado.cantidad_platos} plato(s). Stock descontado con FEFO.
          {resultado.consumo.map((item) => (
            <div key={item.producto} style={{ marginTop: 10 }}>
              <div>{item.producto}: se usaron {item.requerido} {item.unidad_medida}. Stock actual {item.stock_actual}.</div>
              <ul className="lotes-fefo">
                {item.lotes.map((lote) => (
                  <li key={lote.id}>
                    Lote {lote.numero_lote} vence {lote.fecha_vencimiento}: descontado {lote.descontado}, restante {lote.restante}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default ComandaForm
