import { useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'
import BuscadorInsumo from './BuscadorInsumo'

function SalidaManualForm() {
  const [producto, setProducto] = useState(null)
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)

  const disponible = producto ? Number(producto.disponible_para_salida) : null
  const cantidadNum = Number(cantidad)
  const superaStock = producto && Number.isFinite(cantidadNum) && cantidadNum > disponible

  const registrar = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    if (!producto) {
      setError('Busca y elige un insumo por nombre o código.')
      return
    }
    if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
      setError('La cantidad debe ser un número mayor a 0.')
      return
    }
    if (superaStock) {
      setError(`La salida (${cantidadNum}) supera la existencia disponible en lotes vigentes (${disponible}). La acción queda bloqueada.`)
      return
    }
    if (motivo.trim().length < 5 || motivo.trim().length > 200) {
      setError('El motivo debe tener entre 5 y 200 caracteres.')
      return
    }

    setGuardando(true)
    try {
      const res = await fetchConAuth('/inventario/salida-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto_id: producto.id,
          cantidad: cantidadNum,
          motivo: motivo.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo registrar la salida.')
        return
      }
      setAviso(`Salida registrada. Stock de ${data.data.producto.nombre}: ${data.data.producto.stock_actual}.`)
      avisarInventarioActualizado()
      setProducto(null)
      setCantidad('')
      setMotivo('')
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">📤</div>
        <div>
          <h1>Salida manual</h1>
          <p className="subtitle">Busca el insumo por código o por nombre</p>
        </div>
      </div>

      <p className="hint" style={{ marginBottom: 16 }}>
        Para la prueba: busca <strong>QA-10KG</strong> o «10 kg». Ese insumo tiene 10 disponibles. Si pides 50, el sistema no deja registrar la salida.
      </p>

      {error && <div className="error-msg">{error}</div>}
      {aviso && <div className="exito-msg">{aviso}</div>}
      {superaStock && !error && (
        <div className="error-msg">
          La salida ({cantidadNum}) supera la existencia disponible en lotes vigentes ({disponible}). La acción queda bloqueada.
        </div>
      )}

      <form onSubmit={registrar}>
        <div className="campo" style={{ marginBottom: 16 }}>
          <label>Insumo *</label>
          <BuscadorInsumo
            seleccionado={producto}
            onSeleccionar={(item) => { setProducto(item); setError(''); setAviso('') }}
          />
        </div>
        <div className="grid">
          <div className="campo">
            <label htmlFor="cantidadSalida">Cantidad *</label>
            <input
              id="cantidadSalida"
              type="number"
              min="0"
              step="0.01"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="ej: 50"
            />
          </div>
          <div className="campo">
            <label htmlFor="motivoSalida">Motivo *</label>
            <input
              id="motivoSalida"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ej: Ajuste de cocina"
            />
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={guardando || superaStock}>
          {guardando && <span className="btn-spinner" />}
          Registrar salida
        </button>
      </form>
    </section>
  )
}

export default SalidaManualForm
