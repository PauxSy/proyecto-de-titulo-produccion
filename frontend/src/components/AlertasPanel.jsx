import { useState, useEffect } from 'react'
import { fetchConAuth } from '../sesion'
import { EVENTO_INVENTARIO, INTERVALO_INVENTARIO_MS, cortesVencimiento, horaLocal } from '../inventario'
import '../App.css'

function AlertasPanel({ onClose, onRescatar, verAlertasStock }) {
  const [lotes, setLotes] = useState([])
  const [stock, setStock] = useState([])
  const [umbrales, setUmbrales] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [actualizado, setActualizado] = useState('')

  useEffect(() => {
    let vigente = true

    const cargar = async (silencioso) => {
      if (!silencioso) {
        setCargando(true)
        setError('')
      }
      try {
        const pedidos = [fetchConAuth('/alertas/vencimiento')]
        if (verAlertasStock) pedidos.push(fetchConAuth('/alertas/stock'))
        const [resVencimiento, resStock] = await Promise.all(pedidos)
        const dataVencimiento = await resVencimiento.json().catch(() => ({}))
        if (!vigente) return
        if (!resVencimiento.ok || !dataVencimiento.success) {
          setError(dataVencimiento.error || 'No se pudieron cargar las alertas.')
          return
        }
        const relevantes = (dataVencimiento.data ?? []).filter((l) => l.nivel_alerta !== 'VERDE')
        setLotes(relevantes)
        setUmbrales(dataVencimiento.umbrales ?? null)

        if (verAlertasStock && resStock) {
          const dataStock = await resStock.json().catch(() => ({}))
          if (!vigente) return
          if (!resStock.ok || !dataStock.success) {
            setError(dataStock.error || 'No se pudieron cargar las alertas de stock.')
            return
          }
          setStock(dataStock.data ?? [])
        }
        setActualizado(horaLocal())
        setError('')
      } catch {
        if (vigente && !silencioso) setError('Error de conexión con el servidor.')
      } finally {
        if (vigente) setCargando(false)
      }
    }

    cargar(false)
    const intervalo = setInterval(() => cargar(true), INTERVALO_INVENTARIO_MS)
    const alMovimiento = () => cargar(true)
    window.addEventListener(EVENTO_INVENTARIO, alMovimiento)
    return () => {
      vigente = false
      clearInterval(intervalo)
      window.removeEventListener(EVENTO_INVENTARIO, alMovimiento)
    }
  }, [verAlertasStock])

  const esCritico = (lote) => lote.nivel_alerta === 'ROJO'
  const criticos = lotes.filter(esCritico)
  const advertencias = lotes.filter((l) => l.nivel_alerta === 'AMARILLO')
  const bajoMinimo = stock.filter((item) => item.estado === 'Critico')
  const sobreMaximo = stock.filter((item) => item.estado === 'Sobrestock')

  const etiquetaVencimiento = (lote) => {
    const dias = Number(lote.dias_para_vencer)
    if (dias < 0) return `VENCIDO (${Math.abs(dias)}d)`
    if (dias === 0) return 'VENCE HOY'
    return `VENCE EN ${dias}D`
  }

  const claseStock = (item) => {
    if (item.estado === 'Sobrestock') return 'alert-item-sobrestock'
    if (item.estado === 'Critico') return 'alert-item-critico'
    return 'alert-item-advertencia'
  }

  const etiquetaStock = (item) => {
    if (item.estado === 'Sobrestock') return 'SOBRE MÁXIMO'
    if (item.estado === 'Critico') return 'BAJO MÍNIMO'
    return 'CERCA DEL UMBRAL'
  }

  const chipStock = (item) => {
    if (item.estado === 'Sobrestock') return 'badge-sobrestock-chip'
    if (item.estado === 'Critico') return 'badge-vencido-chip'
    return 'badge-advertencia-chip'
  }

  const cortes = cortesVencimiento(umbrales)
  const textoCriticos = cortes?.critico || 'Según configuración'
  const textoAdvertencia = cortes?.advertencia || 'Según configuración'

  return (
    <>
      <div className="alert-overlay-bg" onClick={onClose} />
      <div className="alert-panel">
        <div className="alert-panel-header">
          <div>
            <h3 className="alert-panel-title">Centro de alertas</h3>
            <p className="alert-panel-subtitle">
              {verAlertasStock ? 'Stock fuera de rango y lotes por vencer' : 'Lotes próximos a vencer o ya vencidos'}
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {verAlertasStock && (
          <>
            <div className="alert-summary">
              <div className="alert-summary-box alert-summary-critico">
                <span className="alert-summary-numero">{bajoMinimo.length}</span>
                <span className="alert-summary-label">Bajo mínimo<br />reponer</span>
              </div>
              <div className="alert-summary-box alert-summary-sobrestock">
                <span className="alert-summary-numero">{sobreMaximo.length}</span>
                <span className="alert-summary-label">Sobre máximo<br />frenar pedidos</span>
              </div>
            </div>
            <div className="alert-list-label">
              Stock <span style={{ color: '#9ca3af', fontWeight: 400 }}>({stock.length} insumos)</span>
            </div>
            <div className="alert-list">
              {!cargando && !error && stock.length === 0 && (
                <p style={{ fontSize: '13px', color: '#6b7280', padding: '16px' }}>
                  Ningún insumo está bajo el mínimo ni sobre el máximo.
                </p>
              )}
              {stock.map((item) => (
                <div key={`stock-${item.id}`} className={`alert-item ${claseStock(item)}`}>
                  <div className="alert-item-info">
                    <div className="alert-item-nombre">{item.nombre}</div>
                    <div className="alert-item-detalle">
                      Stock {Number(item.stock_actual).toFixed(2)} · mín {Number(item.stock_minimo).toFixed(2)} · máx {Number(item.stock_maximo).toFixed(2)}
                    </div>
                  </div>
                  <div className="alert-item-acciones">
                    <span className={chipStock(item)}>{etiquetaStock(item)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="alert-summary">
          <div className="alert-summary-box alert-summary-critico">
            <span className="alert-summary-numero">{criticos.length}</span>
            <span className="alert-summary-label">Críticos<br />{textoCriticos}</span>
          </div>
          <div className="alert-summary-box alert-summary-advertencia">
            <span className="alert-summary-numero">{advertencias.length}</span>
            <span className="alert-summary-label">Advertencias<br />{textoAdvertencia}</span>
          </div>
        </div>

        <div className="alert-list-label">
          ⏱ Alertas de vencimiento <span style={{ color: '#9ca3af', fontWeight: 400 }}>({lotes.length} lotes)</span>
        </div>

        <div className="alert-list">
          {cargando && <p style={{ fontSize: '13px', color: '#6b7280', padding: '16px' }}>Cargando alertas...</p>}
          {error && <p className="error-msg" style={{ margin: '12px' }}>⚠️ {error}</p>}
          {!cargando && !error && lotes.length === 0 && (
            <p style={{ fontSize: '13px', color: '#6b7280', padding: '16px' }}>
              No hay lotes próximos a vencer. Todo en orden ✅
            </p>
          )}
          {!cargando &&
            lotes.map((l) => (
              <div key={l.id} className={`alert-item ${esCritico(l) ? 'alert-item-critico' : 'alert-item-advertencia'}`}>
                <div className="alert-item-info">
                  <div className="alert-item-nombre">{l.producto}</div>
                  <div className="alert-item-detalle">
                    Lote: {l.numero_lote} · Stock: {Number(l.cantidad_disponible).toFixed(2)}
                  </div>
                  <div className="alert-item-fecha">Vence: {l.fecha_vencimiento}</div>
                </div>
                <div className="alert-item-acciones">
                  <span className={esCritico(l) ? 'badge-vencido-chip' : 'badge-advertencia-chip'}>
                    {etiquetaVencimiento(l)}
                  </span>
                  {onRescatar && (
                    <button
                      type="button"
                      className="btn-ia"
                      onClick={() => { onRescatar(); onClose() }}
                    >
                      ✨ Rescatar con IA
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>

        <div className="alert-panel-footer">
          <span style={{ fontSize: '11px', color: '#9ca3af' }}>
            {actualizado ? `Actualizado a las ${actualizado}` : 'Actualizando...'}
          </span>
          {onRescatar && (
            <button type="button" className="btn-ia" style={{ fontSize: '12.5px', padding: '8px 14px' }} onClick={() => { onRescatar(); onClose() }}>
              ✨ Optimizar con asistente IA
            </button>
          )}
        </div>
      </div>
    </>
  )
}

export default AlertasPanel
