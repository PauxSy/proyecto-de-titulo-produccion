import { useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'
import { hoyLocal } from '../fechas'
import { puedeRegistrarMerma, puedeVerAnaliticaMermas } from '../permisos'
import { elegirGuardado, guardarPosicion } from '../posicion'
import BotonesExportar from './BotonesExportar'
import GraficosMermas from './GraficosMermas'
import MermaModal from './MermaModal'

const MOTIVOS = ['Vencimiento', 'Rotura/Daño', 'Deterioro', 'Error Operacional', 'Otro']

const numero = (valor) => Number(valor).toLocaleString('es-CL', { maximumFractionDigits: 2 })
const dinero = (valor) => Number(valor || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })

export function RegistrarMerma() {
  const [texto, setTexto] = useState('')
  const [productos, setProductos] = useState([])
  const [producto, setProducto] = useState(null)
  const [lotes, setLotes] = useState([])
  const [loteMerma, setLoteMerma] = useState(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    const consulta = texto.trim()
    if (producto || consulta.length < 1) {
      setProductos([])
      return undefined
    }
    let vigente = true
    const timer = setTimeout(async () => {
      try {
        const res = await fetchConAuth(`/productos/estado-stock?q=${encodeURIComponent(consulta)}`)
        const data = await res.json().catch(() => ({}))
        if (!vigente) return
        if (!res.ok || !data.success) {
          setError(data.error || 'No se pudo buscar insumos.')
          return
        }
        setError('')
        setProductos((data.data || []).slice(0, 8))
      } catch {
        if (vigente) setError('Error de conexión con el servidor.')
      }
    }, 300)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [texto, producto])

  const elegirProducto = async (item, opciones = {}) => {
    setProducto(item)
    setTexto('')
    setProductos([])
    if (!opciones.conservarAviso) setAviso('')
    setCargando(true)
    setError('')
    try {
      const res = await fetchConAuth(`/inventario/lotes?producto_id=${item.id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudieron cargar los lotes.')
        setLotes([])
        return
      }
      setLotes(data.data || [])
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">🗑️</div>
        <div>
          <h1>Registrar merma</h1>
          <p className="subtitle">Elige el lote y la causa. No puede superar lo disponible.</p>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {aviso && <div className="exito-msg">{aviso}</div>}

      {!producto ? (
        <div className="campo">
          <label htmlFor="buscarMerma">Insumo</label>
          <input
            id="buscarMerma"
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por nombre o código"
          />
          {productos.length > 0 && (
            <ul className="buscador-resultados">
              {productos.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => elegirProducto(item)}>
                    <span>{item.nombre}</span>
                    <span className="codigo">{item.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="insumo-elegido" style={{ marginBottom: 16 }}>
            <div>
              <strong>{producto.nombre}</strong>
              <span className="codigo"> {producto.sku}</span>
            </div>
            <button type="button" className="btn-mini btn-mini-outline" onClick={() => { setProducto(null); setLotes([]) }}>
              Cambiar
            </button>
          </div>
          {cargando && <p className="hint">Cargando lotes...</p>}
          {!cargando && lotes.length === 0 && <p className="hint">Este insumo no tiene lotes con saldo.</p>}
          <ul className="lista-recetas">
            {lotes.map((lote) => (
              <li key={lote.id}>
                <div>
                  <strong>{lote.numero_lote}</strong>
                  <span className="codigo"> vence {lote.fecha_vencimiento} · disp. {numero(lote.cantidad_disponible)}</span>
                </div>
                <button type="button" className="btn-mini btn-mini-outline" onClick={() => setLoteMerma(lote)}>
                  Dar merma
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {loteMerma && (
        <MermaModal
          lote={loteMerma}
          onClose={() => setLoteMerma(null)}
          onRegistrada={() => {
            setLoteMerma(null)
            setAviso(`Merma registrada en ${loteMerma.numero_lote}.`)
            elegirProducto(producto, { conservarAviso: true })
          }}
        />
      )}
    </section>
  )
}

const haceDias = (dias) => {
  const fecha = new Date(`${hoyLocal()}T00:00:00`)
  fecha.setDate(fecha.getDate() - dias)
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

export function AnaliticaMermas() {
  const [periodo, setPeriodo] = useState('semana')
  const [motivo, setMotivo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [usuarioId, setUsuarioId] = useState('')
  const [desde, setDesde] = useState(haceDias(29))
  const [hasta, setHasta] = useState(hoyLocal())
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = async (siguiente = {}) => {
    const rango = {
      periodo,
      motivo,
      categoria,
      usuarioId,
      desde,
      hasta,
      ...siguiente,
    }
    if (rango.desde > rango.hasta) {
      setError('Desde no puede ser posterior a Hasta.')
      return
    }
    setPeriodo(rango.periodo)
    setMotivo(rango.motivo)
    setCategoria(rango.categoria)
    setUsuarioId(rango.usuarioId)
    setDesde(rango.desde)
    setHasta(rango.hasta)
    setCargando(true)
    setError('')
    const params = new URLSearchParams({ periodo: rango.periodo, desde: rango.desde, hasta: rango.hasta })
    if (rango.motivo) params.set('motivo', rango.motivo)
    if (rango.categoria) params.set('categoria', rango.categoria)
    if (rango.usuarioId) params.set('usuario_id', rango.usuarioId)
    try {
      const res = await fetchConAuth(`/analitica/mermas?${params}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo cargar la analítica.')
        setDatos(null)
        return
      }
      setDatos(data)
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const resumen = datos?.resumen
  const total = Number(resumen?.cantidad_total || 0)
  const sumaPeriodo = (datos?.por_periodo || []).reduce((suma, fila) => suma + Number(fila.cantidad_total), 0)
  const sumaDetalle = (datos?.detalle || []).reduce((suma, fila) => suma + Number(fila.cantidad), 0)
  const cuadra = Math.abs(sumaPeriodo - total) < 0.01 && Math.abs(sumaDetalle - total) < 0.01
  const grafico = (datos?.por_periodo || []).map((fila) => ({
    periodo: fila.periodo_inicio,
    cantidad: Number(fila.cantidad_total),
    costo: Number(fila.costo_total),
  }))
  const catalogos = datos?.catalogos || { categorias: [], responsables: [] }

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">📊</div>
        <div>
          <h1>Analítica de mermas</h1>
          <p className="subtitle">
            {datos ? `Del ${datos?.filtros?.desde || desde} al ${datos?.filtros?.hasta || hasta}` : 'Elige el rango y aplica'}
          </p>
        </div>
        <BotonesExportar
          nombre="mermas"
          titulo="Mermas"
          columnas={[
            { key: 'fecha', titulo: 'Fecha' },
            { key: 'producto', titulo: 'Producto' },
            { key: 'numero_lote', titulo: 'Lote' },
            { key: 'cantidad', titulo: 'Cantidad', numero: true },
            { key: 'costo', titulo: 'Costo', numero: true },
            { key: 'motivo', titulo: 'Motivo' },
          ]}
          filas={datos?.detalle || []}
        />
      </div>

      <div className="grid">
        <div className="campo">
          <label htmlFor="desdeMerma">Desde</label>
          <input id="desdeMerma" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="hastaMerma">Hasta</label>
          <input id="hastaMerma" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="periodoMerma">Período</label>
          <select id="periodoMerma" className="campo-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="categoriaMerma">Tipo de producto</label>
          <select id="categoriaMerma" className="campo-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>
            {catalogos.categorias.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="responsableMerma">Responsable</label>
          <select id="responsableMerma" className="campo-select" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
            <option value="">Todos</option>
            {catalogos.responsables.map((item) => (
              <option key={item.usuario_id} value={item.usuario_id}>{item.usuario || `Usuario ${item.usuario_id}`}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="motivoMerma">Motivo</label>
          <select id="motivoMerma" className="campo-select" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option value="">Todos</option>
            {MOTIVOS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <button type="button" className="btn-mini" onClick={() => cargar()} disabled={cargando}>
        Aplicar rango
      </button>

      {error && <div className="error-msg">{error}</div>}
      {cargando && <p className="hint">Cargando analítica...</p>}

      {resumen && !cargando && (
        <>
         <div className="mkpi-grid">
            <div className="mkpi-card mkpi-azul">
              <div className="mkpi-top">
                <span className="mkpi-label">Registros</span>
                <span className="mkpi-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                    <path d="M9 12h6M9 16h4" />
                  </svg>
                </span>
              </div>
              <div className="mkpi-valor">{resumen.registros}</div>
              <div className="mkpi-sub">Bajas registradas en el período</div>
            </div>

            <div className="mkpi-card mkpi-ambar">
              <div className="mkpi-top">
                <span className="mkpi-label">Cantidad</span>
                <span className="mkpi-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
                  </svg>
                </span>
              </div>
              <div className="mkpi-valor">{numero(resumen.cantidad_total)}</div>
              <div className="mkpi-sub">Unidades / kg mermados</div>
            </div>

            <div className="mkpi-card mkpi-violeta">
              <div className="mkpi-top">
                <span className="mkpi-label">Productos</span>
                <span className="mkpi-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
                    <path d="M7 7h.01" />
                  </svg>
                </span>
              </div>
              <div className="mkpi-valor">{resumen.productos_afectados}</div>
              <div className="mkpi-sub">Insumos distintos afectados</div>
            </div>

            <div className="mkpi-card mkpi-rojo">
              <div className="mkpi-top">
                <span className="mkpi-label">Costo valorizado</span>
                <span className="mkpi-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
                    <polyline points="16 17 22 17 22 11" />
                  </svg>
                </span>
              </div>
              <div className="mkpi-valor mkpi-valor-rojo">{dinero(resumen.costo_total)}</div>
              <div className="mkpi-sub">Pérdida económica acumulada</div>
            </div>
          </div>

          <GraficosMermas
            periodo={datos?.filtros?.periodo || periodo}
            porPeriodo={grafico}
            porMotivo={datos?.por_motivo || []}
            porProducto={datos?.por_producto || []}
          />
          <p className={cuadra ? 'exito-msg' : 'error-msg'}>
            {cuadra
              ? `Integridad: el gráfico (${numero(sumaPeriodo)}) y el detalle (${numero(sumaDetalle)}) coinciden con el total (${numero(total)}).`
              : `Integridad: gráfico ${numero(sumaPeriodo)}, detalle ${numero(sumaDetalle)}, total ${numero(total)}.`}
          </p>

          <h2 className="subtitulo-seccion">Por motivo</h2>
          <ul className="lista-recetas">
            {(datos.por_motivo || []).map((fila) => (
              <li key={fila.motivo}>
                <span>{fila.motivo}</span>
                <span className="codigo">{fila.registros} reg. · {numero(fila.cantidad_total)} · {dinero(fila.costo_total)}</span>
              </li>
            ))}
            {(datos.por_motivo || []).length === 0 && <li><span className="hint">No hay mermas en este rango.</span></li>}
          </ul>

          <h2 className="subtitulo-seccion">Por producto</h2>
          <ul className="lista-recetas">
            {(datos.por_producto || []).slice(0, 8).map((fila) => (
              <li key={fila.producto_id}>
                <div>
                  <strong>{fila.producto}</strong>
                  <span className="codigo"> {fila.sku}</span>
                </div>
                <span className="codigo">{numero(fila.cantidad_total)} · {dinero(fila.costo_total)} · {fila.motivo_mas_frecuente}</span>
              </li>
            ))}
          </ul>

          <h2 className="subtitulo-seccion">Por categoría</h2>
          <ul className="lista-recetas">
            {(datos.por_categoria || []).map((fila) => (
              <li key={fila.categoria}>
                <span>{fila.categoria}</span>
                <span className="codigo">{numero(fila.cantidad_total)} · {dinero(fila.costo_total)}</span>
              </li>
            ))}
          </ul>

          <h2 className="subtitulo-seccion">Por responsable</h2>
          <ul className="lista-recetas">
            {(datos.por_responsable || []).map((fila) => (
              <li key={fila.usuario_id ?? 'sin-usuario'}>
                <span>{fila.usuario || 'Sin usuario'}</span>
                <span className="codigo">{fila.registros} reg. · {numero(fila.cantidad_total)} · {dinero(fila.costo_total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function MermasPanel({ usuario }) {
  const registra = puedeRegistrarMerma(usuario?.rol)
  const analiza = puedeVerAnaliticaMermas(usuario?.rol)
  const inicial = registra ? 'registrar' : 'analitica'
  const pestanas = [
    registra && { id: 'registrar', label: 'Registrar' },
    analiza && { id: 'analitica', label: 'Analítica' },
  ].filter(Boolean)
  const [seccion, setSeccion] = useState(() => elegirGuardado('mermas', pestanas.map((pestana) => pestana.id), inicial))

  const cambiarSeccion = (id) => {
    setSeccion(id)
    guardarPosicion({ mermas: id })
  }

  return (
    <div>
      {pestanas.length > 1 && (
        <div className="cocina-subtabs">
          {pestanas.map((pestana) => (
            <button
              key={pestana.id}
              type="button"
              className={seccion === pestana.id ? 'activa' : ''}
              onClick={() => cambiarSeccion(pestana.id)}
            >
              {pestana.label}
            </button>
          ))}
        </div>
      )}
      {seccion === 'registrar' && registra && <RegistrarMerma />}
      {seccion === 'analitica' && analiza && <AnaliticaMermas />}
    </div>
  )
}

export default MermasPanel