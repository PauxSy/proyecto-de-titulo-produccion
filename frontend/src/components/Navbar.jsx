import { useState, useEffect, useRef } from 'react'
import { ROLES } from '../permisos'
import { fetchConAuth } from '../sesion'
import { EVENTO_INVENTARIO, INTERVALO_INVENTARIO_MS } from '../inventario'
import AlertasPanel from './AlertasPanel'

function Navbar({ usuario, onLogout, onIrAChefIa }) {

  const [abierto, setAbierto] = useState(false)
  const menuRef = useRef(null)
  const inicial = usuario?.nombre?.charAt(0).toUpperCase() || 'U'
  const esBodeguero = usuario.rol === ROLES.BODEGUERO
  const esChef = usuario.rol === ROLES.CHEF
  const icono = usuario.rol === ROLES.ADMINISTRADOR ? '🛡️' : esChef ? '👨‍🍳' : '📦'
  const [panelAlertas, setPanelAlertas] = useState(false)
  const [alertas, setAlertas] = useState(0)
  const verAlertasStock = usuario.rol === ROLES.ADMINISTRADOR || usuario.rol === ROLES.BODEGUERO

  useEffect(() => {
    let vigente = true
    const cargarConteo = async () => {
      try {
        const pedidos = [fetchConAuth('/alertas/vencimiento')]
        if (verAlertasStock) pedidos.push(fetchConAuth('/alertas/stock'))
        const [resVencimiento, resStock] = await Promise.all(pedidos)
        const dataVencimiento = await resVencimiento.json().catch(() => ({}))
        if (!vigente || !resVencimiento.ok || !dataVencimiento.success) return
        let total = (dataVencimiento.data ?? []).filter((lote) => lote.nivel_alerta !== 'VERDE').length
        if (verAlertasStock && resStock) {
          const dataStock = await resStock.json().catch(() => ({}))
          if (resStock.ok && dataStock.success) total += (dataStock.data ?? []).length
        }
        if (vigente) setAlertas(total)
      } catch {
        // La campanita sigue abriendo el panel aunque el conteo no llegue.
      }
    }
    cargarConteo()
    const intervalo = setInterval(cargarConteo, INTERVALO_INVENTARIO_MS)
    window.addEventListener(EVENTO_INVENTARIO, cargarConteo)
    return () => {
      vigente = false
      clearInterval(intervalo)
      window.removeEventListener(EVENTO_INVENTARIO, cargarConteo)
    }
  }, [verAlertasStock])

  useEffect(() => {
    const cerrarAlClickFuera = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', cerrarAlClickFuera)
    return () => document.removeEventListener('mousedown', cerrarAlClickFuera)
  }, [])

  return (
    <div className="navbar">
      <div className="navbar-brand">
        <div className="navbar-logo">🍽️</div>
        <div>
          <div className="navbar-title">GastroStock FEFO</div>
          <div className="navbar-subtitle">Control Gastronómico, Lotes & Comandas</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          className="navbar-bell"
          onClick={() => setPanelAlertas(true)}
          title={alertas > 0 ? `${alertas} alertas de vencimiento` : 'Centro de alertas'}
          aria-label={alertas > 0 ? `Centro de alertas, ${alertas} pendientes` : 'Centro de alertas'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          {alertas > 0 && <span className="navbar-bell-badge">{alertas > 99 ? '99+' : alertas}</span>}
        </button>

        <div className="user-menu" ref={menuRef}>
          <button className="user-menu-trigger" onClick={() => setAbierto(!abierto)}>
            <div className="navbar-user-avatar">{inicial}</div>
            <div className="user-menu-info">
              <div className="navbar-user-name">{usuario.nombre}</div>
              <span className={`navbar-user-role ${esBodeguero ? 'rol-bodeguero' : ''}`}>
                {icono} {usuario.rol}
              </span>
            </div>
            <span className="user-menu-chevron">▾</span>
          </button>

          {abierto && (
            <div className="user-menu-dropdown">
              <div className="user-menu-header">
                <div className="user-menu-header-name">{usuario.nombre}</div>
                {usuario.email && (
                  <div className="user-menu-header-email">{usuario.email}</div>
                )}
                <div className="user-menu-header-tags">
                  <span className="user-menu-tag">{usuario.rol?.toUpperCase()}</span>
                  <span className="user-menu-status">● Conectado</span>
                </div>
              </div>
              <button className="user-menu-logout" onClick={onLogout}>
                ↪ Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {panelAlertas && (
        <AlertasPanel
          onClose={() => setPanelAlertas(false)}
          onRescatar={onIrAChefIa}
          verAlertasStock={verAlertasStock}
        />
      )}
    </div>
  )
}

export default Navbar