import { Hono } from 'hono';
import * as bcrypt from 'bcryptjs';
import { getDb } from '../db';
import { soloAdministrador } from '../middlewares/auth';

type Env = {
  Bindings: { DATABASE_URL: string; JWT_SECRET: string };
  Variables: { usuario: { id: number; nombre: string; rol: string } };
};

// Router /usuarios (HU-17, crea desde HU-28)
// Solo el Administrador gestiona cuentas. Las contraseñas se guardan con bcrypt y nunca se devuelven.
// "Eliminar" es una baja lógica (activo = false): merma y movimiento referencian al usuario y el login ya rechaza cuentas inactivas.
const usuarios = new Hono<Env>();
usuarios.use('*', soloAdministrador);

const ROLES = ['Administrador', 'Chef', 'Bodeguero'];
const REGEX_NOMBRE = /^[\p{L}\s'.-]{2,100}$/u;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt solo considera los primeros 72 bytes de la contraseña
const REGEX_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
const COSTO_BCRYPT = 10;
const COLUMNAS_PUBLICAS = `id, nombre, email, rol, activo, to_char(fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha_creacion`;

const ERRORES = {
  nombre: 'El nombre debe tener entre 2 y 100 caracteres y solo puede contener letras, espacios, puntos, guiones o apóstrofes',
  email: 'El formato del email no es válido',
  password: 'La contraseña debe tener entre 8 y 72 caracteres e incluir al menos una letra y un número',
  rol: `El rol debe ser uno de: ${ROLES.join(', ')}`,
};

const validarCampo = (campo: keyof typeof ERRORES, valor: string) => {
  switch (campo) {
    case 'nombre': return REGEX_NOMBRE.test(valor);
    case 'email': return REGEX_EMAIL.test(valor) && valor.length <= 255;
    case 'password': return REGEX_PASSWORD.test(valor);
    case 'rol': return ROLES.includes(valor);
  }
};

const leerId = (valor: string) => (/^\d{1,9}$/.test(valor) && Number(valor) > 0 ? Number(valor) : null);

// Bloquea a todos los Administradores activos (siempre en el mismo orden para evitar deadlocks) y devuelve cuántos quedan.
// Dos bajas simultáneas se serializan: la segunda vuelve a contar después de que la primera confirma.
const bloquearAdministradoresActivos = async (client: any) => {
  const result = await client.query(
    `SELECT id FROM usuario WHERE rol = 'Administrador' AND activo = true ORDER BY id FOR UPDATE`
  );
  return result.rowCount ?? 0;
};

// GET /usuarios?rol=Chef&activo=true
usuarios.get('/', async (c) => {
  const rol = c.req.query('rol');
  const activo = c.req.query('activo');
  if (rol !== undefined && !ROLES.includes(rol)) {
    return c.json({ success: false, error: ERRORES.rol }, 400);
  }
  if (activo !== undefined && activo !== 'true' && activo !== 'false') {
    return c.json({ success: false, error: 'activo debe ser true o false' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(
      `SELECT ${COLUMNAS_PUBLICAS} FROM usuario
       WHERE ($1::text IS NULL OR rol = $1) AND ($2::boolean IS NULL OR activo = $2)
       ORDER BY id`,
      [rol ?? null, activo ?? null]
    );
    return c.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /usuarios/:id
usuarios.get('/:id', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id debe ser un número entero válido' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(`SELECT ${COLUMNAS_PUBLICAS} FROM usuario WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
    }
    return c.json({ success: true, usuario: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /usuarios
usuarios.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const rol = typeof body.rol === 'string' ? body.rol.trim() : '';

  if (!nombre || !email || !password || !rol) {
    return c.json({ success: false, error: 'Nombre, email, contraseña y rol son obligatorios' }, 400);
  }
  for (const [campo, valor] of Object.entries({ nombre, email, password, rol }) as [keyof typeof ERRORES, string][]) {
    if (!validarCampo(campo, valor)) {
      return c.json({ success: false, error: ERRORES[campo] }, 400);
    }
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);

    const existente = await sql.query('SELECT 1 FROM usuario WHERE LOWER(email) = $1', [email]);
    if ((existente.rowCount ?? 0) > 0) {
      return c.json({ success: false, error: 'El email ya está registrado' }, 409);
    }

    const passwordHash = await bcrypt.hash(password, COSTO_BCRYPT);
    const result = await sql.query(
      `INSERT INTO usuario (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNAS_PUBLICAS}`,
      [nombre, email, passwordHash, rol]
    );

    return c.json({ success: true, message: 'Usuario creado exitosamente', usuario: result.rows[0] }, 201);
  } catch (error: any) {
    // 23505 = unique_violation: cubre dos registros simultáneos con el mismo email
    if (error.code === '23505') {
      return c.json({ success: false, error: 'El email ya está registrado' }, 409);
    }
    return c.json({ success: false, error: error.message }, 500);
  }
});

// PATCH /usuarios/:id — actualiza nombre, email, password, rol y/o activo
usuarios.patch('/:id', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id debe ser un número entero válido' }, 400);
  }
  const yo = c.get('usuario');
  const body = await c.req.json().catch(() => ({}));

  const cambios: { nombre?: string; email?: string; password?: string; rol?: string; activo?: boolean } = {};
  for (const campo of ['nombre', 'email', 'password', 'rol'] as const) {
    if (body[campo] === undefined) continue;
    if (typeof body[campo] !== 'string') {
      return c.json({ success: false, error: ERRORES[campo] }, 400);
    }
    const valor = campo === 'password' ? body[campo] : campo === 'email' ? body[campo].trim().toLowerCase() : body[campo].trim();
    if (!validarCampo(campo, valor)) {
      return c.json({ success: false, error: ERRORES[campo] }, 400);
    }
    cambios[campo] = valor;
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== 'boolean') {
      return c.json({ success: false, error: 'activo debe ser true o false' }, 400);
    }
    cambios.activo = body.activo;
  }
  if (Object.keys(cambios).length === 0) {
    return c.json({ success: false, error: 'Debe enviar al menos un campo: nombre, email, password, rol o activo' }, 400);
  }

  const passwordHash = cambios.password ? await bcrypt.hash(cambios.password, COSTO_BCRYPT) : null;
  const tocaAdministracion = cambios.rol !== undefined || cambios.activo === false;

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    const administradoresActivos = tocaAdministracion ? await bloquearAdministradoresActivos(client) : null;

    const actual = await client.query(`SELECT id, rol, activo FROM usuario WHERE id = $1 FOR UPDATE`, [id]);
    if (actual.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
    }
    const objetivo = actual.rows[0];

    if (id === yo.id && cambios.rol !== undefined && cambios.rol !== objetivo.rol) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'No puedes cambiar tu propio rol' }, 403);
    }

    const pierdeAdministrador = objetivo.rol === 'Administrador' && objetivo.activo
      && ((cambios.rol !== undefined && cambios.rol !== 'Administrador') || cambios.activo === false);
    if (pierdeAdministrador && (administradoresActivos ?? 0) <= 1) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'No se puede quitar el rol ni desactivar al único Administrador activo del sistema' }, 409);
    }

    if (cambios.email !== undefined) {
      const duplicado = await client.query('SELECT 1 FROM usuario WHERE LOWER(email) = $1 AND id <> $2', [cambios.email, id]);
      if ((duplicado.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return c.json({ success: false, error: 'El email ya está registrado' }, 409);
      }
    }

    const result = await client.query(
      `
        UPDATE usuario
        SET nombre = COALESCE($2, nombre),
            email = COALESCE($3, email),
            password_hash = COALESCE($4, password_hash),
            rol = COALESCE($5, rol),
            activo = COALESCE($6, activo)
        WHERE id = $1
        RETURNING ${COLUMNAS_PUBLICAS}
      `,
      [id, cambios.nombre ?? null, cambios.email ?? null, passwordHash, cambios.rol ?? null, cambios.activo ?? null]
    );

    await client.query('COMMIT');
    return c.json({
      success: true,
      message: 'Usuario actualizado exitosamente',
      campos_actualizados: Object.keys(cambios),
      usuario: result.rows[0],
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return c.json({ success: false, error: 'El email ya está registrado' }, 409);
    }
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

// DELETE /usuarios/:id — baja lógica
usuarios.delete('/:id', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id debe ser un número entero válido' }, 400);
  }

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    const administradoresActivos = await bloquearAdministradoresActivos(client);

    const actual = await client.query(`SELECT id, rol, activo FROM usuario WHERE id = $1 FOR UPDATE`, [id]);
    if (actual.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
    }
    const objetivo = actual.rows[0];

    if (!objetivo.activo) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'El usuario ya está desactivado' }, 409);
    }
    if (objetivo.rol === 'Administrador' && administradoresActivos <= 1) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'No se puede eliminar al único Administrador activo del sistema' }, 409);
    }

    const result = await client.query(
      `UPDATE usuario SET activo = false WHERE id = $1 RETURNING ${COLUMNAS_PUBLICAS}`,
      [id]
    );

    await client.query('COMMIT');
    return c.json({ success: true, message: 'Usuario desactivado exitosamente', usuario: result.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

export default usuarios;
