import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchConAuth } from '../sesion'
import { EVENTO_INVENTARIO, cortesVencimiento } from '../inventario'
import { puedeRegistrarLotes, puedeRegistrarMerma } from '../permisos'
import MermaModal from './MermaModal'
import AnularLoteModal from './AnularLoteModal'
import EscanearCodigoModal from './EscanearCodigoModal'
import RegistrarLoteModal from './RegistrarLoteModal'

// campo = valor de ?sort= que acepta el backend (null = columna no ordenable)
const COLUMNAS = [
  { campo: 'numero_lote', etiqueta: 'Lote / Partida' },
  { campo: 'producto', etiqueta: 'Insumo asociado' },
  { campo: 'fecha_recepcion', etiqueta: 'Fecha ingreso' },
  { campo: 'fecha_vencimiento', etiqueta: 'Fecha vencimiento' },
  { campo: null, etiqueta: 'Horizonte caducidad' },
  { campo: null, etiqueta: 'Cant. inicial', derecha: true },
  { campo: 'cantidad_disponible', etiqueta: 'Stock disponible', derecha: true },
  { campo: null, etiqueta: 'Acciones', centro: true },
]

const formatearCantidad = (valor) => Number(valor).toFixed(2)

const IconoAlerta = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

// fecha_recepcion llega en UTC; se muestra el día en hora de Chile
const fechaChile = (iso) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })

const textoCaducidad = (lote) => {
  const dias = Number(lote.dias_para_vencer)
  if (lote.vencido) return `Caducado (${Math.abs(dias)}d atrás)`
  if (dias === 0) return 'Vence hoy'
  return `Vence en ${dias}d`
}

const claseCaducidad = (lote, umbrales) => {
  if (!umbrales) return 'gl-caducidad gl-vigente'
  const dias = Number(lote.dias_para_vencer)
  if (lote.vencido || dias <= umbrales.rojo) return 'gl-caducidad gl-caducado'
  if (dias <= umbrales.amarillo) return 'gl-caducidad gl-por-vencer'
  return 'gl-caducidad gl-vigente'
}

const claseFila = (lote, umbrales) => {
  if (!umbrales) return ''
  const dias = Number(lote.dias_para_vencer)
  if (lote.vencido || dias <= umbrales.rojo) return 'gl-fila-vencida'
  if (dias <= umbrales.amarillo) return 'gl-fila-por-vencer'
  return ''
}

function ControlLotes({ usuario }) {
  const puedeCambiar = puedeRegistrarLotes(usuario?.rol)
  const puedeMerma = puedeRegistrarMerma(usuario?.rol)
  const columnas = puedeCambiar || puedeMerma ? COLUMNAS : COLUMNAS.filter((c) => c.etiqueta !== 'Acciones')
  const [lotes, setLotes] = useState([])
  const [producto, setProducto] = useState(null)
  const [opciones, setOpciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mensajeExito, setMensajeExito] = useState('')

  const [sort, setSort] = useState('fecha_vencimiento')
  const [order, setOrder] = useState('asc')
  const [productoId, setProductoId] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const [loteMerma, setLoteMerma] = useState(null)
  const [loteAnular, setLoteAnular] = useState(null)
  const [umbrales, setUmbrales] = useState(null)
  const [recarga, setRecarga] = useState(0)

  const [modalEscaneo, setModalEscaneo] = useState(false)
  const [modalRegistro, setModalRegistro] = useState(null) // null = cerrado, {} = nuevo vacío, {producto_id, nombre...} = prellenado
  const [verificacionPedida, setVerificacionPedida] = useState(false)
  const selectInsumoRef = useRef(null)

  useEffect(() => {
    let cancelado = false

    const cargar = async () => {
      setCargando(true)
      setError('')
      const params = new URLSearchParams({ sort, order })
      if (productoId) params.set('producto_id', productoId)

      try {
        const res = await fetchConAuth(`/inventario/lotes?${params}`)
        const data = await res.json().catch(() => ({}))
        if (cancelado) return

        if (!res.ok || !data.success) {
          setError(data.error || 'No se pudo cargar el listado de lotes.')
          return
        }

        setLotes(data.data ?? [])
        setProducto(data.producto ?? null)
        if (data.umbrales?.rojo != null && data.umbrales?.amarillo != null) {
          setUmbrales({ rojo: Number(data.umbrales.rojo), amarillo: Number(data.umbrales.amarillo) })
        }

        // El desplegable de insumos se arma con la carga sin filtro de producto
        if (!productoId) {
          const porId = new Map()
          for (const l of data.data ?? []) porId.set(l.id_producto, l.producto)
          setOpciones(
            [...porId]
              .map(([id, nombre]) => ({ id, nombre }))
              .sort((a, b) => a.nombre.localeCompare(b.nombre))
          )
        }
      } catch {
        if (!cancelado) setError('Error de conexión con el servidor.')
      } finally {
        if (!cancelado) setCargando(false)
      }
    }

    cargar()
    return () => {
      cancelado = true
    }
  }, [sort, order, productoId, recarga])

  useEffect(() => {
    const alCambio = () => setRecarga((n) => n + 1)
    window.addEventListener(EVENTO_INVENTARIO, alCambio)
    return () => window.removeEventListener(EVENTO_INVENTARIO, alCambio)
  }, [])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return lotes
    return lotes.filter(
      (l) =>
        l.numero_lote.toLowerCase().includes(q) ||
        l.producto.toLowerCase().includes(q) ||
        (l.sku ?? '').toLowerCase().includes(q)
    )
  }, [lotes, busqueda])

  // Si la búsqueda deja lotes de un único insumo, se ofrece verificarlo contra su stock total
  const idsVisibles = new Set(visibles.map((l) => l.id_producto))
  const unicoProductoId =
    !productoId && visibles.length >= 2 && idsVisibles.size === 1 ? [...idsVisibles][0] : null

  const ordenarPor = (campo) => {
    if (sort === campo) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(campo)
      setOrder('asc')
    }
  }

  const abrirMerma = (lote) => {
    setMensajeExito('')
    setLoteMerma(lote)
  }

  const alRegistrarMerma = (resultado) => {
    setMensajeExito(
      `Merma registrada: ${formatearCantidad(resultado.merma.cantidad)} de ${resultado.lote.numero_lote} ` +
        `por "${resultado.merma.motivo}", a nombre de ${resultado.registrado_por.nombre}. ` +
        `Stock total del insumo: ${formatearCantidad(resultado.producto.stock_actual)}.`
    )
    setLoteMerma(null)
    setRecarga((n) => n + 1)
  }

  const pedirVerificacion = () => {
    setVerificacionPedida(true)
    if (!productoId) selectInsumoRef.current?.focus()
  }

  const etiquetaOrden =
    sort === 'fecha_vencimiento' && order === 'asc'
      ? 'FEFO'
      : COLUMNAS.find((c) => c.campo === sort)?.etiqueta ?? sort

  // Verificación de HU-08: la suma de los lotes de un insumo debe coincidir con su stock total
  const sumaLotes = lotes.reduce((suma, l) => suma + Number(l.cantidad_disponible), 0)
  const cuadra = producto && Math.abs(sumaLotes - Number(producto.stock_actual)) < 0.005

  return (
    <div className="gl-wrapper">
      <div className="gl-header-card">
  <div className="gl-header-texto">
    <h2 className="gl-header-titulo">Gestión de Lotes & Rotación FEFO</h2>
    <p className="gl-header-subtitulo">
      Control de trazabilidad por partida física. Los insumos se organizan por fecha de
      vencimiento para asegurar que cocina consuma primero los lotes más próximos a vencer.
    </p>
  </div>
  <div className="gl-header-acciones">
    {producto && (
      <div className={cuadra ? 'gl-chip-ok' : 'gl-chip-error'}>
        <span style={{ fontWeight: 700 }}>{cuadra ? 'Consistencia verificada' : 'Revisar consistencia'}</span>
        <span style={{ fontSize: '11px' }}>
          Suma de lotes = Stock consolidado {cuadra ? '✓' : ''}
        </span>
      </div>
    )}
    <button type="button" className="gl-btn-verificar" onClick={pedirVerificacion}>
      Verificar contra el stock total
    </button>
    {puedeCambiar && (
      <>
        <button className="gl-btn-escanear" onClick={() => setModalEscaneo(true)}>
          ⌗ Escanear Código
        </button>
        <button className="gl-btn-registrar" onClick={() => setModalRegistro({})}>
          + Registrar Lote Manual
        </button>
      </>
    )}
  </div>
</div>
      <div className="gl-filtros">
        <input
          type="search"
          className="gl-buscador"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por lote (ej. LOT-2026...) o insumo..."
          aria-label="Buscar por lote o insumo"
        />
        <select
          ref={selectInsumoRef}
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          aria-label="Filtrar por insumo"
        >
          <option value="">Todos los insumos ({opciones.length})</option>
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>{o.nombre}</option>
          ))}
        </select>
        <span className="gl-conteo">
          Mostrando <strong>{visibles.length}</strong> lotes ordenados por <strong>{etiquetaOrden}</strong>
        </span>
      </div>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        {cortesVencimiento(umbrales)?.leyenda || 'Los colores de caducidad usan los días configurados por el administrador.'}
      </p>

      {verificacionPedida && !producto && (
        <div className="gl-verificacion gl-verificacion-pendiente">
          <span>
            Elige un insumo en el filtro. Se compara la suma de sus lotes activos con el stock total consolidado.
          </span>
        </div>
      )}

      {unicoProductoId && (
        <div className="gl-sugerencia">
          <span>Los {visibles.length} lotes mostrados son del mismo insumo.</span>
          <button
            type="button"
            className="gl-btn-verificar"
            onClick={() => setProductoId(String(unicoProductoId))}
          >
            Verificar contra el stock total
          </button>
        </div>
      )}

      {productoId && producto && (
        <div className={cuadra ? 'gl-verificacion gl-verificacion-ok' : 'gl-verificacion gl-verificacion-error'}>
          <span>
            Suma de los {lotes.length} lotes de <strong>{producto.nombre}</strong>:{' '}
            <strong>{formatearCantidad(sumaLotes)}</strong> · Stock total del insumo:{' '}
            <strong>{formatearCantidad(producto.stock_actual)}</strong>
          </span>
          <strong>{cuadra ? '✓ Coinciden' : '⚠ No coinciden'}</strong>
        </div>
      )}

      {mensajeExito && <p className="exito-msg">✅ {mensajeExito}</p>}
      {error && <p className="error-msg">⚠️ {error}</p>}

      <div className="gl-tabla-card">
        <table className="gl-tabla">
          <thead>
            <tr>
              {columnas.map((c) => (
                <th
                  key={c.etiqueta}
                  className={c.derecha ? 'gl-derecha' : c.centro ? 'gl-centro' : ''}
                  aria-sort={
                    c.campo && sort === c.campo ? (order === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {c.campo ? (
                    <button type="button" className="gl-th-btn" onClick={() => ordenarPor(c.campo)}>
                      {c.etiqueta}
                      <span className="gl-flecha" aria-hidden="true">
                        {sort === c.campo ? (order === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    c.etiqueta
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={columnas.length} className="gl-vacio">Cargando lotes...</td>
              </tr>
            )}
            {!cargando && !error && visibles.length === 0 && (
              <tr>
                <td colSpan={columnas.length} className="gl-vacio">
                  No hay lotes que coincidan con la búsqueda.
                </td>
              </tr>
            )}
            {!cargando &&
              visibles.map((l) => (
                <tr key={l.id} className={claseFila(l, umbrales)}>
                  <td><span className="gl-lote">{l.numero_lote}</span></td>
                  <td className="gl-insumo-celda">
                    <div className="gl-insumo">{l.producto}</div>
                    <div className="gl-sku">{l.sku}</div>
                  </td>
                  <td className="gl-fecha">{fechaChile(l.fecha_recepcion)}</td>
                  <td className="gl-fecha gl-fecha-fuerte">{l.fecha_vencimiento}</td>
                  <td>
                    <span className={claseCaducidad(l, umbrales)}>
                      {umbrales && (l.vencido || Number(l.dias_para_vencer) <= umbrales.amarillo) && <IconoAlerta />}
                      {textoCaducidad(l)}
                    </span>
                  </td>
                  <td className="gl-derecha gl-cantidad-inicial">{formatearCantidad(l.cantidad_inicial)}</td>
                  <td className="gl-derecha gl-stock">{formatearCantidad(l.cantidad_disponible)}</td>
                  {(puedeCambiar || puedeMerma) && (
                    <td className="gl-centro">
                      <div className="gl-acciones">
                        {puedeMerma && (
                          <button type="button" className="gl-btn-merma" onClick={() => abrirMerma(l)}>
                            Dar Merma
                          </button>
                        )}
                        {puedeCambiar && (
                          <button type="button" className="gl-btn-anular" onClick={() => setLoteAnular(l)}>
                            Anular Ingreso
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {loteMerma && (
        <MermaModal
          lote={loteMerma}
          onClose={() => setLoteMerma(null)}
          onRegistrada={alRegistrarMerma}
        />
      )}

      {loteAnular && (
        <AnularLoteModal
          lote={loteAnular}
          onClose={() => setLoteAnular(null)}
          onAnulado={() => {
            setMensajeExito(`Ingreso del lote ${loteAnular.numero_lote} anulado.`)
            setLoteAnular(null)
            setRecarga((n) => n + 1)
          }}
        />
      )}


      {modalEscaneo && (
        <EscanearCodigoModal
          onClose={() => setModalEscaneo(false)}
          onProductoEncontrado={(prod) => {
            setModalEscaneo(false)
            setModalRegistro(prod)
          }}
        />
      )}

          {modalRegistro && (
        <RegistrarLoteModal
          productoInicial={modalRegistro}
          onClose={() => setModalRegistro(null)}
          onRegistrado={(resultado) => {
            const stock = resultado?.producto?.stock_actual
            const nombre = resultado?.producto?.nombre
            if (nombre != null && stock != null) {
              setMensajeExito(`Lote registrado. El stock global de ${nombre} quedó en ${Number(stock).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`)
            }
            setModalRegistro(null)
            setRecarga((n) => n + 1)
          }}
        />
      )}
    
    </div>
  )
}


export default ControlLotes