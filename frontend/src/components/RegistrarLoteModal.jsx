import { useState, useEffect } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'
import { esPosteriorAHoy, hoyLocal, minimoVencimiento, noEsPasada } from '../fechas'
import { esNumeroLoteValido, MENSAJE_FORMATO_LOTE, normalizarNumeroLote, PREFIJO_LOTE } from '../numeroLote'
import CampoNumeroLote from './CampoNumeroLote'
import ModalConfirmarLote from './ModalConfirmarLote'
import '../App.css'

function RegistrarLoteModal({ productoInicial, onClose, onRegistrado }) {
  const usuario = JSON.parse(localStorage.getItem('usuario') || '{}')

  const [productos, setProductos] = useState([])
  const [productoId, setProductoId] = useState(productoInicial?.id || '')
  const [numeroLote, setNumeroLote] = useState(PREFIJO_LOTE)
  const [cantidad, setCantidad] = useState('')
  const [costoUnitario, setCostoUnitario] = useState('')
  const [fechaIngreso, setFechaIngreso] = useState(hoyLocal)
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [notas, setNotas] = useState(
    productoInicial?.codigo_de_barra
      ? `Recepción escaneada (Código: ${productoInicial.codigo_de_barra})`
      : ''
  )
  const [mensajeEscaneo, setMensajeEscaneo] = useState(
    productoInicial?.nombre
      ? `¡Insumo reconocido por escaneo: ${productoInicial.nombre} (${productoInicial.sku})!`
      : ''
  )
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mostrarResumen, setMostrarResumen] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [stockAlRevisar, setStockAlRevisar] = useState(null)

  useEffect(() => {
    const cargarProductos = async () => {
      try {
        const res = await fetchConAuth('/productos/estado-stock')
        const data = await res.json()
        if (res.ok && data.success) setProductos(data.data)
      } catch {
        // si falla, el select queda vacío; el usuario puede reintentar cerrando y reabriendo
      }
    }
    cargarProductos()
  }, [])

  const productoSeleccionado = productos.find((p) => String(p.id) === String(productoId))

  const fechaMinimaVencimiento = minimoVencimiento(fechaIngreso)

  const alCambiarIngreso = (valor) => {
    if (valor && !noEsPasada(valor)) {
      setError('La fecha de ingreso no puede ser anterior a hoy.')
      return
    }
    setFechaIngreso(valor)
    const minimo = minimoVencimiento(valor)
    if (fechaVencimiento && fechaVencimiento < minimo) {
      setFechaVencimiento('')
      setError('La fecha de vencimiento debe ser posterior al día de hoy.')
      return
    }
    setError('')
  }

  const alCambiarVencimiento = (valor) => {
    if (valor && (!esPosteriorAHoy(valor) || valor < fechaMinimaVencimiento)) {
      setFechaVencimiento('')
      setError('La fecha de vencimiento debe ser posterior al día de hoy.')
      return
    }
    setError('')
    setFechaVencimiento(valor)
  }

  const validar = () => {
    if (!productoId || !numeroLote.trim() || !cantidad || !fechaVencimiento) {
      setError('Insumo, número de lote, cantidad y fecha de vencimiento son obligatorios.')
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
    if (!noEsPasada(fechaIngreso)) {
      setError('La fecha de ingreso no puede ser anterior a hoy.')
      return false
    }
    if (!esPosteriorAHoy(fechaVencimiento) || fechaVencimiento < fechaMinimaVencimiento) {
      setError('La fecha de vencimiento debe ser posterior al día de hoy.')
      return false
    }
    if (costoUnitario !== '') {
      const costo = Number(costoUnitario)
      if (!Number.isFinite(costo) || costo < 0) {
        setError('El costo unitario debe ser un número mayor o igual a 0.')
        return false
      }
    }
    if (notas.trim().length > 300) {
      setError('Las notas admiten como máximo 300 caracteres.')
      return false
    }
    return true
  }

  const handleRevisar = (e) => {
    e.preventDefault()
    setError('')
    if (!validar()) return
    setStockAlRevisar(productoSeleccionado?.stock_actual ?? productoInicial?.stock_actual)
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
          producto_id: Number(productoId),
          cantidad: Number(cantidad),
          fecha_vencimiento: fechaVencimiento,
          ...(costoUnitario !== '' ? { costo_unitario: Number(costoUnitario) } : {}),
          ...(notas.trim() ? { notas: notas.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 401 || res.status === 403) {
        setError('No tienes permisos para registrar lotes.')
        return
      }
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo registrar el lote.')
        return
      }

      const actualizado = data.data?.producto
      if (actualizado?.id != null) {
        setProductos((prev) =>
          prev.map((p) =>
            Number(p.id) === Number(actualizado.id)
              ? { ...p, stock_actual: actualizado.stock_actual }
              : p
          )
        )
      }
      setResultado(data.data)
      avisarInventarioActualizado()
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const cerrar = () => {
    if (resultado) onRegistrado(resultado)
    else if (!guardando) onClose()
  }

  return (
    <div className="modal-overlay" onClick={cerrar}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="icon-badge" style={{ width: '34px', height: '34px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Recepción y registro de lote</h2>
            <p style={{ margin: 0, fontSize: '12.5px', color: '#6b7280' }}>
              Ingreso a bodega con trazabilidad FEFO inmediata
            </p>
          </div>
          <button onClick={cerrar} className="modal-close-btn" disabled={guardando}>✕</button>
        </div>

        {usuario?.nombre && (
          <div className="registrado-por-box">
            <span>Registrado por: <strong>{usuario.nombre}</strong></span>
            <span className="rol-chip-mini">Rol: {usuario.rol?.toUpperCase()}</span>
          </div>
        )}

        {mensajeEscaneo && (
          <div className="exito-msg" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>✅ {mensajeEscaneo}</span>
            <button
              type="button"
              onClick={() => setMensajeEscaneo('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803d' }}
            >
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleRevisar}>
          <div className="campo" style={{ marginBottom: '14px' }}>
            <label>Insumo / Producto *</label>
            <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="campo-select">
              <option value="">Selecciona un insumo...</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} - {p.sku} (Stock actual: {p.stock_actual})
                </option>
              ))}
            </select>
          </div>

          <div className="campo" style={{ marginBottom: '14px' }}>
            <label>Número de lote / partida *</label>
            <CampoNumeroLote value={numeroLote} onChange={setNumeroLote} />
            <span className="hint">LOT- queda fijo. Escribe el resto con letras y números.</span>
          </div>

          <div className="grid" style={{ marginBottom: '14px' }}>
            <div className="campo">
              <label>Cantidad recibida {productoSeleccionado ? `(${productoSeleccionado.unidad || ''})` : ''} *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="Ej. 15.0"
              />
            </div>
            <div className="campo">
              <label>Costo unitario ($) <span style={{ fontWeight: 400, color: '#9ca3af' }}>(Opcional)</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costoUnitario}
                onChange={(e) => setCostoUnitario(e.target.value)}
                placeholder={productoSeleccionado?.costo_unitario != null ? `Actual $${productoSeleccionado.costo_unitario}` : 'Sin costo definido'}
              />
            </div>
          </div>

          <div className="grid" style={{ marginBottom: '14px' }}>
            <div className="campo">
              <label>Fecha de ingreso *</label>
              <input type="date" value={fechaIngreso} onChange={(e) => alCambiarIngreso(e.target.value)} min={hoyLocal()} />
            </div>
            <div className="campo">
              <label>Fecha de vencimiento *</label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => alCambiarVencimiento(e.target.value)}
                min={fechaMinimaVencimiento}
              />
              <span className="hint">El calendario no permite hoy ni fechas pasadas.</span>
            </div>
          </div>

          <div className="campo" style={{ marginBottom: '16px' }}>
            <label>Notas / guía de despacho <span style={{ fontWeight: 400, color: '#9ca3af' }}>(Opcional)</span></label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej. Factura #4928 - Proveedor Central - Transporte refrigerado OK"
            />
          </div>

          {error && !mostrarResumen && <p className="error-msg">⚠️ {error}</p>}

          <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
            <button type="button" className="btn-mini btn-mini-outline" onClick={cerrar}>Cancelar</button>
            <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}>
              Revisar antes de confirmar
            </button>
          </div>
        </form>

        {mostrarResumen && (
          <ModalConfirmarLote
            numeroLote={normalizarNumeroLote(numeroLote)}
            productoNombre={productoSeleccionado?.nombre || productoInicial?.nombre}
            cantidad={cantidad}
            unidad={productoSeleccionado?.unidad_medida || productoSeleccionado?.unidad}
            fechaVencimiento={fechaVencimiento}
            costoUnitario={costoUnitario}
            notas={notas.trim()}
            stockAnterior={stockAlRevisar}
            resultado={resultado}
            error={error}
            guardando={guardando}
            onCancelar={() => {
              if (guardando) return
              setError('')
              setMostrarResumen(false)
            }}
            onConfirmar={handleConfirmar}
            onCerrarExito={cerrar}
          />
        )}
      </div>
    </div>
  )
}

export default RegistrarLoteModal