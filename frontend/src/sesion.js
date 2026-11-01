import { esRolValido } from './permisos'

export const API_URL = 'https://saas-inventario-backend.gastrostock-paula.workers.dev'

export const EVENTO_SESION_EXPIRADA = 'sesion-expirada'

export const obtenerToken = () => localStorage.getItem('token')

export const obtenerUsuario = () => {
  try {
    return JSON.parse(localStorage.getItem('usuario'))
  } catch {
    return null
  }
}

export const guardarSesion = (token, usuario) => {
  localStorage.setItem('token', token)
  localStorage.setItem('usuario', JSON.stringify(usuario))
}

export const limpiarSesion = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('usuario')
}

// Solo lee el campo exp del payload; la firma del JWT únicamente la puede validar el backend.
export const tokenExpirado = (token) => {
  try {
    const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(payloadBase64))
    return !payload.exp || payload.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export const haySesionVigente = () => {
  const token = obtenerToken()
  return Boolean(token && obtenerUsuario() && !tokenExpirado(token))
}

// Devuelve { estado: 'valido', usuario } | { estado: 'invalido' } | { estado: 'error' }
export const verificarSesion = async () => {
  const token = obtenerToken()
  if (!token || tokenExpirado(token)) {
    limpiarSesion()
    return { estado: 'invalido' }
  }

  try {
    const res = await fetch(`${API_URL}/auth/verificar`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 401 || res.status === 403) {
      limpiarSesion()
      return { estado: 'invalido' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      return { estado: 'error' }
    }
    if (!esRolValido(data.usuario?.rol)) {
      limpiarSesion()
      return { estado: 'invalido' }
    }

    const usuario = { id: data.usuario.id, nombre: data.usuario.nombre, email: data.usuario.email, rol: data.usuario.rol }
    localStorage.setItem('usuario', JSON.stringify(usuario))
    return { estado: 'valido', usuario }
  } catch {
    return { estado: 'error' }
  }
}

// Todas las peticiones autenticadas pasan por aquí: si el backend responde 401
// (token expirado o inválido) se limpia la sesión y la app vuelve al login.
export const fetchConAuth = async (ruta, opciones = {}) => {
  const res = await fetch(`${API_URL}${ruta}`, {
    ...opciones,
    headers: { ...opciones.headers, Authorization: `Bearer ${obtenerToken()}` },
  })

  if (res.status === 401) {
    limpiarSesion()
    window.dispatchEvent(new Event(EVENTO_SESION_EXPIRADA))
  }

  return res
}
