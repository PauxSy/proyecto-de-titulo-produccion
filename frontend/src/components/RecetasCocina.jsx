import { useCallback, useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'
import BuscadorInsumo from './BuscadorInsumo'

const UNIDADES = ['gr', 'ml', 'un']

const filaVacia = () => ({
  clave: crypto.randomUUID(),
  producto: null,
  cantidad: '',
  unidad: 'gr',
})

const formularioVacio = () => ({
  id: null,
  nombre: '',
  rubro: '',
  porciones: '1',
  usada: false,
  salidas: 0,
  filas: [filaVacia()],
})

function RecetasCocina() {
  const [recetas, setRecetas] = useState([])
  const [form, setForm] = useState(formularioVacio)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    try {
      const res = await fetchConAuth('/recetas')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudieron cargar las recetas.')
        return
      }
      setRecetas(data.data || [])
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const actualizarFila = (clave, cambios) => {
    setForm((actual) => ({
      ...actual,
      filas: actual.filas.map((fila) => (fila.clave === clave ? { ...fila, ...cambios } : fila)),
    }))
  }

  const abrirEdicion = async (id) => {
    setError('')
    setAviso('')
    try {
      const res = await fetchConAuth(`/recetas/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo abrir la receta.')
        return
      }
      const ficha = data.data
      setForm({
        id: ficha.id,
        nombre: ficha.nombre_plato,
        rubro: ficha.rubro,
        porciones: String(ficha.porciones),
        usada: Boolean(ficha.usada_en_comandas),
        salidas: ficha.salidas_por_comanda,
        filas: ficha.ingredientes.map((ing) => ({
          clave: crypto.randomUUID(),
          producto: { id: ing.producto_id, sku: ing.sku, nombre: ing.producto },
          cantidad: String(ing.cantidad_requerida),
          unidad: ing.unidad_medida,
        })),
      })
    } catch {
      setError('Error de conexión con el servidor.')
    }
  }

  const validar = () => {
    if (form.nombre.trim().length < 2 || form.rubro.trim().length < 2) {
      setError('El nombre del plato y el rubro son obligatorios.')
      return false
    }
    const porciones = Number(form.porciones)
    if (!Number.isInteger(porciones) || porciones < 1) {
      setError('Las porciones deben ser un número entero mayor a 0.')
      return false
    }
    if (form.usada) return true
    if (form.filas.length === 0) {
      setError('Agrega al menos un ingrediente antes de guardar.')
      return false
    }
    const ids = new Set()
    for (const fila of form.filas) {
      if (!fila.producto) {
        setError('Cada fila necesita un insumo.')
        return false
      }
      if (ids.has(fila.producto.id)) {
        setError('Un insumo no puede repetirse en la misma receta.')
        return false
      }
      ids.add(fila.producto.id)
      const cantidad = Number(fila.cantidad)
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        setError('La cantidad de cada ingrediente debe ser mayor a 0.')
        return false
      }
      if (!UNIDADES.includes(fila.unidad)) {
        setError('La unidad debe ser gr, ml o un.')
        return false
      }
    }
    return true
  }

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    setAviso('')
    if (!validar()) return

    const cuerpo = {
      nombre_plato: form.nombre.trim(),
      rubro: form.rubro.trim(),
      porciones: Number(form.porciones),
    }
    if (!form.usada) {
      cuerpo.ingredientes = form.filas.map((fila) => ({
        producto_id: fila.producto.id,
        cantidad_requerida: Number(fila.cantidad),
        unidad_medida: fila.unidad,
      }))
    }

    setGuardando(true)
    try {
      const res = await fetchConAuth(form.id ? `/recetas/${form.id}` : '/recetas', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo guardar la receta.')
        return
      }
      setAviso(form.id ? 'Receta actualizada.' : 'Receta guardada con sus ingredientes.')
      setForm(formularioVacio())
      await cargar()
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const desactivar = async (receta) => {
    setError('')
    setAviso('')
    setGuardando(true)
    try {
      const res = await fetchConAuth(`/recetas/${receta.id}/desactivar`, { method: 'PATCH' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo desactivar la receta.')
        return
      }
      const fichaRes = await fetchConAuth(`/recetas/${receta.id}`)
      const ficha = await fichaRes.json().catch(() => ({}))
      const salidas = ficha.data?.salidas_por_comanda ?? 0
      const ingredientes = ficha.data?.ingredientes?.length ?? data.data?.ingredientes ?? 0
      setAviso(
        `«${data.data.nombre_plato}» quedó inactiva. Se conservan ${salidas} salida(s) por comanda y ${ingredientes} ingrediente(s). El historial no se borró.`
      )
      if (form.id === receta.id) setForm(formularioVacio())
      await cargar()
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="cocina-layout">
      <section className="card card-ancha">
        <div className="card-header">
          <div className="icon-badge">📖</div>
          <div>
            <h1>Recetas</h1>
            <p className="subtitle">Agrega, edita o quita ingredientes antes de guardar</p>
          </div>
        </div>

        {cargando ? (
          <p className="hint">Cargando recetas...</p>
        ) : recetas.length === 0 ? (
          <p className="hint">Todavía no hay recetas.</p>
        ) : (
          <ul className="lista-recetas">
            {recetas.map((receta) => (
              <li key={receta.id} className={receta.estado === 'inactivo' ? 'receta-inactiva' : ''}>
                <div>
                  <strong>{receta.nombre_plato}</strong>
                  <span className="codigo"> {receta.rubro} · {receta.porciones} porc. · {receta.ingredientes} ing.</span>
                  <div className="hint">
                    {receta.estado === 'activo' ? 'Activa' : 'Inactiva'}
                    {receta.usada_en_comandas ? ' · usada en comandas' : ''}
                  </div>
                </div>
                <div className="fila-acciones">
                  <button type="button" className="btn-mini btn-mini-outline" onClick={() => abrirEdicion(receta.id)}>
                    Editar
                  </button>
                  {receta.estado === 'activo' && (
                    <button
                      type="button"
                      className="btn-mini btn-mini-outline"
                      disabled={guardando}
                      onClick={() => desactivar(receta)}
                    >
                      Desactivar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-ancha">
        <div className="card-header">
          <div className="icon-badge">✏️</div>
          <div>
            <h1>{form.id ? 'Editar receta' : 'Nueva receta'}</h1>
            <p className="subtitle">Las unidades de cada fila son gr, ml o un</p>
          </div>
        </div>

        {error && <div className="error-msg">{error}</div>}
        {aviso && <div className="exito-msg">{aviso}</div>}
        {form.usada && (
          <div className="exito-msg">
            Esta receta ya se usó en comandas ({form.salidas}). Puedes cambiar el nombre, el rubro y las porciones. Los ingredientes quedan fijos para no alterar el historial.
          </div>
        )}

        <form onSubmit={guardar}>
          <div className="grid">
            <div className="campo">
              <label htmlFor="nombrePlato">Nombre del plato *</label>
              <input id="nombrePlato" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="rubro">Rubro *</label>
              <input id="rubro" value={form.rubro} onChange={(e) => setForm({ ...form, rubro: e.target.value })} />
            </div>
          </div>
          <div className="campo" style={{ marginBottom: 16, maxWidth: 180 }}>
            <label htmlFor="porciones">Porciones *</label>
            <input
              id="porciones"
              type="number"
              min="1"
              step="1"
              value={form.porciones}
              onChange={(e) => setForm({ ...form, porciones: e.target.value })}
            />
          </div>

          <div className="campo" style={{ marginBottom: 8 }}>
            <label>Ingredientes *</label>
          </div>
          {form.filas.map((fila, indice) => (
            <div className="fila-ingrediente" key={fila.clave}>
              <div className="campo" style={{ flex: 2 }}>
                <BuscadorInsumo
                  seleccionado={fila.producto}
                  bloqueado={form.usada}
                  onSeleccionar={(producto) => actualizarFila(fila.clave, { producto })}
                  placeholder={`Insumo ${indice + 1}: nombre o código`}
                />
              </div>
              <div className="campo" style={{ width: 110 }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fila.cantidad}
                  disabled={form.usada}
                  placeholder="Cantidad"
                  onChange={(e) => actualizarFila(fila.clave, { cantidad: e.target.value })}
                />
              </div>
              <div className="campo" style={{ width: 90 }}>
                <select
                  className="campo-select"
                  value={fila.unidad}
                  disabled={form.usada}
                  onChange={(e) => actualizarFila(fila.clave, { unidad: e.target.value })}
                >
                  {UNIDADES.map((unidad) => (
                    <option key={unidad} value={unidad}>{unidad}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn-mini btn-mini-outline"
                disabled={form.usada}
                onClick={() => setForm({ ...form, filas: form.filas.filter((item) => item.clave !== fila.clave) })}
              >
                Quitar
              </button>
            </div>
          ))}

          {!form.usada && (
            <button
              type="button"
              className="btn-mini btn-mini-outline"
              style={{ marginBottom: 16 }}
              onClick={() => setForm({ ...form, filas: [...form.filas, filaVacia()] })}
            >
              Agregar ingrediente
            </button>
          )}

          <button type="submit" className="btn-primary" disabled={guardando}>
            {guardando && <span className="btn-spinner" />}
            {form.id ? 'Guardar cambios' : 'Guardar receta'}
          </button>
          {form.id && (
            <button
              type="button"
              className="btn-mini btn-mini-outline"
              style={{ marginTop: 10 }}
              onClick={() => { setForm(formularioVacio()); setError(''); setAviso('') }}
            >
              Cancelar edición
            </button>
          )}
        </form>
      </section>
    </div>
  )
}

export default RecetasCocina
