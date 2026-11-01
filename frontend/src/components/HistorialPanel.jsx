import { useEffect, useState } from 'react'
import BotonesExportar from './BotonesExportar'
import { fetchConAuth } from '../sesion'
import { hoyLocal } from '../fechas'

const haceDias = (dias) => {
  const fecha = new Date(`${hoyLocal()}T00:00:00`)
  fecha.setDate(fecha.getDate() - dias)
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

const numero = (valor) => Number(valor || 0)
const motivoDe = (fila) => fila.detalle?.motivo || fila.detalle?.nombre_plato || ''
const fechaHora = (valor) => {
  if (!valor) return ''
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return String(valor)
  return fecha.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'medium' })
}
const tuvoMovimiento = (fila) => ['entradas', 'salidas_manuales', 'salidas_comanda', 'mermas', 'anulaciones']
  .some((campo) => numero(fila[campo]) !== 0)
const esVisible = (fila) => tuvoMovimiento(fila) || numero(fila.stock_inicial) !== 0 || numero(fila.stock_final) !== 0

const COLUMNAS_BALANCE = [
  { key: 'sku', titulo: 'Código' },
  { key: 'producto', titulo: 'Producto' },
  { key: 'categoria', titulo: 'Categoría' },
  { key: 'stock_inicial', titulo: 'Stock inicial', numero: true },
  { key: 'entradas', titulo: 'Entradas', numero: true },
  { key: 'salidas_manuales', titulo: 'Salidas manuales', numero: true },
  { key: 'salidas_comanda', titulo: 'Salidas por comanda', numero: true },
  { key: 'mermas', titulo: 'Mermas', numero: true },
  { key: 'anulaciones', titulo: 'Anulaciones', numero: true },
  { key: 'stock_final', titulo: 'Stock final', numero: true },
]

const COLUMNAS_HISTORIAL = [
  { key: 'fecha', titulo: 'Fecha y hora' },
  { key: 'tipo', titulo: 'Acción' },
  { key: 'usuario', titulo: 'Quién' },
  { key: 'numero_lote', titulo: 'Lote' },
  { key: 'cantidad', titulo: 'Cantidad', numero: true },
  { key: 'motivo', titulo: 'Detalle' },
]

function HistorialPanel() {
  const [desde, setDesde] = useState(haceDias(29))
  const [hasta, setHasta] = useState(hoyLocal())
  const [categoria, setCategoria] = useState('')
  const [opcionesCategoria, setOpcionesCategoria] = useState([])
  const [balance, setBalance] = useState([])
  const [cuadre, setCuadre] = useState(null)
  const [productoId, setProductoId] = useState('')
  const [historial, setHistorial] = useState([])
  const [registros, setRegistros] = useState([])
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [cargandoHistorial, setCargandoHistorial] = useState(false)

  const visibles = balance.filter(esVisible)
  const importantes = balance.filter(tuvoMovimiento)
  const producto = balance.find((fila) => String(fila.producto_id) === String(productoId))
  const cuadra = cuadre && Number(cuadre.cuadran_movimientos) === Number(cuadre.productos)

  const cargarHistorial = async (id, rango = { desde, hasta }) => {
    if (!id) {
      setHistorial([])
      return
    }
    setCargandoHistorial(true)
    const params = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta, producto_id: String(id), limite: '500' })
    try {
      const res = await fetchConAuth(`/inventario/historial?${params}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo cargar el historial del ítem.')
        setHistorial([])
        return
      }
      setHistorial((data.data || []).map((fila) => ({
        fecha: fechaHora(fila.fecha),
        tipo: fila.tipo,
        usuario: fila.usuario || 'Sin usuario',
        numero_lote: fila.numero_lote,
        cantidad: numero(fila.cantidad),
        motivo: motivoDe(fila),
      })))
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargandoHistorial(false)
    }
  }

  const cargar = async () => {
    if (desde > hasta) {
      setError('Desde no puede ser posterior a Hasta.')
      return
    }
    setCargando(true)
    setError('')
    const params = new URLSearchParams({ desde, hasta })
    if (categoria) params.set('categoria', categoria)
    try {
      const res = await fetchConAuth(`/inventario/reporte?${params}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo cargar el balance.')
        setBalance([])
        setCuadre(null)
        return
      }
      const filas = (data.data || []).map((fila) => ({
        ...fila,
        stock_inicial: numero(fila.stock_inicial),
        entradas: numero(fila.entradas),
        salidas_manuales: numero(fila.salidas_manuales),
        salidas_comanda: numero(fila.salidas_comanda),
        mermas: numero(fila.mermas),
        anulaciones: numero(fila.anulaciones),
        stock_final: numero(fila.stock_final),
      }))
      setBalance(filas)
      setCuadre(data.cuadre)
      const acciones = await fetchConAuth('/registros-accion')
      const libro = await acciones.json().catch(() => ({}))
      setRegistros(acciones.ok && libro.success ? (libro.data || []) : [])
      if (!categoria) {
        setOpcionesCategoria([...new Set(filas.map((fila) => fila.categoria).filter(Boolean))].sort())
      }
      const siguientes = filas.filter(tuvoMovimiento)
      const sigue = siguientes.some((fila) => String(fila.producto_id) === String(productoId))
      const elegido = sigue ? productoId : (siguientes[0]?.producto_id ?? '')
      setProductoId(elegido ? String(elegido) : '')
      await cargarHistorial(elegido, { desde, hasta })
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">📒</div>
        <div className="card-header-texto">
          <h1>Reportes y balances</h1>
          <p className="subtitle">Stock inicial, movimientos y stock final. El historial de cada ítem se descarga aparte.</p>
        </div>
        <BotonesExportar
          nombre="balance-inventario"
          titulo="Balance de inventario"
          columnas={COLUMNAS_BALANCE}
          filas={visibles}
        />
      </div>

      <div className="grid">
        <div className="campo">
          <label htmlFor="desdeReporte">Desde</label>
          <input id="desdeReporte" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="hastaReporte">Hasta</label>
          <input id="hastaReporte" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="categoriaReporte">Categoría</label>
          <select id="categoriaReporte" className="campo-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>
            {opcionesCategoria.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <button type="button" className="btn-mini" onClick={cargar} disabled={cargando}>Aplicar rango</button>
      {error && <div className="error-msg">{error}</div>}
      {cargando && <p className="hint">Cargando balance...</p>}

      {!cargando && cuadre && (
        <p className={cuadra ? 'exito-msg' : 'error-msg'}>
          {cuadra
            ? `Integridad: los ${cuadre.productos} productos cuadran (stock inicial + entradas − salidas − mermas − anulaciones = stock final).`
            : `Integridad: ${cuadre.cuadran_movimientos} de ${cuadre.productos} productos cuadran.`}
        </p>
      )}

      {!cargando && (
        <div className="reporte-tabla-wrap">
          <table className="stock-table">
            <thead>
              <tr>
                {COLUMNAS_BALANCE.map((columna) => <th key={columna.key}>{columna.titulo}</th>)}
                <th>Historial</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((fila) => (
                <tr key={fila.producto_id}>
                  <td>{fila.sku}</td>
                  <td>{fila.producto}</td>
                  <td>{fila.categoria}</td>
                  <td>{fila.stock_inicial}</td>
                  <td>{fila.entradas}</td>
                  <td>{fila.salidas_manuales}</td>
                  <td>{fila.salidas_comanda}</td>
                  <td>{fila.mermas}</td>
                  <td>{fila.anulaciones}</td>
                  <td>{fila.stock_final}</td>
                  <td>
                    <button type="button" className="btn-mini btn-mini-outline" onClick={() => { setProductoId(String(fila.producto_id)); cargarHistorial(fila.producto_id) }}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr><td colSpan={11}>No hay ítems con movimiento en este rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-header" style={{ marginTop: 20 }}>
        <div className="card-header-texto">
          <h2 className="subtitulo-seccion">Historial del ítem</h2>
          <p className="subtitle">{producto ? `${producto.producto} (${producto.sku})` : 'Elige un ítem con movimiento'}</p>
        </div>
        <BotonesExportar
          nombre={producto ? `historial-${producto.sku}` : 'historial-item'}
          titulo={producto ? `Historial de ${producto.producto}` : 'Historial del ítem'}
          columnas={COLUMNAS_HISTORIAL}
          filas={historial}
        />
      </div>
      {cargandoHistorial && <p className="hint">Cargando historial...</p>}
      {!cargandoHistorial && (
        <ul className="lista-recetas">
          {historial.map((fila, indice) => (
            <li key={`${fila.fecha}-${fila.numero_lote}-${indice}`}>
              <div>
                <strong>{fila.tipo}</strong>
                <span className="codigo"> {fila.fecha} · {fila.usuario} · {fila.numero_lote}</span>
              </div>
              <span className="codigo">{fila.cantidad}{fila.motivo ? ` · ${fila.motivo}` : ''}</span>
            </li>
          ))}
          {historial.length === 0 && <li><span className="hint">Este ítem no tiene movimientos en el rango.</span></li>}
        </ul>
      )}

      <h2 className="subtitulo-seccion">Registro de acciones</h2>
      <p className="hint">Fecha, hora, quién lo hizo y la acción. Incluye altas de insumo, ingresos, mermas, salidas y anulaciones nuevas.</p>
      <ul className="lista-recetas">
        {registros.map((fila) => (
          <li key={fila.id}>
            <div>
              <strong>{fila.accion}</strong>
              <span className="codigo"> {fechaHora(fila.fecha)} · {fila.usuario} ({fila.rol})</span>
            </div>
            <span className="codigo">{fila.detalle}</span>
          </li>
        ))}
        {registros.length === 0 && <li><span className="hint">Todavía no hay acciones registradas en este libro.</span></li>}
      </ul>
    </section>
  )
}

export default HistorialPanel
