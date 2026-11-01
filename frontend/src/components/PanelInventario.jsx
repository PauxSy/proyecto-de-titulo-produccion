import { useState } from 'react'
import Navbar from './Navbar'
import TabsBar from './TabsBar'
import StockTable from './StockTable'
import GestionUsuarios from './GestionUsuarios'
import ControlLotes from './ControlLotes'
import CocinaPanel from './CocinaPanel'
import MermasPanel from './MermasPanel'
import ChefIaPanel from './ChefIaPanel'
import HistorialPanel from './HistorialPanel'
import AjustesSistema from './AjustesSistema'
import { tabsPermitidas } from '../permisos'
import { elegirGuardado, guardarPosicion, useRecordarPosicion } from '../posicion'

function PanelInventario({ usuario, onLogout }) {
  const tabs = tabsPermitidas(usuario.rol)
  const ids = tabs.map((tab) => tab.id)
  const respaldo = tabs[0]?.id ?? 'monitoreo'
  const [tabActiva, setTabActiva] = useState(() => elegirGuardado('tab', ids, respaldo))
  const [seccionUsuarios, setSeccionUsuarios] = useState(() => elegirGuardado('usuarios', ['cuentas', 'ajustes'], 'cuentas'))
  const tabVisible = tabs.some((t) => t.id === tabActiva) ? tabActiva : respaldo

  useRecordarPosicion()

  const cambiarTab = (id) => {
    setTabActiva(id)
    guardarPosicion({ tab: id })
  }

  const cambiarSeccionUsuarios = (id) => {
    setSeccionUsuarios(id)
    guardarPosicion({ usuarios: id })
  }

  return (
    <div>
      <Navbar
        usuario={usuario}
        onLogout={onLogout}
        onIrAChefIa={tabs.some((tab) => tab.id === 'chef-ia') ? () => cambiarTab('chef-ia') : undefined}
      />
      <TabsBar tabs={tabs} tabActiva={tabVisible} onCambiarTab={cambiarTab} />
      <div className="content-area">
        {tabVisible === 'monitoreo' ? (
          <StockTable usuario={usuario} />
        ) : tabVisible === 'usuarios' ? (
          <div>
            <div className="cocina-subtabs">
              <button type="button" className={seccionUsuarios === 'cuentas' ? 'activa' : ''} onClick={() => cambiarSeccionUsuarios('cuentas')}>
                Usuarios
              </button>
              <button type="button" className={seccionUsuarios === 'ajustes' ? 'activa' : ''} onClick={() => cambiarSeccionUsuarios('ajustes')}>
                Ajustes del Sistema
              </button>
            </div>
            {seccionUsuarios === 'cuentas' ? <GestionUsuarios usuarioActual={usuario} /> : <AjustesSistema />}
          </div>
        ) : tabVisible === 'lotes' ? (
          <ControlLotes usuario={usuario} />
        ) : tabVisible === 'cocina' ? (
          <CocinaPanel usuario={usuario} />
        ) : tabVisible === 'mermas' ? (
          <MermasPanel usuario={usuario} />
        ) : tabVisible === 'chef-ia' ? (
          <ChefIaPanel />
        ) : tabVisible === 'reportes' ? (
          <HistorialPanel />
        ) : (
          <div className="card"><p>Sección en construcción 🚧</p></div>
        )}
      </div>
    </div>
  )
}

export default PanelInventario