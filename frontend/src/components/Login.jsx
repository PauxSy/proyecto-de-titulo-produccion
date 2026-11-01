import { useState } from 'react'
import { esRolValido } from '../permisos'
import { API_URL, guardarSesion } from '../sesion'
import '../App.css'

function Login({ onLoginExitoso }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password.trim()) {
      setError('Ambos campos son obligatorios.')
      return
    }

    setCargando(true)
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      // HU-22: mensaje genérico, sin indicar si falló el email, la contraseña o si la cuenta está desactivada
      if (res.status === 401) {
        setError('Credenciales inválidas.')
        return
      }

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        setError(data.error || 'No se pudo iniciar sesión. Intenta nuevamente.')
        return
      }

      if (!data.token || !data.usuario) {
        setError('Respuesta inválida del servidor.')
        return
      }

      // HU-23: el rol que usa el frontend es el devuelto por el backend
      if (!esRolValido(data.usuario.rol)) {
        setError('Tu cuenta no tiene un rol válido asignado. Contacta al administrador.')
        return
      }

      const usuarioSesion = {
        id: data.usuario.id,
        nombre: data.usuario.nombre,
        email: data.usuario.email,
        rol: data.usuario.rol,
      }

      guardarSesion(data.token, usuarioSesion)
      onLoginExitoso(usuarioSesion)
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="auth-logo">🍽️</div>
          <div>
            <div className="auth-brand-title">GastroStock <span>FEFO</span></div>
            <div className="auth-brand-subtitle">Sistema Integral de Inventario & Cocina</div>
          </div>
        </div>

        <p className="auth-description">
          Control de existencias con rotación de lotes FEFO (First Expired, First Out),
          descuento automático por comandas, analítica de mermas y auditoría de consistencia física.
        </p>

        <div className="auth-feature">
          <span className="auth-feature-icon green">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span className="auth-feature-text">Trazabilidad completa por lotes y fechas de caducidad.</span>
        </div>

        <div className="auth-feature">
          <span className="auth-feature-icon blue">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span className="auth-feature-text">Las comandas descuentan los insumos de la receta al confirmarse.</span>
        </div>

        <div className="auth-feature">
          <span className="auth-feature-icon purple">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span className="auth-feature-text">Control de acceso basado en roles RBAC (Admin, Chef, Bodega).</span>
        </div>
      </div>

      <div className="auth-form-panel">
        <h2 className="auth-form-title">Bienvenido de vuelta</h2>
        <p className="auth-form-subtitle">Ingrese sus credenciales para acceder al panel</p>

        <form onSubmit={handleSubmit}>
          <div className="dark-campo">
            <label htmlFor="email">Correo Electrónico</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ej: admin@prueba.com"
              autoComplete="username"
            />
          </div>
          <div className="dark-campo">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && <p className="auth-error">⚠️ {error}</p>}

          <button type="submit" className="auth-submit-btn" disabled={cargando}>
            {cargando ? 'Ingresando...' : 'Ingresar al Sistema'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login