import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { verificarSesion } from '../sesion'

function RutaProtegida({ children, onVerificado }) {
  const [estado, setEstado] = useState('verificando')
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelado = false

    verificarSesion().then((resultado) => {
      if (cancelado) return
      onVerificado(resultado.estado === 'valido' ? resultado.usuario : null)
      setEstado(resultado.estado)
    })

    return () => {
      cancelado = true
    }
  }, [intento, onVerificado])

  if (estado === 'invalido') {
    return <Navigate to="/login" replace />
  }

  if (estado === 'verificando') {
    return (
      <div className="content-area">
        <div className="card"><p>Verificando sesión...</p></div>
      </div>
    )
  }

  if (estado === 'error') {
    return (
      <div className="content-area">
        <div className="card">
          <p className="error-msg">⚠️ No se pudo verificar la sesión. Revisa la conexión con el servidor.</p>
          <button
            className="btn-primary"
            onClick={() => {
              setEstado('verificando')
              setIntento((n) => n + 1)
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return children
}

export default RutaProtegida
