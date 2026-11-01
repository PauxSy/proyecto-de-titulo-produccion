import { useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'
import { esPosteriorAHoy, minimoVencimiento } from '../fechas'
import { esNumeroLoteValido, MENSAJE_FORMATO_LOTE, normalizarNumeroLote, PREFIJO_LOTE } from '../numeroLote'
import CampoNumeroLote from './CampoNumeroLote'
import ModalConfirmarLote from './ModalConfirmarLote'
import '../App.css'

function ConfirmarLoteForm({ producto, onClose, onConfirmado }) {
  const [numeroLote, setNumeroLote] = useState(PREFIJO_LOTE)
  const [cantidad, setCantidad] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [mostrarResumen, setMostrarResumen] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const stockAnterior = producto.stock_actual
  const fechaMinima = minimoVencimiento()

  const alCambiarVencimiento = (valor) => {
    if (valor && !esPosteriorAHoy(valor)) {
      setFechaVencimiento('')
      setError('La fecha de vencimiento debe ser posterior al día de hoy.')
      return
    }
    setError('')
    setFechaVencimiento(valor)
  }

  const validarDatos = () => {
    if (!numeroLote.trim() || !cantidad || !fechaVencimiento) {
      setError('Todos los campos son obligatorios.')
      return false
    }
    if (!esNumeroLoteValido(numeroLote)) {
      setError(MENSAJE_FORMATO_LOTE)
      return false
    }
    const cantidadNum = Number(cantidad)
    if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
      setError('La cantidad debe ser un número mayor a 0.')
      return false
    }
    if (!esPosteriorAHoy(fechaVencimiento)) {
      setError('La fecha de vencimiento debe ser posterior al día de hoy.')
      return false
    }
    return true
  }

  const handleRevisar = (e) => {
    e.preventDefault()
    setError('')
    if (!validarDatos()) return
    setMostrarResumen(true)
  }

  const handleConfirmar = async () => {
    setGuardando(true)
    setError('')
    try {
      const res = await fetchConAuth('/lotes/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero_lote: normalizarNumeroLote(numeroLote),
          producto_id: producto.id,
          cantidad: Number(cantidad),
          fecha_vencimiento: fechaVencimiento,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 403) {
        setError('No tienes permisos para registrar lotes.')
        return
      }
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo registrar el lote.')
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

  const volverAlInventario = () => {
    if (onConfirmado) onConfirmado(resultado)
    else onClose()
  }

  const cancelarConfirmacion = () => {
    if (guardando) return
    setError('')
    setMostrarResumen(false)
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="icon-badge">📦</div>
        <div className="card-header-texto">
          <h1>Confirmar ingreso de lote</h1>
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

      <form onSubmit={handleRevisar}>
        <div className="campo" style={{ marginBottom: '16px' }}>
          <label htmlFor="numeroLote">Número de lote *</label>
          <CampoNumeroLote id="numeroLote" value={numeroLote} onChange={setNumeroLote} />
          <span className="hint">LOT- queda fijo. Escribe el resto con letras y números.</span>
        </div>

        <div className="grid">
          <div className="campo">
            <label htmlFor="cantidad">Cantidad recibida *</label>
            <input
              id="cantidad"
              type="number"
              min="0"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="ej: 25"
            />
          </div>
          <div className="campo">
            <label htmlFor="fechaVencimiento">Fecha de vencimiento *</label>
            <input
              id="fechaVencimiento"
              type="date"
              value={fechaVencimiento}
              onChange={(e) => alCambiarVencimiento(e.target.value)}
              min={fechaMinima}
            />
            <span className="hint">El calendario no permite hoy ni fechas pasadas.</span>
          </div>
        </div>

        {error && !mostrarResumen && <p className="error-msg">⚠️ {error}</p>}

        <button type="submit" className="btn-primary">
          Revisar antes de confirmar
        </button>
      </form>

      {mostrarResumen && (
        <ModalConfirmarLote
          numeroLote={normalizarNumeroLote(numeroLote)}
          productoNombre={producto.nombre}
          cantidad={cantidad}
          unidad={producto.unidad}
          fechaVencimiento={fechaVencimiento}
          stockAnterior={stockAnterior}
          resultado={resultado}
          error={error}
          guardando={guardando}
          onCancelar={cancelarConfirmacion}
          onConfirmar={handleConfirmar}
          onCerrarExito={volverAlInventario}
        />
      )}
    </div>
  )
}

export default ConfirmarLoteForm