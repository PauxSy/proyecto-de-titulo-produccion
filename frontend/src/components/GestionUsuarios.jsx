import { useCallback, useEffect, useState } from 'react'
import { ROLES } from '../permisos'
import { fetchConAuth } from '../sesion'


const ROLES_ASIGNABLES = [ROLES.ADMINISTRADOR, ROLES.CHEF, ROLES.BODEGUERO]

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LARGO_MINIMO_PASSWORD = 8

const FORMULARIO_VACIO = { nombre: '', email: '', password: '', rol: '' }

const TARJETAS_ROLES = [
  {
    clase: 'admin',
    titulo: 'Administrador de Local',
    items: [
      'Configuración de stock mínimo y máximo por producto',
      'Reportes de movimientos y balances de inventario',
      'Gestión de usuarios y credenciales',
      'Parámetros globales de stock y vencimiento',
      'Registro de nuevos insumos',
    ],
  },
  {
    clase: 'chef',
    titulo: 'Chef Ejecutivo / Cocina',
    items: [
      'Salidas manuales de insumos de cocina',
      'Creación, edición y desactivación de recetas',
      'Comandas con descuento automático FEFO',
      'Sugerencias de recetas con IA',
      'Registro de merma con descuento inmediato de stock',
      'Analítica histórica de mermas',
    ],
  },
  {
    clase: 'bodeguero',
    titulo: 'Bodeguero',
    items: [
      'Monitoreo de stock mínimo y máximo',
      'Recepción por código de barras e ingreso de lote',
      'Consulta de lotes activos según FEFO',
      'Registro de merma y descarte',
    ],
  },
]

const claseRol = (rol) => `gu-rol gu-rol-${String(rol ?? '').toLowerCase()}`

const validar = ({ nombre, email, password, rol }, editando) => {
  const errores = {}
  if (nombre.trim().length < 2) errores.nombre = 'Ingresa el nombre completo.'
  if (!email.trim()) errores.email = 'Ingresa el correo electrónico.'
  else if (!REGEX_EMAIL.test(email.trim())) errores.email = 'El correo no tiene un formato válido.'
  if (!editando && !password) errores.password = 'Ingresa una contraseña temporal.'
  else if (password && (password.length < LARGO_MINIMO_PASSWORD || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
    errores.password = `Usa al menos ${LARGO_MINIMO_PASSWORD} caracteres, con letras y números.`
  }
  if (!ROLES_ASIGNABLES.includes(rol)) errores.rol = 'Selecciona un rol.'
  return errores
}

function GestionUsuarios({ usuarioActual }) {
  const [usuarios, setUsuarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorLista, setErrorLista] = useState('')
  const [mensajeExito, setMensajeExito] = useState('')

  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORMULARIO_VACIO)
  const [errores, setErrores] = useState({})
  const [errorEnvio, setErrorEnvio] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verPassword, setVerPassword] = useState(false)

  const cargarUsuarios = useCallback(async () => {
    setErrorLista('')
    try {
      const res = await fetchConAuth('/usuarios')
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setErrorLista(data.error || 'No se pudo cargar la lista de usuarios.')
        return
      }
      setUsuarios(data.data ?? data.usuarios ?? [])
    } catch {
      setErrorLista('Error de conexión con el servidor.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(cargarUsuarios, 0)
    return () => clearTimeout(id)
  }, [cargarUsuarios])

  const abrirModal = (usuario = null) => {
    const existente = usuario?.id != null ? usuario : null
    setEditando(existente)
    setForm(existente
      ? { nombre: existente.nombre, email: existente.email, password: '', rol: existente.rol }
      : FORMULARIO_VACIO)
    setErrores({})
    setErrorEnvio('')
    setVerPassword(false)
    setModalAbierto(true)
  }

  const cerrarModal = () => {
    if (!enviando) setModalAbierto(false)
  }

  const cambiarCampo = (campo) => (e) => {
    setForm((f) => ({ ...f, [campo]: e.target.value }))
    if (errores[campo]) setErrores((er) => ({ ...er, [campo]: undefined }))
  }

  const crearUsuario = async (e) => {
    e.preventDefault()
    setErrorEnvio('')

    const erroresForm = validar(form, Boolean(editando))
    setErrores(erroresForm)
    if (Object.keys(erroresForm).length > 0) return

    const cuerpo = {
      nombre: form.nombre.trim(),
      email: form.email.trim().toLowerCase(),
      rol: form.rol,
    }
    if (!editando || form.password) cuerpo.password = form.password

    setEnviando(true)
    try {
      const res = await fetchConAuth(editando ? `/usuarios/${editando.id}` : '/usuarios', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setErrorEnvio(data.error || 'No se pudo guardar el usuario. Intenta nuevamente.')
        return
      }
      setModalAbierto(false)
      setMensajeExito(editando ? `Usuario ${form.nombre.trim()} actualizado.` : `Usuario ${form.nombre.trim()} creado correctamente.`)
      cargarUsuarios()
    } catch {
      setErrorEnvio('Error de conexión con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const cambiarActivo = async (u, activo) => {
    const pregunta = activo
      ? `¿Reactivar a ${u.nombre}? Podrá iniciar sesión de nuevo.`
      : `¿Desactivar a ${u.nombre}? No podrá iniciar sesión.`
    if (!window.confirm(pregunta)) return
    setMensajeExito('')
    try {
      const res = await fetchConAuth(`/usuarios/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setErrorLista(data.error || 'No se pudo actualizar el usuario.')
        return
      }
      setMensajeExito(activo ? `Usuario ${u.nombre} reactivado.` : `Usuario ${u.nombre} desactivado.`)
      cargarUsuarios()
    } catch {
      setErrorLista('Error de conexión con el servidor.')
    }
  }

  return (
    <div className="gu-wrapper">
      <div className="gu-header">
        <div className="gu-header-texto">
          <h2>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Control de Acceso Basado en Roles (RBAC) & Sesión JWT
          </h2>
          <p>Gestiona quién puede entrar al sistema y qué puede hacer cada colaborador.</p>
        </div>
        <button type="button" className="gu-btn-nuevo" onClick={() => abrirModal()}>
          <span aria-hidden="true">+</span> Nuevo Usuario
        </button>
      </div>

      <div className="gu-roles-grid">
        {TARJETAS_ROLES.map((t) => (
          <div key={t.clase} className="gu-role-card">
            <h3 className={`gu-role-titulo gu-role-titulo-${t.clase}`}>{t.titulo}</h3>
            <ul>
              {t.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {mensajeExito && <p className="exito-msg">{mensajeExito}</p>}
      {errorLista && <p className="error-msg">⚠️ {errorLista}</p>}

      <div className="gu-tabla-card">
        <table className="gu-tabla">
          <thead>
            <tr>
              <th>Nombre completo</th>
              <th>Correo electrónico</th>
              <th>Rol asignado</th>
              <th>Estado</th>
              <th className="gu-th-acciones">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={5} className="gu-vacio">Cargando usuarios...</td>
              </tr>
            )}
            {!cargando && usuarios.length === 0 && !errorLista && (
              <tr>
                <td colSpan={5} className="gu-vacio">
                  Aún no hay usuarios. Crea el primero con “Nuevo Usuario”.
                </td>
              </tr>
            )}
            {usuarios.map((u) => {
              const esSesionActual = u.id === usuarioActual?.id
              return (
                <tr key={u.id}>
                  <td>
                    <div className="gu-persona">
                      <span className="gu-avatar">{u.nombre?.charAt(0).toUpperCase()}</span>
                      <div>
                        <div className="gu-nombre">{u.nombre}</div>
                        {esSesionActual && <div className="gu-sesion-actual">(Sesión actual)</div>}
                      </div>
                    </div>
                  </td>
                  <td className="gu-email">{u.email}</td>
                  <td><span className={claseRol(u.rol)}>{u.rol}</span></td>
                  <td>
                    <span className={u.activo ? 'gu-estado gu-estado-activo' : 'gu-estado gu-estado-inactivo'}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="gu-acciones">
                    <button type="button" className="gu-btn-editar" onClick={() => abrirModal(u)}>
                      Editar
                    </button>
                    {!esSesionActual && u.activo && (
                      <button type="button" className="gu-btn-desactivar" onClick={() => cambiarActivo(u, false)}>
                        Desactivar
                      </button>
                    )}
                    {!esSesionActual && !u.activo && (
                      <button type="button" className="gu-btn-editar" onClick={() => cambiarActivo(u, true)}>
                        Reactivar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <div className="gu-overlay" onMouseDown={cerrarModal}>
          <div
            className="gu-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gu-modal-titulo"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="gu-modal-cabecera">
              <div>
                <h3 id="gu-modal-titulo">{editando ? 'Editar colaborador' : 'Nuevo colaborador'}</h3>
                <p>{editando ? 'Actualiza el nombre, el correo o el rol.' : 'Crea la cuenta con una contraseña temporal y asigna su rol.'}</p>
              </div>
              <button type="button" className="gu-modal-cerrar" onClick={cerrarModal} aria-label="Cerrar">
                ×
              </button>
            </div>

            <form onSubmit={crearUsuario} noValidate>
              <div className="gu-campo">
                <label htmlFor="gu-nombre">Nombre completo</label>
                <input
                  id="gu-nombre"
                  type="text"
                  value={form.nombre}
                  onChange={cambiarCampo('nombre')}
                  placeholder="ej: Mateo Valenzuela"
                  autoComplete="off"
                  className={errores.nombre ? 'gu-input-error' : ''}
                />
                {errores.nombre && <span className="gu-error-campo">{errores.nombre}</span>}
              </div>

              <div className="gu-campo">
                <label htmlFor="gu-email">Correo electrónico</label>
                <input
                  id="gu-email"
                  type="email"
                  value={form.email}
                  onChange={cambiarCampo('email')}
                  placeholder="ej: bodega@bistro.com"
                  autoComplete="off"
                  className={errores.email ? 'gu-input-error' : ''}
                />
                {errores.email && <span className="gu-error-campo">{errores.email}</span>}
              </div>

              <div className="gu-campo">
                <label htmlFor="gu-password">{editando ? 'Nueva contraseña' : 'Contraseña temporal'}</label>
                <div className="gu-password-fila">
                  <input
                    id="gu-password"
                    type={verPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={cambiarCampo('password')}
                    placeholder={editando ? 'Déjala vacía para no cambiarla' : 'Mínimo 8 caracteres, con letras y números'}
                    autoComplete="new-password"
                    className={errores.password ? 'gu-input-error' : ''}
                  />
                  <button type="button" className="gu-btn-ver" onClick={() => setVerPassword((v) => !v)}>
                    {verPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                {errores.password && <span className="gu-error-campo">{errores.password}</span>}
              </div>

              <div className="gu-campo">
                <label htmlFor="gu-rol">Rol</label>
                <select
                  id="gu-rol"
                  value={form.rol}
                  onChange={cambiarCampo('rol')}
                  className={errores.rol ? 'gu-input-error' : ''}
                >
                  <option value="">Selecciona un rol</option>
                  {ROLES_ASIGNABLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {errores.rol && <span className="gu-error-campo">{errores.rol}</span>}
              </div>

              {errorEnvio && <p className="error-msg">⚠️ {errorEnvio}</p>}

              <div className="gu-modal-pie">
                <button type="button" className="gu-btn-cancelar" onClick={cerrarModal} disabled={enviando}>
                  Cancelar
                </button>
                <button type="submit" className="gu-btn-nuevo" disabled={enviando}>
                  {enviando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default GestionUsuarios