import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { getDb } from '../db';

type JwtUsuario = {
  id: number;
  nombre: string;
  rol: string;
};

const obtenerUsuarioDesdeToken = async (c: Context): Promise<JwtUsuario | Response> => {
  const secreto = c.env.JWT_SECRET;
  if (!secreto) {
    return c.json({ success: false, error: 'JWT_SECRET no está configurado en el servidor' }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Token de acceso no proporcionado o inválido' }, 401);
  }

  const token = authHeader.split(' ')[1];
  let payload;
  try {
    payload = await verify(token, secreto, 'HS256');
  } catch (err) {
    return c.json({ success: false, error: 'Token expirado o incorrecto' }, 401);
  }
  const id = Number(payload.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return c.json({ success: false, error: 'Token expirado o incorrecto' }, 401);
  }

  // HU-17: el token vale solo mientras la cuenta siga activa y con el mismo rol con que se emitió.
  // El mensaje es el mismo en todos los casos para no revelar el estado de la cuenta (HU-22).
  try {
    const sql = getDb(c.env.DATABASE_URL);
    const cuenta = await sql.query('SELECT nombre, rol, activo FROM usuario WHERE id = $1', [id]);
    if (cuenta.rowCount === 0 || !cuenta.rows[0].activo || cuenta.rows[0].rol !== payload.rol) {
      return c.json({ success: false, error: 'Sesión revocada: vuelva a iniciar sesión' }, 401);
    }
    return { id, nombre: cuenta.rows[0].nombre, rol: cuenta.rows[0].rol };
  } catch (error: any) {
    return c.json({ success: false, error: 'No se pudo validar la sesión' }, 500);
  }
};

const ROLES_SISTEMA = ['Administrador', 'Chef', 'Bodeguero'];

// HU-24: la sesión es de cualquier usuario autenticado, sin importar su rol
export const usuarioAutenticado = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (!ROLES_SISTEMA.includes(usuario.rol)) {
    return c.json({ success: false, error: 'Acceso denegado: rol no reconocido' }, 403);
  }

  c.set('usuario', usuario);
  await next();
};

export const soloAdministrador = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (usuario.rol !== 'Administrador') {
    return c.json({ success: false, error: 'Acceso denegado: Se requiere rol de Administrador' }, 403);
  }

  c.set('usuario', usuario);
  await next();
};

// HU-05 / HU-07: ingreso de lotes lo realiza Bodeguero (Admin también puede)
export const soloBodegueroOAdministrador = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (usuario.rol !== 'Bodeguero' && usuario.rol !== 'Administrador') {
    return c.json({
      success: false,
      error: 'Acceso denegado: Se requiere rol de Bodeguero o Administrador',
    }, 403);
  }

  c.set('usuario', usuario);
  await next();
};

// HU-01 / HU-09: el Chef consulta stock y vencimientos. No modifica umbrales ni ingresa lotes.
export const consultaInventario = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (usuario.rol !== 'Administrador' && usuario.rol !== 'Bodeguero' && usuario.rol !== 'Chef') {
    return c.json({ success: false, error: 'Acceso denegado' }, 403);
  }

  c.set('usuario', usuario);
  await next();
};

// HU-10: Chef, Bodeguero y Administrador registran la merma de forma directa, sin autorización previa.
export const registrarMerma = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (usuario.rol !== 'Administrador' && usuario.rol !== 'Bodeguero' && usuario.rol !== 'Chef') {
    return c.json({ success: false, error: 'Acceso denegado' }, 403);
  }

  c.set('usuario', usuario);
  await next();
};

// HU-11: las salidas manuales de cocina solo las registra el Chef
export const soloChef = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (usuario.rol !== 'Chef') {
    return c.json({ success: false, error: 'Acceso denegado: Se requiere rol de Chef' }, 403);
  }

  c.set('usuario', usuario);
  await next();
};

// HU-12: el módulo de recetas es solo para Chef y Administrador
export const soloChefOAdministrador = async (c: Context, next: Next) => {
  const usuario = await obtenerUsuarioDesdeToken(c);
  if (usuario instanceof Response) return usuario;

  if (usuario.rol !== 'Chef' && usuario.rol !== 'Administrador') {
    return c.json({ success: false, error: 'Acceso denegado: Se requiere rol de Chef o Administrador' }, 403);
  }

  c.set('usuario', usuario);
  await next();
};