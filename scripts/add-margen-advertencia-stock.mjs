import { Pool } from '@neondatabase/serverless';
import fs from 'fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const p = new Pool({ connectionString: url });

try {
  // HU-18: margen global del semáforo de stock (antes fijo en el código en 20 %). Es un porcentaje del rango
  // entre stock_minimo y stock_maximo; 0 desactiva el amarillo y el tope 49 evita que las dos franjas se crucen.
  // No pisa un valor ya configurado.
  await p.query(`
    INSERT INTO configuraciones_globales (clave, valor, tipo, valor_minimo, valor_maximo, descripcion) VALUES
      ('margen_advertencia_stock_porcentaje', '20', 'entero', 0, 49,
       'Porcentaje del rango entre stock mínimo y máximo que se marca AMARILLO cerca de cada umbral (0 desactiva el amarillo)')
    ON CONFLICT (clave) DO NOTHING;
  `);

  const filas = await p.query(`SELECT clave, valor, tipo, valor_minimo, valor_maximo FROM configuraciones_globales ORDER BY clave`);
  console.log('OK - configuraciones_globales:');
  console.table(filas.rows);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await p.end();
}
