import { useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'
import '../App.css'

function UmbralesForm({ producto, onClose, onActualizado }) {
  const [stockMinimo, setStockMinimo] = useState('')
  const [stockMaximo, setStockMaximo] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [guardando, setGuardando] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setExito('')

    const min = Number(stockMinimo)
    const max = Number(stockMaximo)

    if (stockMinimo === '' || stockMaximo === '') {
      setError('Ambos campos son obligatorios.')
      return
    }
    if (min < 0 || max < 0) {
      setError('No se permiten valores negativos.')
      return
    }
    if (max <= min) {
      setError('El Stock Máximo debe ser estrictamente mayor que el Stock Mínimo.')
      return
    }

    setGuardando(true)
    try {
      const res = await fetchConAuth(`/producto/${producto.id}/umbrales`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_minimo: min, stock_maximo: max }),
      })

      if (res.status === 403) {
        setError('Error de permisos: solo el Administrador puede modificar umbrales.')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.mensaje || 'No se pudo guardar. Intenta nuevamente.')
        return
      }

      setExito('Guardado exitoso.')
      avisarInventarioActualizado()
      if (onActualizado) onActualizado()
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="icon-badge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h1>Actualizar umbrales de stock</h1>
          <p className="subtitle">
            {producto.nombre} <span className="codigo">({producto.sku})</span>
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#6b7280' }}>
            ✕
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid">
          <div className="campo">
            <label htmlFor="stockMinimo">Stock mínimo *</label>
            <input
              id="stockMinimo"
              type="number"
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
              placeholder={`Actual: ${producto.stock_minimo}`}
            />
            <span className="hint">Por debajo de este valor se marcará Crítico.</span>
          </div>

          <div className="campo">
            <label htmlFor="stockMaximo">Stock máximo *</label>
            <input
              id="stockMaximo"
              type="number"
              value={stockMaximo}
              onChange={(e) => setStockMaximo(e.target.value)}
              placeholder={`Actual: ${producto.stock_maximo}`}
            />
            <span className="hint">Por encima de este valor se marcará Sobrestock.</span>
          </div>
        </div>

        {error && <p className="error-msg">⚠️ {error}</p>}
        {exito && <p className="exito-msg">✅ {exito}</p>}

        <button type="submit" className="btn-primary" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Actualizar umbrales'}
        </button>
      </form>
    </div>
  )
}

export default UmbralesForm