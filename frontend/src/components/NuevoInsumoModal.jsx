import { useEffect, useState } from 'react'
import { fetchConAuth } from '../sesion'
import { avisarInventarioActualizado } from '../inventario'

const VACIO = {
  nombre: '',
  codigo_de_barra: '',
  categoria: '',
  unidad_medida: 'un',
  stock_minimo: '',
  stock_maximo: '',
}

function validar(form) {
  const errores = {}
  if (form.nombre.trim().length < 2) errores.nombre = 'Ingresa el nombre del insumo.'
  if (!/^\d{4,18}$/.test(form.codigo_de_barra.trim())) errores.codigo_de_barra = 'El código de barra debe ser numérico.'
  if (!form.categoria) errores.categoria = 'Selecciona una categoría.'
  if (!['gr', 'ml', 'un'].includes(form.unidad_medida)) errores.unidad_medida = 'Selecciona una unidad.'
  const minimo = Number(form.stock_minimo)
  const maximo = Number(form.stock_maximo)
  if (form.stock_minimo === '' || !Number.isFinite(minimo) || minimo < 0) errores.stock_minimo = 'El mínimo no puede ser negativo.'
  if (form.stock_maximo === '' || !Number.isFinite(maximo) || maximo < 0) errores.stock_maximo = 'El máximo no puede ser negativo.'
  else if (Number.isFinite(minimo) && maximo <= minimo) errores.stock_maximo = 'El máximo debe ser mayor que el mínimo.'
  return errores
}

function NuevoInsumoModal({ onClose, onCreado }) {
  const [form, setForm] = useState(VACIO)
  const [opciones, setOpciones] = useState({ unidades: ['gr', 'ml', 'un'], categorias: [] })
  const [errores, setErrores] = useState({})
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      try {
        const res = await fetchConAuth('/productos/opciones')
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.success) setOpciones(data)
      } catch {
        setError('No se pudieron cargar las categorías.')
      }
    }
    cargar()
  }, [])

  const cambiar = (campo) => (e) => {
    setForm((actual) => ({ ...actual, [campo]: e.target.value }))
    setErrores((actual) => ({ ...actual, [campo]: undefined }))
  }

  const guardar = async (e) => {
    e.preventDefault()
    const encontrados = validar(form)
    setErrores(encontrados)
    if (Object.keys(encontrados).length > 0) return
    setEnviando(true)
    setError('')
    try {
      const res = await fetchConAuth('/producto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          codigo_de_barra: form.codigo_de_barra.trim(),
          categoria: form.categoria,
          unidad_medida: form.unidad_medida,
          stock_minimo: Number(form.stock_minimo),
          stock_maximo: Number(form.stock_maximo),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo crear el insumo.')
        return
      }
      avisarInventarioActualizado()
      onCreado(data.data)
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="gu-overlay" onMouseDown={onClose}>
      <div className="gu-modal" role="dialog" aria-modal="true" aria-labelledby="nuevo-insumo-titulo" onMouseDown={(e) => e.stopPropagation()}>
        <div className="gu-modal-cabecera">
          <div>
            <h3 id="nuevo-insumo-titulo">Nuevo insumo</h3>
            <p>Queda con stock 0 hasta que se confirme un lote.</p>
          </div>
          <button type="button" className="gu-modal-cerrar" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form onSubmit={guardar} noValidate>
          <div className="gu-campo">
            <label htmlFor="insumo-nombre">Nombre</label>
            <input id="insumo-nombre" value={form.nombre} onChange={cambiar('nombre')} />
            {errores.nombre && <span className="gu-error-campo">{errores.nombre}</span>}
          </div>
          <div className="gu-campo">
            <label htmlFor="insumo-codigo">Código de barra</label>
            <input id="insumo-codigo" inputMode="numeric" value={form.codigo_de_barra} onChange={cambiar('codigo_de_barra')} />
            {errores.codigo_de_barra && <span className="gu-error-campo">{errores.codigo_de_barra}</span>}
          </div>
          <div className="gu-campo">
            <label htmlFor="insumo-categoria">Categoría</label>
            <select id="insumo-categoria" className="campo-select" value={form.categoria} onChange={cambiar('categoria')}>
              <option value="">Selecciona</option>
              {opciones.categorias.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {errores.categoria && <span className="gu-error-campo">{errores.categoria}</span>}
          </div>
          <div className="gu-campo">
            <label htmlFor="insumo-unidad">Unidad de medida</label>
            <select id="insumo-unidad" className="campo-select" value={form.unidad_medida} onChange={cambiar('unidad_medida')}>
              {opciones.unidades.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {errores.unidad_medida && <span className="gu-error-campo">{errores.unidad_medida}</span>}
          </div>
          <div className="grid">
            <div className="gu-campo">
              <label htmlFor="insumo-min">Stock mínimo</label>
              <input id="insumo-min" type="number" min="0" step="0.01" value={form.stock_minimo} onChange={cambiar('stock_minimo')} />
              {errores.stock_minimo && <span className="gu-error-campo">{errores.stock_minimo}</span>}
            </div>
            <div className="gu-campo">
              <label htmlFor="insumo-max">Stock máximo</label>
              <input id="insumo-max" type="number" min="0" step="0.01" value={form.stock_maximo} onChange={cambiar('stock_maximo')} />
              {errores.stock_maximo && <span className="gu-error-campo">{errores.stock_maximo}</span>}
            </div>
          </div>
          {error && <p className="error-msg">{error}</p>}
          <div className="gu-modal-pie">
            <button type="button" className="gu-btn-cancelar" onClick={onClose} disabled={enviando}>Cancelar</button>
            <button type="submit" className="gu-btn-nuevo" disabled={enviando}>{enviando ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NuevoInsumoModal
