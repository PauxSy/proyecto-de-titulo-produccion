import { useEffect, useRef, useState } from 'react'
import { guardarRecetaIa, leerRecetaIa } from '../posicion'
import { fetchConAuth } from '../sesion'

const CATEGORIAS = [
  'Repostería',
  'Comida Italiana',
  'Comida Rápida',
  'Comida Tailandesa',
  'Comida Chilena',
  'Comida China',
]

function ChefIaPanel() {
  const recetaGuardada = leerRecetaIa()
  const [datos, setDatos] = useState(recetaGuardada)
  const [categoria, setCategoria] = useState(recetaGuardada?.categoria_restaurante || 'Repostería')
  const [categoriaLista, setCategoriaLista] = useState(Boolean(recetaGuardada))
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [cargando, setCargando] = useState(!recetaGuardada)
  const [guardando, setGuardando] = useState(false)
  const [ficha, setFicha] = useState(null)
  const [fichaError, setFichaError] = useState('')
  const [abriendoFicha, setAbriendoFicha] = useState(false)
  const abortRef = useRef(null)

  const recordar = (data) => {
    if (!data || data.fase === 'parcial') return
    const visible = { ...data, sugerencias: Array.isArray(data.sugerencias) ? data.sugerencias : [] }
    guardarRecetaIa(visible)
  }

  const aplicarSugerencias = (data) => {
    if (data.origen !== 'ia' && data.origen !== 'local') return
    if (data.categoria_restaurante) setCategoria(data.categoria_restaurante)
    setDatos(data)
    setCargando(false)
    recordar(data)
  }

  const leerEventos = async (res) => {
    const lector = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await lector.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let corte = buffer.indexOf('\n\n')
      while (corte !== -1) {
        const bloque = buffer.slice(0, corte)
        buffer = buffer.slice(corte + 2)
        const linea = bloque.split('\n').find((fila) => fila.startsWith('data:'))
        if (linea) {
          const data = JSON.parse(linea.slice(5).trim())
          if (data?.success) aplicarSugerencias(data)
        }
        corte = buffer.indexOf('\n\n')
      }
    }
  }

  const cargar = async () => {
    abortRef.current?.abort()
    const controlador = new AbortController()
    abortRef.current = controlador
    setError('')
    setAviso('')
    setDatos(null)
    setCargando(true)
    try {
      const res = await fetchConAuth('/ia/sugerencias', { signal: controlador.signal })
      const tipo = res.headers.get('content-type') || ''
      if (tipo.includes('text/event-stream') && res.body) {
        if (!res.ok) {
          setError('No se pudieron generar sugerencias.')
          return
        }
        await leerEventos(res)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data.categoria_restaurante) setCategoria(data.categoria_restaurante)
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudieron generar sugerencias.')
        setDatos(data.contexto ? {
          contexto: data.contexto,
          sugerencias: [],
          generado_en_ms: data.generado_en_ms,
        } : null)
        return
      }
      if (data.origen === 'ia' || data.origen === 'local') aplicarSugerencias({ ...data, fase: 'final' })
      else {
        const visible = { ...data, sugerencias: Array.isArray(data.sugerencias) ? data.sugerencias : [] }
        setDatos(visible)
        recordar(visible)
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      setError('Error de conexión con el servidor.')
    } finally {
      if (!controlador.signal.aborted) setCargando(false)
    }
  }

  useEffect(() => {
    if (leerRecetaIa()) return undefined
    let vigente = true
    const iniciar = async () => {
      try {
        const res = await fetchConAuth('/ia/categoria-restaurante')
        const data = await res.json().catch(() => ({}))
        if (vigente && data?.data?.categoria) setCategoria(data.data.categoria)
      } catch {
        // La consulta de sugerencias vuelve a traer la categoría guardada.
      } finally {
        if (vigente) setCategoriaLista(true)
      }
      if (vigente) await cargar()
    }
    iniciar()
    return () => {
      vigente = false
      abortRef.current?.abort()
    }
  }, [])

  const cambiarCategoria = async (valor) => {
    setCategoria(valor)
    setCategoriaLista(true)
    setAviso('')
    setError('')
    setDatos(null)
    setGuardando(true)
    try {
      const res = await fetchConAuth('/ia/categoria-restaurante', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria: valor }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo guardar la categoría.')
        return
      }
      await cargar()
      setAviso(`Categoría guardada: ${valor}. Las recetas se arman con ese estilo.`)
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const abrirFicha = async (recetaId) => {
    setFichaError('')
    setAbriendoFicha(true)
    try {
      const res = await fetchConAuth(`/recetas/${recetaId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setFichaError(data.error || 'No se pudo abrir la ficha técnica.')
        return
      }
      setFicha(data.data)
    } catch {
      setFichaError('Error de conexión con el servidor.')
    } finally {
      setAbriendoFicha(false)
    }
  }

  const porVencer = datos?.contexto?.proximos_a_vencer || []

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">✨</div>
        <div className="card-header-texto">
          <h1>Chef IA y rescate</h1>
          <p className="subtitle">Recetas de {categoria} para usar primero lo que está por vencer</p>
        </div>
        <button type="button" className="btn-mini btn-mini-outline" onClick={cargar} disabled={cargando || guardando}>
          Actualizar
        </button>
      </div>

      <div className="campo" style={{ marginBottom: 16, maxWidth: 320 }}>
        <label htmlFor="categoriaRestaurante">Categoría del restaurante</label>
        <select
          id="categoriaRestaurante"
          className="campo-select"
          value={categoria}
          disabled={guardando || cargando}
          onChange={(e) => cambiarCategoria(e.target.value)}
        >
          {CATEGORIAS.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <span className="hint">Queda guardada y se usa en las próximas sugerencias.</span>
      </div>

      {cargando && (
        <div className="chef-ia-cargando" role="status" aria-live="polite">
          <span className="chef-ia-spinner" aria-hidden="true" />
          <p className="hint">
            {categoriaLista
              ? `Generando la receta de ${categoria} con IA...`
              : 'Generando la receta con IA...'}
          </p>
        </div>
      )}
      {!cargando && aviso && <div className="exito-msg">{aviso}</div>}
      {!cargando && datos?.aviso && datos?.fase !== 'parcial' && <p className="hint">{datos.aviso}</p>}
      {!cargando && error && <div className="error-msg">{error}</div>}
      {fichaError && <div className="error-msg">{fichaError}</div>}

      {!cargando && datos?.origen === 'local' && (
        <p className="hint">{datos.mensaje || `Recetas guardadas del rubro ${categoria}. El aceite y los insumos de venta se ofrecen, no se cocinan.`}</p>
      )}

      {!cargando && (datos?.sugerencias || []).length > 0 && (
        <>
          <h2 className="subtitulo-seccion">{datos?.origen === 'local' ? 'Recetas de respaldo' : 'Sugerencias del Chef'}</h2>
          <div className="sugerencias-chef">
            {datos.sugerencias.map((item) => (
              <article key={`${item.receta_id || 'nueva'}-${item.titulo}`} className="sugerencia-card">
                <span className="codigo">{item.tipo === 'promocion' ? 'Promoción' : 'Receta'}</span>
                <h3>{item.titulo}</h3>
                <p>{item.descripcion}</p>
                <h4>Ingredientes</h4>
                <ul className="sugerencia-lista">
                  {(item.ingredientes || []).map((ing) => (
                    <li key={ing.producto}>
                      {ing.producto}: {new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(ing.cantidad)} {ing.unidad}
                    </li>
                  ))}
                </ul>
                <h4>Preparación</h4>
                <ol className="sugerencia-lista">
                  {(item.pasos || []).map((paso) => (
                    <li key={paso}>{paso}</li>
                  ))}
                </ol>
                {item.receta_id && (
                  <button type="button" className="btn-mini" onClick={() => abrirFicha(item.receta_id)} disabled={abriendoFicha}>
                    Ver ficha técnica
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {porVencer.length > 0 && (
        <>
          <h2 className="subtitulo-seccion">Insumos por vencer</h2>
          <ul className="lista-recetas">
            {porVencer.map((item) => (
              <li key={item.producto}>
                <span>{item.producto}</span>
                <span className="codigo">vence {item.vence} · {item.dias_para_vencer} día(s)</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {!cargando && datos?.generado_en_ms != null && (
        <p className="hint">
          Respuesta del Worker: {Number(datos.generado_en_ms)} ms
          {Number(datos.descartadas_por_alucinacion) > 0
            ? ` · ${datos.descartadas_por_alucinacion} sugerencia(s) se dejó afuera porque no usaba insumos de ${categoria} que estén por vencer`
            : ''}
        </p>
      )}

      {!cargando && !error && (datos?.sugerencias || []).length === 0 && (
        <p className="hint">{datos?.mensaje || 'No hay sugerencias para mostrar.'}</p>
      )}

      {ficha && (
        <div className="gu-overlay" onMouseDown={() => setFicha(null)}>
          <div className="gu-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="gu-modal-cabecera">
              <div>
                <h3>{ficha.nombre_plato}</h3>
                <p>{ficha.rubro || 'Sin rubro'} · {ficha.porciones} porción(es) · {ficha.estado}</p>
              </div>
              <button type="button" className="gu-modal-cerrar" onClick={() => setFicha(null)} aria-label="Cerrar">×</button>
            </div>
            <ul className="lista-recetas">
              {(ficha.ingredientes || []).map((ing) => (
                <li key={ing.producto_id}>
                  <span>{ing.producto}</span>
                  <span className="codigo">{ing.cantidad_requerida} {ing.unidad_medida}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

export default ChefIaPanel
