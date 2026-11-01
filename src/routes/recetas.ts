import { Hono } from 'hono';
import { getDb } from '../db';
import { soloChefOAdministrador } from '../middlewares/auth';

type Env = {
  Bindings: { DATABASE_URL: string; JWT_SECRET: string };
  Variables: { usuario: { id: number; nombre: string; rol: string } };
};

// Router /recetas (HU-12): crear, consultar, modificar, desactivar y reactivar recetas con sus ingredientes.
// Reglas en la BD (scripts/create-recetas.mjs y scripts/add-receta-reglas.mjs): nombre único entre recetas activas,
// sin borrado físico y sin cambios de ingredientes una vez que la receta se usó en comandas.
const recetas = new Hono<Env>();
recetas.use('*', soloChefOAdministrador);

const UNIDADES = ['gr', 'ml', 'un'];
const REGEX_NOMBRE_PLATO = /^[\p{L}\p{N}\s'".,()&/-]{2,150}$/u;
const REGEX_RUBRO = /^[\p{L}\p{N}\s'.,()&/-]{2,100}$/u;
const LIMITES = { porcionesMaximo: 1000, ingredientesMaximo: 50, cantidadMaxima: 100000, busquedaMaxima: 100 };

const ERRORES = {
  nombre_plato: 'nombre_plato debe tener entre 2 y 150 caracteres (letras, números, espacios y puntuación básica)',
  rubro: 'rubro debe tener entre 2 y 100 caracteres (letras, números, espacios y puntuación básica)',
  porciones: `porciones debe ser un número entero entre 1 y ${LIMITES.porcionesMaximo}`,
  ingredientes: `ingredientes debe ser una lista de 1 a ${LIMITES.ingredientesMaximo} elementos { producto_id, cantidad_requerida, unidad_medida }`,
  nombre_duplicado: 'Ya existe una receta activa con ese nombre',
};

const leerId = (valor: string) => (/^\d{1,9}$/.test(valor) && Number(valor) > 0 ? Number(valor) : null);

type Ingrediente = { producto_id: number; cantidad_requerida: number; unidad_medida: string };

// Devuelve la lista normalizada o el mensaje de error del primer ingrediente inválido
const validarIngredientes = (valor: unknown): Ingrediente[] | string => {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > LIMITES.ingredientesMaximo) {
    return ERRORES.ingredientes;
  }
  const vistos = new Set<number>();
  const lista: Ingrediente[] = [];
  for (const [i, ing] of valor.entries()) {
    const n = i + 1;
    if (typeof ing !== 'object' || ing === null) return `El ingrediente ${n} debe ser un objeto`;
    const { producto_id, cantidad_requerida, unidad_medida } = ing as Record<string, unknown>;
    if (typeof producto_id !== 'number' || !Number.isInteger(producto_id) || producto_id <= 0) {
      return `El ingrediente ${n}: producto_id debe ser un número entero válido`;
    }
    if (typeof cantidad_requerida !== 'number' || !Number.isFinite(cantidad_requerida)
        || cantidad_requerida <= 0 || cantidad_requerida > LIMITES.cantidadMaxima) {
      return `El ingrediente ${n}: cantidad_requerida debe ser un número mayor a 0 y hasta ${LIMITES.cantidadMaxima}`;
    }
    if (typeof unidad_medida !== 'string' || !UNIDADES.includes(unidad_medida)) {
      return `El ingrediente ${n}: unidad_medida debe ser una de: ${UNIDADES.join(', ')}`;
    }
    if (vistos.has(producto_id)) return `El producto ${producto_id} está repetido en los ingredientes`;
    vistos.add(producto_id);
    lista.push({ producto_id, cantidad_requerida, unidad_medida });
  }
  return lista;
};

// Valida los campos de texto/número presentes en el body; `obligatorios` exige los tres (POST)
const validarDatos = (body: Record<string, unknown>, obligatorios: boolean) => {
  const datos: { nombre_plato?: string; rubro?: string; porciones?: number } = {};
  for (const campo of ['nombre_plato', 'rubro'] as const) {
    if (body[campo] === undefined) {
      if (obligatorios) return { error: ERRORES[campo] };
      continue;
    }
    const valor = typeof body[campo] === 'string' ? (body[campo] as string).trim().replace(/\s+/g, ' ') : '';
    if (!(campo === 'nombre_plato' ? REGEX_NOMBRE_PLATO : REGEX_RUBRO).test(valor)) return { error: ERRORES[campo] };
    datos[campo] = valor;
  }
  if (body.porciones === undefined) {
    if (obligatorios) return { error: ERRORES.porciones };
  } else {
    const p = body.porciones;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > LIMITES.porcionesMaximo) return { error: ERRORES.porciones };
    datos.porciones = p;
  }
  return { datos };
};

const productosInexistentes = async (client: any, ingredientes: Ingrediente[]) => {
  const ids = ingredientes.map((i) => i.producto_id);
  const result = await client.query('SELECT id FROM producto WHERE id = ANY($1::int[])', [ids]);
  const existentes = new Set(result.rows.map((r: { id: number }) => r.id));
  return ids.filter((id) => !existentes.has(id));
};

const insertarIngredientes = (client: any, recetaId: number, ingredientes: Ingrediente[]) =>
  client.query(
    `
      INSERT INTO ingrediente_receta (id_receta, id_producto, cantidad_requerida, unidad_medida)
      SELECT $1, t.id_producto, t.cantidad, t.unidad
      FROM unnest($2::int[], $3::numeric[], $4::varchar[]) AS t(id_producto, cantidad, unidad)
    `,
    [recetaId, ingredientes.map((i) => i.producto_id), ingredientes.map((i) => i.cantidad_requerida), ingredientes.map((i) => i.unidad_medida)]
  );

// Ficha técnica (HU-12 / HU-14): datos de la receta, ingredientes con su producto y stock, y si ya se usó en comandas
const obtenerFicha = async (db: any, id: number) => {
  const receta = await db.query(
    `
      SELECT r.id, r.nombre_plato, r.porciones, r.rubro, r.estado,
             (SELECT COUNT(*)::int FROM movimiento WHERE id_receta = r.id) AS salidas_por_comanda
      FROM receta r WHERE r.id = $1
    `,
    [id]
  );
  if (receta.rowCount === 0) return null;
  const ingredientes = await db.query(
    `
      SELECT ir.id_producto AS producto_id, p.sku, p.nombre AS producto, ir.cantidad_requerida, ir.unidad_medida,
             p.stock_actual
      FROM ingrediente_receta ir
      JOIN producto p ON p.id = ir.id_producto
      WHERE ir.id_receta = $1
      ORDER BY p.nombre, ir.id_producto
    `,
    [id]
  );
  const r = receta.rows[0];
  return { ...r, usada_en_comandas: r.salidas_por_comanda > 0, ingredientes: ingredientes.rows };
};

const respuestaError = (c: any, error: any) => {
  // 23505 = unique_violation (receta_nombre_activo_unico); 23001 = trigger de ingredientes de receta usada
  if (error.code === '23505') return c.json({ success: false, error: ERRORES.nombre_duplicado }, 409);
  if (error.code === '23001' && error.constraint === 'ingrediente_receta_receta_usada') {
    return c.json({ success: false, error: error.message, restriccion: error.constraint }, 409);
  }
  return c.json({ success: false, error: error.message }, 500);
};

// GET /recetas?estado=activo|inactivo&q=texto
recetas.get('/', async (c) => {
  const estado = c.req.query('estado');
  const q = c.req.query('q')?.trim() ?? '';
  if (estado !== undefined && estado !== 'activo' && estado !== 'inactivo') {
    return c.json({ success: false, error: 'estado debe ser activo o inactivo' }, 400);
  }
  if (q.length > LIMITES.busquedaMaxima) {
    return c.json({ success: false, error: `La búsqueda admite hasta ${LIMITES.busquedaMaxima} caracteres` }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    // Los comodines de LIKE que escriba el usuario se buscan literalmente
    const patron = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const result = await sql.query(
      `
        SELECT r.id, r.nombre_plato, r.porciones, r.rubro, r.estado,
               (SELECT COUNT(*)::int FROM ingrediente_receta WHERE id_receta = r.id) AS ingredientes,
               EXISTS (SELECT 1 FROM movimiento WHERE id_receta = r.id) AS usada_en_comandas
        FROM receta r
        WHERE ($1::text IS NULL OR r.estado = $1)
          AND ($2::text IS NULL OR r.nombre_plato ILIKE $2 ESCAPE '\\')
        ORDER BY r.nombre_plato, r.id
      `,
      [estado ?? null, patron]
    );
    return c.json({ success: true, total: result.rowCount, data: result.rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// GET /recetas/:id — ficha técnica
recetas.get('/:id', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id de la receta debe ser un número entero válido' }, 400);
  }
  try {
    const ficha = await obtenerFicha(getDb(c.env.DATABASE_URL), id);
    if (!ficha) return c.json({ success: false, error: 'Receta no encontrada' }, 404);
    return c.json({ success: true, data: ficha });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// POST /recetas — crea la receta y sus ingredientes en una sola transacción
recetas.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { datos, error } = validarDatos(body ?? {}, true);
  if (error) return c.json({ success: false, error }, 400);
  const ingredientes = validarIngredientes(body?.ingredientes);
  if (typeof ingredientes === 'string') return c.json({ success: false, error: ingredientes }, 400);

  const client = await getDb(c.env.DATABASE_URL).connect();
  try {
    await client.query('BEGIN');

    const faltantes = await productosInexistentes(client, ingredientes);
    if (faltantes.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: `Productos no encontrados: ${faltantes.join(', ')}` }, 400);
    }

    const creada = await client.query(
      `INSERT INTO receta (nombre_plato, porciones, rubro) VALUES ($1, $2, $3) RETURNING id`,
      [datos!.nombre_plato, datos!.porciones, datos!.rubro]
    );
    const id = creada.rows[0].id;
    await insertarIngredientes(client, id, ingredientes);
    const ficha = await obtenerFicha(client, id);

    await client.query('COMMIT');
    return c.json({ success: true, message: 'Receta creada exitosamente', data: ficha }, 201);
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return respuestaError(c, error);
  } finally {
    client.release();
  }
});

// PUT /recetas/:id — modifica nombre_plato, porciones, rubro y/o reemplaza la lista completa de ingredientes
recetas.put('/:id', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id de la receta debe ser un número entero válido' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const { datos, error } = validarDatos(body ?? {}, false);
  if (error) return c.json({ success: false, error }, 400);
  const cambiaIngredientes = body?.ingredientes !== undefined;
  const ingredientes = cambiaIngredientes ? validarIngredientes(body.ingredientes) : [];
  if (typeof ingredientes === 'string') return c.json({ success: false, error: ingredientes }, 400);
  if (Object.keys(datos!).length === 0 && !cambiaIngredientes) {
    return c.json({ success: false, error: 'Debe enviar al menos un campo: nombre_plato, porciones, rubro o ingredientes' }, 400);
  }

  const client = await getDb(c.env.DATABASE_URL).connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE espera a las comandas en curso (toman la receta con FOR SHARE) antes de revisar si ya se usó
    const actual = await client.query('SELECT id FROM receta WHERE id = $1 FOR UPDATE', [id]);
    if (actual.rowCount === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, error: 'Receta no encontrada' }, 404);
    }

    if (cambiaIngredientes) {
      const usos = await client.query('SELECT COUNT(*)::int AS total FROM movimiento WHERE id_receta = $1', [id]);
      if (usos.rows[0].total > 0) {
        await client.query('ROLLBACK');
        return c.json({
          success: false,
          error: 'La receta ya se usó en comandas: solo se pueden modificar nombre_plato, porciones y rubro. Para cambiar los ingredientes cree una receta nueva y desactive esta.',
          salidas_por_comanda: usos.rows[0].total,
        }, 409);
      }
      const faltantes = await productosInexistentes(client, ingredientes);
      if (faltantes.length > 0) {
        await client.query('ROLLBACK');
        return c.json({ success: false, error: `Productos no encontrados: ${faltantes.join(', ')}` }, 400);
      }
    }

    await client.query(
      `
        UPDATE receta
        SET nombre_plato = COALESCE($2, nombre_plato),
            porciones = COALESCE($3, porciones),
            rubro = COALESCE($4, rubro)
        WHERE id = $1
      `,
      [id, datos!.nombre_plato ?? null, datos!.porciones ?? null, datos!.rubro ?? null]
    );
    if (cambiaIngredientes) {
      await client.query('DELETE FROM ingrediente_receta WHERE id_receta = $1', [id]);
      await insertarIngredientes(client, id, ingredientes);
    }
    const ficha = await obtenerFicha(client, id);

    await client.query('COMMIT');
    return c.json({
      success: true,
      message: 'Receta actualizada exitosamente',
      campos_actualizados: [...Object.keys(datos!), ...(cambiaIngredientes ? ['ingredientes'] : [])],
      data: ficha,
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return respuestaError(c, error);
  } finally {
    client.release();
  }
});

// PATCH /recetas/:id/desactivar
// Baja lógica: la receta pasa a estado 'inactivo' y conserva sus ingredientes para el historial.
// El borrado físico lo impide la BD (ingrediente_receta.id_receta ON DELETE RESTRICT).
recetas.patch('/:id/desactivar', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id de la receta debe ser un número entero válido' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(
      `
        UPDATE receta
        SET estado = 'inactivo'
        WHERE id = $1 AND estado = 'activo'
        RETURNING id, nombre_plato, porciones, rubro, estado,
                  (SELECT COUNT(*)::int FROM ingrediente_receta WHERE id_receta = receta.id) AS ingredientes
      `,
      [id]
    );

    if (result.rowCount === 0) {
      const existe = await sql.query('SELECT estado FROM receta WHERE id = $1', [id]);
      if (existe.rowCount === 0) {
        return c.json({ success: false, error: 'Receta no encontrada' }, 404);
      }
      return c.json({ success: false, error: 'La receta ya está inactiva' }, 409);
    }

    return c.json({
      success: true,
      message: 'Receta desactivada (baja lógica)',
      data: result.rows[0],
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// PATCH /recetas/:id/activar — si otra receta activa ya usa el nombre, el índice único lo rechaza (409)
recetas.patch('/:id/activar', async (c) => {
  const id = leerId(c.req.param('id'));
  if (id === null) {
    return c.json({ success: false, error: 'El id de la receta debe ser un número entero válido' }, 400);
  }

  try {
    const sql = getDb(c.env.DATABASE_URL);
    const result = await sql.query(
      `UPDATE receta SET estado = 'activo' WHERE id = $1 AND estado = 'inactivo' RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      const existe = await sql.query('SELECT estado FROM receta WHERE id = $1', [id]);
      if (existe.rowCount === 0) {
        return c.json({ success: false, error: 'Receta no encontrada' }, 404);
      }
      return c.json({ success: false, error: 'La receta ya está activa' }, 409);
    }
    return c.json({ success: true, message: 'Receta reactivada', data: await obtenerFicha(sql, id) });
  } catch (error: any) {
    return respuestaError(c, error);
  }
});

export default recetas;
