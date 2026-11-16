// Arma una receta completa alrededor de lo que está por vencer.
// Los demás ingredientes salen del inventario aunque les quede más fecha.

export type InsumoCocina = {
  id?: string | number;
  producto: string;
  unidad_medida: string;
  cantidad_en_riesgo: number;
  dias_para_vencer: number | null;
  por_vencer: boolean;
  prioridad_rescate?: boolean;
};

export type IngredienteMedido = {
  producto: string;
  cantidad: number;
  unidad: string;
  inventario_id?: string;
  es_rescate?: boolean;
};

export type SugerenciaRescate = {
  tipo: 'receta';
  titulo: string;
  descripcion: string;
  tipo_plato?: 'Salado' | 'Dulce' | 'Agridulce';
  tiempo_minutos?: number;
  porciones?: number;
  implementos?: string[];
  insumos_usados: string[];
  ingredientes: IngredienteMedido[];
  pasos: string[];
};

type RolInsumo = 'aceite' | 'seco' | 'picable' | 'proteina' | 'lacteo' | 'otro';

const PREFERENCIA_CATEGORIA: Record<string, RegExp> = {
  'Repostería': /azucar|manjar|cacao|chocolate|harina|margarina|mantequilla|manteca|huevo|crema|leche|vainilla|fruta|nuez|almendra|dulce|maicena|miel|mermelada/,
  'Comida Italiana': /tomate|harina|queso|albahaca|pasta|cebolla|ajo|crema|oregano/,
  'Comida Rápida': /tomate|queso|pan|harina|carne|pollo|papa|lechuga|huevo/,
  'Comida Tailandesa': /aji|coco|limon|lima|arroz|pollo|pescado|cebolla|jengibre/,
  'Comida Chilena': /tomate|aji|cebolla|carne|pollo|papa|choclo|harina|huevo|poroto/,
  'Comida China': /arroz|pollo|carne|cebolla|ajo|jengibre|harina|soya|repollo/,
};

const CATEGORIAS_SALADAS = ['Comida Italiana', 'Comida Rápida', 'Comida Tailandesa', 'Comida Chilena', 'Comida China'];
// Frutas en almíbar / conserva cuentan como dulce: no entran a cazuelas, caldos ni platos salados.
const DULCES_FUERA_DE_REPOSTERIA = /cacao|chocolate|manjar|colorante|vainilla|mermelada|mazapan|confite|papaya|almibar|almíbar|fruta en conserva|durazno|pina en|piña en|cereza|compota|jalea/;

export const normalizarTexto = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const cortoInsumo = (nombre: string) =>
  nombre
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|lt|un)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

const textoDias = (dias: number) => {
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
};

const rolInsumo = (nombre: string): RolInsumo => {
  const texto = normalizarTexto(nombre);
  if (/aceite/.test(texto)) return 'aceite';
  if (/harina|azucar|arroz|fideo|pasta|maicena|pan rallado/.test(texto)) return 'seco';
  if (/tomate|cebolla|ajo|pimenton|pimiento|lechuga|repollo|apio|zanahoria|papa|choclo|aji|jengibre|albahaca|cilantro|champinon|brocoli|zapallo|pepino|palta|limon|lima/.test(texto)) return 'picable';
  if (/pollo|carne|cerdo|pescado|camaron|huevo|tofu|jamon/.test(texto)) return 'proteina';
  if (/leche|crema|queso|mantequilla|margarina|manteca|manjar|yogurt/.test(texto)) return 'lacteo';
  return 'otro';
};

export const encajaEnCategoria = (nombre: string, categoria: string) => {
  const texto = normalizarTexto(nombre);
  if (CATEGORIAS_SALADAS.includes(categoria) && DULCES_FUERA_DE_REPOSTERIA.test(texto)) return false;
  if (categoria === 'Repostería' && /soya|aji|jengibre|repollo|pescado/.test(texto) && !/limon/.test(texto)) return false;
  const preferencia = PREFERENCIA_CATEGORIA[categoria];
  if (preferencia?.test(texto)) return true;
  const rol = rolInsumo(nombre);
  if (CATEGORIAS_SALADAS.includes(categoria)) {
    return rol === 'picable' || rol === 'proteina' || /arroz|fideo|pasta|tomate|cebolla|ajo|aceite/.test(texto);
  }
  return rol !== 'aceite';
};

const formatearCantidad = (cantidad: number) =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(cantidad);

const ajustarAlDisponible = (cantidad: number, disponible: number, unidad: string) => {
  const tope = disponible > 0 ? Math.min(cantidad, disponible) : cantidad;
  if (!(tope > 0)) return 0;
  return unidad === 'un' || unidad === 'huevos' ? Math.max(1, Math.floor(tope)) : Math.round(tope * 10) / 10;
};

const porcionExacta = (item: InsumoCocina | undefined) => {
  const disponible = Number(item?.cantidad_en_riesgo);
  const unidadStock = typeof item?.unidad_medida === 'string' ? item.unidad_medida : 'un';
  if (!(disponible > 0)) return null;
  const nombre = normalizarTexto(String(item?.producto ?? ''));
  const rol = rolInsumo(nombre);
  if (rol === 'aceite') return { cantidad: 2, unidad: 'cucharadas' };
  if (/harina/.test(nombre)) return { cantidad: 150, unidad: 'g' };
  if (/azucar/.test(nombre)) return { cantidad: 40, unidad: 'g' };
  if (/arroz|fideo|pasta/.test(nombre)) return { cantidad: 80, unidad: 'g' };
  if (/maicena/.test(nombre)) return { cantidad: 15, unidad: 'g' };
  if (/huevo/.test(nombre)) return { cantidad: Math.min(2, Math.max(1, Math.floor(disponible))), unidad: 'huevos' };
  if (/mantequilla|margarina/.test(nombre)) return { cantidad: 40, unidad: 'g' };
  if (/(^|\s)sal fina|(^|\s)sal de mesa/.test(nombre)) return { cantidad: 1, unidad: 'cucharadita' };
  if (/leche/.test(nombre)) return { cantidad: 100, unidad: 'ml' };
  if (/esencia|vainilla/.test(nombre)) return { cantidad: 1, unidad: 'cucharadita' };
  if (/crema/.test(nombre) && !/queso crema|crema pastelera/.test(nombre)) return { cantidad: 200, unidad: 'ml' };
  if (/tomate/.test(nombre) && unidadStock === 'un') {
    return { cantidad: Math.min(3, Math.max(1, Math.floor(disponible))), unidad: 'unidades' };
  }
  if (/cacao|chocolate/.test(nombre)) return { cantidad: 30, unidad: 'g' };
  if (/arandano|frambuesa|pulpa|durazno|fruta/.test(nombre)) return { cantidad: 100, unidad: 'g' };
  if (unidadStock === 'un') return { cantidad: 1, unidad: 'un' };
  let objetivo = unidadStock === 'ml' ? 30 : 150;
  if (unidadStock === 'gr') {
    if (/margarina|mantequilla|manteca|manjar/.test(nombre)) objetivo = 40;
    else if (/cacao|chocolate/.test(nombre)) objetivo = 40;
    else if (/tomate/.test(nombre)) objetivo = 200;
  }
  return { cantidad: ajustarAlDisponible(objetivo, disponible, unidadStock), unidad: unidadStock };
};

const ingredientesMedidos = (nombres: string[], items: InsumoCocina[], pedidos?: Map<string, number>) =>
  nombres.map((nombre) => {
    const clave = normalizarTexto(nombre);
    const item = items.find((fila) => normalizarTexto(fila.producto) === clave);
    const base = porcionExacta(item);
    const unidadStock = item?.unidad_medida || 'un';
    const unidad = base?.unidad || unidadStock;
    const disponible = Number(item?.cantidad_en_riesgo);
    const pedida = pedidos?.get(clave);
    const tope = base?.cantidad ?? disponible;
    const pedidaEnLaMismaUnidad = pedida != null && pedida > 0 && unidad === unidadStock && pedida <= tope
      ? pedida
      : null;
    const preferida = pedidaEnLaMismaUnidad ?? (base?.cantidad ?? 0);
    const cantidad = unidad === unidadStock
      ? ajustarAlDisponible(preferida, disponible, unidad)
      : (preferida > 0 ? preferida : 0);
    if (!(cantidad > 0)) return null;
    return { producto: String(item?.producto || nombre), cantidad, unidad };
  }).filter((ing): ing is IngredienteMedido => ing !== null);

const textoInsumo = (ing: IngredienteMedido) =>
  `${formatearCantidad(ing.cantidad)} ${ing.unidad} de ${cortoInsumo(ing.producto)}`;

const unir = (nombres: string[]) => {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
};

const describirRescate = (categoria: string, ingredientes: IngredienteMedido[], items: InsumoCocina[]) => {
  const ficha = (nombre: string) => items.find((fila) => normalizarTexto(fila.producto) === normalizarTexto(nombre));
  const texto = (ing: IngredienteMedido) => {
    const item = ficha(ing.producto);
    const dias = Number(item?.dias_para_vencer);
    return item?.por_vencer === true && Number.isFinite(dias)
      ? `${textoInsumo(ing)} (vence ${textoDias(dias)})`
      : textoInsumo(ing);
  };
  const protagonistas = ingredientes.filter((ing) => ficha(ing.producto)?.por_vencer === true);
  const apoyo = ingredientes.filter((ing) => ficha(ing.producto)?.por_vencer !== true);
  const base = `Receta de ${categoria} para usar primero ${unir((protagonistas.length > 0 ? protagonistas : ingredientes).map(texto))}.`;
  if (apoyo.length === 0) return base;
  return `${base} Se completa con ${unir(apoyo.map(textoInsumo))}, aunque no estén por vencer.`;
};

const pasosConMedidas = (implementos: string, ingredientes: IngredienteMedido[], pasos: string[]) => [
  `Implementos: ${implementos}.`,
  `Mide y separa: ${ingredientes.map(textoInsumo).join('; ')}.`,
  ...pasos.filter((paso) => !paso.startsWith('Implementos:') && !paso.startsWith('Mide y separa:')),
];

const buscarInsumo = (fuente: InsumoCocina[], patron: RegExp) =>
  fuente.find((item) => patron.test(normalizarTexto(item.producto))) ?? null;

const unicos = (items: InsumoCocina[]) => {
  const vistos = new Set<string>();
  return items.filter((item) => {
    const clave = normalizarTexto(item.producto);
    if (!clave || vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
};

const puntajeHeroe = (item: InsumoCocina, categoria: string) => {
  const nombre = normalizarTexto(item.producto);
  const rol = rolInsumo(nombre);
  const preferencia = PREFERENCIA_CATEGORIA[categoria];
  let puntaje = 0;
  if (rol === 'picable' || rol === 'proteina') puntaje += 10;
  if (rol === 'lacteo') puntaje += categoria === 'Repostería' ? 8 : categoria === 'Comida Italiana' ? 2 : 0;
  if (rol === 'seco') puntaje += preferencia?.test(nombre) ? 5 : 1;
  if (preferencia?.test(nombre) && rol !== 'seco' && rol !== 'lacteo') puntaje += 2;
  const dias = Number(item.dias_para_vencer);
  if (Number.isFinite(dias)) puntaje += Math.max(0, 8 - dias) / 10;
  return puntaje;
};

type Plantilla = {
  categorias: string[];
  titulo: string | ((categoria: string) => string);
  hero: RegExp;
  extras: RegExp[];
  pasos: (titulo: string, ingredientes: IngredienteMedido[]) => string[];
};

const tiene = (ingredientes: IngredienteMedido[], patron: RegExp) =>
  ingredientes.find((ing) => patron.test(normalizarTexto(ing.producto)));

const PLANTILLAS: Plantilla[] = [
  {
    categorias: [],
    titulo: 'Salsa de tomate',
    hero: /tomate/,
    extras: [/aceite/, /(^|\s)sal fina|(^|\s)sal de mesa/, /azucar granulada/],
    pasos: (titulo, ingredientes) => {
      const tomate = tiene(ingredientes, /tomate/);
      const aceite = tiene(ingredientes, /aceite/);
      const otros = ingredientes.filter((ing) => ing !== tomate && ing !== aceite);
      return pasosConMedidas('cuchillo, tabla y olla', ingredientes, [
        tomate ? `Con el cuchillo y sobre la tabla, corta ${textoInsumo(tomate)} en cubos.` : `Reúne ${ingredientes.map(textoInsumo).join('; ')}.`,
        aceite
          ? `En la olla, calienta ${textoInsumo(aceite)} a fuego medio.`
          : 'Pon la olla a fuego medio.',
        otros.length > 0
          ? `Agrega ${tomate ? textoInsumo(tomate) : 'el tomate'} y ${otros.map(textoInsumo).join('; ')}.`
          : `Agrega ${tomate ? textoInsumo(tomate) : 'el tomate'} a la olla.`,
        'Cocina 20 minutos, aplastando con una cuchara, hasta que el agua se reduzca y la salsa espese.',
        `Sirve ${titulo}.`,
      ]);
    },
  },
  {
    categorias: ['Repostería'],
    titulo: 'Queque húmedo',
    hero: /harina/,
    extras: [/huevo/, /azucar granulada/, /mantequilla sin sal|mantequilla/, /leche evaporada|leche condensada/, /esencia de vainilla|vainilla/],
    pasos: (titulo, ingredientes) => {
      const secos = ingredientes.filter((ing) => /harina|azucar/.test(normalizarTexto(ing.producto)));
      const resto = ingredientes.filter((ing) => !secos.includes(ing));
      return pasosConMedidas('balanza, bol, molde y horno', ingredientes, [
        secos.length > 0
          ? `Tamiza en el bol ${secos.map(textoInsumo).join(' y ')}.`
          : 'Mezcla los ingredientes secos en un bol.',
        resto.length > 0
          ? `Incorpora ${resto.map(textoInsumo).join('; ')} y mezcla hasta que no queden grumos.`
          : 'Mezcla 3 minutos, hasta que la masa quede pareja.',
        'Engrasa el molde, vierte la mezcla y nivela la superficie.',
        'Hornea a 180 °C durante 25 minutos. Al pinchar el centro, el palillo debe salir limpio.',
        `Deja enfriar 15 minutos y sirve ${titulo}.`,
      ]);
    },
  },
  {
    categorias: CATEGORIAS_SALADAS,
    titulo: (categoria) => categoria === 'Comida Italiana' ? 'Pasta fresca' : categoria === 'Comida China' ? 'Fideos caseros' : 'Masa de harina',
    hero: /harina/,
    extras: [/huevo/, /(^|\s)sal fina|(^|\s)sal de mesa/, /aceite/],
    pasos: (titulo, ingredientes) => {
      const harina = tiene(ingredientes, /harina/);
      const huevo = tiene(ingredientes, /huevo/);
      const sal = tiene(ingredientes, /(^|\s)sal fina|(^|\s)sal de mesa/);
      const aceite = tiene(ingredientes, /aceite/);
      return pasosConMedidas('bol, uslero y olla', ingredientes, [
        harina
          ? `En el bol, forma un volcán con ${textoInsumo(harina)}.`
          : `Reúne ${ingredientes.map(textoInsumo).join('; ')}.`,
        huevo
          ? `Abre el centro, agrega ${textoInsumo(huevo)}${sal ? ` y ${textoInsumo(sal)}` : ''} y amasa 8 minutos, hasta que la masa quede lisa.`
          : 'Agrega 80 ml de agua tibia y amasa 8 minutos, hasta que la masa quede lisa.',
        'Tapa el bol y deja reposar la masa 20 minutos.',
        titulo === 'Pasta fresca'
          ? 'Estira con el uslero y corta cintas con el cuchillo.'
          : 'Estira con el uslero y corta fideos con el cuchillo.',
        aceite
          ? `Hierve en la olla 4 minutos, escurre y termina con ${textoInsumo(aceite)}.`
          : 'Hierve en la olla 4 minutos y escurre.',
        `Sirve ${titulo}.`,
      ]);
    },
  },
  {
    categorias: ['Repostería'],
    titulo: 'Crema batida',
    hero: /crema/,
    extras: [/azucar granulada/, /esencia de vainilla|vainilla/, /arandano|frambuesa|fruta|durazno|pina/],
    pasos: (titulo, ingredientes) => {
      const crema = tiene(ingredientes, /crema/);
      const resto = ingredientes.filter((ing) => ing !== crema);
      return pasosConMedidas('bol y batidor', ingredientes, [
        crema
          ? `Pon ${textoInsumo(crema)} bien fría en el bol.`
          : `Reúne ${ingredientes.map(textoInsumo).join('; ')}.`,
        resto.length > 0
          ? `Agrega ${resto.map(textoInsumo).join('; ')}.`
          : 'Agrega el azúcar medido.',
        'Bate con el batidor hasta que la crema forme picos blandos.',
        `Sirve ${titulo} enseguida o guárdala en frío.`,
      ]);
    },
  },
  {
    categorias: CATEGORIAS_SALADAS,
    titulo: 'Salsa blanca',
    hero: /crema/,
    extras: [/harina de trigo tradicional|harina sin polvos|harina/, /mantequilla/, /(^|\s)sal fina|(^|\s)sal de mesa/, /leche evaporada|leche/],
    pasos: (titulo, ingredientes) => {
      const crema = tiene(ingredientes, /crema/);
      const harina = tiene(ingredientes, /harina/);
      const mantequilla = tiene(ingredientes, /mantequilla/);
      const resto = ingredientes.filter((ing) => ing !== crema && ing !== harina && ing !== mantequilla);
      return pasosConMedidas('olla y batidor', ingredientes, [
        mantequilla
          ? `En la olla, derrite ${textoInsumo(mantequilla)} a fuego bajo.`
          : 'Calienta la olla a fuego bajo.',
        harina
          ? `Agrega ${textoInsumo(harina)} y cocina 1 minuto, moviendo con el batidor.`
          : 'Agrega el espesante y cocina 1 minuto.',
        crema
          ? `Suma ${textoInsumo(crema)}${resto.length > 0 ? ` junto con ${resto.map(textoInsumo).join('; ')}` : ''} y cocina 5 minutos hasta que espese.`
          : `Suma ${ingredientes.map(textoInsumo).join('; ')} y cocina 5 minutos.`,
        `La salsa debe quedar lisa. Sirve ${titulo}.`,
      ]);
    },
  },
  {
    categorias: CATEGORIAS_SALADAS,
    titulo: 'Huevos revueltos',
    hero: /huevo/,
    extras: [/mantequilla sin sal|aceite/, /tomate/, /(^|\s)sal fina|(^|\s)sal de mesa/],
    pasos: (titulo, ingredientes) => {
      const huevo = tiene(ingredientes, /huevo/);
      const grasa = tiene(ingredientes, /mantequilla/) || tiene(ingredientes, /aceite/);
      const tomate = tiene(ingredientes, /tomate/);
      const sal = tiene(ingredientes, /(^|\s)sal fina|(^|\s)sal de mesa/);
      return pasosConMedidas('sartén y espátula', ingredientes, [
        grasa
          ? `Calienta ${textoInsumo(grasa)} en el sartén a fuego medio.`
          : 'Calienta el sartén a fuego medio.',
        tomate ? `Agrega ${textoInsumo(tomate)} y cocina 2 minutos.` : 'Cuando la grasa esté caliente, baja un poco el fuego.',
        huevo
          ? `Bate ${textoInsumo(huevo)}${sal ? ` con ${textoInsumo(sal)}` : ''} y viértelos al sartén.`
          : `Agrega ${ingredientes.map(textoInsumo).join('; ')}.`,
        `Cocina 2 minutos, moviendo con la espátula, y sirve ${titulo}.`,
      ]);
    },
  },
  {
    categorias: ['Repostería'],
    titulo: 'Bizcocho de huevo',
    hero: /huevo/,
    extras: [/harina de trigo tradicional|harina sin polvos|harina/, /azucar granulada/, /mantequilla sin sal|mantequilla/, /esencia de vainilla|vainilla/],
    pasos: (titulo, ingredientes) => pasosConMedidas('balanza, bol, molde y horno', ingredientes, [
      `Mezcla en el bol ${ingredientes.map(textoInsumo).join('; ')} hasta que no queden grumos.`,
      'Engrasa el molde, vierte la mezcla y nivela.',
      'Hornea a 180 °C durante 25 minutos. El palillo debe salir limpio.',
      `Deja enfriar y sirve ${titulo}.`,
    ]),
  },
  {
    categorias: ['Repostería'],
    titulo: 'Brownies de cacao',
    hero: /cacao|chocolate/,
    extras: [/huevo/, /azucar granulada/, /mantequilla/, /harina sin polvos|harina de trigo tradicional|harina/],
    pasos: (titulo, ingredientes) => pasosConMedidas('olla, bol, molde y horno', ingredientes, [
      `Mezcla en el bol ${ingredientes.map(textoInsumo).join('; ')}.`,
      'Vierte en el molde engrasado y nivela.',
      'Hornea a 180 °C durante 20 minutos. El centro debe quedar húmedo.',
      `Deja enfriar y corta ${titulo}.`,
    ]),
  },
  {
    categorias: [],
    titulo: 'Salteado de la casa',
    hero: /aceite/,
    extras: [/tomate/, /huevo/, /(^|\s)sal fina|(^|\s)sal de mesa/],
    pasos: (titulo, ingredientes) => {
      const aceite = tiene(ingredientes, /aceite/);
      const resto = ingredientes.filter((ing) => ing !== aceite);
      return pasosConMedidas('sartén y espátula', ingredientes, [
        aceite
          ? `Calienta ${textoInsumo(aceite)} en el sartén a fuego medio.`
          : 'Calienta el sartén a fuego medio.',
        resto.length > 0
          ? `Agrega ${resto.map(textoInsumo).join('; ')} y cocina 8 minutos, moviendo con la espátula.`
          : 'Cocina 8 minutos el insumo que está por vencer.',
        `Retira y sirve ${titulo}.`,
      ]);
    },
  },
];

const publicar = (
  categoria: string,
  titulo: string,
  nombres: string[],
  pasos: string[],
  universo: InsumoCocina[],
) => {
  const ingredientes = ingredientesMedidos([...new Set(nombres)], universo);
  if (ingredientes.length === 0) return null;
  return {
    tipo: 'receta' as const,
    titulo,
    descripcion: describirRescate(categoria, ingredientes, universo),
    insumos_usados: ingredientes.map((ing) => ing.producto),
    ingredientes,
    pasos,
  };
};

const armarDesdePlantilla = (categoria: string, heroe: InsumoCocina, despensa: InsumoCocina[]) => {
  const universo = unicos([heroe, ...despensa]);
  const candidatas = PLANTILLAS.filter((plantilla) =>
    plantilla.hero.test(normalizarTexto(heroe.producto))
    && (plantilla.categorias.length === 0 || plantilla.categorias.includes(categoria))
  );
  const mejor = candidatas
    .map((plantilla) => ({
      plantilla,
      extras: unicos(plantilla.extras
        .map((patron) => buscarInsumo(universo, patron))
        .filter((item): item is InsumoCocina => item !== null && normalizarTexto(item.producto) !== normalizarTexto(heroe.producto))),
    }))
    .sort((a, b) => b.extras.length - a.extras.length)[0];
  if (!mejor) return null;
  const nombres = [heroe.producto, ...mejor.extras.map((item) => item.producto)];
  const titulo = typeof mejor.plantilla.titulo === 'function' ? mejor.plantilla.titulo(categoria) : mejor.plantilla.titulo;
  const ingredientes = ingredientesMedidos(nombres, universo);
  if (ingredientes.length === 0) return null;
  return publicar(categoria, titulo, nombres, mejor.plantilla.pasos(titulo, ingredientes), universo);
};

type EstiloCategoria = {
  titulo: string;
  extras: RegExp[];
  implementos: string;
  pasos: (titulo: string, ingredientes: IngredienteMedido[]) => string[];
};

const pasosPlato = (titulo: string, ingredientes: IngredienteMedido[], cuerpo: string[]) => [
  `Reúne ${ingredientes.map(textoInsumo).join('; ')}.`,
  ...cuerpo,
  `Sirve ${titulo}.`,
];

const ESTILOS_CATEGORIA: Record<string, EstiloCategoria[]> = {
  'Comida China': [
    { titulo: 'Arroz frito cantonés', extras: [/arroz/, /huevo/, /aceite/, /cebolla|ajo|soya/], implementos: 'wok y cuchara', pasos: (t, i) => pasosPlato(t, i, ['Calienta el wok a fuego alto.', 'Revuelve el huevo, suma el arroz y saltea 5 minutos.']) },
    { titulo: 'Chow mein', extras: [/harina|arroz|fideo/, /aceite/, /soya|ajo|cebolla/, /huevo/], implementos: 'olla, wok y tenedor', pasos: (t, i) => pasosPlato(t, i, ['Hierve la masa o el fideo 4 minutos y escurre.', 'Saltea en el wok 3 minutos con salsa de soya.']) },
    { titulo: 'Pollo kung pao', extras: [/pollo|huevo/, /aceite/, /aji|soya|ajo/, /almendra|mani|nuez/], implementos: 'wok y cuchillo', pasos: (t, i) => pasosPlato(t, i, ['Dora la proteína a fuego alto.', 'Agrega el resto y cocina 6 minutos, hasta que brille.']) },
    { titulo: 'Chop suey de verduras', extras: [/aceite/, /tomate|cebolla|repollo|aji/, /soya|ajo/], implementos: 'wok y espátula', pasos: (t, i) => pasosPlato(t, i, ['Saltea las verduras 4 minutos a fuego alto.', 'Termina con un chorrito de soya.']) },
    { titulo: 'Fideos salteados al wok', extras: [/harina|fideo|arroz/, /aceite/, /huevo/, /soya|ajo/], implementos: 'olla y wok', pasos: (t, i) => pasosPlato(t, i, ['Cocina el fideo al dente.', 'Saltea 3 minutos con el resto de insumos.']) },
    { titulo: 'Sopa wantán exprés', extras: [/harina/, /huevo/, /aceite/, /cebolla|ajo|soya/], implementos: 'olla y cuchara', pasos: (t, i) => pasosPlato(t, i, ['Arma tiras o wantanes con la masa.', 'Hierve 6 minutos en caldo suave.']) },
    { titulo: 'Pollo agridulce', extras: [/pollo|huevo/, /aceite/, /tomate|aji/, /azucar granulada|soya/], implementos: 'sartén y cuchara', pasos: (t, i) => pasosPlato(t, i, ['Dora la proteína.', 'Reduce la salsa agridulce 5 minutos y napar.']) },
    { titulo: 'Rollitos de primavera a la sartén', extras: [/harina/, /aceite/, /huevo/, /cebolla|repollo|zanahoria/], implementos: 'sartén y tabla', pasos: (t, i) => pasosPlato(t, i, ['Arma rollos delgados con la masa.', 'Dora 2 minutos por lado.']) },
    { titulo: 'Salteado de ajo y jengibre', extras: [/aceite/, /ajo|jengibre|cebolla/, /pollo|huevo|tomate/], implementos: 'wok y cuchillo', pasos: (t, i) => pasosPlato(t, i, ['Perfuma el aceite con ajo o jengibre.', 'Saltea 5 minutos a fuego alto.']) },
    { titulo: 'Huevos al estilo fu yung', extras: [/huevo/, /aceite/, /cebolla|tomate/, /soya/], implementos: 'sartén y palillos', pasos: (t, i) => pasosPlato(t, i, ['Bate los huevos.', 'Cocina como tortilla abierta 3 minutos por lado.']) },
  ],
  'Comida Italiana': [
    { titulo: 'Spaghetti al pomodoro', extras: [/harina|fideo|pasta/, /tomate/, /aceite/, /ajo|oregano|queso/], implementos: 'olla y sartén', pasos: (t, i) => pasosPlato(t, i, ['Cocina la pasta al dente.', 'Reduce el tomate 10 minutos y mezcla.']) },
    { titulo: 'Pasta aglio e olio', extras: [/harina|fideo|pasta/, /aceite/, /ajo/, /(^|\s)sal fina|(^|\s)sal de mesa/], implementos: 'olla y sartén', pasos: (t, i) => pasosPlato(t, i, ['Dora el ajo en aceite sin quemar.', 'Saltea la pasta 2 minutos en esa grasa.']) },
    { titulo: 'Fettuccine alfredo', extras: [/harina|fideo|pasta/, /crema|leche/, /queso|mantequilla/, /(^|\s)sal fina|(^|\s)sal de mesa/], implementos: 'olla y sartén', pasos: (t, i) => pasosPlato(t, i, ['Reduce la crema 4 minutos.', 'Emulsiona con la pasta y el queso.']) },
    { titulo: 'Lasagna exprés', extras: [/harina/, /tomate/, /queso|leche/, /huevo/], implementos: 'fuente y horno', pasos: (t, i) => pasosPlato(t, i, ['Arma capas de masa, salsa y queso.', 'Hornea 20 minutos a 180 °C.']) },
    { titulo: 'Risotto rápido', extras: [/arroz|harina/, /cebolla|ajo/, /queso|crema|mantequilla/, /tomate/], implementos: 'olla ancha', pasos: (t, i) => pasosPlato(t, i, ['Sofríe la base y suma el arroz.', 'Remueve 12 minutos hasta que quede cremoso.']) },
    { titulo: 'Bruschetta de tomate', extras: [/tomate/, /aceite/, /ajo|albahaca|oregano/, /harina/], implementos: 'tabla, cuchillo y horno', pasos: (t, i) => pasosPlato(t, i, ['Pica el tomate y mézclalo con aceite.', 'Tuéstate la base y cubre al momento.']) },
    { titulo: 'Pizza rápida al sartén', extras: [/harina/, /tomate/, /queso/, /aceite|oregano/], implementos: 'sartén y horno', pasos: (t, i) => pasosPlato(t, i, ['Estira una masa delgada.', 'Cubre y cocina 8 minutos tapada.']) },
    { titulo: 'Ensalada caprese', extras: [/tomate/, /queso/, /aceite/, /albahaca|oregano/], implementos: 'tabla y plato', pasos: (t, i) => pasosPlato(t, i, ['Lamina tomate y queso.', 'Rocía aceite y sirve fresco.']) },
    { titulo: 'Sopa minestrone', extras: [/tomate/, /cebolla|ajo|zanahoria/, /harina|fideo|arroz/, /aceite/], implementos: 'olla y cuchara', pasos: (t, i) => pasosPlato(t, i, ['Sofríe verduras.', 'Cubre con agua y cocina 15 minutos.']) },
    { titulo: 'Ñoquis a la sartén', extras: [/harina/, /huevo/, /papa|tomate|queso/, /aceite/], implementos: 'olla y sartén', pasos: (t, i) => pasosPlato(t, i, ['Forma ñoquis y hiérvelos hasta que floten.', 'Acabado en sartén 2 minutos.']) },
  ],
  'Comida Rápida': [
    { titulo: 'Sándwich del día', extras: [/harina|pan/, /tomate|lechuga|queso/, /huevo|pollo|carne/, /aceite/], implementos: 'tabla y sartén', pasos: (t, i) => pasosPlato(t, i, ['Arma el relleno caliente.', 'Dora 2 minutos por lado.']) },
    { titulo: 'Hamburguesa casera', extras: [/harina|pan/, /carne|pollo|huevo/, /tomate|queso|lechuga/, /aceite/], implementos: 'sartén y tabla', pasos: (t, i) => pasosPlato(t, i, ['Forma y dora el medallón.', 'Arma con pan y receta al momento.']) },
    { titulo: 'Wrap de la casa', extras: [/harina|pan/, /tomate|lechuga|queso/, /pollo|huevo/, /aceite/], implementos: 'sartén y tabla', pasos: (t, i) => pasosPlato(t, i, ['Calienta el relleno 3 minutos.', 'Enrolla y marca 1 minuto por lado.']) },
    { titulo: 'Papas salteadas', extras: [/papa|harina/, /aceite/, /huevo|queso/, /cebolla|tomate/], implementos: 'sartén y espátula', pasos: (t, i) => pasosPlato(t, i, ['Saltea a fuego medio-alto.', 'Cocina 10 minutos hasta que doren.']) },
    { titulo: 'Huevos revueltos express', extras: [/huevo/, /aceite|mantequilla/, /tomate/, /(^|\s)sal fina|(^|\s)sal de mesa/], implementos: 'sartén y espátula', pasos: (t, i) => pasosPlato(t, i, ['Bate los huevos.', 'Cocina 2 minutos moviendo.']) },
    { titulo: 'Completo casero', extras: [/harina|pan/, /tomate/, /aceite/, /queso|huevo/], implementos: 'tabla y sartén', pasos: (t, i) => pasosPlato(t, i, ['Calienta el pan.', 'Arma con tomate y el resto al momento.']) },
    { titulo: 'Quesadilla rápida', extras: [/harina|pan/, /queso/, /tomate|pollo/, /aceite/], implementos: 'sartén', pasos: (t, i) => pasosPlato(t, i, ['Rellena y cierra.', 'Dora 2 minutos por lado hasta fundir.']) },
    { titulo: 'Nuggets al horno', extras: [/pollo|huevo/, /harina/, /aceite/, /(^|\s)sal fina|(^|\s)sal de mesa/], implementos: 'bol, lata y horno', pasos: (t, i) => pasosPlato(t, i, ['Pasa por harina y huevo.', 'Hornea 15 minutos a 200 °C.']) },
    { titulo: 'Ensalada rápida', extras: [/tomate|lechuga/, /aceite/, /huevo|queso/, /limon/], implementos: 'bol y cuchillo', pasos: (t, i) => pasosPlato(t, i, ['Corta y mezcla en el bol.', 'Aliña y sirve fresco.']) },
    { titulo: 'Empanada exprés', extras: [/harina/, /huevo/, /carne|pollo|queso|tomate/, /aceite/], implementos: 'uslero, lata y horno', pasos: (t, i) => pasosPlato(t, i, ['Rellena discos de masa.', 'Pinta con huevo y hornea 18 minutos a 200 °C.']) },
  ],
  'Comida Tailandesa': [
    { titulo: 'Pad Thai', extras: [/harina|arroz|fideo/, /huevo/, /aceite/, /limon|lima|aji/], implementos: 'wok y pinzas', pasos: (t, i) => pasosPlato(t, i, ['Saltea el fideo a fuego alto.', 'Suma huevo, ácido y un toque picante.']) },
    { titulo: 'Pad kra pao', extras: [/pollo|carne|huevo/, /aceite/, /aji|ajo|cebolla/, /arroz/], implementos: 'wok y cuchara', pasos: (t, i) => pasosPlato(t, i, ['Saltea la proteína picada.', 'Termina picante y sirve con arroz.']) },
    { titulo: 'Curry verde de coco', extras: [/coco|leche/, /aji|jengibre/, /pollo|huevo/, /arroz/], implementos: 'olla y cuchara', pasos: (t, i) => pasosPlato(t, i, ['Sofríe la pasta de curry.', 'Cocina 10 minutos con leche de coco o similar.']) },
    { titulo: 'Tom yum', extras: [/limon|lima/, /aji|jengibre/, /tomate/, /pollo|huevo/], implementos: 'olla', pasos: (t, i) => pasosPlato(t, i, ['Hierve el fondo aromático.', 'Suma el resto y cocina 8 minutos.']) },
    { titulo: 'Arroz frito thai', extras: [/arroz|harina/, /huevo/, /aceite/, /aji|limon|cebolla/], implementos: 'wok', pasos: (t, i) => pasosPlato(t, i, ['Saltea el arroz con huevo.', 'Ajusta con limón o ají al final.']) },
    { titulo: 'Pollo con leche de coco', extras: [/pollo|huevo/, /coco|leche/, /aji|jengibre/, /arroz/], implementos: 'olla', pasos: (t, i) => pasosPlato(t, i, ['Dora la proteína.', 'Cocina tapado 12 minutos en coco.']) },
    { titulo: 'Salteado de limón y jengibre', extras: [/aceite/, /limon|lima|jengibre/, /pollo|huevo|tomate/, /arroz/], implementos: 'wok', pasos: (t, i) => pasosPlato(t, i, ['Perfuma el aceite.', 'Saltea 6 minutos y termina con cítrico.']) },
    { titulo: 'Noodles al wok', extras: [/harina|fideo|arroz/, /aceite/, /huevo/, /aji|soya|limon/], implementos: 'wok y olla', pasos: (t, i) => pasosPlato(t, i, ['Escurre el fideo.', 'Saltea 4 minutos a fuego alto.']) },
    { titulo: 'Som tam de tomate', extras: [/tomate/, /limon|lima/, /aji/, /aceite/], implementos: 'mortero o bol', pasos: (t, i) => pasosPlato(t, i, ['Machaca suave tomate y ají.', 'Aliña con limón y sirve fresco.']) },
    { titulo: 'Huevos thai al sartén', extras: [/huevo/, /aceite/, /aji|limon/, /arroz|tomate/], implementos: 'sartén', pasos: (t, i) => pasosPlato(t, i, ['Fríe los huevos a fuego medio-alto.', 'Sirve con arroz o tomate al lado.']) },
  ],
  'Comida Chilena': [
    { titulo: 'Cazuela rápida', extras: [/pollo|carne/, /papa|choclo|tomate/, /cebolla|ajo|zanahoria|huevo/, /aceite/], implementos: 'olla', pasos: (t, i) => pasosPlato(t, i, ['Sofríe la base.', 'Cubre con agua y cocina 20 minutos.']) },
    { titulo: 'Tomaticán', extras: [/tomate/, /huevo|cebolla|choclo/, /aceite/, /harina|queso/], implementos: 'sartén', pasos: (t, i) => pasosPlato(t, i, ['Sofríe la base en aceite.', 'Suma tomate y cocina 10 minutos.']) },
    { titulo: 'Huevos a la chilena', extras: [/huevo/, /tomate/, /aceite/, /harina|queso/], implementos: 'sartén', pasos: (t, i) => pasosPlato(t, i, ['Fríe o revuelve los huevos.', 'Acompaña con tomate salteado.']) },
    { titulo: 'Pantrucas', extras: [/harina/, /huevo/, /aceite/, /tomate|cebolla|aji/], implementos: 'olla y cuchillo', pasos: (t, i) => pasosPlato(t, i, ['Corta tiras de masa.', 'Hiérvelas 6 minutos en el caldo.']) },
    { titulo: 'Sopaipillas', extras: [/harina/, /aceite/, /huevo|zapallo/, /(^|\s)sal fina|(^|\s)sal de mesa|tomate/], implementos: 'sartén y uslero', pasos: (t, i) => pasosPlato(t, i, ['Estira discos delgados.', 'Fríe 1 minuto por lado.']) },
    { titulo: 'Completo italiano', extras: [/harina|pan/, /tomate/, /queso|palta|aceite/, /huevo/], implementos: 'tabla', pasos: (t, i) => pasosPlato(t, i, ['Abre el pan.', 'Arma tomate y el resto al momento.']) },
    { titulo: 'Pebre', extras: [/tomate/, /aceite/, /cebolla|aji|huevo/, /limon|harina/], implementos: 'tabla y bol', pasos: (t, i) => pasosPlato(t, i, ['Pica bien fino.', 'Deja reposar 5 minutos.']) },
    { titulo: 'Tortilla de papa', extras: [/papa|tomate|cebolla/, /huevo/, /aceite/, /harina|queso/], implementos: 'sartén', pasos: (t, i) => pasosPlato(t, i, ['Mezcla base y huevo.', 'Cocina 4 minutos por lado.']) },
    { titulo: 'Charquicán', extras: [/papa|tomate/, /choclo|zapallo|huevo/, /carne|cebolla|queso/, /aceite/], implementos: 'olla y pisón', pasos: (t, i) => pasosPlato(t, i, ['Cocina las verduras.', 'Aplasta y mezcla.']) },
    { titulo: 'Pastel de papa exprés', extras: [/papa|harina/, /carne|pollo|tomate/, /huevo|leche|queso/, /aceite/], implementos: 'fuente y horno', pasos: (t, i) => pasosPlato(t, i, ['Arma capa de guiso y cobertura.', 'Gratina 10 minutos.']) },
  ],
  'Repostería': [
    { titulo: 'Queque húmedo', extras: [/harina/, /huevo/, /azucar/, /mantequilla|leche/], implementos: 'bol, molde y horno', pasos: (t, i) => pasosPlato(t, i, ['Mezcla secos y húmedos.', 'Hornea 25 minutos a 180 °C.']) },
    { titulo: 'Brownies de cacao', extras: [/cacao|chocolate/, /huevo/, /azucar/, /mantequilla|harina/], implementos: 'bol, molde y horno', pasos: (t, i) => pasosPlato(t, i, ['Integra el cacao a la masa.', 'Hornea 20 minutos; el centro debe quedar húmedo.']) },
    { titulo: 'Galletas de la casa', extras: [/harina/, /azucar/, /mantequilla|huevo/, /vainilla/], implementos: 'bol, lata y horno', pasos: (t, i) => pasosPlato(t, i, ['Forma bolitas.', 'Hornea 12 minutos a 180 °C.']) },
    { titulo: 'Muffins', extras: [/harina/, /huevo/, /azucar|leche/, /arandano|fruta|cacao/], implementos: 'molde muffins y horno', pasos: (t, i) => pasosPlato(t, i, ['Llena los moldes a 3/4.', 'Hornea 18 minutos a 180 °C.']) },
    { titulo: 'Cheesecake frío', extras: [/queso crema|queso/, /crema|leche/, /azucar/, /galleta|harina|mantequilla/], implementos: 'molde y refrigerador', pasos: (t, i) => pasosPlato(t, i, ['Bate el queso hasta que quede liso.', 'Enfría al menos 2 horas.']) },
    { titulo: 'Crema pastelera', extras: [/leche|crema/, /azucar/, /huevo/, /maicena|harina|vainilla/], implementos: 'olla y batidor', pasos: (t, i) => pasosPlato(t, i, ['Calienta la leche.', 'Espesa 5 minutos a fuego bajo.']) },
    { titulo: 'Alfajores de manjar', extras: [/harina/, /mantequilla|huevo/, /manjar/, /azucar/], implementos: 'uslero, lata y horno', pasos: (t, i) => pasosPlato(t, i, ['Hornea tapas 10 minutos a 180 °C.', 'Rellena con manjar al enfriar.']) },
    { titulo: 'Torta de chocolate', extras: [/cacao|chocolate/, /harina/, /huevo/, /azucar|mantequilla/], implementos: 'moldes y horno', pasos: (t, i) => pasosPlato(t, i, ['Hornea dos discos 25 minutos a 180 °C.', 'Rellena y cubre al enfriar.']) },
    { titulo: 'Crumble de arándanos', extras: [/arandano|fruta|durazno|papaya/, /harina/, /azucar/, /mantequilla/], implementos: 'fuente y horno', pasos: (t, i) => pasosPlato(t, i, ['Cubre la fruta con el morón de harina.', 'Hornea 20 minutos a 180 °C.']) },
    { titulo: 'Panqueques', extras: [/harina/, /huevo/, /leche/, /azucar|mantequilla/], implementos: 'bol y sartén', pasos: (t, i) => pasosPlato(t, i, ['Bate una masa líquida.', 'Cocina 1 minuto por lado.']) },
  ],
};

const universoParaCategoria = (categoria: string, proximos: InsumoCocina[], despensa: InsumoCocina[]) =>
  unicos([...proximos, ...despensa]).filter((item) => {
    const nombre = normalizarTexto(item.producto);
    if (/prueba/.test(nombre)) return false;
    if (CATEGORIAS_SALADAS.includes(categoria) && DULCES_FUERA_DE_REPOSTERIA.test(nombre)) return false;
    return true;
  });

const esSoloGrasaOSal = (nombre: string) =>
  /aceite|(^|\s)sal fina|(^|\s)sal de mesa|^agua\b/.test(normalizarTexto(nombre));

const puntuacionEstilo = (estilo: EstiloCategoria, universo: InsumoCocina[], proximos: InsumoCocina[]) => {
  const clavesVencer = new Set(proximos.map((item) => normalizarTexto(item.producto)));
  let matches = 0;
  let rescates = 0;
  let protagonistas = 0;
  estilo.extras.forEach((patron, indice) => {
    const hallado = buscarInsumo(universo, patron);
    if (!hallado) return;
    matches += 1;
    if (!esSoloGrasaOSal(hallado.producto)) protagonistas += 1;
    if (clavesVencer.has(normalizarTexto(hallado.producto))) rescates += 1;
    if (indice === 0) protagonistas += 1; // el primer patrón suele ser el eje del plato
  });
  return { matches, protagonistas, rescates };
};

const armarEstiloCategoria = (categoria: string, universo: InsumoCocina[], estilo: EstiloCategoria, proximos: InsumoCocina[]) => {
  const hallados = estilo.extras
    .map((patron) => buscarInsumo(universo, patron))
    .filter((item): item is InsumoCocina => item !== null);
  const extras = unicos(hallados);
  const nombres = extras.map((item) => item.producto);
  const minMatches = Math.min(3, Math.max(2, Math.ceil(estilo.extras.length * 0.5)));
  const conCuerpo = nombres.filter((nombre) => !esSoloGrasaOSal(nombre));
  const primerPatron = estilo.extras[0] ? buscarInsumo(universo, estilo.extras[0]) : null;
  // No publicar cazuela de solo aceite ni plantillas a medias.
  if (nombres.length < minMatches || conCuerpo.length < 1 || !primerPatron) return null;
  if (proximos.length > 0) {
    const clavesVencer = new Set(proximos.map((item) => normalizarTexto(item.producto)));
    const tieneRescate = nombres.some((nombre) => clavesVencer.has(normalizarTexto(nombre)));
    if (!tieneRescate) return null;
  }
  const ingredientes = ingredientesMedidos(nombres, universo);
  if (ingredientes.length < minMatches) return null;
  return publicar(
    categoria,
    estilo.titulo,
    nombres,
    pasosConMedidas(estilo.implementos, ingredientes, estilo.pasos(estilo.titulo, ingredientes)),
    universo,
  );
};

export const armarSugerenciasLocales = (categoria: string, proximos: InsumoCocina[], despensa: InsumoCocina[]) => {
  const universo = universoParaCategoria(categoria, proximos, despensa);
  const vistas = new Set<string>();
  const recetas: SugerenciaRescate[] = [];
  const agregar = (armada: SugerenciaRescate | null) => {
    if (!armada) return;
    const clave = normalizarTexto(armada.titulo);
    if (!clave || vistas.has(clave)) return;
    if (CATEGORIAS_SALADAS.includes(categoria) && DULCES_FUERA_DE_REPOSTERIA.test(clave)) return;
    if (armada.ingredientes.length < 2) return;
    if (armada.ingredientes.every((ing) => esSoloGrasaOSal(ing.producto))) return;
    if (proximos.length > 0) {
      const clavesVencer = new Set(proximos.map((item) => normalizarTexto(item.producto)));
      if (!armada.ingredientes.some((ing) => clavesVencer.has(normalizarTexto(ing.producto)))) return;
    }
    vistas.add(clave);
    recetas.push(armada);
  };
  const estilos = [...(ESTILOS_CATEGORIA[categoria] || ESTILOS_CATEGORIA['Comida Rápida'])]
    .map((estilo) => ({ estilo, score: puntuacionEstilo(estilo, universo, proximos) }))
    .filter((fila) => fila.score.matches >= 2 && fila.score.protagonistas >= 1)
    .sort((a, b) =>
      b.score.rescates - a.score.rescates
      || b.score.matches - a.score.matches
      || b.score.protagonistas - a.score.protagonistas
    );
  for (const fila of estilos) {
    if (recetas.length >= 3) break;
    agregar(armarEstiloCategoria(categoria, universo, fila.estilo, proximos));
  }
  if (recetas.length >= 3) return recetas;
  const porVencer = proximos
    .filter((item) => item.por_vencer && universo.some((fila) => normalizarTexto(fila.producto) === normalizarTexto(item.producto)))
    .sort((a, b) => puntajeHeroe(b, categoria) - puntajeHeroe(a, categoria) || Number(a.dias_para_vencer) - Number(b.dias_para_vencer));
  const candidatos = porVencer.length > 0
    ? porVencer
    : universo.filter((item) => encajaEnCategoria(item.producto, categoria) && !esSoloGrasaOSal(item.producto));
  for (const heroe of candidatos) {
    if (recetas.length >= 3) break;
    if (esSoloGrasaOSal(heroe.producto)) continue;
    agregar(armarDesdePlantilla(categoria, heroe, universo));
  }
  return recetas;
};

export const insumosUtilesParaModelo = (categoria: string, despensa: InsumoCocina[], limite: number) => {
  const preferencia = PREFERENCIA_CATEGORIA[categoria];
  const basicos = [/harina/, /azucar/, /huevo/, /aceite/, /leche/, /arroz/, /tomate/, /cebolla/, /ajo/, /soya/, /jengibre/];
  const ordenados = unicos(despensa).sort((a, b) => {
    const na = normalizarTexto(a.producto);
    const nb = normalizarTexto(b.producto);
    const pa = (preferencia?.test(na) ? 2 : 0) + (basicos.some((patron) => patron.test(na)) ? 1 : 0);
    const pb = (preferencia?.test(nb) ? 2 : 0) + (basicos.some((patron) => patron.test(nb)) ? 1 : 0);
    return pb - pa;
  });
  return ordenados.slice(0, limite).map((item) => item.producto);
};

const PALABRAS_DEL_TITULO = ['crema', 'queso', 'pollo', 'carne', 'pescado', 'chocolate', 'manjar', 'tomate', 'arroz', 'huevo', 'leche'];

const tituloCoherente = (titulo: string, ingredientes: IngredienteMedido[]) => {
  const textoTitulo = normalizarTexto(titulo);
  if (!textoTitulo || /^(oferta|aceite)\b/.test(textoTitulo)) return false;
  const insumos = ingredientes.map((ing) => normalizarTexto(ing.producto)).join(' ');
  return PALABRAS_DEL_TITULO.every((palabra) => {
    const enTitulo = new RegExp(`(?:^|\\s)${palabra}(?:\\s|$)`).test(textoTitulo);
    return !enTitulo || insumos.includes(palabra);
  });
};

const pasosDelModelo = (pasos: unknown) =>
  (Array.isArray(pasos) ? pasos : [])
    .filter((paso): paso is string => typeof paso === 'string')
    .map((paso) => paso.trim())
    .filter((paso) => paso.length >= 12)
    .slice(0, 6);

const TIPOS_PLATO = new Set(['Salado', 'Dulce', 'Agridulce']);

const normalizarTipoPlato = (valor: unknown): SugerenciaRescate['tipo_plato'] | undefined => {
  if (typeof valor !== 'string') return undefined;
  const limpio = valor.trim();
  if (TIPOS_PLATO.has(limpio)) return limpio as SugerenciaRescate['tipo_plato'];
  const bajo = normalizarTexto(limpio);
  if (bajo === 'salado') return 'Salado';
  if (bajo === 'dulce') return 'Dulce';
  if (bajo === 'agridulce') return 'Agridulce';
  return undefined;
};

const pasosCoherentesConIngredientes = (pasos: string[], ingredientes: IngredienteMedido[]) => {
  if (pasos.length === 0 || ingredientes.length === 0) return false;
  const textoPasos = normalizarTexto(pasos.join(' '));
  const mencionados = ingredientes.filter((ing) => {
    const corto = normalizarTexto(cortoInsumo(ing.producto));
    if (corto.length < 3) return true;
    return textoPasos.includes(corto) || corto.split(/\s+/).some((token) => token.length >= 4 && textoPasos.includes(token));
  });
  return mencionados.length >= Math.ceil(ingredientes.length * 0.6);
};

/** Valida que cada inventario_id exista y que cantidad no exceda stock (si la unidad coincide). */
export const validarRecetaContraInventario = (
  receta: { ingredientes: IngredienteMedido[] },
  insumos: InsumoCocina[],
) => {
  if (!Array.isArray(receta?.ingredientes) || receta.ingredientes.length === 0) {
    return { ok: false as const, motivo: 'sin_ingredientes' };
  }
  const porId = new Map(
    insumos
      .filter((item) => item.id != null && String(item.id).length > 0)
      .map((item) => [String(item.id), item]),
  );
  const porNombre = new Map(insumos.map((item) => [normalizarTexto(item.producto), item]));
  for (const ing of receta.ingredientes) {
    const porIdentificador = ing.inventario_id != null ? porId.get(String(ing.inventario_id)) : undefined;
    const item = porIdentificador || porNombre.get(normalizarTexto(ing.producto));
    if (!item) return { ok: false as const, motivo: `inventario_desconocido:${ing.producto}` };
    const cantidad = Number(ing.cantidad);
    if (!(cantidad > 0)) return { ok: false as const, motivo: `cantidad_invalida:${ing.producto}` };
    const mismaUnidad = normalizarTexto(ing.unidad) === normalizarTexto(item.unidad_medida)
      || (ing.unidad === 'unidades' && item.unidad_medida === 'un')
      || (ing.unidad === 'huevos' && item.unidad_medida === 'un');
    if (mismaUnidad && cantidad > Number(item.cantidad_en_riesgo) + 1e-6) {
      return { ok: false as const, motivo: `stock_excedido:${ing.producto}` };
    }
  }
  return { ok: true as const };
};

export const inventarioParaModelo = (insumos: InsumoCocina[]) =>
  insumos.map((item) => ({
    id: item.id != null ? String(item.id) : normalizarTexto(item.producto),
    nombre: item.producto,
    stock: Number(item.cantidad_en_riesgo),
    unidad: item.unidad_medida,
    dias_para_vencer: item.dias_para_vencer,
    prioridad_rescate: item.prioridad_rescate === true
      || (item.por_vencer === true && Number(item.dias_para_vencer) <= 3),
  }));

export const cerrarSugerenciaModelo = (entrada: {
  categoria: string;
  titulo: string;
  nombres: string[];
  pasos: unknown;
  pedidos?: Map<string, number>;
  insumos: InsumoCocina[];
  porVencer: InsumoCocina[];
  tipo_plato?: unknown;
  implementos?: unknown;
  tiempo_minutos?: unknown;
  porciones?: unknown;
  idsPorNombre?: Map<string, string>;
  rescatePorNombre?: Map<string, boolean>;
}) => {
  const titulo = entrada.titulo.trim();
  const otrosPorVencer = entrada.porVencer.filter((item) => {
    const rol = rolInsumo(item.producto);
    return rol !== 'lacteo' && rol !== 'aceite';
  });
  const permiteLacteo = entrada.categoria === 'Repostería'
    || entrada.categoria === 'Comida Italiana'
    || otrosPorVencer.length === 0;
  const nombres = [...new Set(entrada.nombres.map((nombre) => nombre.trim()).filter(Boolean))]
    .filter((nombre) => permiteLacteo || rolInsumo(nombre) !== 'lacteo')
    .filter((nombre) => {
      const texto = normalizarTexto(nombre);
      if (CATEGORIAS_SALADAS.includes(entrada.categoria) && DULCES_FUERA_DE_REPOSTERIA.test(texto)) return false;
      return encajaEnCategoria(nombre, entrada.categoria) || !CATEGORIAS_SALADAS.includes(entrada.categoria);
    });
  if (CATEGORIAS_SALADAS.includes(entrada.categoria) && DULCES_FUERA_DE_REPOSTERIA.test(normalizarTexto(titulo))) {
    return null;
  }
  const tipoPlato = normalizarTipoPlato(entrada.tipo_plato);
  if (CATEGORIAS_SALADAS.includes(entrada.categoria) && tipoPlato === 'Dulce') {
    return null;
  }
  // Todos los por vencer coherentes con la categoría (mín. 1 obligatorio en la receta).
  const porVencerAfines = entrada.porVencer.filter((item) => {
    const texto = normalizarTexto(item.producto);
    if (CATEGORIAS_SALADAS.includes(entrada.categoria) && DULCES_FUERA_DE_REPOSTERIA.test(texto)) return false;
    return encajaEnCategoria(item.producto, entrada.categoria);
  });
  const clavesVencer = new Set(porVencerAfines.map((item) => normalizarTexto(item.producto)));
  // Sin inyección forzada: solo se usan los nombres que devolvió el modelo.
  const ingredientesBase = ingredientesMedidos(nombres, entrada.insumos, entrada.pedidos);
  const ingredientes = ingredientesBase.map((ing) => {
    const clave = normalizarTexto(ing.producto);
    const ficha = entrada.insumos.find((fila) => normalizarTexto(fila.producto) === clave);
    const inventarioId = entrada.idsPorNombre?.get(clave)
      || (ficha?.id != null ? String(ficha.id) : undefined);
    const esRescate = ficha?.por_vencer === true
      || clavesVencer.has(clave)
      || entrada.rescatePorNombre?.get(clave) === true;
    return {
      ...ing,
      ...(inventarioId ? { inventario_id: inventarioId } : {}),
      es_rescate: Boolean(esRescate),
    };
  });
  const minimo = entrada.insumos.length > 1 ? 2 : 1;
  const pasos = pasosDelModelo(entrada.pasos);
  const rescatesEnReceta = ingredientes.filter((ing) => clavesVencer.has(normalizarTexto(ing.producto)));
  // Obligatorio: al menos 1 insumo por vencer. Si no hay afines, no se puede validar rescate.
  const incluyeVencer = porVencerAfines.length === 0
    ? false
    : rescatesEnReceta.length >= 1;
  if (
    ingredientes.length < minimo
    || pasos.length < 3
    || !incluyeVencer
    || !tituloCoherente(titulo, ingredientes)
    || !pasosCoherentesConIngredientes(pasos, ingredientes)
  ) {
    return null;
  }
  const implementos = (Array.isArray(entrada.implementos) ? entrada.implementos : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const tiempo = Number(entrada.tiempo_minutos);
  const porciones = Number(entrada.porciones);
  return {
    tipo: 'receta' as const,
    titulo,
    tipo_plato: tipoPlato,
    ...(Number.isFinite(tiempo) && tiempo > 0 ? { tiempo_minutos: Math.round(tiempo) } : {}),
    ...(Number.isFinite(porciones) && porciones > 0 ? { porciones: Math.round(porciones) } : {}),
    ...(implementos.length > 0 ? { implementos } : {}),
    descripcion: describirRescate(entrada.categoria, ingredientes, entrada.insumos),
    insumos_usados: ingredientes.map((ing) => ing.producto),
    ingredientes,
    // Pasos del modelo tal cual (sin "Mide y separa..." ni plantillas estáticas).
    pasos,
  };
};

const VACIAS_TITULO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'al', 'en', 'a', 'un', 'una', 'para', 'tipo', 'no', 'su']);

export const tokensPlato = (titulo: string) =>
  normalizarTexto(titulo)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !VACIAS_TITULO.has(token));

const jaccard = (a: string[], b: string[]) => {
  const uno = new Set(a);
  const dos = new Set(b);
  if (uno.size === 0 || dos.size === 0) return 0;
  let inter = 0;
  for (const token of uno) if (dos.has(token)) inter += 1;
  return inter / new Set([...uno, ...dos]).size;
};

const familiaTecnica = (tokens: string[]) => {
  const texto = tokens.join(' ');
  if (/torta|quiche|frittata|omelette|tortilla/.test(texto)) return 'huevo-horno';
  if (/pasta|spaghetti|fettuccine|lasagna|noqui|penne|tagliatelle|pomodoro|aglio/.test(texto)) return 'pasta';
  if (/risotto/.test(texto)) return 'risotto';
  if (/pizza|focaccia|bruschetta/.test(texto)) return 'masa-horno';
  if (/ensalada|caprese/.test(texto)) return 'ensalada';
  if (/sopa|minestrone|caldo|tom yum|wantan/.test(texto)) return 'sopa';
  if (/cazuela|charquican|tomatican|pastel de papa/.test(texto)) return 'guiso-chileno';
  if (/pebre/.test(texto)) return 'pebre';
  if (/sopaipilla/.test(texto)) return 'frito';
  if (/sandwich|hamburguesa|wrap|completo|quesadilla/.test(texto)) return 'sandwich';
  if (/queque|muffin|panqueque/.test(texto)) return 'queque';
  if (/brownie|chocolate/.test(texto) && /torta/.test(texto) === false) return 'brownie';
  if (/galleta|alfajor/.test(texto)) return 'galleta';
  if (/cheesecake|crema pastelera/.test(texto)) return 'crema';
  if (/curry|kra pao/.test(texto)) return 'curry';
  if (/pad|noodle|chow mein|fideos/.test(texto)) return 'fideos';
  if (/kung pao|chop suey|agridulce/.test(texto)) return 'salteado-chino';
  if (/arroz/.test(texto)) return 'arroz';
  return '';
};

const clavesInsumo = (ingredientes: IngredienteMedido[]) =>
  [...new Set(
    ingredientes
      .map((ing) => normalizarTexto(cortoInsumo(ing.producto)))
      .filter((nombre) => nombre.length >= 4 && !/aceite|sal fina|sal de mesa|^agua\b/.test(nombre))
  )];

export const FAMILIAS_IA: Record<string, { ids: string[]; prompt: string }[]> = {
  'Comida Italiana': [
    { ids: ['pasta'], prompt: 'pasta o ñoquis con salsa (prohibido: torta, quiche, frittata)' },
    { ids: ['risotto', 'masa-horno'], prompt: 'risotto, pizza o bruschetta (no pasta ni spaghetti ni fettuccine)' },
    { ids: ['ensalada', 'sopa', 'huevo-horno'], prompt: 'ensalada caprese, minestrone o frittata salada' },
  ],
  'Comida Rápida': [
    { ids: ['sandwich'], prompt: 'sándwich, hamburguesa o wrap' },
    { ids: ['huevo-horno'], prompt: 'huevos, papas o quesadilla (otro formato)' },
    { ids: ['ensalada', 'frito'], prompt: 'ensalada, nuggets u empanada' },
  ],
  'Comida Tailandesa': [
    { ids: ['fideos'], prompt: 'pad thai o noodles al wok' },
    { ids: ['curry', 'sopa'], prompt: 'curry, tom yum o kra pao' },
    { ids: ['ensalada', 'arroz', 'huevo-horno'], prompt: 'ensalada som tam, arroz frito o huevos thai' },
  ],
  'Comida Chilena': [
    { ids: ['guiso-chileno'], prompt: 'cazuela, charquicán o tomaticán' },
    { ids: ['huevo-horno', 'sopa'], prompt: 'tortilla de papa, pastel de papa o pantrucas' },
    { ids: ['pebre', 'sandwich', 'frito'], prompt: 'pebre, completo o sopaipillas' },
  ],
  'Comida China': [
    { ids: ['arroz', 'fideos'], prompt: 'arroz frito o chow mein' },
    { ids: ['salteado-chino'], prompt: 'pollo kung pao, chop suey o agridulce' },
    { ids: ['sopa', 'huevo-horno'], prompt: 'sopa wantán, rollitos o huevos fu yung' },
  ],
  'Repostería': [
    { ids: ['queque'], prompt: 'queque, muffins o panqueques' },
    { ids: ['brownie', 'galleta'], prompt: 'brownies, galletas o crumble (no otro queque)' },
    { ids: ['crema'], prompt: 'cheesecake, crema pastelera o alfajores' },
  ],
};

export const elegirFamiliaIa = (categoria: string, titulosOcupados: string[]) => {
  const ocupadas = new Set(titulosOcupados.map((titulo) => familiaTecnica(tokensPlato(titulo))).filter(Boolean));
  const lista = FAMILIAS_IA[categoria] ?? FAMILIAS_IA['Comida Italiana'];
  return lista.find((familia) => !familia.ids.some((id) => ocupadas.has(id))) ?? lista[lista.length - 1] ?? lista[0];
};

export const tituloInvalido = (titulo: string) => {
  const limpio = normalizarTexto(titulo);
  return !limpio || /^preparacion de /.test(limpio) || /no incluida|en su lugar/.test(limpio);
};

export const tituloParecido = (titulo: string, usados: string[], mismaTecnica = false) => {
  if (tituloInvalido(titulo)) return true;
  const tokens = tokensPlato(titulo);
  return usados.some((previo) => {
    const otros = tokensPlato(previo);
    if (jaccard(tokens, otros) >= 0.5) return true;
    const familia = familiaTecnica(tokens);
    return mismaTecnica && Boolean(familia) && familia === familiaTecnica(otros);
  });
};

export const recetaEsDistinta = (nueva: SugerenciaRescate, anteriores: SugerenciaRescate[]) => {
  if (tituloParecido(nueva.titulo, anteriores.map((item) => item.titulo), true)) return false;
  const insumosNuevo = clavesInsumo(nueva.ingredientes);
  return anteriores.every((previa) => jaccard(insumosNuevo, clavesInsumo(previa.ingredientes)) < 0.8);
};
