import { useState } from 'react'
import { fetchConAuth } from '../sesion'
import '../App.css'

const codigosPrueba = [
  { nombre: 'Harina de Trigo Tradicional 1kg', codigo: '7801234567890' },
  { nombre: 'Azúcar Granulada 1kg', codigo: '7801234560003' },
  { nombre: 'Mantequilla con Sal 250g', codigo: '7801234560019' },
  { nombre: 'Huevos de Gallina (Caja 30 un)', codigo: '7801234560023' },
  { nombre: 'Chocolate de Cacao Cobertura de Leche 1kg', codigo: '7801234560010' },
  { nombre: 'Código no registrado', codigo: '9999999999999', noRegistrado: true },
]

function EscanearCodigoModal({ onClose, onProductoEncontrado }) {
  const [inputCodigo, setInputCodigo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [noEncontrado, setNoEncontrado] = useState(false)

  const buscarProducto = async (codigo) => {
    setBuscando(true)
    setNoEncontrado(false)
    try {
      const res = await fetchConAuth(`/productos/barcode/${codigo}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success || !data.data) {
        setNoEncontrado(true)
        return
      }
      onProductoEncontrado(data.data)
    } catch {
      setNoEncontrado(true)
    } finally {
      setBuscando(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && inputCodigo.trim()) {
      buscarProducto(inputCodigo.trim())
      setInputCodigo('')
    }
  }

  const handleBuscarClick = () => {
    if (inputCodigo.trim()) {
      buscarProducto(inputCodigo.trim())
      setInputCodigo('')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="icon-badge" style={{ width: '34px', height: '34px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"></path>
              <line x1="7" y1="12" x2="17" y2="12"></line>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Escanear código de barras</h2>
            <p style={{ margin: 0, fontSize: '12.5px', color: '#6b7280' }}>
              Recepción rápida de insumos con autocompletado automático
            </p>
          </div>
          <button onClick={onClose} className="modal-close-btn">✕</button>
        </div>

        <div className="scan-box">
          <p style={{ fontWeight: 600, margin: '0 0 4px' }}>Ingresa el código del producto</p>
          <p style={{ fontSize: '12.5px', color: '#94a3b8', margin: '0 0 14px' }}>
            Escribe el código y presiona Enter, o usa el botón Buscar
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={inputCodigo}
              onChange={(e) => setInputCodigo(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ej: 7801234567890"
              className="scan-input"
              style={{ flex: 1 }}
            />
            <button type="button" className="btn-mini btn-mini-blue" onClick={handleBuscarClick} style={{ padding: '0 16px' }}>
              Buscar
            </button>
          </div>
          {buscando && <p style={{ fontSize: '12px', color: '#60a5fa', marginTop: '8px' }}>Buscando producto...</p>}
          {noEncontrado && (
            <p className="error-msg" style={{ marginTop: '10px', textAlign: 'left' }}>
              ⚠️ Producto no encontrado. Verifica el código o regístralo como nuevo insumo.
            </p>
          )}
        </div>

        <div className="scan-demo-label">
          Códigos de prueba rápida <span style={{ color: '#9ca3af', fontWeight: 400 }}>(clic para simular escaneo)</span>
        </div>
        <div className="scan-demo-grid">
          {codigosPrueba.map((c) => (
            <button
              key={c.codigo}
              className={`scan-demo-item ${c.noRegistrado ? 'scan-demo-item-warning' : ''}`}
              onClick={() => buscarProducto(c.codigo)}
            >
              <div style={{ fontWeight: 600, fontSize: '12.5px' }}>{c.nombre}</div>
              <div style={{ fontSize: '11px', color: c.noRegistrado ? '#b45309' : '#6b7280' }}>{c.codigo}</div>
            </button>
          ))}
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
            Verifica el código impreso en el empaque del producto.
          </span>
          <button onClick={onClose} className="btn-mini btn-mini-outline">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

export default EscanearCodigoModal