import { useState, useEffect, useRef } from 'react'
import UmbralesForm from './UmbralesForm'
import ConfirmarLoteForm from './ConfirmarLoteForm'
import { puedeEditarUmbrales, puedeRegistrarLotes } from '../permisos'
import { fetchConAuth } from '../sesion'
import { EVENTO_INVENTARIO, INTERVALO_INVENTARIO_MS, horaLocal } from '../inventario'
import BotonesExportar from './BotonesExportar'
import TarjetaResumen from './TarjetaResumen'
import NuevoInsumoModal from './NuevoInsumoModal'
import '../App.css'

const TARJETAS_ESTADO = [
  { id: 'Critico', clase: 'stock-summary-critico', titulo: 'Crítico (≤ Mín)', frase: 'críticos', subtitulo: 'Riesgo inminente de quiebre', icono: '●' },
  { id: 'Advertencia', clase: 'stock-summary-advertencia', titulo: 'Advertencia', frase: 'en advertencia', subtitulo: 'Cercano al umbral', icono: '⚠' },
  { id: 'Normal', clase: 'stock-summary-optimo', titulo: 'Stock Óptimo', frase: 'en stock óptimo', subtitulo: 'Rango saludable', icono: '✓' },
  { id: 'Sobrestock', clase: 'stock-summary-sobrestock', titulo: 'Sobrestock', frase: 'en sobrestock', subtitulo: 'Capital inmovilizado', icono: '↗' },
]

function StockTable({ usuario }) {
  const [productos, setProductos] = useState([])
  const [resumen, setResumen] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [productoEditando, setProductoEditando] = useState(null)
  const [productoParaLote, setProductoParaLote] = useState(null)
  const [modalInsumo, setModalInsumo] = useState(false)
  const [aviso, setAviso] = useState('')
  const [actualizado, setActualizado] = useState('')
  const [recargarTrigger, setRecargarTrigger] = useState(0)
  const esPrimeraCarga = useRef(true)

  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState([])
  const [filtroEstado, setFiltroEstado] = useState('')

  const verUmbrales = puedeEditarUmbrales(usuario.rol)
  const verLotes = puedeRegistrarLotes(usuario.rol)

  // Evita disparar una petición en cada tecla: espera 300ms de pausa antes de buscar
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda.trim()), 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    let vigente = true
    const cargarProductos = async () => {
      if (esPrimeraCarga.current) setCargando(true)
      setError('')
      try {
        const params = busquedaDebounced ? `?q=${encodeURIComponent(busquedaDebounced)}` : ''
        const res = await fetchConAuth(`/productos/estado-stock${params}`)
        const data = await res.json()
        if (!vigente) return
        if (!res.ok || !data.success) {
          setError(data.error || 'No se pudo cargar el inventario.')
          return
        }
        setProductos(data.data)
        setResumen(data.resumen)
        setActualizado(horaLocal())
        if (!busquedaDebounced) {
          setCategorias([...new Set(data.data.map((p) => p.categoria).filter(Boolean))].sort())
        }
      } catch {
        if (vigente) setError('Error de conexión con el servidor.')
      } finally {
        if (!vigente) return
        esPrimeraCarga.current = false
        setCargando(false)
      }
    }
    cargarProductos()
    const intervalo = setInterval(cargarProductos, INTERVALO_INVENTARIO_MS)
    const alMovimiento = () => cargarProductos()
    window.addEventListener(EVENTO_INVENTARIO, alMovimiento)
    return () => {
      vigente = false
      clearInterval(intervalo)
      window.removeEventListener(EVENTO_INVENTARIO, alMovimiento)
    }
  }, [recargarTrigger, busquedaDebounced])

  const recargar = () => {
    setProductoEditando(null)
    setProductoParaLote(null)
    setRecargarTrigger((prev) => prev + 1)
  }

  const alConfirmarLote = (resultado) => {
    const actualizado = resultado?.producto
    if (actualizado?.id != null) {
      setProductos((prev) =>
        prev.map((p) =>
          Number(p.id) === Number(actualizado.id)
            ? { ...p, stock_actual: actualizado.stock_actual }
            : p
        )
      )
    }
    setProductoParaLote(null)
    setRecargarTrigger((prev) => prev + 1)
  }

  const tarjetaActiva = TARJETAS_ESTADO.find((t) => t.id === filtroEstado)

  const visibles = productos.filter((p) => {
    if (categoria && p.categoria !== categoria) return false
    if (filtroEstado && p.estado !== filtroEstado) return false
    return true
  })

  const alternarFiltroEstado = (estado) => {
    setFiltroEstado((actual) => (actual === estado ? '' : estado))
  }

  const hayFiltros = Boolean(busqueda.trim() || categoria || filtroEstado)

  const limpiarFiltros = () => {
    setBusqueda('')
    setBusquedaDebounced('')
    setCategoria('')
    setFiltroEstado('')
    setAviso('')
  }

  const badgeEstado = (estado) => {
    if (estado === 'Critico') {
      return {
        texto: 'Crítico (≤ Mínimo)',
        clase: 'badge-critico',
        colorBarra: '#dc2626',
        icono: (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="6" />
          </svg>
        ),
      }
    }
    if (estado === 'Sobrestock') {
      return {
        texto: 'Exceso (≥ Máximo)',
        clase: 'badge-sobrestock',
        colorBarra: '#2563eb',
        icono: (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
            <polyline points="17 6 23 6 23 12"></polyline>
          </svg>
        ),
      }
    }
    if (estado === 'Advertencia') {
      return {
        texto: 'Advertencia',
        clase: 'badge-advertencia',
        colorBarra: '#f59e0b',
        icono: (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        ),
      }
    }
    return {
      texto: 'Stock Óptimo',
      clase: 'badge-optimo',
      colorBarra: '#16a34a',
      icono: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      ),
    }
  }

  const calcularPorcentaje = (actual, max) => {
    if (!max || max <= 0) return 0
    const pct = (actual / max) * 100
    return Math.min(pct, 100)
  }

  const textoVencimiento = (producto) => {
    if (producto.dias_para_vencer === null || producto.dias_para_vencer === undefined || producto.dias_para_vencer === '') return null
    const dias = Number(producto.dias_para_vencer)
    if (!Number.isFinite(dias)) return null
    if (dias < 0) return `Lote vencido hace ${Math.abs(dias)}d`
    if (dias === 0) return 'Lote vence hoy'
    return `Lote vence en ${dias}d`
  }

  if (productoEditando) {
    return (
      <UmbralesForm
        producto={productoEditando}
        onClose={() => setProductoEditando(null)}
        onActualizado={recargar}
      />
    )
  }

  if (productoParaLote) {
    return (
      <ConfirmarLoteForm
        producto={productoParaLote}
        onClose={() => setProductoParaLote(null)}
        onConfirmado={alConfirmarLote}
      />
    )
  }

  return (
    <div>
      <div className="stock-summary-grid">
        {TARJETAS_ESTADO.map((tarjeta) => (
          <TarjetaResumen
            key={tarjeta.id}
            titulo={tarjeta.titulo}
            contador={resumen?.por_estado?.[tarjeta.id] ?? 0}
            clase={tarjeta.clase}
            subtitulo={tarjeta.subtitulo}
            icono={tarjeta.icono}
            seleccionada={filtroEstado === tarjeta.id}
            onClick={() => alternarFiltroEstado(tarjeta.id)}
            cargando={cargando && !resumen}
            error={error}
          />
        ))}
      </div>

      <div className="card" style={{ maxWidth: '100%' }}>
        <div className="card-header">
          <div className="icon-badge">📦</div>
          <div className="card-header-texto">
            <h1>Tablero de Monitoreo & Semáforo de Existencias</h1>
            <p className="subtitle">
              Se actualiza solo después de cada movimiento{actualizado ? ` · ${actualizado}` : ''}. Mostrando {visibles.length} insumos
              {tarjetaActiva ? ` ${tarjetaActiva.frase}` : ''}.
              {!verUmbrales && !verLotes ? ' Consulta de stock y vencimiento.' : ''}
            </p>
          </div>
          <BotonesExportar
            nombre="inventario"
            titulo="Inventario"
            columnas={[
              { key: 'sku', titulo: 'Código' },
              { key: 'nombre', titulo: 'Insumo' },
              { key: 'stock_actual', titulo: 'Existencia', numero: true },
              { key: 'stock_minimo', titulo: 'Mínimo', numero: true },
              { key: 'stock_maximo', titulo: 'Máximo', numero: true },
              { key: 'estado', titulo: 'Estado' },
              { key: 'dias_para_vencer', titulo: 'Días para vencer', numero: true },
            ]}
            filas={visibles}
          />
        </div>

        <div className="stock-filtros">
          <input
            type="search"
            className="stock-buscador"
            value={busqueda}
            onChange={(e) => {
              setAviso('')
              setBusqueda(e.target.value)
            }}
            placeholder="Buscar por insumo, código (ej. REP-001) o código de barras..."
          />
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="stock-select-categoria">
            <option value="">Todas las categorías ({categorias.length})</option>
            {categorias.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            className="stock-limpiar-filtros"
            onClick={limpiarFiltros}
            disabled={!hayFiltros}
            aria-disabled={!hayFiltros}
          >
            Limpiar filtros
          </button>
          {verUmbrales && (
            <button type="button" className="stock-btn-nuevo" onClick={() => { setAviso(''); setModalInsumo(true) }}>
              <span aria-hidden="true">+</span> Nuevo Insumo
            </button>
          )}
        </div>

        {aviso && <p className="stock-aviso" role="status">{aviso}</p>}

        {cargando && <p style={{ padding: '16px', fontSize: '13px', color: '#6b7280' }}>Cargando inventario...</p>}
        {error && <p className="error-msg">⚠️ {error}</p>}

        {!cargando && !error && (
          <div className="tabla-scroll">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Código / Insumo</th>
                  <th>Existencia Actual</th>
                  <th>Semáforo de Estado</th>
                  <th>Umbrales (Mín / Máx)</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: '#6b7280', fontSize: '13px' }}>
                      No hay insumos que coincidan con los filtros.
                    </td>
                  </tr>
                )}
                {visibles.map((p) => {
                  const badge = badgeEstado(p.estado)
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                        <div className="codigo">{p.sku}</div>
                      </td>
                      <td>{p.stock_actual}</td>
                      <td>
                        <span className={`badge ${badge.clase}`}>
                          {badge.icono} {badge.texto}
                        </span>
                        <div className="stock-progress-track">
                          <div
                            className="stock-progress-fill"
                            style={{
                              width: `${calcularPorcentaje(p.stock_actual, p.stock_maximo)}%`,
                              background: badge.colorBarra,
                            }}
                          />
                        </div>
                        {p.nivel_vencimiento && p.nivel_vencimiento !== 'VERDE' && (
                          <div className={`stock-vence stock-vence-${p.nivel_vencimiento === 'ROJO' ? 'rojo' : 'amarillo'}`}>
                            {textoVencimiento(p)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="umbral-min">{p.stock_minimo}</span> / <span className="umbral-max">{p.stock_maximo}</span>
                      </td>
                      <td>
                        {verUmbrales && (
                          <button className="btn-mini btn-mini-blue" onClick={() => setProductoEditando(p)}>Umbrales</button>
                        )}
                        {verLotes && (
                          <button className="btn-mini btn-mini-green" onClick={() => setProductoParaLote(p)}>+Lote</button>
                        )}
                        {!verUmbrales && !verLotes && (
                          <span className="hint">Solo consulta</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalInsumo && (
        <NuevoInsumoModal
          onClose={() => setModalInsumo(false)}
          onCreado={(creado) => {
            setModalInsumo(false)
            setCategoria('')
            setFiltroEstado('')
            const nombre = creado?.nombre ?? ''
            setBusqueda(nombre)
            setBusquedaDebounced(nombre)
            setAviso(nombre
              ? `${nombre} quedó creado con stock 0. Registra un lote para ingresar existencia.`
              : 'Insumo creado.')
            setRecargarTrigger((prev) => prev + 1)
          }}
        />
      )}
    </div>
  )
}

export default StockTable