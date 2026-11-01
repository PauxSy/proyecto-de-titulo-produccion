import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

// HU-02 / HU-03 y HU-09 leen los mismos lotes: el stock del producto es la suma de
// sus lotes activos, y el semáforo de vencimiento sale de la fecha de cada lote.
// Esta carga deja ejemplos de los cuatro estados de stock y de las tres franjas
// de vencimiento (rojo <= 3 días, amarillo <= 7, verde el resto), sin romper esa suma.
// Se puede volver a ejecutar: cada lote queda en un valor absoluto, no en un delta.

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const pool = new Pool({ connectionString: url });
const client = await pool.connect();

const lotes = [
  // producto 102 Harina tradicional — crítico, tres lotes con distinto horizonte
  { loteId: 1, productoId: 102, stock: null, vence: '2026-09-28' },
  { loteId: 104, productoId: 102, stock: null, vence: '2026-10-05' },
  { loteId: 231, productoId: 102, stock: null, vence: '2026-10-09' },

  // críticos (stock <= mínimo) y por vencer o ya vencidos
  { loteId: 106, productoId: 104, stock: null, vence: '2026-10-04' },
  { loteId: 118, productoId: 116, stock: 18, vence: '2026-10-06' },
  { loteId: 126, productoId: 124, stock: 25, vence: '2026-10-04' },
  { loteId: 142, productoId: 140, stock: 6, vence: '2026-10-01' },

  // advertencia cerca del mínimo
  { loteId: 107, productoId: 105, stock: 30, vence: '2026-10-08' },
  { loteId: 111, productoId: 109, stock: 18, vence: '2026-10-10' },
  { loteId: 130, productoId: 128, stock: 8, vence: '2026-12-31' },
  { loteId: 160, productoId: 158, stock: 9, vence: '2026-10-07' },

  // advertencia cerca del máximo
  { loteId: 115, productoId: 113, stock: 175, vence: '2026-10-09' },
  { loteId: 120, productoId: 118, stock: 195, vence: '2026-12-31' },
  { loteId: 192, productoId: 190, stock: 145, vence: '2026-12-31' },

  // sobrestock
  { loteId: 112, productoId: 110, stock: 95, vence: '2026-10-05' },
  { loteId: 184, productoId: 182, stock: 24, vence: '2026-12-31' },

  // stock normal, pero el lote sí entra en alerta de vencimiento
  { loteId: 119, productoId: 117, stock: null, vence: '2026-10-03' },
  { loteId: 143, productoId: 141, stock: null, vence: '2026-10-04' },
  { loteId: 124, productoId: 122, stock: null, vence: '2026-10-10' },
];

try {
  await client.query('BEGIN');
  await client.query('ALTER TABLE lote DISABLE TRIGGER lote_stock_igual_lotes_trg');
  await client.query('ALTER TABLE lote DISABLE TRIGGER lote_validar_fecha_vencimiento_trg');
  await client.query('ALTER TABLE producto DISABLE TRIGGER producto_stock_igual_lotes_trg');

  for (const item of lotes) {
    if (item.stock === null) {
      const soloFecha = await client.query(
        `UPDATE lote SET fecha_vencimiento = $2 WHERE id = $1 AND id_producto = $3 AND estado = 'ACTIVO' RETURNING id`,
        [item.loteId, item.vence, item.productoId]
      );
      if (soloFecha.rowCount !== 1) {
        throw new Error(`No se actualizó la fecha del lote ${item.loteId} del producto ${item.productoId}`);
      }
      continue;
    }

    const lote = await client.query(
      `UPDATE lote
       SET cantidad_disponible = $2,
           cantidad_inicial = GREATEST(cantidad_inicial, $2),
           fecha_vencimiento = $3
       WHERE id = $1 AND id_producto = $4 AND estado = 'ACTIVO'
       RETURNING id`,
      [item.loteId, item.stock, item.vence, item.productoId]
    );
    if (lote.rowCount !== 1) {
      throw new Error(`No se actualizó el lote ${item.loteId} del producto ${item.productoId}`);
    }

    await client.query(`UPDATE producto SET stock_actual = $2 WHERE id = $1`, [item.productoId, item.stock]);
  }

  const descuadre = await client.query(`
    SELECT p.id
    FROM producto p
    LEFT JOIN lote l ON l.id_producto = p.id AND l.estado = 'ACTIVO'
    GROUP BY p.id, p.stock_actual
    HAVING p.stock_actual <> COALESCE(SUM(l.cantidad_disponible), 0)
  `);
  if (descuadre.rowCount > 0) {
    throw new Error(`Stock distinto de la suma de lotes en productos: ${descuadre.rows.map((r) => r.id).join(', ')}`);
  }

  await client.query('ALTER TABLE lote ENABLE TRIGGER lote_stock_igual_lotes_trg');
  await client.query('ALTER TABLE lote ENABLE TRIGGER lote_validar_fecha_vencimiento_trg');
  await client.query('ALTER TABLE producto ENABLE TRIGGER producto_stock_igual_lotes_trg');
  await client.query('COMMIT');

  const estados = await client.query(`
    WITH cfg AS (
      SELECT valor::numeric / 100 AS margen
      FROM configuraciones_globales
      WHERE clave = 'margen_advertencia_stock_porcentaje'
    ),
    base AS (
      SELECT COALESCE(p.stock_actual, 0) AS stock, p.stock_minimo AS mn, p.stock_maximo AS mx,
             p.stock_minimo + (p.stock_maximo - p.stock_minimo) * cfg.margen AS lim_min,
             p.stock_maximo - (p.stock_maximo - p.stock_minimo) * cfg.margen AS lim_max
      FROM producto p CROSS JOIN cfg
    )
    SELECT CASE
             WHEN stock <= mn THEN 'Critico'
             WHEN stock >= mx THEN 'Sobrestock'
             WHEN stock <= lim_min OR stock >= lim_max THEN 'Advertencia'
             ELSE 'Normal'
           END AS estado,
           COUNT(*)::int AS n
    FROM base
    GROUP BY 1
    ORDER BY 1
  `);

  const vencimientos = await client.query(`
    SELECT CASE
             WHEN (l.fecha_vencimiento - (NOW() AT TIME ZONE 'America/Santiago')::date) <= 3 THEN 'ROJO'
             WHEN (l.fecha_vencimiento - (NOW() AT TIME ZONE 'America/Santiago')::date) <= 7 THEN 'AMARILLO'
             ELSE 'VERDE'
           END AS nivel,
           COUNT(*)::int AS n
    FROM lote l
    WHERE l.estado = 'ACTIVO' AND l.cantidad_disponible > 0
    GROUP BY 1
    ORDER BY 1
  `);

  console.log('Estados de stock (HU-02 / HU-03):');
  console.table(estados.rows);
  console.log('Vencimientos (HU-09):');
  console.table(vencimientos.rows);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
