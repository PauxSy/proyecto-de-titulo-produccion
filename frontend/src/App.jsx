import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import Login from './components/Login'
import PanelInventario from './components/PanelInventario'
import RutaProtegida from './components/RutaProtegida'
import { olvidarPosicion } from './posicion'
import { EVENTO_SESION_EXPIRADA, haySesionVigente, limpiarSesion, obtenerUsuario } from './sesion'
import './App.css'

function App() {
  const [usuario, setUsuario] = useState(obtenerUsuario)
  const navigate = useNavigate()

  const cerrarSesion = useCallback(() => {
    limpiarSesion()
    olvidarPosicion()
    setUsuario(null)
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    window.addEventListener(EVENTO_SESION_EXPIRADA, cerrarSesion)
    return () => window.removeEventListener(EVENTO_SESION_EXPIRADA, cerrarSesion)
  }, [cerrarSesion])

  // Detecta un token borrado o expirado mientras la app está abierta, sin esperar a otra petición
  useEffect(() => {
    if (!usuario) return
    const revisar = () => {
      if (!haySesionVigente()) cerrarSesion()
    }
    const intervalo = setInterval(revisar, 5000)
    window.addEventListener('focus', revisar)
    window.addEventListener('storage', revisar)
    return () => {
      clearInterval(intervalo)
      window.removeEventListener('focus', revisar)
      window.removeEventListener('storage', revisar)
    }
  }, [usuario, cerrarSesion])

  const handleLoginExitoso = (u) => {
    setUsuario(u)
    navigate('/inventario', { replace: true })
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          haySesionVigente()
            ? <Navigate to="/inventario" replace />
            : <Login onLoginExitoso={handleLoginExitoso} />
        }
      />
      <Route
        path="/inventario"
        element={
          <RutaProtegida onVerificado={setUsuario}>
            {usuario && <PanelInventario usuario={usuario} onLogout={cerrarSesion} />}
          </RutaProtegida>
        }
      />
      <Route path="*" element={<Navigate to="/inventario" replace />} />
    </Routes>
  )
}

export default App
