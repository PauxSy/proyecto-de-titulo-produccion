// Arma una receta completa alrededor de lo que está por vencer.
// Los demás ingredientes salen del inventario aunque les quede más fecha.

export type InsumoCocina = {
  producto: string;
  unidad_medida: string;
  cantidad_en_riesgo: number;
  dias_para_vencer: number | null;
  por_vencer: boolean;
};

export type IngredienteMedido = { producto: string; cantidad: number; unidad: string };

export type SugerenciaRescate = {
  tipo: 'receta';
  titulo: string;
  descripcion: string;
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

const completarGenerico = (categoria: string, heroe: InsumoCocina, despensa: InsumoCocina[]) => {
  const preferencia = PREFERENCIA_CATEGORIA[categoria];
  const basicos = [/aceite/, /(^|\s)sal fina|(^|\s)sal de mesa/, /azucar granulada/, /huevo/, /mantequilla sin sal|mantequilla/]
    .map((patron) => buscarInsumo(despensa, patron))
    .filter((item): item is InsumoCocina => item !== null);
  const afines = despensa
    .filter((item) => preferencia?.test(normalizarTexto(item.producto)))
    .filter((item) => rolInsumo(item.producto) !== 'lacteo' || categoria === 'Repostería');
  const apoyo = unicos([...basicos, ...afines])
    .filter((item) => normalizarTexto(item.producto) !== normalizarTexto(heroe.producto))
    .slice(0, 3);
  const universo = unicos([heroe, ...apoyo]);
  const rol = rolInsumo(heroe.producto);
  const titulo = rol === 'picable'
    ? `${cortoInsumo(heroe.producto)} salteado`
    : `Preparación de ${cortoInsumo(heroe.producto)}`;
  const nombres = universo.map((item) => item.producto);
  const ingredientes = ingredientesMedidos(nombres, universo);
  const pasos = pasosConMedidas('olla o sartén, cuchillo y bol', ingredientes, [
    `Parte de ${textoInsumo(ingredientes[0])}, que es el insumo por vencer.`,
    apoyo.length > 0
      ? `Suma ${ingredientes.slice(1).map(textoInsumo).join('; ')}.`
      : 'Cocina una porción chica, sin vaciar el envase.',
    'Cocina a fuego medio 12 minutos, hasta que el conjunto quede parejo.',
    `Sirve ${titulo}.`,
  ]);
  return publicar(categoria, titulo, nombres, pasos, universo);
};

export const armarSugerenciasLocales = (categoria: string, proximos: InsumoCocina[], despensa: InsumoCocina[]) => {
  const candidatos = proximos
    .filter((item) => item.por_vencer && !/prueba/.test(normalizarTexto(item.producto)))
    .sort((a, b) => puntajeHeroe(b, categoria) - puntajeHeroe(a, categoria) || Number(a.dias_para_vencer) - Number(b.dias_para_vencer));
  const vistas = new Set<string>();
  const recetas: SugerenciaRescate[] = [];
  for (const heroe of candidatos) {
    const otros = unicos([...candidatos.filter((item) => item !== heroe), ...despensa]);
    const armada = armarDesdePlantilla(categoria, heroe, otros);
    if (!armada) continue;
    const clave = normalizarTexto(armada.titulo);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    recetas.push(armada);
    if (recetas.length === 4) break;
  }
  if (recetas.length === 0 && candidatos[0]) {
    const generica = completarGenerico(categoria, candidatos[0], despensa);
    if (generica) recetas.push(generica);
  }
  return recetas;
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

export const cerrarSugerenciaModelo = (entrada: {
  categoria: string;
  titulo: string;
  nombres: string[];
  pasos: unknown;
  pedidos?: Map<string, number>;
  insumos: InsumoCocina[];
  porVencer: InsumoCocina[];
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
    .filter((nombre) => permiteLacteo || rolInsumo(nombre) !== 'lacteo');
  const ingredientes = ingredientesMedidos(nombres, entrada.insumos, entrada.pedidos);
  const minimo = entrada.insumos.length > 1 ? 2 : 1;
  const pasos = pasosDelModelo(entrada.pasos);
  const clavesVencer = new Set(entrada.porVencer.map((item) => normalizarTexto(item.producto)));
  const usaLoQueVence = ingredientes.some((ing) => clavesVencer.has(normalizarTexto(ing.producto)));
  if (ingredientes.length < minimo || pasos.length < 3 || !usaLoQueVence || !tituloCoherente(titulo, ingredientes)) {
    return null;
  }
  return {
    tipo: 'receta' as const,
    titulo,
    descripcion: describirRescate(entrada.categoria, ingredientes, entrada.insumos),
    insumos_usados: ingredientes.map((ing) => ing.producto),
    ingredientes,
    pasos: pasosConMedidas('olla o sartén, cuchillo y bol', ingredientes, pasos),
  };
};
