import { useEffect } from 'react'

const CLAVE = 'gastrostock-posicion'
const CLAVE_RECETA = 'gastrostock-receta-ia'

// El navegador restaura el scroll antes de que carguen las tablas y lo deja arriba.
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

const leer = () => {
  try {
    const datos = JSON.parse(sessionStorage.getItem(CLAVE) || '{}')
    return datos && typeof datos === 'object' ? datos : {}
  } catch {
    return {}
  }
}

let ignorarScroll = false

const altoSuficiente = (destino) => (
  document.documentElement.scrollHeight - window.innerHeight + 16 >= destino
)

export const guardarPosicion = (parcial) => {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ ...leer(), ...parcial }))
  } catch {
    // Si el navegador bloquea sessionStorage, la pantalla sigue funcionando.
  }
}

export const elegirGuardado = (clave, permitidos, respaldo) => {
  const valor = leer()[clave]
  return permitidos.includes(valor) ? valor : respaldo
}

const recetaValida = (datos) => (
  Boolean(datos && typeof datos === 'object' && Array.isArray(datos.sugerencias))
)

export const guardarRecetaIa = (datos) => {
  try {
    localStorage.setItem(CLAVE_RECETA, JSON.stringify(datos))
    sessionStorage.removeItem(CLAVE_RECETA)
  } catch {
    // Si el navegador bloquea localStorage, la receta se ve igual en esta visita.
  }
}

export const leerRecetaIa = () => {
  try {
    const local = JSON.parse(localStorage.getItem(CLAVE_RECETA) || 'null')
    if (recetaValida(local)) return local
    const previa = JSON.parse(sessionStorage.getItem(CLAVE_RECETA) || 'null')
    if (!recetaValida(previa)) return null
    localStorage.setItem(CLAVE_RECETA, JSON.stringify(previa))
    sessionStorage.removeItem(CLAVE_RECETA)
    return previa
  } catch {
    return null
  }
}

export const olvidarPosicion = () => {
  ignorarScroll = false
  try {
    sessionStorage.removeItem(CLAVE)
  } catch {
    // No había nada guardado.
  }
}

// Recuerda pestaña y scroll. El scroll se aplica cuando el contenido ya tiene altura.
export function useRecordarPosicion() {
  useEffect(() => {
    const destino = Number(leer().scroll) || 0
    ignorarScroll = destino > 0
    let listo = destino <= 0

    const intentar = () => {
      if (listo || !ignorarScroll) return true
      if (!altoSuficiente(destino)) return false
      window.scrollTo(0, destino)
      ignorarScroll = false
      listo = true
      return true
    }

    const observer = new ResizeObserver(() => {
      if (intentar()) observer.disconnect()
    })
    observer.observe(document.documentElement)
    if (intentar()) observer.disconnect()

    const limite = window.setTimeout(() => {
      if (!listo && ignorarScroll) {
        const maximo = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        window.scrollTo(0, Math.min(destino, maximo))
        ignorarScroll = false
        listo = true
      }
      observer.disconnect()
    }, 8000)

    let marco = 0
    const alDesplazar = () => {
      if (ignorarScroll) return
      cancelAnimationFrame(marco)
      marco = requestAnimationFrame(() => {
        guardarPosicion({ scroll: Math.round(window.scrollY) })
      })
    }

    const alOcultar = () => {
      if (!ignorarScroll) guardarPosicion({ scroll: Math.round(window.scrollY) })
    }

    window.addEventListener('scroll', alDesplazar, { passive: true })
    window.addEventListener('pagehide', alOcultar)

    return () => {
      observer.disconnect()
      clearTimeout(limite)
      cancelAnimationFrame(marco)
      window.removeEventListener('scroll', alDesplazar)
      window.removeEventListener('pagehide', alOcultar)
      ignorarScroll = false
    }
  }, [])
}
