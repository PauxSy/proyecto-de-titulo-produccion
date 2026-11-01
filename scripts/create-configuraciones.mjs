import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-18: una fila por variable del sistema. El valor se guarda como texto y los CHECK validan
  // su formato y rango según el tipo, aunque se modifique fuera de la API.
  await p.query(`
    CREATE TABLE IF NOT EXISTS configuraciones_globales (
      clave VARCHAR(100) PRIMARY KEY CHECK (clave ~ '^[a-z0-9_]+$'),
      valor TEXT NOT NULL,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entero', 'decimal', 'booleano', 'texto')),
      valor_minimo NUMERIC,
      valor_maximo NUMERIC,
      descripcion TEXT NOT NULL,
      fecha_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      id_usuario_actualizacion INTEGER REFERENCES usuario(id),
      CONSTRAINT configuraciones_rango_coherente CHECK (valor_minimo IS NULL OR valor_maximo IS NULL OR valor_minimo <= valor_maximo),
      CONSTRAINT configuraciones_valor_valido CHECK (
        CASE
          WHEN tipo = 'entero' AND valor !~ '^-?[0-9]+$' THEN false
          WHEN tipo = 'decimal' AND valor !~ '^-?[0-9]+(\\.[0-9]+)?$' THEN false
          WHEN tipo = 'booleano' THEN valor IN ('true', 'false')
          WHEN tipo IN ('entero', 'decimal') THEN
            (valor_minimo IS NULL OR valor::numeric >= valor_minimo) AND (valor_maximo IS NULL OR valor::numeric <= valor_maximo)
          ELSE true
        END
      )
    );
  `);

  // Valores iniciales = los que estaban fijos en el código (HU-09). No pisa valores ya configurados.
  await p.query(`
    INSERT INTO configuraciones_globales (clave, valor, tipo, valor_minimo, valor_maximo, descripcion) VALUES
      ('alerta_vencimiento_rojo_dias', '3', 'entero', 0, 365,
       'Días de anticipación para la alerta ROJA de vencimiento (lote vence en esta cantidad de días o menos)'),
      ('alerta_vencimiento_amarillo_dias', '7', 'entero', 1, 365,
       'Días de anticipación para la alerta AMARILLA de vencimiento (debe ser mayor que la alerta roja)')
    ON CONFLICT (clave) DO NOTHING;
  `);

  const filas = await p.query(`SELECT clave, valor, tipo, valor_minimo, valor_maximo FROM configuraciones_globales ORDER BY clave`);
  console.log('OK - configuraciones_globales:');
  console.table(filas.rows);

  const cons = await p.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'configuraciones_globales'
    ORDER BY conname
  `);
  console.table(cons.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
