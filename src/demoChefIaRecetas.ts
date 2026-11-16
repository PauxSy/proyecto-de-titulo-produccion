// =============================================================================
// TEMPORAL — DEMO RÁPIDA CHEF IA
// Para revertir: pon DEMO_CHEF_IA_RAPIDO = false (o elimina este archivo y el
// bloque marcado TEMPORAL DEMO en src/index.ts).
// =============================================================================

export const DEMO_CHEF_IA_RAPIDO = true;
export const DEMO_CHEF_IA_DELAY_MS = 3000;

type Ing = { producto: string; cantidad: number; unidad: string; es_rescate?: boolean };
type RecetaDemo = {
  tipo: 'receta';
  titulo: string;
  tipo_plato: 'Salado' | 'Dulce' | 'Agridulce';
  tiempo_minutos: number;
  porciones: number;
  implementos: string[];
  descripcion: string;
  insumos_usados: string[];
  ingredientes: Ing[];
  pasos: string[];
};

const r = (
  titulo: string,
  tipo_plato: RecetaDemo['tipo_plato'],
  tiempo_minutos: number,
  porciones: number,
  implementos: string[],
  ingredientes: Ing[],
  pasos: string[],
  descripcion: string,
): RecetaDemo => ({
  tipo: 'receta',
  titulo,
  tipo_plato,
  tiempo_minutos,
  porciones,
  implementos,
  descripcion,
  insumos_usados: ingredientes.map((i) => i.producto),
  ingredientes,
  pasos,
});

/** 5 recetas IA prearmadas por categoría de restaurante (solo demo). */
export const RECETAS_DEMO_POR_CATEGORIA: Record<string, RecetaDemo[]> = {
  'Repostería': [
    r('Queque húmedo de la casa', 'Dulce', 40, 8, ['bol', 'molde', 'horno'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 250, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Azúcar Granulada 1kg', cantidad: 180, unidad: 'g', es_rescate: true },
      { producto: 'Crema para Batir UHT 1L', cantidad: 100, unidad: 'ml', es_rescate: true },
    ], [
      'Tamiza la harina con el azúcar en un bol.',
      'Incorpora los huevos y la crema; mezcla hasta que no queden grumos.',
      'Vierte en molde engrasado y hornea 30 minutos a 180 °C.',
      'Deja enfriar 10 minutos antes de desmoldar.',
    ], 'Rescata harina, huevos y crema próximos a vencer en un queque clásico.'),
    r('Brownies de cacao exprés', 'Dulce', 35, 9, ['bol', 'molde', 'horno'], [
      { producto: 'Harina sin Polvos de Horno 1kg', cantidad: 120, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Azúcar Granulada 1kg', cantidad: 150, unidad: 'g', es_rescate: true },
      { producto: 'Margarina para Hojaldre 1kg', cantidad: 80, unidad: 'g', es_rescate: true },
    ], [
      'Derrite la margarina y mézclala con el azúcar.',
      'Agrega huevos y harina hasta obtener una masa espesa.',
      'Hornea 22 minutos a 180 °C; el centro debe quedar húmedo.',
      'Corta en cuadrados al enfriar.',
    ], 'Aprovecha margarina y huevos en un brownie rápido.'),
    r('Muffins de arándanos', 'Dulce', 30, 6, ['molde muffins', 'bol', 'horno'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 200, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Arándanos Congelados 1kg', cantidad: 120, unidad: 'g', es_rescate: true },
      { producto: 'Crema para Batir UHT 1L', cantidad: 80, unidad: 'ml', es_rescate: true },
    ], [
      'Mezcla harina, huevos y crema hasta una masa suave.',
      'Incorpora los arándanos con movimientos envolventes.',
      'Llena moldes a 3/4 y hornea 18 minutos a 180 °C.',
      'Sirve tibios o a temperatura ambiente.',
    ], 'Rescata arándanos y crema en muffins de vitrina.'),
    r('Panqueques de domingo', 'Dulce', 20, 4, ['bol', 'sartén'], [
      { producto: 'Harina Integral de Trigo 1kg', cantidad: 150, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Crema para Batir UHT 1L', cantidad: 150, unidad: 'ml', es_rescate: true },
      { producto: 'Azúcar Granulada 1kg', cantidad: 30, unidad: 'g' },
    ], [
      'Bate una masa líquida con harina, huevos, crema y azúcar.',
      'Calienta la sartén y cocina 1 minuto por lado.',
      'Apila y sirve con un toque de azúcar o mermelada si hay.',
    ], 'Desayuno rápido con harina y huevos por vencer.'),
    r('Cheesecake frío de queso crema', 'Dulce', 25, 8, ['molde', 'batidor', 'refrigerador'], [
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 300, unidad: 'g', es_rescate: true },
      { producto: 'Crema para Batir UHT 1L', cantidad: 200, unidad: 'ml', es_rescate: true },
      { producto: 'Azúcar Granulada 1kg', cantidad: 80, unidad: 'g', es_rescate: true },
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 40, unidad: 'g' },
    ], [
      'Bate el queso crema con el azúcar hasta que quede liso.',
      'Incorpora la crema y un poco de harina para dar cuerpo.',
      'Vierte en molde y refrigera al menos 2 horas.',
      'Desmolda y sirve frío.',
    ], 'Rescata queso crema y crema UHT en postre frío.'),
  ],
  'Comida Italiana': [
    r('Spaghetti al pomodoro de rescate', 'Salado', 25, 3, ['olla', 'sartén'], [
      { producto: 'Tomate fresco', cantidad: 3, unidad: 'unidades', es_rescate: true },
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 200, unidad: 'g', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 1, unidad: 'huevos', es_rescate: true },
    ], [
      'Corta el tomate y sofríe en aceite 8 minutos hasta reducir.',
      'Arma tiras de masa con harina y huevo; hierve 4 minutos.',
      'Mezcla la pasta con la salsa de tomate.',
      'Sirve al momento con un chorrito de aceite.',
    ], 'Usa tomate y harina por vencer en un pomodoro casero.'),
    r('Pizza rápida al sartén', 'Salado', 20, 2, ['sartén', 'tabla'], [
      { producto: 'Harina sin Polvos de Horno 1kg', cantidad: 180, unidad: 'g', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 80, unidad: 'g', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
    ], [
      'Estira una masa delgada con harina y un poco de agua.',
      'Cubre con tomate picado y queso crema.',
      'Cocina 8 minutos tapada a fuego medio.',
      'Corta en porciones y sirve caliente.',
    ], 'Pizza exprés con tomate y harina de rescate.'),
    r('Ñoquis a la sartén', 'Salado', 30, 3, ['olla', 'sartén'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 200, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
    ], [
      'Forma ñoquis con harina y huevo; hierve hasta que floten.',
      'Sofríe tomate en aceite 6 minutos.',
      'Acaba los ñoquis 2 minutos en la sartén con la salsa.',
      'Sirve inmediato.',
    ], 'Ñoquis de rescate con tomate fresco.'),
    r('Frittata de tomate y queso', 'Salado', 18, 2, ['sartén'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 60, unidad: 'g', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
    ], [
      'Bate los huevos con el queso crema.',
      'Saltea tomate en aceite y vierte la mezcla.',
      'Cocina 4 minutos por lado hasta cuajar.',
      'Sirve en porciones.',
    ], 'Frittata italiana con huevos y tomate por vencer.'),
    r('Bruschetta de tomate', 'Salado', 15, 4, ['tabla', 'horno'], [
      { producto: 'Tomate fresco', cantidad: 3, unidad: 'unidades', es_rescate: true },
      { producto: 'Harina Integral de Trigo 1kg', cantidad: 120, unidad: 'g', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 40, unidad: 'g' },
    ], [
      'Tuésta bases de masa o pan con harina.',
      'Pica el tomate y mézclalo con aceite.',
      'Unta un velo de queso crema y cubre con tomate.',
      'Sirve al momento.',
    ], 'Entrada rápida que prioriza el tomate fresco.'),
  ],
  'Comida Rápida': [
    r('Huevos revueltos express', 'Salado', 10, 2, ['sartén', 'espátula'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 1, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 30, unidad: 'g' },
    ], [
      'Bate los huevos con un poco de queso crema.',
      'Saltea tomate en aceite 2 minutos.',
      'Vierte los huevos y cocina moviendo 2 minutos.',
      'Sirve caliente.',
    ], 'Desayuno rápido con huevos por vencer.'),
    r('Quesadilla de tomate', 'Salado', 12, 2, ['sartén'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 150, unidad: 'g', es_rescate: true },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 80, unidad: 'g', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
    ], [
      'Estira discos de masa con harina.',
      'Rellena con queso y tomate; cierra.',
      'Dora 2 minutos por lado.',
      'Corta en triángulos.',
    ], 'Snack rápido con harina y tomate de rescate.'),
    r('Wrap de huevo y tomate', 'Salado', 15, 2, ['sartén', 'tabla'], [
      { producto: 'Harina sin Polvos de Horno 1kg', cantidad: 140, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
    ], [
      'Cocina una tortilla delgada de harina.',
      'Revuelve huevos y tomate 3 minutos.',
      'Enrolla el wrap y marca 1 minuto por lado.',
      'Sirve al tiro.',
    ], 'Wrap de servicio rápido con insumos por vencer.'),
    r('Empanada exprés al horno', 'Salado', 25, 4, ['uslero', 'lata', 'horno'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 220, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 60, unidad: 'g', es_rescate: true },
    ], [
      'Arma masa con harina y un huevo.',
      'Rellena con tomate y queso; pinta con huevo.',
      'Hornea 18 minutos a 200 °C.',
      'Sirve tibias.',
    ], 'Empanadas de vitrina con harina y tomate.'),
    r('Sándwich tostado de la casa', 'Salado', 12, 2, ['sartén', 'tabla'], [
      { producto: 'Harina Integral de Trigo 1kg', cantidad: 120, unidad: 'g', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 1, unidad: 'huevos', es_rescate: true },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 50, unidad: 'g', es_rescate: true },
    ], [
      'Prepara bases con harina o pan plano.',
      'Arma tomate, queso y huevo cocido o frito.',
      'Dora 2 minutos por lado.',
      'Sirve cortado al medio.',
    ], 'Sándwich caliente con rescate de tomate y huevo.'),
  ],
  'Comida Tailandesa': [
    r('Huevos thai al sartén', 'Salado', 15, 2, ['sartén'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 40, unidad: 'g' },
    ], [
      'Fríe los huevos a fuego medio-alto en aceite.',
      'Saltea tomate al lado 3 minutos.',
      'Sirve juntos con un toque de harina tostada si quieres textura.',
      'Come al momento.',
    ], 'Plato thai rápido con huevos por vencer.'),
    r('Salteado agridulce de tomate', 'Agridulce', 18, 2, ['wok', 'sartén'], [
      { producto: 'Tomate fresco', cantidad: 3, unidad: 'unidades', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Azúcar Granulada 1kg', cantidad: 15, unidad: 'g' },
    ], [
      'Saltea tomate en aceite a fuego alto.',
      'Agrega un toque de azúcar para brillo agridulce.',
      'Incorpora huevo revuelto al final 1 minuto.',
      'Sirve caliente.',
    ], 'Agridulce coherente con tomate de rescate.'),
    r('Noodles de harina al wok', 'Salado', 20, 2, ['olla', 'wok'], [
      { producto: 'Harina sin Polvos de Horno 1kg', cantidad: 180, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
    ], [
      'Corta tiras de masa y hiérvelas 3 minutos.',
      'Saltea en wok con aceite, huevo y tomate 4 minutos.',
      'Ajusta de sal y sirve al tiro.',
    ], 'Noodles caseros con harina y huevo por vencer.'),
    r('Tortilla thai de tomate', 'Salado', 12, 2, ['sartén'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
      { producto: 'Harina Integral de Trigo 1kg', cantidad: 30, unidad: 'g' },
    ], [
      'Bate huevos con un poco de harina.',
      'Agrega tomate picado y cocina 3 minutos por lado.',
      'Sirve doblada.',
    ], 'Tortilla aromática con insumos de rescate.'),
    r('Bowl de huevo y tomate al limón', 'Salado', 14, 2, ['sartén', 'bol'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 3, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 20, unidad: 'g' },
    ], [
      'Saltea tomate en aceite.',
      'Suma huevos revueltos y mezcla 2 minutos.',
      'Sirve en bowl con un toque ácido si hay limón; si no, solo sal.',
    ], 'Bowl rápido estilo thai con tomate fresco.'),
  ],
  'Comida Chilena': [
    r('Tomaticán de rescate', 'Salado', 20, 3, ['sartén'], [
      { producto: 'Tomate fresco', cantidad: 3, unidad: 'unidades', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 30, unidad: 'g' },
    ], [
      'Sofríe tomate en aceite 8 minutos.',
      'Agrega huevos y cocina hasta cuajar suave.',
      'Ajusta espesor con un poco de harina si hace falta.',
      'Sirve con pan o solo.',
    ], 'Tomaticán coherente con tomate y huevos por vencer.'),
    r('Huevos a la chilena', 'Salado', 15, 2, ['sartén'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 40, unidad: 'g' },
    ], [
      'Fríe o revuelve los huevos en aceite.',
      'Saltea tomate al lado.',
      'Termina con un toque de queso crema derretido.',
      'Sirve al momento.',
    ], 'Clásico chileno de rescate con huevos.'),
    r('Pantrucas de harina', 'Salado', 25, 3, ['olla', 'cuchillo'], [
      { producto: 'Harina sin Polvos de Horno 1kg', cantidad: 200, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 1, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
    ], [
      'Arma masa de harina y huevo; corta tiras.',
      'Prepara caldo con tomate sofrito y agua.',
      'Hierve las pantrucas 6 minutos.',
      'Sirve en plato hondo.',
    ], 'Pantrucas con harina y tomate de rescate.'),
    r('Sopaipillas de la casa', 'Salado', 20, 6, ['sartén', 'uslero'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 250, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 1, unidad: 'huevos', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 200, unidad: 'ml' },
      { producto: 'Tomate fresco', cantidad: 1, unidad: 'unidades', es_rescate: true },
    ], [
      'Mezcla harina y huevo; estira discos delgados.',
      'Fríe 1 minuto por lado en aceite caliente.',
      'Acompaña con pebre rápido de tomate picado.',
      'Sirve calientes.',
    ], 'Sopaipillas que usan harina por vencer.'),
    r('Completo italiano exprés', 'Salado', 12, 2, ['tabla', 'sartén'], [
      { producto: 'Harina Integral de Trigo 1kg', cantidad: 120, unidad: 'g', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Queso Crema Tipo Philadelphia 1.3kg', cantidad: 50, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 1, unidad: 'huevos', es_rescate: true },
    ], [
      'Prepara base tipo pan con harina.',
      'Arma tomate, queso y huevo.',
      'Calienta 1 minuto y sirve.',
    ], 'Completo italiano con tomate y huevo de rescate.'),
  ],
  'Comida China': [
    r('Arroz frito de harina tostada', 'Salado', 18, 2, ['wok', 'sartén'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 100, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
    ], [
      'Tuesta un poco de harina en seco para base crocante.',
      'Saltea huevo y tomate en aceite a fuego alto.',
      'Mezcla 3 minutos y sirve.',
    ], 'Salteado estilo chino con huevo y tomate.'),
    r('Huevos fu yung', 'Salado', 15, 2, ['sartén'], [
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 3, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
      { producto: 'Harina sin Polvos de Horno 1kg', cantidad: 20, unidad: 'g' },
    ], [
      'Bate huevos con un poco de harina.',
      'Incorpora tomate picado.',
      'Cocina como tortilla abierta 3 minutos por lado.',
      'Sirve con salsa ligera de tomate si sobra.',
    ], 'Fu yung clásico con huevos por vencer.'),
    r('Fideos salteados al wok', 'Salado', 20, 2, ['olla', 'wok'], [
      { producto: 'Harina Integral de Trigo 1kg', cantidad: 180, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
    ], [
      'Corta tiras de masa y hierve 3 minutos.',
      'Saltea en wok con huevo y tomate 4 minutos.',
      'Sirve al tiro.',
    ], 'Chow mein casero con harina de rescate.'),
    r('Sopa wantán exprés', 'Salado', 22, 3, ['olla'], [
      { producto: 'Harina de Trigo Tradicional 1kg', cantidad: 150, unidad: 'g', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 1, unidad: 'huevos', es_rescate: true },
      { producto: 'Tomate fresco', cantidad: 2, unidad: 'unidades', es_rescate: true },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 1, unidad: 'cucharadas' },
    ], [
      'Arma wantanes o tiras con harina y huevo.',
      'Hierve en caldo de tomate 6 minutos.',
      'Sirve en plato hondo.',
    ], 'Sopa rápida con harina y tomate por vencer.'),
    r('Salteado agridulce de tomate', 'Agridulce', 16, 2, ['sartén'], [
      { producto: 'Tomate fresco', cantidad: 3, unidad: 'unidades', es_rescate: true },
      { producto: 'Huevos de Gallina (Caja 30 un)', cantidad: 2, unidad: 'huevos', es_rescate: true },
      { producto: 'Azúcar Granulada 1kg', cantidad: 20, unidad: 'g' },
      { producto: 'Aceite Vegetal Maravilla 1L', cantidad: 2, unidad: 'cucharadas' },
    ], [
      'Dora huevo en aceite y reserva.',
      'Reduce tomate con azúcar 5 minutos.',
      'Napa el huevo y sirve.',
    ], 'Agridulce chino coherente con tomate fresco.'),
  ],
};

const normalizar = (texto: string) =>
  String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Elige 1 receta del banco de 5, evitando títulos ya usados si se puede. */
export const elegirRecetaDemo = (categoria: string, evitar: string[] = []) => {
  const banco = RECETAS_DEMO_POR_CATEGORIA[categoria] || RECETAS_DEMO_POR_CATEGORIA['Comida Rápida'] || [];
  if (banco.length === 0) return null;
  const evitados = new Set(evitar.map(normalizar).filter(Boolean));
  const libres = banco.filter((receta) => !evitados.has(normalizar(receta.titulo)));
  const pool = libres.length > 0 ? libres : banco;
  const indice = Math.floor(Date.now() / 1000) % pool.length;
  return structuredClone(pool[indice]);
};

/** Ajusta nombres de insumos demo a los del inventario real (para sellos de vencimiento). */
export const adaptarRecetaDemoAInventario = (
  receta: RecetaDemo,
  inventario: { producto: string; por_vencer?: boolean }[],
) => {
  const porNombre = new Map(inventario.map((item) => [normalizar(item.producto), item.producto]));
  const resolver = (nombre: string) => {
    const clave = normalizar(nombre);
    if (porNombre.has(clave)) return porNombre.get(clave) as string;
    const parcial = [...porNombre.entries()].find(([k]) => k.includes(clave) || clave.includes(k));
    return parcial ? parcial[1] : nombre;
  };
  const ingredientes = receta.ingredientes.map((ing) => {
    const producto = resolver(ing.producto);
    const ficha = inventario.find((item) => normalizar(item.producto) === normalizar(producto));
    return {
      ...ing,
      producto,
      es_rescate: Boolean(ing.es_rescate || ficha?.por_vencer),
    };
  });
  return {
    ...receta,
    ingredientes,
    insumos_usados: ingredientes.map((ing) => ing.producto),
  };
};
