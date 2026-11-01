// Ocultar opciones en la interfaz es solo visual: la seguridad real la aplica el backend
// con el JWT (middlewares soloAdministrador / soloBodegueroOAdministrador).

export const ROLES = {
  ADMINISTRADOR: 'Administrador',
  BODEGUERO: 'Bodeguero',
  CHEF: 'Chef',
}

const INVENTARIO = [ROLES.ADMINISTRADOR, ROLES.BODEGUERO]
const CONSULTA = [ROLES.ADMINISTRADOR, ROLES.BODEGUERO, ROLES.CHEF]
const SOLO_ADMIN = [ROLES.ADMINISTRADOR]
const COCINA = [ROLES.ADMINISTRADOR, ROLES.CHEF]
const ANALITICA_Y_IA = [ROLES.ADMINISTRADOR, ROLES.CHEF]

export const TABS = [
  { id: 'monitoreo', label: 'Monitoreo de Stock', roles: CONSULTA },            // HU-02, HU-09, HU-29
  { id: 'lotes', label: 'Control de Lotes (FEFO)', roles: CONSULTA },           // Chef consulta; Bodeguero y Admin registran
  { id: 'cocina', label: 'Cocina, Recetas y Comandas', roles: COCINA },         // HU-11 a HU-13
  { id: 'chef-ia', label: 'Chef IA & Rescate', roles: ANALITICA_Y_IA },         // HU-14
  { id: 'mermas', label: 'Mermas & Analítica', roles: CONSULTA },               // HU-10, HU-15
  { id: 'reportes', label: 'Reportes & Balances', roles: SOLO_ADMIN },          // HU-16
  { id: 'usuarios', label: 'Usuarios & Parámetros', roles: SOLO_ADMIN },        // HU-17, HU-18, HU-27, HU-28
]

export const esRolValido = (rol) => Object.values(ROLES).includes(rol)

export const tabsPermitidas = (rol) => TABS.filter((tab) => tab.roles.includes(rol))

export const puedeEditarUmbrales = (rol) => rol === ROLES.ADMINISTRADOR

export const puedeRegistrarLotes = (rol) => INVENTARIO.includes(rol)

// HU-10: Chef, Bodeguero y Administrador registran la merma y el stock baja al momento.
export const puedeRegistrarMerma = (rol) => CONSULTA.includes(rol)

export const puedeVerAnaliticaMermas = (rol) => ANALITICA_Y_IA.includes(rol)

export const esChef = (rol) => rol === ROLES.CHEF
