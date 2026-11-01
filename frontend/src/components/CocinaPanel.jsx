import { useState } from 'react'
import { esChef } from '../permisos'
import { elegirGuardado, guardarPosicion } from '../posicion'
import RecetasCocina from './RecetasCocina'
import ComandaForm from './ComandaForm'
import SalidaManualForm from './SalidaManualForm'

const SECCIONES = [
  { id: 'recetas', label: 'Recetas', chef: false },
  { id: 'comanda', label: 'Comanda', chef: true },
  { id: 'salida', label: 'Salida manual', chef: true },
]

function CocinaPanel({ usuario }) {
  const chef = esChef(usuario.rol)
  const secciones = SECCIONES.filter((seccion) => chef || !seccion.chef)
  const [activa, setActiva] = useState(() => elegirGuardado('cocina', secciones.map((seccion) => seccion.id), 'recetas'))
  const visible = secciones.some((seccion) => seccion.id === activa) ? activa : 'recetas'

  const cambiarSeccion = (id) => {
    setActiva(id)
    guardarPosicion({ cocina: id })
  }

  return (
    <div>
      <div className="cocina-subtabs">
        {secciones.map((seccion) => (
          <button
            key={seccion.id}
            type="button"
            className={visible === seccion.id ? 'activa' : ''}
            onClick={() => cambiarSeccion(seccion.id)}
          >
            {seccion.label}
          </button>
        ))}
      </div>
      {!chef && (
        <p className="hint" style={{ margin: '0 0 16px' }}>
          Las comandas y las salidas manuales las confirma el Chef. Desde aquí puedes armar y desactivar recetas.
        </p>
      )}
      {visible === 'recetas' && <RecetasCocina />}
      {visible === 'comanda' && <ComandaForm />}
      {visible === 'salida' && <SalidaManualForm />}
    </div>
  )
}

export default CocinaPanel
