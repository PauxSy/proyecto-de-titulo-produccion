import { Hono } from 'hono';
import { Pool } from '@neondatabase/serverless';
import { sign } from 'hono/jwt';
import * as bcrypt from 'bcryptjs';
import { consultaInventario, registrarMerma, soloAdministrador, soloBodegueroOAdministrador, soloChef, soloChefOAdministrador, usuarioAutenticado } from './middlewares/auth';
import { cors } from 'hono/cors'; 
import usuarios from './routes/usuarios';
import recetas from './routes/recetas';
import { armarSugerenciasLocales, cerrarSugerenciaModelo, elegirFamiliaIa, encajaEnCategoria, insumosUtilesParaModelo, normalizarTexto, recetaEsDistinta, tituloInvalido, tituloParecido, type InsumoCocina } from './chefRecetas';

type Bindings = {
  DATABASE_URL: string;
  JWT_SECRET: string;
  AI: { run: (modelo: string, entradas: Record<string, unknown>) => Promise<any> };
};

type Variables = {
  usuario: {
    id: number;
    nombre: string;
    rol: string;
  };
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/*', cors()); 

// agregue momentaneamente un trozo de codigo para probar que el backend funciona correctamente

app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'Backend funcionando correctamente'
  });
});

// Helper para conectar a NeonDB
const getDb = (connectionString: string) => new Pool({ connectionString });

// POST /login
// Límite de intentos por email (tabla login_intento): MAX_FALLOS_LOGIN fallos seguidos, con menos de
// MINUTOS_BLOQUEO_LOGIN entre uno y otro, bloquean ese email por MINUTOS_BLOQUEO_LOGIN. Cuenta también emails
// que no existen, así el bloqueo no revela qué cuentas hay. Un login exitoso reinicia el contador.
const MAX_FALLOS_LOGIN = 5;
const MINUTOS_BLOQUEO_LOGIN = 15;
const LARGO_MAXIMO_EMAIL = 254;

const respuestaBloqueoLogin = (c: any, segundos: number) => {
  c.header('Retry-After', String(segundos));
  return c.json({
    success: false,
    error: `Demasiados intentos fallidos. Intente nuevamente en ${Math.ceil(segundos / 60)} minuto(s)`,
  }, 429);
};

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body ?? {};

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ success: false, error: 'Email y contraseña son obligatorios' }, 400);
  }
  const emailNormalizado = email.trim().toLowerCase();
  if (emailNormalizado === '' || emailNormalizado.length > LARGO_MAXIMO_EMAIL) {
    return c.json({ success: false, error: 'Credenciales inválidas' }, 401);
  }

  if (!c.env.JWT_SECRET) {
    return c.json({ success: false, error: 'JWT_SECRET no está configurado en el servidor' }, 500);
  }

  try {
    const connectionString = c.env.DATABASE_URL;
    const sql = getDb(connectionString);

    // Mientras dure el bloqueo no se revisa la contraseña (tampoco una correcta)
    const bloqueo = await sql.query(
      `SELECT CEIL(EXTRACT(EPOCH FROM bloqueado_hasta - NOW()))::int AS segundos
       FROM login_intento WHERE email = $1 AND bloqueado_hasta > NOW()`,
      [emailNormalizado]
    );
    if (bloqueo.rowCount > 0) {
      return respuestaBloqueoLogin(c, bloqueo.rows[0].segundos);
    }

    // El contador vuelve a 1 si el fallo anterior fue hace más de MINUTOS_BLOQUEO_LOGIN o si ya cumplió un bloqueo.
    // Un bloqueo vigente (otra petición simultánea lo activó) se conserva tal cual.
    const registrarFallo = async () => {
      const fallo = await sql.query(
        `
          WITH limpieza AS (
            DELETE FROM login_intento
            WHERE email <> $1 AND ultimo_fallo < NOW() - INTERVAL '1 day' AND (bloqueado_hasta IS NULL OR bloqueado_hasta < NOW())
          )
          INSERT INTO login_intento AS li (email, fallos, ultimo_fallo) VALUES ($1, 1, NOW())
          ON CONFLICT (email) DO UPDATE SET
            fallos = CASE
              WHEN li.bloqueado_hasta > NOW() THEN li.fallos
              WHEN li.bloqueado_hasta IS NOT NULL OR li.ultimo_fallo < NOW() - make_interval(mins => $2) THEN 1
              ELSE li.fallos + 1
            END,
            ultimo_fallo = NOW(),
            bloqueado_hasta = CASE WHEN li.bloqueado_hasta > NOW() THEN li.bloqueado_hasta END
          RETURNING fallos, CEIL(EXTRACT(EPOCH FROM bloqueado_hasta - NOW()))::int AS segundos_bloqueo
        `,
        [emailNormalizado, MINUTOS_BLOQUEO_LOGIN]
      );
      const { fallos, segundos_bloqueo } = fallo.rows[0];
      if (segundos_bloqueo !== null) {
        return respuestaBloqueoLogin(c, segundos_bloqueo);
      }
      if (fallos >= MAX_FALLOS_LOGIN) {
        await sql.query(
          `UPDATE login_intento SET bloqueado_hasta = NOW() + make_interval(mins => $2) WHERE email = $1 AND bloqueado_hasta IS NULL`,
          [emailNormalizado, MINUTOS_BLOQUEO_LOGIN]
        );
        return respuestaBloqueoLogin(c, MINUTOS_BLOQUEO_LOGIN * 60);
      }
      return c.json({ success: false, error: 'Credenciales inválidas' }, 401);
    };

    const query = `SELECT id, nombre, email, rol, password_hash, activo FROM usuario WHERE LOWER(email) = $1;`;
    const result = await sql.query(query, [emailNormalizado]);

    if (result.rowCount === 0) {
      return registrarFallo();
    }

    const usuario = result.rows[0];
    const passwordValida = await bcrypt.compare(password, usuario.password_hash);

    // HU-22: un usuario desactivado recibe el mismo error genérico, sin revelar su estado
    if (!passwordValida || !usuario.activo) {
      return registrarFallo();
    }

    await sql.query('DELETE FROM login_intento WHERE email = $1', [emailNormalizado]);

    const token = await sign(
      {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8, // expira en 8 horas
      },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      message: 'Login exitoso',
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email,rol: usuario.rol },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// CRUD /usuarios (HU-28 / HU-17): ver src/routes/usuarios.ts
app.route('/usuarios', usuarios);

// GET /auth/verificar (HU-24 / HU-25)
// Confirma que el token es válido y que el usuario sigue existiendo y activo
app.get('/auth/verificar', usuarioAutenticado, async (c) => {
  const { id } = c.get('usuario');

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query('SELECT id, nombre, email, rol, activo FROM usuario WHERE id = $1;', [id]);

    if (result.rowCount === 0 || !result.rows[0].activo) {
      return c.json({ success: false, error: 'Sesión no válida' }, 401);
    }

    const { nombre, email, rol } = result.rows[0];
    return c.json({ success: true, usuario: { id, nombre, email, rol } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Semáforo de stock (HU-02 / HU-03):
//   ROJO     -> Critico (stock_actual <= stock_minimo) o Sobrestock (stock_actual >= stock_maximo)
//   AMARILLO -> Advertencia: dentro del margen cercano a uno de los umbrales
//   VERDE    -> Normal
// El margen es un porcentaje del rango (stock_maximo - stock_minimo) configurable en configuraciones_globales
// (HU-18) y se lee en cada petición. La BD garantiza stock_maximo > stock_minimo y el margen está limitado a
// 0..49, así que las dos franjas amarillas no se cruzan; con 0 no hay amarillo.
const CLAVE_MARGEN_STOCK = 'margen_advertencia_stock_porcentaje';
const NIVELES_STOCK = ['ROJO', 'AMARILLO', 'VERDE'] as const;
const ESTADOS_STOCK = ['Critico', 'Sobrestock', 'Advertencia', 'Normal'] as const;

// Búsqueda de productos (HU-11 / HU-29): nombre o SKU parcial, código de barras por prefijo.
// Los comodines de LIKE que escriba el usuario se buscan literalmente.
// Se ignoran tildes: "azucar" encuentra "Azúcar".
const LARGO_MAXIMO_BUSQUEDA = 100;
const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûýÿñÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÝŸÑ';
const SIN_ACENTOS = 'aaaaaeeeeiiiiooooouuuuyynAAAAAEEEEIIIIOOOOOUUUUYYN';
const quitarAcentos = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '');
const columnaSinAcentos = (columna: string) => `translate(${columna}, '${ACENTOS}', '${SIN_ACENTOS}')`;
const parametrosBusqueda = (q: string) => [
  q ? `%${quitarAcentos(q).replace(/[\\%_]/g, '\\$&')}%` : null,
  /^\d+$/.test(q) ? `${q}%` : null,
];
const filtroBusquedaProducto = (alias: string, patron: string, prefijoCodigo: string) => `(
  ${patron}::text IS NULL
  OR ${columnaSinAcentos(`${alias}.nombre`)} ILIKE ${patron} ESCAPE '\\'
  OR ${columnaSinAcentos(`${alias}.sku`)} ILIKE ${patron} ESCAPE '\\'
  OR ${alias}.codigo_de_barra::text LIKE ${prefijoCodigo}
)`;

const consultarEstadoStock = async (sql: any, soloAlertas: boolean, q = '') => {
  const config = await sql.query(`SELECT valor::int AS porcentaje FROM configuraciones_globales WHERE clave = $1`, [CLAVE_MARGEN_STOCK]);
  if (config.rowCount === 0) {
    throw new Error(`Falta ${CLAVE_MARGEN_STOCK} en configuraciones_globales (ejecutar scripts/add-margen-advertencia-stock.mjs)`);
  }
  const margenPorcentaje: number = config.rows[0].porcentaje;
  // HU-09 comparte los lotes con este semáforo: el lote que vence primero define la alerta del insumo.
  const umbralesVencimiento = await obtenerUmbralesVencimiento(sql);

  const result = await sql.query(
    `
      WITH base AS (
        SELECT id, sku, codigo_de_barra::text AS codigo_de_barra, nombre, categoria, costo_unitario,
               COALESCE(stock_actual, 0) AS stock_actual, stock_minimo, stock_maximo,
               stock_minimo + (stock_maximo - stock_minimo) * $1::numeric AS limite_advertencia_minimo,
               stock_maximo - (stock_maximo - stock_minimo) * $1::numeric AS limite_advertencia_maximo
        FROM producto
        WHERE ${filtroBusquedaProducto('producto', '$2', '$3')}
      ),
      clasificado AS (
        SELECT b.*,
               b.stock_actual - b.stock_minimo AS diferencia_minimo,
               b.stock_actual - b.stock_maximo AS diferencia_maximo,
               CASE
                 WHEN b.stock_actual <= b.stock_minimo THEN 'Critico'
                 WHEN b.stock_actual >= b.stock_maximo THEN 'Sobrestock'
                 WHEN b.stock_actual <= b.limite_advertencia_minimo OR b.stock_actual >= b.limite_advertencia_maximo THEN 'Advertencia'
                 ELSE 'Normal'
               END AS estado,
               CASE
                 WHEN b.stock_actual <= b.limite_advertencia_minimo THEN 'MINIMO'
                 WHEN b.stock_actual >= b.limite_advertencia_maximo THEN 'MAXIMO'
               END AS umbral_afectado
        FROM base b
      )
      SELECT c.id, c.sku, c.codigo_de_barra, c.nombre, c.categoria, c.costo_unitario, c.stock_actual, c.stock_minimo, c.stock_maximo,
             c.diferencia_minimo, c.diferencia_maximo, c.estado,
             CASE c.estado WHEN 'Normal' THEN 'VERDE' WHEN 'Advertencia' THEN 'AMARILLO' ELSE 'ROJO' END AS nivel_alerta,
             c.umbral_afectado,
             ROUND(c.limite_advertencia_minimo, 2) AS limite_advertencia_minimo,
             ROUND(c.limite_advertencia_maximo, 2) AS limite_advertencia_maximo,
             prox.fecha_vencimiento::text AS proximo_vencimiento,
             prox.dias AS dias_para_vencer,
             CASE
               WHEN prox.dias IS NULL THEN NULL
               WHEN prox.dias <= $4 THEN 'ROJO'
               WHEN prox.dias <= $5 THEN 'AMARILLO'
               ELSE 'VERDE'
             END AS nivel_vencimiento
      FROM clasificado c
      LEFT JOIN LATERAL (
        SELECT l.fecha_vencimiento,
               (l.fecha_vencimiento - ${HOY_CHILE_SQL}) AS dias
        FROM lote l
        WHERE l.id_producto = c.id AND l.estado = 'ACTIVO' AND l.cantidad_disponible > 0
        ORDER BY l.fecha_vencimiento ASC, l.id ASC
        LIMIT 1
      ) prox ON true
      ORDER BY ${soloAlertas ? `(c.estado = 'Advertencia'), (c.umbral_afectado = 'MAXIMO'), c.nombre,` : ''} c.id
    `,
    [margenPorcentaje / 100, ...parametrosBusqueda(q), umbralesVencimiento.rojo, umbralesVencimiento.amarillo]
  );

  // El resumen cuenta todos los productos consultados, aunque la respuesta traiga solo los que están en alerta
  const resumen = {
    total: result.rowCount,
    ...Object.fromEntries(NIVELES_STOCK.map((n) => [n, 0])),
    por_estado: Object.fromEntries(ESTADOS_STOCK.map((e) => [e, 0])),
  } as Record<string, any>;
  for (const fila of result.rows) {
    resumen[fila.nivel_alerta]++;
    resumen.por_estado[fila.estado]++;
  }
  const filas = soloAlertas ? result.rows.filter((f: any) => f.nivel_alerta !== 'VERDE') : result.rows;
  const margen = { margen_advertencia: margenPorcentaje / 100, margen_advertencia_porcentaje: margenPorcentaje };
  return { filas, resumen, margen };
};

// GET /productos/estado-stock?q= (HU-02 / HU-29)
// Semáforo de los productos según stock_actual vs umbrales, con resumen de conteos por nivel.
// Con ?q= filtra por nombre, SKU o código de barras y el resumen cuenta solo los encontrados.
app.get('/productos/estado-stock', consultaInventario, async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length > LARGO_MAXIMO_BUSQUEDA) {
    return c.json({ success: false, error: `La búsqueda admite hasta ${LARGO_MAXIMO_BUSQUEDA} caracteres` }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const { filas, resumen, margen } = await consultarEstadoStock(sql, false, q);

    return c.json({
      success: true,
      ...margen,
      ...(q ? { q } : {}),
      resumen,
      total: filas.length,
      data: filas,
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

const UNIDADES_PRODUCTO = ['gr', 'ml', 'un'] as const;

const registrarAccion = async (db: { query: (texto: string, valores?: unknown[]) => Promise<any> }, usuarioId: number, accion: string, detalle: string) => {
  await db.query(
    `INSERT INTO registro_accion (id_usuario, accion, detalle) VALUES ($1, $2, $3)`,
    [usuarioId, accion, detalle.slice(0, 300)]
  );
};

// GET /productos/opciones (HU-34): listas del formulario de alta.
app.get('/productos/opciones', soloAdministrador, async (c) => {
  try {
    const sql = getDb(c.env.DATABASE_URL);
    const categorias = await sql.query(
      `SELECT DISTINCT categoria FROM producto WHERE categoria IS NOT NULL AND btrim(categoria) <> '' ORDER BY categoria`
    );
    return c.json({
      success: true,
      unidades: UNIDADES_PRODUCTO,
      categorias: categorias.rows.map((fila: any) => fila.categoria),
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /producto (HU-34). El stock parte en 0: entra recién con un lote.
app.post('/producto', soloAdministrador, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim().replace(/\s+/g, ' ') : '';
  const codigo = typeof body?.codigo_de_barra === 'string' ? body.codigo_de_barra.trim() : String(body?.codigo_de_barra ?? '').trim();
  const categoria = typeof body?.categoria === 'string' ? body.categoria.trim() : '';
  const unidad = typeof body?.unidad_medida === 'string' ? body.unidad_medida.trim() : '';
  const minimo = Number(body?.stock_minimo);
  const maximo = Number(body?.stock_maximo);

  if (nombre.length < 2 || nombre.length > 150) {
    return c.json({ success: false, error: 'El nombre es obligatorio (entre 2 y 150 caracteres)' }, 400);
  }
  if (!/^\d{4,18}$/.test(codigo)) {
    return c.json({ success: false, error: 'El código de barra es obligatorio y debe ser numérico' }, 400);
  }
  if (categoria.length < 2 || categoria.length > 100) {
    return c.json({ success: false, error: 'La categoría es obligatoria' }, 400);
  }
  if (!(UNIDADES_PRODUCTO as readonly string[]).includes(unidad)) {
    return c.json({ success: false, error: `La unidad de medida debe ser una de: ${UNIDADES_PRODUCTO.join(', ')}` }, 400);
  }
  if (!Number.isFinite(minimo) || !Number.isFinite(maximo) || minimo < 0 || maximo < 0) {
    return c.json({ success: false, error: 'El stock mínimo y el máximo no pueden ser negativos' }, 400);
  }
  if (maximo <= minimo) {
    return c.json({ success: false, error: 'El stock máximo debe ser estrictamente mayor al stock mínimo' }, 400);
  }

  const usuario = c.get('usuario');

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const conocida = await sql.query(`SELECT 1 FROM producto WHERE LOWER(categoria) = LOWER($1) LIMIT 1`, [categoria]);
    if ((conocida.rowCount ?? 0) === 0) {
      return c.json({ success: false, error: 'La categoría no está entre las disponibles' }, 400);
    }
    const duplicado = await sql.query(`SELECT 1 FROM producto WHERE codigo_de_barra = $1 LIMIT 1`, [codigo]);
    if ((duplicado.rowCount ?? 0) > 0) {
      return c.json({ success: false, error: `Ya existe un insumo con el código de barra ${codigo}` }, 409);
    }

    const sku = `INS-${codigo}`.slice(0, 40);
    const client = await sql.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          INSERT INTO producto (sku, nombre, marca, categoria, unidad_medida, codigo_de_barra, stock_actual, stock_minimo, stock_maximo, fecha_actualizacion)
          VALUES ($1, $2, 'Sin marca', $3, $4, $5, 0, $6, $7, NOW())
          RETURNING id, sku, nombre, categoria, unidad_medida, codigo_de_barra::text AS codigo_de_barra,
                    stock_actual, stock_minimo, stock_maximo
        `,
        [sku, nombre, categoria, unidad, codigo, minimo, maximo]
      );
      await registrarAccion(client, usuario.id, 'ALTA_INSUMO', `Creó el insumo ${nombre} (${sku})`);
      await client.query('COMMIT');
      return c.json({ success: true, message: 'Insumo creado', data: result.rows[0] }, 201);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error.code === '23505' && String(error.constraint ?? '').includes('codigo_de_barra')) {
      return c.json({ success: false, error: `Ya existe un insumo con el código de barra ${codigo}` }, 409);
    }
    if (error.code === '23505') {
      return c.json({ success: false, error: 'No se pudo asignar un código interno único. Intenta de nuevo.' }, 409);
    }
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /registros-accion: fecha, hora, usuario y acción de altas, ingresos, mermas, salidas y anulaciones.
app.get('/registros-accion', soloAdministrador, async (c) => {
  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(`
      SELECT r.id, r.accion, r.detalle,
             to_char(r.fecha, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha,
             u.nombre AS usuario, u.rol
      FROM registro_accion r
      JOIN usuario u ON u.id = r.id_usuario
      ORDER BY r.fecha DESC, r.id DESC
      LIMIT 80
    `);
    return c.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /productos/barcode/:codigo (HU-04)
// Busca coincidencia exacta por codigo_de_barra y devuelve la ficha del producto
app.get('/productos/barcode/:codigo', soloBodegueroOAdministrador, async (c) => {
  const codigo = c.req.param('codigo')?.trim();

  if (!codigo) {
    return c.json({
      success: false,
      error: 'El código de barras es obligatorio',
    }, 400);
  }

  // codigo_de_barra es numeric en el diagrama de clases
  if (!/^\d+$/.test(codigo)) {
    return c.json({
      success: false,
      error: 'El código de barras debe ser numérico',
    }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);

    const result = await sql.query(
      `
        SELECT
          id,
          sku,
          codigo_de_barra,
          nombre,
          marca,
          categoria,
          stock_actual,
          stock_minimo,
          stock_maximo
        FROM producto
        WHERE codigo_de_barra = $1
        LIMIT 1
      `,
      [codigo]
    );

    if (result.rowCount === 0) {
      return c.json({
        success: false,
        error: 'Producto no encontrado',
      }, 404);
    }

    return c.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message,
    }, 500);
  }
});

// PUT /producto/:id/umbrales (Protegido con el middleware de Administrador)
app.put('/producto/:id/umbrales', soloAdministrador, async (c) => {
//app.put('/producto/:id/umbrales', async (c) => {  
  const id = c.req.param('id');
  const body = await c.req.json();
  const { stock_minimo, stock_maximo } = body;

  // 1. Validación: Bloquear números negativos
  if (stock_minimo < 0 || stock_maximo < 0) {
    return c.json({ 
      success: false, 
      error: 'Los umbrales de stock no pueden ser valores negativos' 
    }, 400);
  }

  // 2. Validación: Exigir que stock_maximo sea estrictamente mayor a stock_minimo
  if (Number(stock_maximo) <= Number(stock_minimo)) {
    return c.json({ 
      success: false, 
      error: 'El stock máximo debe ser estrictamente mayor al stock mínimo' 
    }, 400);
  }

  try {
    const connectionString = c.env.DATABASE_URL;
    const sql = getDb(connectionString);

    // 3. Actualización en NeonDB con SQL nativo de PostgreSQL
    const query = `
      UPDATE producto 
      SET stock_minimo = $1, stock_maximo = $2, fecha_actualizacion = NOW()
      WHERE id = $3
      RETURNING id, sku, nombre, stock_minimo, stock_maximo;
    `;

    const result = await sql.query(query, [stock_minimo, stock_maximo, id]);

    // 4. Validar si el producto existe
    if (result.rowCount === 0) {
      return c.json({ 
        success: false, 
        error: 'Producto no encontrado' 
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Umbrales actualizados exitosamente',
      data: result.rows[0]
    });

  } catch (error: any) {
    return c.json({ 
      success: false, 
      error: error.message 
    }, 500);
  }
});

// PUT /producto/:id/costo (HU-15)
// Costo de referencia por unidad de medida con que se valorizan las mermas. null lo deja sin definir.
const COSTO_UNITARIO_MAXIMO = 9_999_999_999.99; // NUMERIC(12, 2)

app.put('/producto/:id/costo', soloAdministrador, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ success: false, error: 'El id del producto debe ser un número entero válido' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  if (!body || !('costo_unitario' in body)) {
    return c.json({ success: false, error: 'costo_unitario es obligatorio (número mayor o igual a 0, o null)' }, 400);
  }
  const costo = body.costo_unitario;
  if (costo !== null) {
    if (typeof costo !== 'number' || !Number.isFinite(costo) || costo < 0 || costo > COSTO_UNITARIO_MAXIMO) {
      return c.json({ success: false, error: 'costo_unitario debe ser un número mayor o igual a 0, o null' }, 400);
    }
    if (Math.abs(Math.round(costo * 100) - costo * 100) > 1e-6) {
      return c.json({ success: false, error: 'costo_unitario admite como máximo 2 decimales' }, 400);
    }
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(
      `UPDATE producto SET costo_unitario = $2, fecha_actualizacion = NOW()
       WHERE id = $1
       RETURNING id, sku, nombre, costo_unitario`,
      [id, costo]
    );
    if (result.rowCount === 0) {
      return c.json({ success: false, error: 'Producto no encontrado' }, 404);
    }
    return c.json({ success: true, message: 'Costo unitario actualizado exitosamente', data: result.rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /lotes/confirmar (HU-05, HU-06, HU-07)
// En una sola transacción: inserta el lote, suma la cantidad al stock_actual del producto
// y registra el movimiento de ingreso con el usuario del JWT y el timestamp de la operación
app.post('/lotes/confirmar', soloBodegueroOAdministrador, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { numero_lote, producto_id, cantidad, fecha_vencimiento, costo_unitario, notas } = body;
  const usuario = c.get('usuario');

  // Campos obligatorios (requerimiento + HU-05)
  if (
    numero_lote === undefined || numero_lote === null || String(numero_lote).trim() === '' ||
    producto_id === undefined || producto_id === null ||
    cantidad === undefined || cantidad === null ||
    fecha_vencimiento === undefined || fecha_vencimiento === null || String(fecha_vencimiento).trim() === ''
  ) {
    return c.json({
      success: false,
      error: 'numero_lote, producto_id, cantidad y fecha_vencimiento son obligatorios',
    }, 400);
  }

  const productoId = Number(producto_id);
  if (!Number.isInteger(productoId) || productoId <= 0) {
    return c.json({
      success: false,
      error: 'producto_id debe ser un número entero válido',
    }, 400);
  }

  const cantidadNum = Number(cantidad);
  if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
    return c.json({
      success: false,
      error: 'La cantidad debe ser un número válido mayor a 0',
    }, 400);
  }

  // HU-05 / HU-06: fecha_vencimiento estrictamente posterior al día actual en Chile
  // (el Worker corre en UTC; "hoy" sale de la BD igual que en las alertas y en FEFO)
  const fechaVencimiento = String(fecha_vencimiento).slice(0, 10);
  if (!esFechaValida(fechaVencimiento)) {
    return c.json({
      success: false,
      error: 'La fecha de vencimiento no es válida',
    }, 400);
  }

  let costoUnitario = null;
  if (costo_unitario !== undefined && costo_unitario !== null && costo_unitario !== '') {
    const costo = Number(costo_unitario);
    if (!Number.isFinite(costo) || costo < 0 || costo > COSTO_UNITARIO_MAXIMO) {
      return c.json({ success: false, error: 'El costo unitario debe ser un número mayor o igual a 0' }, 400);
    }
    if (Math.abs(Math.round(costo * 100) - costo * 100) > 1e-6) {
      return c.json({ success: false, error: 'El costo unitario admite como máximo 2 decimales' }, 400);
    }
    costoUnitario = Math.round(costo * 100) / 100;
  }

  const notasTexto = typeof notas === 'string' ? notas.trim() : '';
  if (notasTexto.length > 300) {
    return c.json({ success: false, error: 'Las notas admiten como máximo 300 caracteres' }, 400);
  }

  const numeroLote = String(numero_lote).trim().toUpperCase();
  if (!/^LOT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(numeroLote)) {
    return c.json({
      success: false,
      error: 'El número de lote debe empezar con LOT- y continuar con letras o números',
    }, 400);
  }

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();

  try {
    await client.query('BEGIN');

    const vigencia = await client.query(
      `SELECT $1::date > ${HOY_CHILE_SQL} AS posterior, ${HOY_CHILE_SQL}::text AS hoy`,
      [fechaVencimiento]
    );
    if (!vigencia.rows[0].posterior) {
      await client.query('ROLLBACK');
      return c.json({
        success: false,
        error: `La fecha de vencimiento debe ser posterior al día de hoy (${vigencia.rows[0].hoy})`,
      }, 400);
    }

    await client.query(`ALTER TABLE lote ADD COLUMN IF NOT EXISTS notas VARCHAR(300)`);

    const productoResult = await client.query(
      `SELECT id, sku, nombre, costo_unitario FROM producto WHERE id = $1 FOR UPDATE`,
      [productoId]
    );

    if (productoResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Producto no encontrado' }, 404);
    }

    const producto = productoResult.rows[0];

    const duplicado = await client.query(
      `SELECT id FROM lote WHERE UPPER(TRIM(numero_lote)) = $1 LIMIT 1`,
      [numeroLote]
    );
    if (duplicado.rowCount > 0) {
      await client.query('ROLLBACK');
      return c.json({
        success: false,
        error: `Ya existe un lote con el número ${numeroLote}. El número de lote debe ser único.`,
      }, 409);
    }

    // Persistencia del lote (diagrama: cantidad_inicial + cantidad_disponible)
    const loteResult = await client.query(
      `
        INSERT INTO lote (
          id_producto,
          numero_lote,
          cantidad_inicial,
          cantidad_disponible,
          fecha_recepcion,
          fecha_vencimiento,
          notas
        )
        VALUES ($1, $2, $3, $3, NOW(), $4::date, $5)
        RETURNING id, id_producto, numero_lote, cantidad_inicial, cantidad_disponible, fecha_recepcion, fecha_vencimiento, notas
      `,
      [productoId, numeroLote, cantidadNum, fechaVencimiento, notasTexto || null]
    );

    const lote = loteResult.rows[0];

    // HU-07: actualizar stock global del producto
    const stockResult = await client.query(
      `
        UPDATE producto
        SET stock_actual = COALESCE(stock_actual, 0) + $1,
            costo_unitario = COALESCE($3, costo_unitario),
            fecha_actualizacion = NOW()
        WHERE id = $2
        RETURNING id, sku, nombre, stock_actual, costo_unitario
      `,
      [cantidadNum, productoId, costoUnitario]
    );

    // HU-07: el usuario responsable sale del JWT, nunca del body
    const movimientoResult = await client.query(
      `
        INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario)
        VALUES ($1, 'INGRESO', $2, NOW(), $3)
        RETURNING id, id_lote, tipo, cantidad, fecha, id_usuario
      `,
      [lote.id, cantidadNum, usuario.id]
    );
    await registrarAccion(
      client,
      usuario.id,
      'INGRESO_LOTE',
      `Ingresó ${cantidadNum} de ${producto.nombre} en el lote ${numeroLote}`
    );

    await client.query('COMMIT');

    return c.json({
      success: true,
      message: 'Lote registrado exitosamente',
      data: {
        lote,
        producto: stockResult.rows[0] ?? producto,
        movimiento: movimientoResult.rows[0],
        registrado_por: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      },
    }, 201);
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    // 23503 = foreign_key_violation: el usuario del token ya no existe en la BD
    if (error.code === '23503') {
      return c.json({ success: false, error: 'Sesión no válida' }, 401);
    }
    if (error.code === '23505') {
      return c.json({
        success: false,
        error: `Ya existe un lote con el número ${numeroLote}. El número de lote debe ser único.`,
      }, 409);
    }
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

// POST /lotes/:id/anular (HU-19)
// En una sola transacción: marca el lote como ANULADO (cantidad 0), descuenta su cantidad_inicial del stock_actual
// del producto y registra un movimiento ANULACION. El trigger lote_validar_anulacion rechaza la anulación
// si el lote tiene mermas, consumos por comanda u otras salidas (scripts/add-anulacion-lote.mjs)
// o si es un lote de carga inicial (scripts/add-lote-carga-inicial.mjs).
// HU-20: antes de abrir la transacción se exige confirmar la identidad con la contraseña del usuario
// en sesión, y la anulación queda en log_anulaciones dentro de la misma transacción (scripts/create-log-anulaciones.mjs).
// Las confirmaciones fallidas también se registran y, tras MAX_INTENTOS_FALLIDOS en la ventana, se bloquea (429).
const MOTIVO_ANULACION = { minimo: 10, maximo: 300 };
const CONFIRMACION_ANULACION = { maxIntentosFallidos: 5, ventanaMinutos: 15 };

const ERRORES_ANULACION: Record<string, string> = {
  producto_stock_actual_check: 'No se puede anular: el stock del producto es menor que la cantidad del lote (parte del ingreso ya salió de bodega)',
};

app.post('/lotes/:id/anular', soloBodegueroOAdministrador, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ success: false, error: 'El id del lote debe ser un número entero válido' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length < MOTIVO_ANULACION.minimo || motivo.length > MOTIVO_ANULACION.maximo) {
    return c.json({
      success: false,
      error: `El motivo de la anulación es obligatorio (entre ${MOTIVO_ANULACION.minimo} y ${MOTIVO_ANULACION.maximo} caracteres)`,
    }, 400);
  }

  if (typeof body?.password !== 'string' || body.password === '') {
    return c.json({ success: false, error: 'Debe confirmar la anulación con su contraseña' }, 400);
  }
  const usuario = c.get('usuario');

  const sql = getDb(c.env.DATABASE_URL);

  // Re-validación de seguridad: el JWT no basta para una acción que altera el inventario confirmado
  try {
    const fallidos = await sql.query(
      `SELECT COUNT(*)::int AS total FROM log_anulaciones
       WHERE id_usuario = $1 AND resultado = 'VERIFICACION_FALLIDA' AND fecha > NOW() - make_interval(mins => $2)`,
      [usuario.id, CONFIRMACION_ANULACION.ventanaMinutos]
    );
    const intentosFallidos = fallidos.rows[0].total;
    if (intentosFallidos >= CONFIRMACION_ANULACION.maxIntentosFallidos) {
      return c.json({
        success: false,
        error: `Demasiadas confirmaciones fallidas. Intente nuevamente en ${CONFIRMACION_ANULACION.ventanaMinutos} minutos`,
      }, 429);
    }

    const cuenta = await sql.query('SELECT password_hash, activo FROM usuario WHERE id = $1', [usuario.id]);
    if (cuenta.rowCount === 0 || !cuenta.rows[0].activo) {
      return c.json({ success: false, error: 'Sesión no válida' }, 401);
    }

    if (!(await bcrypt.compare(body.password, cuenta.rows[0].password_hash))) {
      await sql.query(
        `INSERT INTO log_anulaciones (id_usuario, id_lote, resultado, metodo_verificacion, motivo)
         VALUES ($1, (SELECT id FROM lote WHERE id = $2), 'VERIFICACION_FALLIDA', 'PASSWORD', $3)`,
        [usuario.id, id, motivo]
      );
      return c.json({
        success: false,
        error: 'Contraseña incorrecta',
        intentos_restantes: CONFIRMACION_ANULACION.maxIntentosFallidos - intentosFallidos - 1,
      }, 403);
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }

  const client = await sql.connect();

  try {
    await client.query('BEGIN');

    // Mismo orden de bloqueo que mermas y comandas (lote y luego producto) para evitar deadlocks
    const loteResult = await client.query(
      `SELECT id, id_producto, numero_lote, cantidad_inicial, estado FROM lote WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (loteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Lote no encontrado' }, 404);
    }
    const lote = loteResult.rows[0];
    if (lote.estado === 'ANULADO') {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'El lote ya está anulado' }, 409);
    }

    const anulado = await client.query(
      `
        UPDATE lote
        SET estado = 'ANULADO',
            cantidad_disponible = 0,
            fecha_anulacion = NOW(),
            id_usuario_anulacion = $2,
            motivo_anulacion = $3
        WHERE id = $1
        RETURNING id, id_producto, numero_lote, cantidad_inicial, cantidad_disponible, estado,
                  fecha_vencimiento::text AS fecha_vencimiento,
                  to_char(fecha_anulacion, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha_anulacion,
                  id_usuario_anulacion, motivo_anulacion
      `,
      [id, usuario.id, motivo]
    );

    const producto = await client.query(
      `
        UPDATE producto
        SET stock_actual = stock_actual - $1,
            fecha_actualizacion = NOW()
        WHERE id = $2
        RETURNING id, sku, nombre, stock_actual + $1 AS stock_anterior, stock_actual
      `,
      [lote.cantidad_inicial, lote.id_producto]
    );

    const movimiento = await client.query(
      `
        INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario)
        VALUES ($1, 'ANULACION', $2, NOW(), $3)
        RETURNING id, id_lote, tipo, cantidad, to_char(fecha, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha, id_usuario
      `,
      [id, lote.cantidad_inicial, usuario.id]
    );
    await registrarAccion(client, usuario.id, 'ANULACION_LOTE', `Anuló el lote ${lote.numero_lote}: ${motivo}`);

    const auditoria = await client.query(
      `
        INSERT INTO log_anulaciones (id_usuario, id_lote, resultado, metodo_verificacion, motivo,
                                     cantidad_revertida, stock_anterior, stock_posterior)
        VALUES ($1, $2, 'ANULADO', $3, $4, $5, $6, $7)
        RETURNING id, to_char(fecha, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fecha, id_usuario, resultado, metodo_verificacion, motivo
      `,
      [usuario.id, id, 'PASSWORD', motivo, lote.cantidad_inicial, producto.rows[0].stock_anterior, producto.rows[0].stock_actual]
    );

    await client.query('COMMIT');

    return c.json({
      success: true,
      message: 'Lote anulado y stock revertido exitosamente',
      data: {
        lote: anulado.rows[0],
        producto: producto.rows[0],
        movimiento: movimiento.rows[0],
        auditoria: auditoria.rows[0],
        anulado_por: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    // 23001 = restrict_violation: el trigger rechazó la anulación (mermas, comandas, otras salidas o carga inicial)
    if (error.code === '23001' && String(error.constraint ?? '').startsWith('lote_')) {
      return c.json({ success: false, error: error.message, restriccion: error.constraint }, 409);
    }
    if (error.code === '23514' && ERRORES_ANULACION[error.constraint]) {
      return c.json({ success: false, error: ERRORES_ANULACION[error.constraint], restriccion: error.constraint }, 409);
    }
    // 23503 = foreign_key_violation: el usuario del token ya no existe en la BD
    if (error.code === '23503') {
      return c.json({ success: false, error: 'Sesión no válida' }, 401);
    }
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

// Fecha actual en Chile para calcular días al vencimiento.
// CURRENT_DATE en Neon es UTC y cambia de día a las 21:00 (invierno) o 20:00 (verano) hora de Chile.
const HOY_CHILE_SQL = `(NOW() AT TIME ZONE 'America/Santiago')::date`;

// GET /inventario/lotes (HU-08 / HU-30)
// Lotes activos (cantidad_disponible > 0) ordenados según ?sort=...&order=asc|desc; por defecto FEFO.
// Con ?producto_id= solo los del producto, incluidos los vencidos (vencido: true) para decidir qué dar de baja.
// ORDER BY no admite parámetros ($1), por eso solo se aceptan columnas de esta lista
const ORDEN_LOTES: Record<string, string> = {
  fecha_vencimiento: 'l.fecha_vencimiento',
  fecha_recepcion: 'l.fecha_recepcion',
  producto: 'p.nombre',
  numero_lote: 'l.numero_lote',
  cantidad_disponible: 'l.cantidad_disponible',
};

app.get('/inventario/lotes', consultaInventario, async (c) => {
  const sort = c.req.query('sort') ?? 'fecha_vencimiento';
  const order = (c.req.query('order') ?? 'asc').toLowerCase();

  if (!(sort in ORDEN_LOTES)) {
    return c.json({
      success: false,
      error: `Parámetro sort inválido. Valores permitidos: ${Object.keys(ORDEN_LOTES).join(', ')}`,
    }, 400);
  }
  if (order !== 'asc' && order !== 'desc') {
    return c.json({ success: false, error: 'Parámetro order inválido. Valores permitidos: asc, desc' }, 400);
  }

  const productoParam = c.req.query('producto_id');
  const productoId = productoParam === undefined ? null : Number(productoParam);
  if (productoId !== null && (!/^\d+$/.test(productoParam!) || !Number.isSafeInteger(productoId) || productoId <= 0)) {
    return c.json({ success: false, error: 'producto_id debe ser un número entero válido' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);

    let producto = null;
    if (productoId !== null) {
      const productoResult = await sql.query(
        `SELECT id, sku, codigo_de_barra::text AS codigo_de_barra, nombre, stock_actual FROM producto WHERE id = $1`,
        [productoId]
      );
      if (productoResult.rowCount === 0) {
        return c.json({ success: false, error: 'Producto no encontrado' }, 404);
      }
      producto = productoResult.rows[0];
    }

    const umbrales = await obtenerUmbralesVencimiento(sql);
    const result = await sql.query(`
      SELECT
        l.id,
        l.numero_lote,
        l.id_producto,
        p.sku,
        p.nombre AS producto,
        l.cantidad_inicial,
        l.cantidad_disponible,
        to_char(l.fecha_recepcion, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha_recepcion,
        l.fecha_vencimiento::text AS fecha_vencimiento,
        (l.fecha_vencimiento - ${HOY_CHILE_SQL}) AS dias_para_vencer,
        (l.fecha_vencimiento < ${HOY_CHILE_SQL}) AS vencido,
        l.origen
      FROM lote l
      JOIN producto p ON p.id = l.id_producto
      WHERE l.estado = 'ACTIVO' AND l.cantidad_disponible > 0
        AND ($1::int IS NULL OR l.id_producto = $1)
      ORDER BY ${ORDEN_LOTES[sort]} ${order.toUpperCase()}, l.id ASC
    `, [productoId]);

    return c.json({
      success: true,
      sort,
      order,
      umbrales,
      ...(producto ? { producto } : {}),
      total: result.rowCount,
      data: result.rows,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Umbrales de alerta de vencimiento (HU-18): se leen en cada petición desde configuraciones_globales,
// así un cambio hecho con PUT /configuraciones se aplica de inmediato.
const CLAVES_UMBRALES_VENCIMIENTO = { rojo: 'alerta_vencimiento_rojo_dias', amarillo: 'alerta_vencimiento_amarillo_dias' };

const obtenerUmbralesVencimiento = async (sql: Pool) => {
  const result = await sql.query(
    `
      SELECT MAX(valor::int) FILTER (WHERE clave = $1) AS rojo,
             MAX(valor::int) FILTER (WHERE clave = $2) AS amarillo
      FROM configuraciones_globales
      WHERE clave IN ($1, $2)
    `,
    [CLAVES_UMBRALES_VENCIMIENTO.rojo, CLAVES_UMBRALES_VENCIMIENTO.amarillo]
  );
  const { rojo, amarillo } = result.rows[0];
  if (rojo === null || amarillo === null) {
    throw new Error('Faltan los umbrales de vencimiento en configuraciones_globales (ejecutar scripts/create-configuraciones.mjs)');
  }
  return { rojo: Number(rojo), amarillo: Number(amarillo) };
};

// GET /alertas/stock (HU-03)
// Solo los productos en ROJO o AMARILLO para el panel principal: primero los rojos, y en cada nivel primero
// los cercanos al mínimo (reposición) y después los cercanos al máximo (frenar pedidos).
app.get('/alertas/stock', soloBodegueroOAdministrador, async (c) => {
  try {
    const sql = getDb(c.env.DATABASE_URL);
    const { filas, resumen, margen } = await consultarEstadoStock(sql, true);

    return c.json({
      success: true,
      ...margen,
      resumen,
      total: filas.length,
      data: filas,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /alertas/vencimiento (HU-09)
// Clasifica los lotes activos por días restantes: ROJO <= rojo, AMARILLO <= amarillo, VERDE > amarillo.
app.get('/alertas/vencimiento', consultaInventario, async (c) => {
  try {
    const sql = getDb(c.env.DATABASE_URL);
    const umbrales = await obtenerUmbralesVencimiento(sql);
    const result = await sql.query(`
      SELECT
        l.id,
        l.numero_lote,
        l.id_producto,
        p.sku,
        p.nombre AS producto,
        l.cantidad_disponible,
        l.fecha_vencimiento::text AS fecha_vencimiento,
        dias.restantes AS dias_para_vencer,
        CASE
          WHEN dias.restantes <= $1 THEN 'ROJO'
          WHEN dias.restantes <= $2 THEN 'AMARILLO'
          ELSE 'VERDE'
        END AS nivel_alerta
      FROM lote l
      JOIN producto p ON p.id = l.id_producto
      CROSS JOIN LATERAL (
        SELECT l.fecha_vencimiento - ${HOY_CHILE_SQL} AS restantes
      ) dias
      WHERE l.cantidad_disponible > 0
      ORDER BY dias.restantes ASC, l.id ASC
    `, [umbrales.rojo, umbrales.amarillo]);

    const resumen = { ROJO: 0, AMARILLO: 0, VERDE: 0 };
    for (const lote of result.rows) {
      resumen[lote.nivel_alerta as keyof typeof resumen]++;
    }

    return c.json({
      success: true,
      umbrales,
      resumen,
      total: result.rowCount,
      data: result.rows,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /mermas (HU-10)
// En una sola transacción: registra la merma y descuenta la cantidad del lote y del stock_actual del producto.
// El lote se bloquea con FOR UPDATE para que dos mermas simultáneas no superen la cantidad disponible.
// Chef, Bodeguero y Administrador descuentan stock aquí, igual que un ingreso de bodega.
const MOTIVOS_MERMA = ['Vencimiento', 'Rotura/Daño', 'Deterioro', 'Error Operacional', 'Otro'];
const leerCantidadMerma = (cantidad: unknown) => {
  const cantidadNum = Number(cantidad);
  if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
    return { error: 'La cantidad debe ser un número válido mayor a 0' };
  }
  if (Math.abs(Math.round(cantidadNum * 100) - cantidadNum * 100) > 1e-6) {
    return { error: 'La cantidad admite como máximo 2 decimales' };
  }
  return { cantidadNum };
};

// Descuenta el lote y el producto y deja la fila en merma. La transacción y el COMMIT son del llamador.
// Los triggers de cuadre se pausan solo dentro de esta transacción: comparan stock y lotes al instante,
// y las dos escrituras no pueden quedar consistentes entre medio.
const descontarMerma = async (client: any, loteId: number, cantidadNum: number, motivo: string, usuarioId: number) => {
  const loteResult = await client.query(
    `SELECT id, id_producto, numero_lote, cantidad_disponible, estado FROM lote WHERE id = $1 FOR UPDATE`,
    [loteId]
  );
  if (loteResult.rowCount === 0) return { ok: false as const, status: 404, error: 'Lote no encontrado' };

  const lote = loteResult.rows[0];
  if (lote.estado !== 'ACTIVO') {
    return { ok: false as const, status: 409, error: 'El lote no está activo y no admite merma' };
  }
  const disponible = Number(lote.cantidad_disponible);
  if (cantidadNum > disponible) {
    return {
      ok: false as const,
      status: 400,
      error: `La merma (${cantidadNum}) supera la cantidad disponible del lote (${disponible})`,
      cantidad_disponible: disponible,
    };
  }

  await client.query(`SELECT id FROM producto WHERE id = $1 FOR UPDATE`, [lote.id_producto]);
  await client.query('ALTER TABLE lote DISABLE TRIGGER lote_stock_igual_lotes_trg');
  await client.query('ALTER TABLE producto DISABLE TRIGGER producto_stock_igual_lotes_trg');

  const mermaResult = await client.query(
    `
      INSERT INTO merma (id_lote, id_usuario, motivo, cantidad, fecha)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, id_lote, id_usuario, motivo, cantidad,
                to_char(fecha, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha
    `,
    [loteId, usuarioId, motivo, cantidadNum]
  );
  await registrarAccion(
    client,
    usuarioId,
    'MERMA',
    `Registró merma de ${cantidadNum} en el lote ${lote.numero_lote} por ${motivo}`
  );
  const loteActualizado = await client.query(
    `
      UPDATE lote
      SET cantidad_disponible = cantidad_disponible - $1
      WHERE id = $2
      RETURNING id, numero_lote, cantidad_inicial, cantidad_disponible
    `,
    [cantidadNum, loteId]
  );
  const productoActualizado = await client.query(
    `
      UPDATE producto
      SET stock_actual = stock_actual - $1,
          fecha_actualizacion = NOW()
      WHERE id = $2
      RETURNING id, sku, nombre, stock_actual
    `,
    [cantidadNum, lote.id_producto]
  );

  await client.query('ALTER TABLE lote ENABLE TRIGGER lote_stock_igual_lotes_trg');
  await client.query('ALTER TABLE producto ENABLE TRIGGER producto_stock_igual_lotes_trg');

  const descuadre = await client.query(
    `
      SELECT p.id
      FROM producto p
      LEFT JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
      WHERE p.id = $1
      GROUP BY p.id, p.stock_actual
      HAVING p.stock_actual <> COALESCE(SUM(l.cantidad_disponible), 0)
    `,
    [lote.id_producto]
  );
  if (descuadre.rowCount > 0) {
    throw new Error('El stock del producto quedó distinto de la suma de sus lotes');
  }

  return {
    ok: true as const,
    merma: mermaResult.rows[0],
    lote: loteActualizado.rows[0],
    producto: productoActualizado.rows[0],
  };
};

const responderErrorMerma = (c: any, error: any) => {
  if (error.code === '23503') return c.json({ success: false, error: 'Sesión no válida' }, 401);
  if (error.code === '23514') {
    return c.json({ success: false, error: 'El stock del producto es inconsistente con sus lotes' }, 409);
  }
  return c.json({ success: false, error: error.message }, 500);
};

app.post('/mermas', registrarMerma, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { lote_id, cantidad, motivo } = body;
  const usuario = c.get('usuario');

  if (lote_id === undefined || lote_id === null || cantidad === undefined || cantidad === null || !motivo) {
    return c.json({ success: false, error: 'lote_id, cantidad y motivo son obligatorios' }, 400);
  }

  const loteId = Number(lote_id);
  if (!Number.isInteger(loteId) || loteId <= 0) {
    return c.json({ success: false, error: 'lote_id debe ser un número entero válido' }, 400);
  }

  const cantidadLeida = leerCantidadMerma(cantidad);
  if (cantidadLeida.error) return c.json({ success: false, error: cantidadLeida.error }, 400);

  if (!MOTIVOS_MERMA.includes(motivo)) {
    return c.json({
      success: false,
      error: `Motivo inválido. Valores permitidos: ${MOTIVOS_MERMA.join(', ')}`,
    }, 400);
  }

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();

  try {
    await client.query('BEGIN');
    const resultado = await descontarMerma(client, loteId, cantidadLeida.cantidadNum!, motivo, usuario.id);
    if (!resultado.ok) {
      await client.query('ROLLBACK');
      return c.json({
        success: false,
        error: resultado.error,
        ...(resultado.cantidad_disponible !== undefined ? { cantidad_disponible: resultado.cantidad_disponible } : {}),
      }, resultado.status);
    }
    await client.query('COMMIT');

    return c.json({
      success: true,
      message: 'Merma registrada exitosamente',
      data: {
        merma: resultado.merma,
        lote: resultado.lote,
        producto: resultado.producto,
        registrado_por: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      },
    }, 201);
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    return responderErrorMerma(c, error);
  } finally {
    client.release();
  }
});

// Lotes que pueden consumir las comandas y las salidas manuales: con saldo y no vencidos (fecha de Chile)
const LOTES_FEFO_WHERE = `id_producto = $1 AND cantidad_disponible > 0 AND fecha_vencimiento >= ${HOY_CHILE_SQL}`;

// Descuenta `cantidad` de los lotes FEFO del producto (ya bloqueados con FOR UPDATE): cada lote aporta lo que falta
// después de los lotes que vencen antes. Devuelve lo descontado por lote, del que vence primero al último.
const descontarFefo = async (client: any, productoId: number, cantidad: number | string) => {
  const descuento = await client.query(
    `
      WITH fefo AS (
        SELECT id, cantidad_disponible,
               SUM(cantidad_disponible) OVER (ORDER BY fecha_vencimiento ASC, id ASC) - cantidad_disponible AS acumulado_previo
        FROM lote
        WHERE ${LOTES_FEFO_WHERE}
      ),
      a_descontar AS (
        SELECT id, LEAST(cantidad_disponible, $2::numeric - acumulado_previo) AS cantidad
        FROM fefo
        WHERE acumulado_previo < $2::numeric
      )
      UPDATE lote l
      SET cantidad_disponible = l.cantidad_disponible - d.cantidad
      FROM a_descontar d
      WHERE l.id = d.id
      RETURNING l.id, l.numero_lote, l.fecha_vencimiento::text AS fecha_vencimiento,
                d.cantidad AS descontado, l.cantidad_disponible AS restante
    `,
    [productoId, cantidad]
  );
  return descuento.rows.sort((a: any, b: any) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.id - b.id);
};

// GET /inventario/insumos?q= (HU-11)
// Búsqueda rápida del Chef por nombre, SKU o código de barras (prefijo). No expone los umbrales de stock.
const BUSQUEDA_INSUMOS = { limite: 50 };

app.get('/inventario/insumos', soloChefOAdministrador, async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length > LARGO_MAXIMO_BUSQUEDA) {
    return c.json({ success: false, error: `La búsqueda admite hasta ${LARGO_MAXIMO_BUSQUEDA} caracteres` }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(
      `
        SELECT p.id, p.sku, p.codigo_de_barra::text AS codigo_de_barra, p.nombre, p.marca, p.categoria, p.stock_actual,
               COALESCE((SELECT SUM(cantidad_disponible) FROM lote WHERE ${LOTES_FEFO_WHERE.replace('$1', 'p.id')}), 0) AS disponible_para_salida
        FROM producto p
        WHERE ${filtroBusquedaProducto('p', '$1', '$2')}
        ORDER BY p.nombre, p.id
        LIMIT ${BUSQUEDA_INSUMOS.limite}
      `,
      parametrosBusqueda(q)
    );
    return c.json({ success: true, total: result.rowCount, limite: BUSQUEDA_INSUMOS.limite, data: result.rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /inventario/salida-manual (HU-11)
// En una sola transacción descuenta la cantidad de los lotes vigentes del producto con regla FEFO, registra un
// movimiento SALIDA_MANUAL por lote (Chef responsable, fecha y motivo) y actualiza el stock_actual del producto.
const MOTIVO_SALIDA_MANUAL = { minimo: 5, maximo: 200 };

app.post('/inventario/salida-manual', soloChef, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { producto_id, cantidad } = body;
  const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : '';
  const usuario = c.get('usuario');

  if (producto_id === undefined || producto_id === null || cantidad === undefined || cantidad === null) {
    return c.json({ success: false, error: 'producto_id y cantidad son obligatorios' }, 400);
  }

  const productoId = Number(producto_id);
  if (!Number.isInteger(productoId) || productoId <= 0) {
    return c.json({ success: false, error: 'producto_id debe ser un número entero válido' }, 400);
  }

  // Solo se acepta un número JSON: textos como "5" o "-5" se rechazan
  if (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad <= 0) {
    return c.json({ success: false, error: 'La cantidad debe ser un número mayor a 0' }, 400);
  }

  if (motivo.length < MOTIVO_SALIDA_MANUAL.minimo || motivo.length > MOTIVO_SALIDA_MANUAL.maximo) {
    return c.json({
      success: false,
      error: `El motivo de la salida es obligatorio (entre ${MOTIVO_SALIDA_MANUAL.minimo} y ${MOTIVO_SALIDA_MANUAL.maximo} caracteres)`,
    }, 400);
  }

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();

  try {
    await client.query('BEGIN');

    const productoResult = await client.query(`SELECT id FROM producto WHERE id = $1`, [productoId]);
    if (productoResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Producto no encontrado' }, 404);
    }

    // Mismo orden de bloqueo que comandas y mermas (lotes y luego producto): dos salidas simultáneas se serializan
    await client.query(
      `SELECT id FROM lote WHERE ${LOTES_FEFO_WHERE} ORDER BY fecha_vencimiento ASC, id ASC FOR UPDATE`,
      [productoId]
    );
    const saldo = await client.query(
      `SELECT COALESCE(SUM(cantidad_disponible), 0) AS disponible FROM lote WHERE ${LOTES_FEFO_WHERE}`,
      [productoId]
    );
    const disponible = Number(saldo.rows[0].disponible);
    if (cantidad > disponible) {
      await client.query('ROLLBACK');
      return c.json({
        success: false,
        error: `La salida (${cantidad}) supera la existencia disponible en lotes vigentes (${disponible})`,
        disponible_en_lotes: saldo.rows[0].disponible,
      }, 400);
    }

    const lotes = await descontarFefo(client, productoId, cantidad);
    for (const lote of lotes) {
      await client.query(
        `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario, motivo)
         VALUES ($1, 'SALIDA_MANUAL', $2, NOW(), $3, $4)`,
        [lote.id, lote.descontado, usuario.id, motivo]
      );
    }

    const actualizado = await client.query(
      `
        UPDATE producto
        SET stock_actual = stock_actual - $1,
            fecha_actualizacion = NOW()
        WHERE id = $2
        RETURNING id, sku, nombre, stock_actual + $1 AS stock_anterior, stock_actual,
                  to_char(fecha_actualizacion, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha_actualizacion
      `,
      [cantidad, productoId]
    );
    await registrarAccion(
      client,
      usuario.id,
      'SALIDA_MANUAL',
      `Registró salida manual de ${cantidad} de ${actualizado.rows[0].nombre}: ${motivo}`
    );

    await client.query('COMMIT');

    return c.json({
      success: true,
      message: 'Salida manual registrada exitosamente',
      data: {
        producto: actualizado.rows[0],
        cantidad,
        motivo,
        lotes,
        registrado_por: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      },
    }, 201);
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    // 23503 = foreign_key_violation: el usuario del token ya no existe en la BD
    if (error.code === '23503') {
      return c.json({ success: false, error: 'Sesión no válida' }, 401);
    }
    // 23514 = check_violation: stock_actual negativo o distinto de la suma de sus lotes (producto_stock_igual_lotes)
    if (error.code === '23514') {
      return c.json({ success: false, error: 'El stock del producto es inconsistente con sus lotes' }, 409);
    }
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

// CRUD /recetas (HU-12): ver src/routes/recetas.ts
app.route('/recetas', recetas);

// POST /comandas (HU-13)
// En una sola transacción: identifica la receta y sus ingredientes, calcula platos x cantidad_requerida
// y descuenta cada ingrediente de sus lotes con regla FEFO (vence primero, sale primero).
// Si un lote no alcanza, el remanente se descuenta del siguiente lote próximo a vencer.
// Solo se usan lotes con saldo y no vencidos (fecha de Chile).

app.post('/comandas', soloChef, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { receta_id, cantidad_platos } = body;
  const usuario = c.get('usuario');

  if (receta_id === undefined || receta_id === null || cantidad_platos === undefined || cantidad_platos === null) {
    return c.json({ success: false, error: 'receta_id y cantidad_platos son obligatorios' }, 400);
  }

  const recetaId = Number(receta_id);
  if (!Number.isInteger(recetaId) || recetaId <= 0) {
    return c.json({ success: false, error: 'receta_id debe ser un número entero válido' }, 400);
  }

  if (typeof cantidad_platos !== 'number' || !Number.isInteger(cantidad_platos) || cantidad_platos <= 0) {
    return c.json({ success: false, error: 'cantidad_platos debe ser un número entero mayor a 0' }, 400);
  }

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();

  try {
    await client.query('BEGIN');

    // 1. Identificar la receta (FOR SHARE: PUT /recetas/:id no puede cambiar sus ingredientes mientras se descuenta)
    const recetaResult = await client.query(
      `SELECT id, nombre_plato, estado FROM receta WHERE id = $1 FOR SHARE`,
      [recetaId]
    );
    if (recetaResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Receta no encontrada' }, 404);
    }
    const receta = recetaResult.rows[0];
    if (receta.estado !== 'activo') {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'La receta está inactiva y no se puede usar en comandas' }, 409);
    }

    // 2. Sus ingredientes con la cantidad total requerida (ordenados por producto para bloquear siempre en el mismo orden)
    const ingredientesResult = await client.query(
      `
        SELECT ir.id_producto, p.nombre AS producto, ir.unidad_medida,
               ir.cantidad_requerida, (ir.cantidad_requerida * $2) AS requerido
        FROM ingrediente_receta ir
        JOIN producto p ON p.id = ir.id_producto
        WHERE ir.id_receta = $1
        ORDER BY ir.id_producto
      `,
      [recetaId, cantidad_platos]
    );
    if (ingredientesResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'La receta no tiene ingredientes asociados' }, 409);
    }

    // 3. Bloquear los lotes FEFO de cada ingrediente y verificar que alcancen antes de descontar nada
    const faltantes = [];
    for (const ing of ingredientesResult.rows) {
      await client.query(
        `SELECT id FROM lote WHERE ${LOTES_FEFO_WHERE} ORDER BY fecha_vencimiento ASC, id ASC FOR UPDATE`,
        [ing.id_producto]
      );
      const saldo = await client.query(
        `SELECT COALESCE(SUM(cantidad_disponible), 0) AS disponible,
                COALESCE(SUM(cantidad_disponible), 0) >= $2::numeric AS alcanza
         FROM lote WHERE ${LOTES_FEFO_WHERE}`,
        [ing.id_producto, ing.requerido]
      );
      if (!saldo.rows[0].alcanza) {
        faltantes.push({
          producto: ing.producto,
          requerido: ing.requerido,
          disponible_en_lotes: saldo.rows[0].disponible,
          unidad_medida: ing.unidad_medida,
        });
      }
    }
    if (faltantes.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Stock insuficiente en lotes vigentes para preparar la comanda', faltantes }, 409);
    }

    // 4. Descuento FEFO: cada lote aporta lo que falta después de los lotes que vencen antes
    const consumo = [];
    for (const ing of ingredientesResult.rows) {
      const lotes = await descontarFefo(client, ing.id_producto, ing.requerido);

      for (const lote of lotes) {
        await client.query(
          `INSERT INTO movimiento (id_lote, tipo, cantidad, fecha, id_usuario, id_receta)
           VALUES ($1, 'SALIDA_COMANDA', $2, NOW(), $3, $4)`,
          [lote.id, lote.descontado, usuario.id, recetaId]
        );
      }

      const producto = await client.query(
        `
          UPDATE producto
          SET stock_actual = stock_actual - $1,
              fecha_actualizacion = NOW()
          WHERE id = $2
          RETURNING stock_actual
        `,
        [ing.requerido, ing.id_producto]
      );

      consumo.push({
        producto: ing.producto,
        unidad_medida: ing.unidad_medida,
        cantidad_por_plato: ing.cantidad_requerida,
        requerido: ing.requerido,
        lotes,
        stock_actual: producto.rows[0].stock_actual,
      });
    }

    await registrarAccion(
      client,
      usuario.id,
      'SALIDA_COMANDA',
      `Registró comanda de ${cantidad_platos} plato(s) de ${receta.nombre_plato}`
    );
    await client.query('COMMIT');

    return c.json({
      success: true,
      message: 'Comanda registrada y stock descontado con regla FEFO',
      data: {
        receta: { id: receta.id, nombre_plato: receta.nombre_plato },
        cantidad_platos,
        consumo,
        registrado_por: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      },
    }, 201);
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    // 23503 = foreign_key_violation: el usuario del token ya no existe en la BD
    if (error.code === '23503') {
      return c.json({ success: false, error: 'Sesión no válida' }, 401);
    }
    // 23514 = check_violation: el stock_actual del producto quedaría negativo (inconsistente con sus lotes)
    if (error.code === '23514') {
      return c.json({ success: false, error: 'El stock de un producto es inconsistente con sus lotes' }, 409);
    }
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

// GET /ia/sugerencias (HU-14)
// 1. Consulta los insumos por vencer y el resto de la despensa.
// 2. La IA arma una receta real: usa lo que vence y puede completar con otros insumos que no estén por vencer.
// Si el modelo no entrega una receta completa, el servidor arma una con el mismo criterio.
const MODELO_IA = '@cf/meta/llama-4-scout-17b-16e-instruct';
const TTL_CACHE_IA_MS = 900_000;
const cacheSugerenciasIa = new Map<string, { vence: number; cuerpo: any }>();
const CATEGORIAS_NO_ALIMENTARIAS = ['Aseo y Limpieza', 'Embalaje', 'Utensilios Descartables'];
const LIMITE_POR_VENCER_IA = 10;
const LIMITE_RECETAS_IA = 1;
const LIMITE_INSUMOS_IA = 10;
const LIMITE_DESPENSA_MODELO = 8;
const CLAVE_CATEGORIA_RESTAURANTE = 'categoria_restaurante';
const CATEGORIAS_RESTAURANTE = [
  'Repostería',
  'Comida Italiana',
  'Comida Rápida',
  'Comida Tailandesa',
  'Comida Chilena',
  'Comida China',
] as const;
const CATEGORIA_RESTAURANTE_INICIAL = 'Repostería';

const esCategoriaRestaurante = (valor: unknown): valor is (typeof CATEGORIAS_RESTAURANTE)[number] =>
  typeof valor === 'string' && (CATEGORIAS_RESTAURANTE as readonly string[]).includes(valor);

const obtenerCategoriaRestaurante = async (sql: any) => {
  const result = await sql.query(
    `SELECT valor FROM configuraciones_globales WHERE clave = $1`,
    [CLAVE_CATEGORIA_RESTAURANTE]
  );
  const valor = result.rows[0]?.valor;
  return esCategoriaRestaurante(valor) ? valor : CATEGORIA_RESTAURANTE_INICIAL;
};

const extraerJsonModelo = (respuesta: any) => {
  const bruto = typeof respuesta?.response === 'string'
    ? respuesta.response
    : typeof respuesta === 'string'
      ? respuesta
      : respuesta?.response ?? respuesta;
  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) return bruto;
  if (typeof bruto !== 'string') return null;
  const limpio = bruto.replace(/```(?:json)?/gi, '').trim();
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (inicio === -1 || fin <= inicio) return null;
  try {
    return JSON.parse(limpio.slice(inicio, fin + 1));
  } catch {
    return null;
  }
};

const guardarCacheIa = (clave: string, cuerpo: any) => {
  if (cacheSugerenciasIa.size > 20) {
    const primera = cacheSugerenciasIa.keys().next().value;
    if (primera) cacheSugerenciasIa.delete(primera);
  }
  cacheSugerenciasIa.set(clave, { vence: Date.now() + TTL_CACHE_IA_MS, cuerpo });
};

// La categoría del restaurante orienta las recetas de rescate y queda guardada para el Chef y el Administrador.
app.get('/ia/categoria-restaurante', soloChefOAdministrador, async (c) => {
  try {
    const categoria = await obtenerCategoriaRestaurante(getDb(c.env.DATABASE_URL));
    return c.json({ success: true, data: { categoria, categorias: CATEGORIAS_RESTAURANTE } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.put('/ia/categoria-restaurante', soloChefOAdministrador, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!esCategoriaRestaurante(body?.categoria)) {
    return c.json({
      success: false,
      error: `La categoría debe ser una de: ${CATEGORIAS_RESTAURANTE.join(', ')}`,
    }, 400);
  }

  const usuario = c.get('usuario');
  try {
    const sql = getDb(c.env.DATABASE_URL);
    await sql.query(
      `
        INSERT INTO configuraciones_globales (clave, valor, tipo, descripcion, id_usuario_actualizacion)
        VALUES ($1, $2, 'texto', 'Categoría del restaurante usada por Chef IA para sugerir recetas de rescate', $3)
        ON CONFLICT (clave) DO UPDATE
          SET valor = EXCLUDED.valor,
              fecha_actualizacion = NOW(),
              id_usuario_actualizacion = EXCLUDED.id_usuario_actualizacion
      `,
      [CLAVE_CATEGORIA_RESTAURANTE, body.categoria, usuario.id]
    );
    return c.json({ success: true, data: { categoria: body.categoria, categorias: CATEGORIAS_RESTAURANTE } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/ia/sugerencias', soloChefOAdministrador, async (c) => {
  const renovar = c.req.query('renovar') === '1';
  const evitar = (c.req.query('evitar') || '')
    .split('|')
    .map((titulo) => titulo.trim())
    .filter(Boolean)
    .slice(0, 8);
  const sql = getDb(c.env.DATABASE_URL);

  let categoriaRestaurante = CATEGORIA_RESTAURANTE_INICIAL;
  let proximosAVencer: any[];
  let mayorStock: any[];
  let despensaFilas: any[] = [];
  let recetasMenu: any[] = [];
  let diasAlerta = 7;
  try {
    const [categoria, umbrales] = await Promise.all([
      obtenerCategoriaRestaurante(sql).catch(() => CATEGORIA_RESTAURANTE_INICIAL),
      obtenerUmbralesVencimiento(sql),
    ]);
    categoriaRestaurante = categoria;
    diasAlerta = umbrales.amarillo;
    const [vencer, stock, despensaSql, menu] = await Promise.all([
      // FEFO: por producto, el lote vigente que vence primero; solo dentro de la alerta amarilla (HU-09)
      sql.query(
        `
          SELECT p.nombre AS producto,
                 p.unidad_medida,
                 SUM(l.cantidad_disponible) AS cantidad_en_riesgo,
                 MIN(l.fecha_vencimiento)::text AS vence,
                 MIN(l.fecha_vencimiento) - ${HOY_CHILE_SQL} AS dias_para_vencer
          FROM lote l
          JOIN producto p ON p.id = l.id_producto
          WHERE l.estado = 'ACTIVO'
            AND l.cantidad_disponible > 0
            AND l.fecha_vencimiento >= ${HOY_CHILE_SQL}
            AND l.fecha_vencimiento - ${HOY_CHILE_SQL} <= $1
            AND NOT (p.categoria = ANY($2))
          GROUP BY p.id, p.nombre, p.unidad_medida
          ORDER BY MIN(l.fecha_vencimiento) ASC, p.id ASC
          LIMIT $3
        `,
        [umbrales.amarillo, CATEGORIAS_NO_ALIMENTARIAS, LIMITE_POR_VENCER_IA]
      ),
      // Mayor stock relativo a su máximo (compara productos con distintas unidades)
      sql.query(
        `
          SELECT nombre AS producto, stock_actual, stock_maximo,
                 ROUND(stock_actual / NULLIF(stock_maximo, 0) * 100) AS porcentaje_del_maximo
          FROM producto
          WHERE stock_actual > 0
            AND NOT (categoria = ANY($1))
          ORDER BY stock_actual / NULLIF(stock_maximo, 0) DESC NULLS LAST, id ASC
          LIMIT $2
        `,
        [CATEGORIAS_NO_ALIMENTARIAS, LIMITE_INSUMOS_IA]
      ),
      sql.query(
        `
          SELECT nombre AS producto, unidad_medida, stock_actual AS cantidad
          FROM producto
          WHERE stock_actual > 0
            AND NOT (categoria = ANY($1))
          ORDER BY nombre
        `,
        [CATEGORIAS_NO_ALIMENTARIAS]
      ),
      sql.query(
        `
          SELECT r.id, r.nombre_plato, r.porciones, r.rubro,
                 COALESCE(
                   json_agg(
                     json_build_object('producto', p.nombre, 'cantidad', ir.cantidad_requerida, 'unidad', ir.unidad_medida)
                     ORDER BY p.nombre
                   ) FILTER (WHERE p.id IS NOT NULL),
                   '[]'
                 ) AS ingredientes
          FROM receta r
          LEFT JOIN ingrediente_receta ir ON ir.id_receta = r.id
          LEFT JOIN producto p ON p.id = ir.id_producto
          WHERE r.estado = 'activo'
          GROUP BY r.id
          ORDER BY r.nombre_plato, r.id
          LIMIT 40
        `
      ),
    ]);
    proximosAVencer = vencer.rows;
    mayorStock = stock.rows;
    despensaFilas = despensaSql.rows;
    recetasMenu = menu.rows.map((fila: any) => ({
      ...fila,
      id: Number(fila.id),
      ingredientes: typeof fila.ingredientes === 'string' ? JSON.parse(fila.ingredientes) : (fila.ingredientes ?? []),
    }));
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }

  const contexto = { proximos_a_vencer: proximosAVencer, mayor_stock: mayorStock, categoria_restaurante: categoriaRestaurante };

  if (proximosAVencer.length === 0) {
    return c.json({
      success: true,
      modelo: null,
      contexto,
      categoria_restaurante: categoriaRestaurante,
      sugerencias: [],
      dias_alerta: diasAlerta,
      mensaje: `No hay insumos que venzan en los próximos ${diasAlerta} días. Los lotes que ya vencieron no entran en las sugerencias.`,
    });
  }

  const listado = {
    proximos_a_vencer: proximosAVencer.map((i) => ({
      insumo: String(i.producto).slice(0, 100),
      unidad: i.unidad_medida,
      cantidad_disponible: Number(i.cantidad_en_riesgo),
      vence_en_dias: Number(i.dias_para_vencer),
    })),
    mayor_stock: mayorStock.map((i) => ({
      insumo: String(i.producto).slice(0, 100),
      stock_actual: Number(i.stock_actual),
      porcentaje_del_maximo: Number(i.porcentaje_del_maximo),
    })),
  };

  const aInsumo = (fila: any, porVencerFlag: boolean, dias: number | null, cantidad: number): InsumoCocina => ({
    producto: String(fila.producto),
    unidad_medida: String(fila.unidad_medida || 'un'),
    cantidad_en_riesgo: cantidad,
    dias_para_vencer: dias,
    por_vencer: porVencerFlag,
  });
  const porVencerMarcados = proximosAVencer.map((fila) =>
    aInsumo(fila, true, Number(fila.dias_para_vencer), Number(fila.cantidad_en_riesgo))
  );
  const clavesPorVencer = new Set(porVencerMarcados.map((item) => normalizarTexto(item.producto)));
  const despensa = despensaFilas
    .filter((fila) => {
      const nombre = normalizarTexto(String(fila.producto));
      return nombre && !clavesPorVencer.has(nombre) && !/prueba/.test(nombre);
    })
    .map((fila) => aInsumo(fila, false, null, Number(fila.cantidad)));
  const inventario = [...porVencerMarcados, ...despensa];
  const porNombre = new Map(inventario.map((item) => [normalizarTexto(item.producto), item.producto]));
  const resolverInsumo = (texto: unknown) => {
    const buscado = normalizarTexto(String(texto ?? ''));
    if (!buscado) return null;
    if (porNombre.has(buscado)) return porNombre.get(buscado) as string;
    const coincidencias = [...porNombre.entries()].filter(([clave]) => clave.includes(buscado) || buscado.includes(clave));
    return coincidencias.length === 1 ? coincidencias[0][1] : null;
  };

  const inicio = Date.now();

  const sugerenciasChef = armarSugerenciasLocales(categoriaRestaurante, porVencerMarcados, despensa);
  const cuerpoChef = (mensaje: string, fase: 'parcial' | 'final') => ({
    success: true,
    origen: 'chef' as const,
    modelo: null,
    categoria_restaurante: categoriaRestaurante,
    contexto,
    sugerencias: [],
    sugerencias_ia: [],
    sugerencias_chef: sugerenciasChef,
    generado_en_ms: Date.now() - inicio,
    mensaje,
    fase,
  });

  if (!c.env.AI?.run) {
    return c.json(cuerpoChef(`Recetas de ${categoriaRestaurante} con los insumos que vencen primero.`, 'final'));
  }

  const menuParaModelo = recetasMenu
    .filter((receta) => receta.ingredientes.some((ing: any) => clavesPorVencer.has(normalizarTexto(String(ing.producto)))))
    .slice(0, 4)
    .map((receta) => ({
      receta_id: receta.id,
      plato: receta.nombre_plato,
      insumos: receta.ingredientes.map((ing: any) => ing.producto),
    }));
  const despensaParaModelo = insumosUtilesParaModelo(categoriaRestaurante, despensa, LIMITE_DESPENSA_MODELO);
  const porVencerAfines = listado.proximos_a_vencer.filter((item) => encajaEnCategoria(item.insumo, categoriaRestaurante));
  const porVencerFuera = listado.proximos_a_vencer.filter((item) => !encajaEnCategoria(item.insumo, categoriaRestaurante));
  const claveCache = `v18|${categoriaRestaurante}|${listado.proximos_a_vencer
    .map((item) => `${item.insumo}:${item.vence_en_dias}:${item.cantidad_disponible}`)
    .join(',')}|${despensaParaModelo.join(',')}`;
  const titulosChef = sugerenciasChef.map((item) => String(item.titulo || '')).filter(Boolean);

  const extraerUnaReceta = (cuerpo: any, previas: any[]) => {
    const usados = [...evitar, ...titulosChef, ...previas.map((item) => String(item.titulo || ''))];
    const crudas = Array.isArray(cuerpo?.sugerencias) ? cuerpo.sugerencias : (cuerpo?.titulo ? [cuerpo] : []);
    for (const sugerencia of crudas) {
      const pedidos = new Map<string, number>();
      const desdeIngredientes = (Array.isArray(sugerencia?.ingredientes) ? sugerencia.ingredientes : [])
        .map((ing: any) => {
          const nombre = resolverInsumo(ing?.nombre ?? ing?.producto);
          const cantidad = Number(ing?.cantidad);
          if (nombre && cantidad > 0) pedidos.set(normalizarTexto(nombre), cantidad);
          return nombre;
        });
      const insumos = [...new Set(
        [
          ...(Array.isArray(sugerencia?.insumos_usados) ? sugerencia.insumos_usados : []).map((nombre: unknown) => resolverInsumo(nombre)),
          ...desdeIngredientes,
        ].filter((nombre: string | null): nombre is string => Boolean(nombre))
      )];
      const titulo = typeof sugerencia?.titulo === 'string' ? sugerencia.titulo.trim() : '';
      if (tituloInvalido(titulo) || tituloParecido(titulo, usados, true)) continue;
      const cerrada = cerrarSugerenciaModelo({
        categoria: categoriaRestaurante,
        titulo,
        nombres: insumos,
        pasos: sugerencia?.pasos,
        pedidos,
        insumos: inventario,
        porVencer: porVencerMarcados,
      });
      if (cerrada && recetaEsDistinta(cerrada, previas)) return cerrada;
    }
    return null;
  };

  const generarUnaReceta = async (previas: any[], numero: number) => {
    const usados = [...evitar, ...titulosChef, ...previas.map((item) => String(item.titulo || ''))];
    const familia = elegirFamiliaIa(categoriaRestaurante, usados);
    const heroe = porVencerAfines[(numero - 1) % Math.max(porVencerAfines.length, 1)];
    const anteriores = [...sugerenciasChef, ...previas]
      .map((item) => `${item.titulo} [${(item.ingredientes || []).map((ing: any) => ing.producto).slice(0, 4).join(', ')}]`)
      .join(' | ');
    const mensajes = [
      {
        role: 'system',
        content:
          `Eres el chef de un restaurante de ${categoriaRestaurante} en Chile. ` +
          `Arma exactamente 1 plato real de ${categoriaRestaurante}, distinto a las sugerencias del chef. ` +
          `Este plato DEBE ser: ${familia.prompt}. ` +
          'Usa primero los insumos por vencer que combinan con esa cocina. ' +
          'Nunca hagas salteado, curry, arroz o pasta de cacao, chocolate, manjar o colorante si no es Repostería. ' +
          'Copia el nombre exacto de la despensa. No inventes insumos. 4 pasos concretos. Título corto = nombre del plato, nunca "Preparación de" ni "en su lugar". ' +
          'receta_id 0 si no está en el menú. Español de Chile. SOLO JSON ' +
          '{"sugerencias":[{"tipo":"receta","titulo":"...","receta_id":0,"insumos_usados":["..."],"ingredientes":[{"nombre":"...","cantidad":1}],"pasos":["..."]}]}',
      },
      {
        role: 'user',
        content:
          `Categoría: ${categoriaRestaurante}.\n` +
          `Familia obligatoria: ${familia.prompt}.\n` +
          (heroe ? `Insumo protagonista de este plato: ${heroe.insumo}.\n` : '') +
          `Insumos por vencer que SÍ combinan con el rubro:\n${JSON.stringify(porVencerAfines)}\n` +
          `Insumos por vencer que NO debes usar en estos platos:\n${JSON.stringify(porVencerFuera)}\n` +
          `Menú de referencia:\n${JSON.stringify(menuParaModelo)}\n` +
          `Despensa, se puede usar aunque no venza:\n${JSON.stringify(despensaParaModelo)}` +
          (anteriores ? `\nSugerencias del chef, prohibido copiarlas o hacer variantes: ${anteriores}.` : '') +
          (usados.length > 0 ? `\nTítulos prohibidos: ${usados.join(', ')}.` : '') +
          (renovar ? '\nPropón una combinación distinta a las de antes.' : ''),
      },
    ];
    try {
      const respuesta = await c.env.AI.run(MODELO_IA, {
        messages: mensajes,
        max_tokens: 400,
        temperature: numero > 1 || renovar ? 0.75 : 0.45,
      });
      return extraerUnaReceta(extraerJsonModelo(respuesta), previas);
    } catch {
      return null;
    }
  };

  const cuerpoIa = (recetas: any[], fase: 'ia-espera' | 'ia-parcial' | 'final', recetaEnCurso = 0) => ({
    success: true,
    origen: 'ia' as const,
    modelo: MODELO_IA,
    categoria_restaurante: categoriaRestaurante,
    contexto,
    sugerencias: recetas,
    sugerencias_ia: recetas,
    sugerencias_chef: sugerenciasChef,
    generado_en_ms: Date.now() - inicio,
    pendientes_ia: Math.max(0, LIMITE_RECETAS_IA - recetas.length),
    receta_en_curso: recetaEnCurso,
    fase,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        if (renovar) cacheSugerenciasIa.delete(claveCache);
        const guardado = renovar ? undefined : cacheSugerenciasIa.get(claveCache);
        if (guardado && guardado.vence > Date.now()) {
          enviar({ ...guardado.cuerpo, fase: 'final', pendientes_ia: 0, desde_cache: true, generado_en_ms: Date.now() - inicio });
          return;
        }
        enviar({
          ...cuerpoChef(`Armando recetas de Chef IA para ${categoriaRestaurante}...`, 'parcial'),
          pendientes_ia: LIMITE_RECETAS_IA,
          receta_en_curso: 1,
        });
        const recetas: any[] = [];
        for (let n = 1; n <= LIMITE_RECETAS_IA; n++) {
          enviar(cuerpoIa(recetas, 'ia-espera', n));
          let receta = null;
          for (let intento = 0; intento < 2 && !receta; intento++) {
            receta = await generarUnaReceta(recetas, n);
          }
          if (!receta) continue;
          recetas.push(receta);
          enviar(cuerpoIa(recetas, n === LIMITE_RECETAS_IA ? 'final' : 'ia-parcial', n === LIMITE_RECETAS_IA ? 0 : n + 1));
        }
        if (recetas.length > 0 && recetas.length < LIMITE_RECETAS_IA) {
          enviar(cuerpoIa(recetas, 'final', 0));
        } else if (recetas.length === 0) {
          enviar(cuerpoChef(`Recetas de ${categoriaRestaurante} con los insumos que vencen primero.`, 'final'));
        }
        if (recetas.length > 0) guardarCacheIa(claveCache, cuerpoIa(recetas, 'final'));
      } catch {
        enviar(cuerpoChef(`Recetas de ${categoriaRestaurante} con los insumos que vencen primero.`, 'final'));
      } finally {
        try { controller.close(); } catch { /* el cliente ya cerró el stream */ }
      }
    },
  });

  return c.newResponse(stream, 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
  });
});

// GET /analitica/mermas (HU-15)
// Agrupa las mermas de un rango de fechas por producto, motivo, responsable, categoría y período (día, semana o mes).
// Filtros opcionales ?categoria=, ?motivo= y ?usuario_id= que se aplican a todos los totales.
// merma.fecha se guarda en UTC: el rango y los períodos se calculan en hora de Chile.
// El costo valorizado usa producto.costo_unitario; lo que no tiene costo se informa aparte (sin_costo), no como $0.
const PERIODOS_ANALITICA: Record<string, string> = { dia: 'day', semana: 'week', mes: 'month' };
const RANGO_MAXIMO_DIAS = 731;
const LARGO_MAXIMO_CATEGORIA = 100;
const FECHA_MERMA_CHILE_SQL = `((m.fecha AT TIME ZONE 'UTC') AT TIME ZONE 'America/Santiago')`;
// $1 desde, $2 hasta, $3 categoría, $4 motivo, $5 usuario (requiere JOIN lote l y producto p)
const FILTRO_MERMA_SQL = `
  m.fecha >= (($1::date)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC'
  AND m.fecha < (($2::date + 1)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC'
  AND ($3::text IS NULL OR LOWER(p.categoria) = LOWER($3))
  AND ($4::text IS NULL OR m.motivo = $4)
  AND ($5::int IS NULL OR m.id_usuario = $5)
`;
const COSTO_MERMA_SQL = `
  ROUND(COALESCE(SUM(m.cantidad * p.costo_unitario), 0), 2) AS costo_total,
  COALESCE(SUM(m.cantidad) FILTER (WHERE p.costo_unitario IS NULL), 0) AS cantidad_sin_costo
`;

const esFechaValida = (valor: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
};

app.get('/analitica/mermas', soloChefOAdministrador, async (c) => {
  const periodo = c.req.query('periodo') ?? 'semana';
  if (!PERIODOS_ANALITICA[periodo]) {
    return c.json({ success: false, error: 'periodo inválido. Valores permitidos: dia, semana, mes' }, 400);
  }

  const desdeParam = c.req.query('desde');
  const hastaParam = c.req.query('hasta');
  for (const [nombre, valor] of [['desde', desdeParam], ['hasta', hastaParam]]) {
    if (valor !== undefined && !esFechaValida(valor)) {
      return c.json({ success: false, error: `${nombre} debe ser una fecha válida con formato YYYY-MM-DD` }, 400);
    }
  }

  const categoria = c.req.query('categoria')?.trim() || null;
  if (categoria !== null && categoria.length > LARGO_MAXIMO_CATEGORIA) {
    return c.json({ success: false, error: `categoria admite hasta ${LARGO_MAXIMO_CATEGORIA} caracteres` }, 400);
  }
  const motivo = c.req.query('motivo') ?? null;
  if (motivo !== null && !MOTIVOS_MERMA.includes(motivo)) {
    return c.json({ success: false, error: `motivo inválido. Valores permitidos: ${MOTIVOS_MERMA.join(', ')}` }, 400);
  }
  const usuarioParam = c.req.query('usuario_id');
  const usuarioId = usuarioParam === undefined ? null : Number(usuarioParam);
  if (usuarioId !== null && (!/^\d+$/.test(usuarioParam!) || !Number.isSafeInteger(usuarioId) || usuarioId <= 0)) {
    return c.json({ success: false, error: 'usuario_id debe ser un número entero válido' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);

    // Por defecto: los últimos 30 días hasta hoy (fecha de Chile)
    const rango = await sql.query(
      `
        SELECT COALESCE($2::date, ${HOY_CHILE_SQL})::text AS hasta,
               COALESCE($1::date, COALESCE($2::date, ${HOY_CHILE_SQL}) - 29)::text AS desde
      `,
      [desdeParam ?? null, hastaParam ?? null]
    );
    const { desde, hasta } = rango.rows[0];

    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
    if (dias < 0) {
      return c.json({ success: false, error: 'desde no puede ser posterior a hasta' }, 400);
    }
    if (dias >= RANGO_MAXIMO_DIAS) {
      return c.json({ success: false, error: `El rango no puede superar ${RANGO_MAXIMO_DIAS} días` }, 400);
    }

    const unidad = PERIODOS_ANALITICA[periodo];
    const filtros = [desde, hasta, categoria, motivo, usuarioId];
    const desdeMerma = (joinExtra = '') => `
      FROM merma m
      JOIN lote l ON l.id = m.id_lote
      JOIN producto p ON p.id = l.id_producto
      ${joinExtra}
      WHERE ${FILTRO_MERMA_SQL}
    `;

    const [resumen, porProducto, porMotivo, porResponsable, porCategoria, porPeriodo, detalle, categoriasCatalogo, responsablesCatalogo] = await Promise.all([
      sql.query(
        `
          SELECT COUNT(*)::int AS registros,
                 COALESCE(SUM(m.cantidad), 0) AS cantidad_total,
                 COUNT(DISTINCT l.id_producto)::int AS productos_afectados,
                 ${COSTO_MERMA_SQL},
                 COUNT(*) FILTER (WHERE p.costo_unitario IS NULL)::int AS registros_sin_costo
          ${desdeMerma()}
        `,
        filtros
      ),
      sql.query(
        `
          SELECT p.id AS producto_id, p.sku, p.nombre AS producto, p.categoria, p.costo_unitario,
                 COUNT(*)::int AS registros,
                 SUM(m.cantidad) AS cantidad_total,
                 ROUND(SUM(m.cantidad * p.costo_unitario), 2) AS costo_total,
                 ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS porcentaje_registros,
                 mode() WITHIN GROUP (ORDER BY m.motivo) AS motivo_mas_frecuente
          ${desdeMerma()}
          GROUP BY p.id, p.sku, p.nombre, p.categoria, p.costo_unitario
          ORDER BY cantidad_total DESC, registros DESC, p.id ASC
        `,
        filtros
      ),
      sql.query(
        `
          SELECT m.motivo,
                 COUNT(*)::int AS registros,
                 SUM(m.cantidad) AS cantidad_total,
                 ${COSTO_MERMA_SQL},
                 ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS porcentaje_registros,
                 COUNT(DISTINCT l.id_producto)::int AS productos_afectados
          ${desdeMerma()}
          GROUP BY m.motivo
          ORDER BY registros DESC, cantidad_total DESC, m.motivo ASC
        `,
        filtros
      ),
      sql.query(
        `
          SELECT m.id_usuario AS usuario_id, u.nombre AS usuario, u.rol,
                 COUNT(*)::int AS registros,
                 SUM(m.cantidad) AS cantidad_total,
                 ${COSTO_MERMA_SQL},
                 ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS porcentaje_registros
          ${desdeMerma('LEFT JOIN usuario u ON u.id = m.id_usuario')}
          GROUP BY m.id_usuario, u.nombre, u.rol
          ORDER BY registros DESC, cantidad_total DESC, m.id_usuario ASC
        `,
        filtros
      ),
      sql.query(
        `
          SELECT p.categoria,
                 COUNT(*)::int AS registros,
                 SUM(m.cantidad) AS cantidad_total,
                 ${COSTO_MERMA_SQL},
                 ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS porcentaje_registros,
                 COUNT(DISTINCT l.id_producto)::int AS productos_afectados
          ${desdeMerma()}
          GROUP BY p.categoria
          ORDER BY registros DESC, cantidad_total DESC, p.categoria ASC
        `,
        filtros
      ),
      // generate_series incluye los períodos sin mermas (en 0) para que los gráficos no tengan huecos
      sql.query(
        `
          WITH periodos AS (
            SELECT generate_series(
              date_trunc($6, $1::date::timestamp),
              date_trunc($6, $2::date::timestamp),
              ('1 ' || $6)::interval
            ) AS inicio
          ),
          agrupado AS (
            SELECT date_trunc($6, ${FECHA_MERMA_CHILE_SQL}) AS inicio,
                   COUNT(*)::int AS registros,
                   SUM(m.cantidad) AS cantidad_total,
                   ${COSTO_MERMA_SQL}
            ${desdeMerma()}
            GROUP BY 1
          )
          SELECT to_char(pe.inicio, 'YYYY-MM-DD') AS periodo_inicio,
                 COALESCE(a.registros, 0) AS registros,
                 COALESCE(a.cantidad_total, 0)::float8 AS cantidad_total,
                 COALESCE(a.costo_total, 0)::float8 AS costo_total,
                 COALESCE(a.cantidad_sin_costo, 0) AS cantidad_sin_costo
          FROM periodos pe
          LEFT JOIN agrupado a ON a.inicio = pe.inicio
          ORDER BY pe.inicio ASC
        `,
        [...filtros, unidad]
      ),
      sql.query(
        `
          SELECT m.id,
                 to_char(${FECHA_MERMA_CHILE_SQL}, 'YYYY-MM-DD') AS fecha,
                 p.nombre AS producto,
                 l.numero_lote,
                 m.cantidad::float8 AS cantidad,
                 ROUND(m.cantidad * p.costo_unitario, 2)::float8 AS costo,
                 m.motivo
          ${desdeMerma()}
          ORDER BY m.fecha DESC, m.id DESC
        `,
        filtros
      ),
      sql.query(
        `
          SELECT DISTINCT categoria
          FROM producto
          WHERE categoria IS NOT NULL AND btrim(categoria) <> ''
          ORDER BY categoria
        `
      ),
      sql.query(
        `
          SELECT DISTINCT m.id_usuario AS usuario_id, u.nombre AS usuario
          FROM merma m
          LEFT JOIN usuario u ON u.id = m.id_usuario
          WHERE m.fecha >= (($1::date)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC'
            AND m.fecha < (($2::date + 1)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC'
          ORDER BY usuario
        `,
        [desde, hasta]
      ),
    ]);

    return c.json({
      success: true,
      filtros: { desde, hasta, periodo, categoria, motivo, usuario_id: usuarioId },
      resumen: resumen.rows[0],
      por_producto: porProducto.rows,
      por_motivo: porMotivo.rows,
      por_responsable: porResponsable.rows,
      por_categoria: porCategoria.rows,
      por_periodo: porPeriodo.rows.map((fila: any) => ({
        ...fila,
        registros: Number(fila.registros),
        cantidad_total: Number(fila.cantidad_total),
        costo_total: Number(fila.costo_total),
      })),
      detalle: detalle.rows,
      catalogos: {
        categorias: categoriasCatalogo.rows.map((fila: any) => fila.categoria),
        responsables: responsablesCatalogo.rows,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /inventario/historial (HU-16)
// Historial consolidado: une en una sola línea de tiempo los ingresos (lote), las mermas (merma) y las salidas
// por comanda, manuales y anulaciones (movimiento); las de comanda se cruzan con ingrediente_receta para saber qué plato las originó.
// saldo_lote se calcula sobre todo el historial del lote antes de aplicar los filtros.
const TIPOS_HISTORIAL = ['INGRESO', 'MERMA', 'SALIDA_COMANDA', 'SALIDA_MANUAL', 'ANULACION'];
const LIMITE_HISTORIAL = { defecto: 100, maximo: 500 };

const HISTORIAL_CTE = `
  WITH eventos AS (
    SELECT 'INGRESO' AS tipo, l.fecha_recepcion AS fecha, l.id AS lote_id, l.cantidad_inicial AS cantidad,
           l.cantidad_inicial AS variacion, ing.id_usuario, 1 AS orden, l.id AS origen_id,
           json_build_object('fecha_vencimiento', l.fecha_vencimiento::text) AS detalle
    FROM lote l
    LEFT JOIN LATERAL (
      SELECT id_usuario FROM movimiento WHERE id_lote = l.id AND tipo = 'INGRESO' ORDER BY id LIMIT 1
    ) ing ON true

    UNION ALL

    SELECT 'MERMA', m.fecha, m.id_lote, m.cantidad, -m.cantidad, m.id_usuario, 2, m.id,
           json_build_object('motivo', m.motivo)
    FROM merma m

    UNION ALL

    SELECT mv.tipo, mv.fecha, mv.id_lote, mv.cantidad, -mv.cantidad, mv.id_usuario, 3, mv.id,
           CASE WHEN mv.tipo = 'ANULACION' THEN json_build_object('motivo', lm.motivo_anulacion)
                WHEN mv.tipo = 'SALIDA_MANUAL' THEN json_build_object('motivo', mv.motivo)
                WHEN r.id IS NULL THEN NULL ELSE json_build_object(
             'receta_id', r.id,
             'nombre_plato', r.nombre_plato,
             'cantidad_por_plato', ir.cantidad_requerida,
             'unidad_medida', ir.unidad_medida,
             'platos_equivalentes', ROUND(mv.cantidad / NULLIF(ir.cantidad_requerida, 0), 2)
           ) END
    FROM movimiento mv
    JOIN lote lm ON lm.id = mv.id_lote
    LEFT JOIN receta r ON r.id = mv.id_receta
    LEFT JOIN ingrediente_receta ir ON ir.id_receta = mv.id_receta AND ir.id_producto = lm.id_producto
    WHERE mv.tipo <> 'INGRESO'
  ),
  con_saldo AS (
    SELECT e.*,
           SUM(e.variacion) OVER (PARTITION BY e.lote_id ORDER BY e.fecha, e.orden, e.origen_id) AS saldo_lote
    FROM eventos e
  ),
  filtrado AS (
    SELECT cs.*, l.numero_lote, l.id_producto, p.nombre AS producto, u.nombre AS usuario
    FROM con_saldo cs
    JOIN lote l ON l.id = cs.lote_id
    JOIN producto p ON p.id = l.id_producto
    LEFT JOIN usuario u ON u.id = cs.id_usuario
    WHERE cs.fecha >= (($1::date)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC'
      AND cs.fecha < (($2::date + 1)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC'
      AND ($3::text IS NULL OR cs.tipo = $3)
      AND ($4::int IS NULL OR l.id_producto = $4)
  )
`;

app.get('/inventario/historial', soloAdministrador, async (c) => {
  const desdeParam = c.req.query('desde');
  const hastaParam = c.req.query('hasta');
  for (const [nombre, valor] of [['desde', desdeParam], ['hasta', hastaParam]]) {
    if (valor !== undefined && !esFechaValida(valor)) {
      return c.json({ success: false, error: `${nombre} debe ser una fecha válida con formato YYYY-MM-DD` }, 400);
    }
  }

  const tipo = c.req.query('tipo')?.toUpperCase() ?? null;
  if (tipo !== null && !TIPOS_HISTORIAL.includes(tipo)) {
    return c.json({ success: false, error: `tipo inválido. Valores permitidos: ${TIPOS_HISTORIAL.join(', ')}` }, 400);
  }

  const productoParam = c.req.query('producto_id');
  const productoId = productoParam === undefined ? null : Number(productoParam);
  if (productoId !== null && (!Number.isInteger(productoId) || productoId <= 0)) {
    return c.json({ success: false, error: 'producto_id debe ser un número entero válido' }, 400);
  }

  const limite = Number(c.req.query('limite') ?? LIMITE_HISTORIAL.defecto);
  const pagina = Number(c.req.query('pagina') ?? 1);
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_HISTORIAL.maximo) {
    return c.json({ success: false, error: `limite debe ser un entero entre 1 y ${LIMITE_HISTORIAL.maximo}` }, 400);
  }
  if (!Number.isInteger(pagina) || pagina < 1) {
    return c.json({ success: false, error: 'pagina debe ser un entero mayor o igual a 1' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);

    const rango = await sql.query(
      `
        SELECT COALESCE($2::date, ${HOY_CHILE_SQL})::text AS hasta,
               COALESCE($1::date, COALESCE($2::date, ${HOY_CHILE_SQL}) - 29)::text AS desde
      `,
      [desdeParam ?? null, hastaParam ?? null]
    );
    const { desde, hasta } = rango.rows[0];
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
    if (dias < 0) {
      return c.json({ success: false, error: 'desde no puede ser posterior a hasta' }, 400);
    }
    if (dias >= RANGO_MAXIMO_DIAS) {
      return c.json({ success: false, error: `El rango no puede superar ${RANGO_MAXIMO_DIAS} días` }, 400);
    }

    const filtros = [desde, hasta, tipo, productoId];
    const [movimientos, resumen] = await Promise.all([
      sql.query(
        `
          ${HISTORIAL_CTE}
          SELECT to_char(f.fecha, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha,
                 f.tipo,
                 f.id_producto AS producto_id, f.producto,
                 f.lote_id, f.numero_lote,
                 f.cantidad,
                 f.variacion,
                 f.saldo_lote,
                 f.usuario,
                 f.detalle
          FROM filtrado f
          ORDER BY f.fecha DESC, f.orden DESC, f.origen_id DESC
          LIMIT $5 OFFSET $6
        `,
        [...filtros, limite, (pagina - 1) * limite]
      ),
      sql.query(
        `
          ${HISTORIAL_CTE}
          SELECT f.tipo, COUNT(*)::int AS movimientos, SUM(f.cantidad) AS cantidad_total
          FROM filtrado f
          GROUP BY f.tipo
          ORDER BY f.tipo
        `,
        filtros
      ),
    ]);

    const total = resumen.rows.reduce((suma: number, fila: any) => suma + fila.movimientos, 0);

    return c.json({
      success: true,
      filtros: { desde, hasta, tipo, producto_id: productoId },
      paginacion: { pagina, limite, total, total_paginas: Math.ceil(total / limite) },
      resumen: resumen.rows,
      data: movimientos.rows,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /inventario/reporte?desde&hasta&categoria&producto_id&formato=json|csv (HU-16)
// Balance por producto en el período: stock inicial + entradas - salidas (manuales y comandas) - mermas - anulaciones
// = stock final. Se calcula con los mismos eventos del historial (lote, merma y movimiento). Si el período llega
// hasta hoy, el stock final también se compara con producto.stock_actual.
const COLUMNAS_REPORTE = [
  ['sku', 'SKU'], ['producto', 'Producto'], ['categoria', 'Categoría'], ['stock_inicial', 'Stock inicial'],
  ['entradas', 'Entradas'], ['salidas_manuales', 'Salidas manuales'], ['salidas_comanda', 'Salidas por comanda'],
  ['mermas', 'Mermas'], ['anulaciones', 'Anulaciones'], ['stock_final', 'Stock final'], ['rotacion', 'Rotación'],
] as const;
const CAMPOS_BALANCE = ['stock_inicial', 'entradas', 'salidas_manuales', 'salidas_comanda', 'mermas', 'anulaciones', 'stock_final'] as const;

// CSV para Excel en español: separador ";", coma decimal y BOM UTF-8. Los textos que empiezan con =, +, - o @
// se anteponen con ' para que Excel no los ejecute como fórmula.
const celdaCsv = (valor: unknown, numerica: boolean) => {
  if (valor === null || valor === undefined) return '';
  if (numerica) return String(valor).replace('.', ',');
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

app.get('/inventario/reporte', soloAdministrador, async (c) => {
  const desdeParam = c.req.query('desde');
  const hastaParam = c.req.query('hasta');
  for (const [nombre, valor] of [['desde', desdeParam], ['hasta', hastaParam]]) {
    if (valor !== undefined && !esFechaValida(valor)) {
      return c.json({ success: false, error: `${nombre} debe ser una fecha válida con formato YYYY-MM-DD` }, 400);
    }
  }
  const formato = (c.req.query('formato') ?? 'json').toLowerCase();
  if (formato !== 'json' && formato !== 'csv') {
    return c.json({ success: false, error: 'formato inválido. Valores permitidos: json, csv' }, 400);
  }
  const categoria = c.req.query('categoria')?.trim() || null;
  if (categoria !== null && categoria.length > LARGO_MAXIMO_CATEGORIA) {
    return c.json({ success: false, error: `categoria admite hasta ${LARGO_MAXIMO_CATEGORIA} caracteres` }, 400);
  }
  const productoParam = c.req.query('producto_id');
  const productoId = productoParam === undefined ? null : Number(productoParam);
  if (productoId !== null && (!/^\d+$/.test(productoParam!) || !Number.isSafeInteger(productoId) || productoId <= 0)) {
    return c.json({ success: false, error: 'producto_id debe ser un número entero válido' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);

    const rango = await sql.query(
      `
        SELECT COALESCE($2::date, ${HOY_CHILE_SQL})::text AS hasta,
               COALESCE($1::date, COALESCE($2::date, ${HOY_CHILE_SQL}) - 29)::text AS desde,
               COALESCE($2::date, ${HOY_CHILE_SQL}) >= ${HOY_CHILE_SQL} AS incluye_hoy
      `,
      [desdeParam ?? null, hastaParam ?? null]
    );
    const { desde, hasta, incluye_hoy } = rango.rows[0];
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
    if (dias < 0) {
      return c.json({ success: false, error: 'desde no puede ser posterior a hasta' }, 400);
    }
    if (dias >= RANGO_MAXIMO_DIAS) {
      return c.json({ success: false, error: `El rango no puede superar ${RANGO_MAXIMO_DIAS} días` }, 400);
    }

    const result = await sql.query(
      `
        WITH eventos AS (
          SELECT l.id_producto, l.fecha_recepcion AS fecha, 'INGRESO' AS tipo, l.cantidad_inicial AS cantidad FROM lote l
          UNION ALL
          SELECT l.id_producto, m.fecha, 'MERMA', m.cantidad FROM merma m JOIN lote l ON l.id = m.id_lote
          UNION ALL
          SELECT l.id_producto, mv.fecha, mv.tipo, mv.cantidad FROM movimiento mv JOIN lote l ON l.id = mv.id_lote
          WHERE mv.tipo <> 'INGRESO'
        ),
        limites AS (
          SELECT (($1::date)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC' AS inicio,
                 (($2::date + 1)::timestamp AT TIME ZONE 'America/Santiago') AT TIME ZONE 'UTC' AS fin
        ),
        balance AS (
          SELECT e.id_producto,
                 SUM(CASE WHEN e.tipo = 'INGRESO' THEN e.cantidad ELSE -e.cantidad END) FILTER (WHERE e.fecha < li.inicio) AS stock_inicial,
                 SUM(e.cantidad) FILTER (WHERE e.tipo = 'INGRESO' AND e.fecha >= li.inicio AND e.fecha < li.fin) AS entradas,
                 SUM(e.cantidad) FILTER (WHERE e.tipo = 'SALIDA_MANUAL' AND e.fecha >= li.inicio AND e.fecha < li.fin) AS salidas_manuales,
                 SUM(e.cantidad) FILTER (WHERE e.tipo = 'SALIDA_COMANDA' AND e.fecha >= li.inicio AND e.fecha < li.fin) AS salidas_comanda,
                 SUM(e.cantidad) FILTER (WHERE e.tipo = 'MERMA' AND e.fecha >= li.inicio AND e.fecha < li.fin) AS mermas,
                 SUM(e.cantidad) FILTER (WHERE e.tipo = 'ANULACION' AND e.fecha >= li.inicio AND e.fecha < li.fin) AS anulaciones,
                 SUM(CASE WHEN e.tipo = 'INGRESO' THEN e.cantidad ELSE -e.cantidad END) FILTER (WHERE e.fecha < li.fin) AS stock_final
          FROM eventos e CROSS JOIN limites li
          GROUP BY e.id_producto
        ),
        reporte AS (
          SELECT p.id AS producto_id, p.sku, p.nombre AS producto, p.categoria,
                 COALESCE(b.stock_inicial, 0) AS stock_inicial, COALESCE(b.entradas, 0) AS entradas,
                 COALESCE(b.salidas_manuales, 0) AS salidas_manuales, COALESCE(b.salidas_comanda, 0) AS salidas_comanda,
                 COALESCE(b.mermas, 0) AS mermas, COALESCE(b.anulaciones, 0) AS anulaciones,
                 COALESCE(b.stock_final, 0) AS stock_final, COALESCE(p.stock_actual, 0) AS stock_actual
          FROM producto p
          LEFT JOIN balance b ON b.id_producto = p.id
          WHERE ($3::text IS NULL OR LOWER(p.categoria) = LOWER($3))
            AND ($4::int IS NULL OR p.id = $4)
        )
        SELECT r.*,
               ROUND((r.salidas_manuales + r.salidas_comanda) / NULLIF((r.stock_inicial + r.stock_final) / 2, 0), 2) AS rotacion,
               r.stock_inicial + r.entradas - r.salidas_manuales - r.salidas_comanda - r.mermas - r.anulaciones = r.stock_final AS cuadra_movimientos,
               CASE WHEN $5::boolean THEN r.stock_final = r.stock_actual END AS cuadra_stock_actual
        FROM reporte r
        ORDER BY r.producto, r.producto_id
      `,
      [desde, hasta, categoria, productoId, incluye_hoy]
    );

    if (productoId !== null && result.rowCount === 0) {
      return c.json({ success: false, error: 'Producto no encontrado' }, 404);
    }

    // Totales en centésimas para no acumular errores de punto flotante (las cantidades son NUMERIC con 2 decimales)
    const totales = Object.fromEntries(CAMPOS_BALANCE.map((campo) => [
      campo,
      (result.rows.reduce((suma: number, fila: any) => suma + Math.round(Number(fila[campo]) * 100), 0) / 100).toFixed(2),
    ]));
    const cuadre = {
      productos: result.rowCount,
      cuadran_movimientos: result.rows.filter((f: any) => f.cuadra_movimientos).length,
      cuadran_stock_actual: incluye_hoy ? result.rows.filter((f: any) => f.cuadra_stock_actual).length : null,
    };

    if (formato === 'csv') {
      const numericas = new Set<string>([...CAMPOS_BALANCE, 'rotacion']);
      const lineas = [
        COLUMNAS_REPORTE.map(([, titulo]) => titulo).join(';'),
        ...result.rows.map((fila: any) => COLUMNAS_REPORTE.map(([campo]) => celdaCsv(fila[campo], numericas.has(campo))).join(';')),
        COLUMNAS_REPORTE.map(([campo]) => campo === 'sku' ? 'TOTAL' : celdaCsv((totales as any)[campo] ?? '', numericas.has(campo))).join(';'),
      ];
      return new Response('\uFEFF' + lineas.join('\r\n') + '\r\n', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="reporte_inventario_${desde}_${hasta}.csv"`,
        },
      });
    }

    return c.json({
      success: true,
      filtros: { desde, hasta, categoria, producto_id: productoId },
      totales,
      cuadre,
      data: result.rows,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET / PUT /configuraciones (HU-18)
// Variables globales del sistema en configuraciones_globales. El PUT actualiza varias claves en una sola
// transacción: si una falla la validación no se guarda ninguna (así se puede mover rojo y amarillo a la vez).
const MAX_CLAVES_POR_PUT = 20;
const COLUMNAS_CONFIGURACION = `clave, valor, tipo, valor_minimo, valor_maximo, descripcion,
  to_char(fecha_actualizacion, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fecha_actualizacion, id_usuario_actualizacion`;

const validarValorConfiguracion = (config: any, valor: unknown): string | null => {
  switch (config.tipo) {
    case 'entero':
    case 'decimal': {
      if (typeof valor !== 'number' || !Number.isFinite(valor)) return 'debe ser un número';
      if (config.tipo === 'entero' && !Number.isInteger(valor)) return 'debe ser un número entero';
      if (config.valor_minimo !== null && valor < Number(config.valor_minimo)) return `debe ser mayor o igual a ${Number(config.valor_minimo)}`;
      if (config.valor_maximo !== null && valor > Number(config.valor_maximo)) return `debe ser menor o igual a ${Number(config.valor_maximo)}`;
      return null;
    }
    case 'booleano':
      return typeof valor === 'boolean' ? null : 'debe ser true o false';
    default:
      return typeof valor === 'string' && valor.trim() !== '' && valor.length <= 500 ? null : 'debe ser un texto no vacío de hasta 500 caracteres';
  }
};

app.get('/configuraciones', soloAdministrador, async (c) => {
  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(`SELECT ${COLUMNAS_CONFIGURACION} FROM configuraciones_globales ORDER BY clave`);
    return c.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.put('/configuraciones', soloAdministrador, async (c) => {
  const body = await c.req.json().catch(() => null);
  const usuario = c.get('usuario');

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ success: false, error: 'El cuerpo debe ser un objeto { clave: valor }' }, 400);
  }
  const claves = Object.keys(body);
  if (claves.length === 0) {
    return c.json({ success: false, error: 'Debe enviar al menos una configuración' }, 400);
  }
  if (claves.length > MAX_CLAVES_POR_PUT) {
    return c.json({ success: false, error: `No se pueden actualizar más de ${MAX_CLAVES_POR_PUT} configuraciones a la vez` }, 400);
  }

  const sql = getDb(c.env.DATABASE_URL);
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    // Se bloquean también los dos umbrales de vencimiento para validar su relación con los valores definitivos
    const actuales = await client.query(
      `SELECT ${COLUMNAS_CONFIGURACION} FROM configuraciones_globales
       WHERE clave = ANY($1) OR clave = ANY($2)
       ORDER BY clave
       FOR UPDATE`,
      [claves, Object.values(CLAVES_UMBRALES_VENCIMIENTO)]
    );
    const porClave = new Map(actuales.rows.map((fila: any) => [fila.clave, fila]));

    const desconocidas = claves.filter((clave) => !porClave.has(clave));
    if (desconocidas.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: `Configuración desconocida: ${desconocidas.map((x) => x.slice(0, 100)).join(', ')}` }, 400);
    }

    const errores = claves
      .map((clave) => ({ clave, error: validarValorConfiguracion(porClave.get(clave), body[clave]) }))
      .filter((x) => x.error !== null);
    if (errores.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Valores inválidos', detalle: errores.map((x) => `${x.clave} ${x.error}`) }, 400);
    }

    const valorFinal = (clave: string) => (clave in body ? Number(body[clave]) : Number(porClave.get(clave)?.valor));
    const rojo = valorFinal(CLAVES_UMBRALES_VENCIMIENTO.rojo);
    const amarillo = valorFinal(CLAVES_UMBRALES_VENCIMIENTO.amarillo);
    if (!(rojo < amarillo)) {
      await client.query('ROLLBACK');
      return c.json({
        success: false,
        error: `Valores inconsistentes: la alerta roja (${rojo} días) debe ser menor que la alerta amarilla (${amarillo} días)`,
      }, 400);
    }

    const actualizadas = [];
    for (const clave of claves) {
      const result = await client.query(
        `UPDATE configuraciones_globales
         SET valor = $2, fecha_actualizacion = NOW(), id_usuario_actualizacion = $3
         WHERE clave = $1
         RETURNING ${COLUMNAS_CONFIGURACION}`,
        [clave, String(body[clave]), usuario.id]
      );
      actualizadas.push({ ...result.rows[0], valor_anterior: porClave.get(clave).valor });
    }

    await client.query('COMMIT');
    return c.json({ success: true, message: 'Configuraciones actualizadas exitosamente', data: actualizadas });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    // 23514 = check_violation: el CHECK de la tabla rechazó el valor
    if (error.code === '23514') {
      return c.json({ success: false, error: 'El valor no cumple las restricciones de la configuración' }, 400);
    }
    if (error.code === '23503') {
      return c.json({ success: false, error: 'Usuario no válido' }, 401);
    }
    return c.json({ success: false, error: error.message }, 500);
  } finally {
    client.release();
  }
});

export default app;
