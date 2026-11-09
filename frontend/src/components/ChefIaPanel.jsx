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

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

const cortoInsumo = (nombre) => nombre
  .replace(/\s*\([^)]*\)\s*/g, ' ')
  .replace(/\s+\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|lt|un)\b/gi, '')
  .replace(/\s{2,}/g, ' ')
  .trim()

const escaparRegExp = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const lista = (valor) => (Array.isArray(valor) ? valor : [])

const proximosDeLaReceta = (ingredientes, porVencer) => {
  const porNombre = new Map(porVencer.map((item) => [normalizar(item.producto), item]))
  const presentes = (ingredientes || [])
    .map((ing) => porNombre.get(normalizar(ing.producto)))
    .filter(Boolean)
  if (presentes.length === 0) return new Set()
  const minimo = Math.min(...presentes.map((item) => Number(item.dias_para_vencer)))
  return new Set(
    presentes
      .filter((item) => Number(item.dias_para_vencer) === minimo)
      .map((item) => normalizar(item.producto))
  )
}

const resaltarPaso = (paso, nombres) => {
  const claves = [...new Set(nombres.map(cortoInsumo).filter((nombre) => nombre.length >= 4))]
  if (claves.length === 0) return paso
  const partes = paso.split(new RegExp(`(${claves.map(escaparRegExp).join('|')})`, 'gi'))
  if (partes.length === 1) return paso
  return partes.map((parte, indice) => (
    indice % 2 === 1
      ? <mark key={`${indice}-${parte}`} className="sugerencia-marca">{parte}</mark>
      : parte
  ))
}

function TarjetaReceta({ item, porVencer, sello, abrirFicha, abriendoFicha }) {
  const proximos = proximosDeLaReceta(item.ingredientes, porVencer)
  const porNombre = new Map(porVencer.map((fila) => [normalizar(fila.producto), fila]))
  const nombresProximos = (item.ingredientes || [])
    .filter((ing) => proximos.has(normalizar(ing.producto)))
    .map((ing) => ing.producto)
  return (
    <article className={`sugerencia-card${sello === 'Chef IA' ? ' sugerencia-card-ia' : ''}`}>
      <span className="codigo">{sello}</span>
      <h3>{item.titulo}</h3>
      <h4>Ingredientes</h4>
      <ul className="sugerencia-lista">
        {(item.ingredientes || []).map((ing) => {
          const ficha = proximos.has(normalizar(ing.producto)) ? porNombre.get(normalizar(ing.producto)) : null
          return (
            <li key={ing.producto} className={ficha ? 'sugerencia-por-vencer' : undefined}>
              <span className="sugerencia-insumo-nombre">
                <strong>{new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(ing.cantidad)} {ing.unidad}</strong>
                de {cortoInsumo(ing.producto)}
                {ficha && (
                  <span className="sugerencia-vence">vence {ficha.vence} · {ficha.dias_para_vencer} día(s)</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <h4>Preparación</h4>
      <ol className="sugerencia-lista">
        {(item.pasos || []).map((paso) => (
          <li key={paso}><span>{resaltarPaso(paso, nombresProximos)}</span></li>
        ))}
      </ol>
      {item.receta_id ? (
        <button type="button" className="btn-mini" onClick={() => abrirFicha(item.receta_id)} disabled={abriendoFicha}>
          Ver ficha técnica
        </button>
      ) : null}
    </article>
  )
}

function ChefIaPanel() {
  const recetaGuardada = leerRecetaIa()
  const [datos, setDatos] = useState(recetaGuardada)
  const [sugerenciasIa, setSugerenciasIa] = useState(lista(recetaGuardada?.sugerencias_ia))
  const [sugerenciasChef, setSugerenciasChef] = useState(
    lista(recetaGuardada?.sugerencias_chef).length > 0
      ? lista(recetaGuardada.sugerencias_chef)
      : lista(recetaGuardada?.sugerencias)
  )
  const [categoria, setCategoria] = useState(recetaGuardada?.categoria_restaurante || 'Repostería')
  const [categoriaLista, setCategoriaLista] = useState(Boolean(recetaGuardada))
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [cargandoChef, setCargandoChef] = useState(!recetaGuardada)
  const [esperandoIa, setEsperandoIa] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [ficha, setFicha] = useState(null)
  const [fichaError, setFichaError] = useState('')
  const [abriendoFicha, setAbriendoFicha] = useState(false)
  const abortRef = useRef(null)
  const categoriaRef = useRef(categoria)

  useEffect(() => {
    categoriaRef.current = categoria
  }, [categoria])

  const recordar = (payload) => {
    guardarRecetaIa({
      ...payload,
      sugerencias: lista(payload.sugerencias_ia),
      sugerencias_ia: lista(payload.sugerencias_ia),
      sugerencias_chef: lista(payload.sugerencias_chef),
    })
  }

  const aplicarSugerencias = (data) => {
    if (data.categoria_restaurante && data.categoria_restaurante !== categoriaRef.current) return
    const chef = Array.isArray(data.sugerencias_chef) ? data.sugerencias_chef : null
    const ia = Array.isArray(data.sugerencias_ia)
      ? data.sugerencias_ia
      : (data.origen === 'ia' && data.fase === 'final' ? lista(data.sugerencias) : null)

    setDatos((previo) => {
      const siguiente = {
        ...(previo || {}),
        ...data,
        sugerencias_chef: chef ?? lista(previo?.sugerencias_chef),
        sugerencias_ia: ia ?? lista(previo?.sugerencias_ia),
      }
      if (data.fase === 'final') recordar(siguiente)
      return siguiente
    })
    if (chef) {
      setSugerenciasChef((previas) => (data.fase === 'final' && previas.length > 0 ? previas : chef))
      setCargandoChef(false)
    }
    if (Array.isArray(ia) && (data.fase === 'ia-espera' || data.fase === 'ia-parcial' || data.fase === 'final')) {
      setSugerenciasIa(ia)
    }
    if (data.categoria_restaurante) setCategoria(data.categoria_restaurante)
    setEsperandoIa(data.fase === 'parcial' || data.fase === 'ia-espera')
    if (data.fase === 'final') {
      setAviso((texto) => {
        if (texto && texto.startsWith('Preparando')) return 'Sugerencias listas. Quedan en caché 15 minutos.'
        if (texto && texto.startsWith('Generando')) return 'Listo: recetas nuevas de Chef IA.'
        return texto
      })
    }
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

  const cargar = async ({ preparar = false, borrarChef = false, renovar = false } = {}) => {
    abortRef.current?.abort()
    const controlador = new AbortController()
    abortRef.current = controlador
    setError('')
    setAviso(preparar ? 'Preparando sugerencias para la demo...' : (renovar ? 'Generando recetas nuevas...' : ''))
    const evitar = renovar
      ? sugerenciasIa.map((item) => item.titulo).filter(Boolean)
      : []
    setSugerenciasIa([])
    setEsperandoIa(true)
    if (borrarChef) {
      setSugerenciasChef([])
      setCargandoChef(true)
      setDatos(null)
    } else if (sugerenciasChef.length === 0) {
      setCargandoChef(true)
    }
    try {
      const params = new URLSearchParams()
      if (renovar) {
        params.set('renovar', '1')
        if (evitar.length > 0) params.set('evitar', evitar.join('|'))
      }
      const ruta = params.toString() ? `/ia/sugerencias?${params}` : '/ia/sugerencias'
      const res = await fetchConAuth(ruta, { signal: controlador.signal })
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
        if (data.contexto) setDatos((previo) => ({ ...(previo || {}), contexto: data.contexto, generado_en_ms: data.generado_en_ms }))
        return
      }
      aplicarSugerencias({ ...data, fase: 'final' })
    } catch (error) {
      if (error?.name === 'AbortError') return
      setError('Error de conexión con el servidor.')
    } finally {
      if (!controlador.signal.aborted) {
        setCargandoChef(false)
        setEsperandoIa(false)
      }
    }
  }

  useEffect(() => {
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
    categoriaRef.current = valor
    setCategoriaLista(true)
    setAviso('')
    setError('')
    setSugerenciasIa([])
    setSugerenciasChef([])
    setDatos(null)
    setCargandoChef(true)
    setEsperandoIa(true)
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
      await cargar({ borrarChef: true })
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
  const ocupado = esperandoIa || cargandoChef || guardando

  return (
    <section className="card card-ancha">
      <div className="card-header">
        <div className="icon-badge">✨</div>
        <div className="card-header-texto">
          <h1>Chef IA y rescate</h1>
          <p className="subtitle">Recetas de {categoria} para usar primero lo que está por vencer. El resto de ingredientes sale del inventario.</p>
        </div>
        <button type="button" className="btn-mini btn-mini-outline" onClick={() => cargar({ renovar: true })} disabled={ocupado}>
          Actualizar
        </button>
        {esperandoIa ? (
          <button type="button" className="btn-mini btn-chef-ia-cargando" disabled>
            <span className="chef-ia-spinner-mini" aria-hidden="true" />
            Cargando Chef IA
          </button>
        ) : (
          <button type="button" className="btn-mini" onClick={() => cargar({ preparar: true })} disabled={ocupado}>
            Preparar Chef IA
          </button>
        )}
      </div>

      <div className="campo" style={{ marginBottom: 16, maxWidth: 320 }}>
        <label htmlFor="categoriaRestaurante">Categoría del restaurante</label>
        <select
          id="categoriaRestaurante"
          className="campo-select"
          value={categoria}
          disabled={guardando}
          onChange={(e) => cambiarCategoria(e.target.value)}
        >
          {CATEGORIAS.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <span className="hint">Queda guardada y se usa en las próximas sugerencias.</span>
      </div>

      {aviso && <div className="exito-msg">{aviso}</div>}
      {error && <div className="error-msg">{error}</div>}
      {fichaError && <div className="error-msg">{fichaError}</div>}

      <div className="chef-ia-columnas">
        <div className="chef-ia-col">
          <h2 className="subtitulo-seccion">Chef IA</h2>
          {!esperandoIa && sugerenciasIa.length === 0 && (
            <p className="hint">Chef IA no devolvió recetas esta vez. A la derecha quedan las sugerencias del chef.</p>
          )}
          {(esperandoIa || sugerenciasIa.length > 0) && (
            <div className="sugerencias-chef">
              {sugerenciasIa.map((item) => (
                <TarjetaReceta
                  key={`ia-${item.receta_id || 'nueva'}-${item.titulo}`}
                  item={item}
                  porVencer={porVencer}
                  sello="Chef IA"
                  abrirFicha={abrirFicha}
                  abriendoFicha={abriendoFicha}
                />
              ))}
              {esperandoIa && sugerenciasIa.length < 1 && (
                <article key="ia-carga-1" className="sugerencia-card sugerencia-card-ia sugerencia-card-cargando" aria-busy="true">
                  <span className="codigo">Chef IA</span>
                  <span className="chef-ia-spinner" aria-hidden="true" />
                  <p className="hint">Cargando receta...</p>
                </article>
              )}
            </div>
          )}
        </div>

        <div className="chef-ia-col">
          <h2 className="subtitulo-seccion">Sugerencias del Chef</h2>
          {cargandoChef && sugerenciasChef.length === 0 && (
            <div className="chef-ia-cargando chef-ia-cargando-bloque" role="status" aria-live="polite">
              <span className="chef-ia-spinner" aria-hidden="true" />
              <p className="hint">Armando sugerencias del chef...</p>
            </div>
          )}
          {sugerenciasChef.length > 0 && (
            <div className="sugerencias-chef">
              {sugerenciasChef.slice(0, 3).map((item) => (
                <TarjetaReceta
                  key={`chef-${item.titulo}`}
                  item={item}
                  porVencer={porVencer}
                  sello="Receta"
                  abrirFicha={abrirFicha}
                  abriendoFicha={abriendoFicha}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {porVencer.length > 0 && (
        <>
          <h2 className="subtitulo-seccion">Insumos por vencer</h2>
          <p className="hint">Chef IA usa los 10 que vencen primero y propone 1 receta.</p>
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

      {!esperandoIa && datos?.generado_en_ms != null && (
        <p className="hint">
          Recetas de {categoria} · {Number(datos.generado_en_ms)} ms
        </p>
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
