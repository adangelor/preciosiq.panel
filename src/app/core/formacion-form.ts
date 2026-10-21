import { Aviso, BaseMargen, CartelItem, Competencia, ConfiguracionDePrecios, RedondeoModo, SugeridoItem } from './formacion.models';
import { texto as textoDePromo, vistaPrevia as vistaPreviaDePromo } from './promo-calculator';

// BP-181 (21-oct-2026) -- lo que la formación de precios y los carteles muestran y calculan, en funciones puras (con spec).
// La fórmula es ESPEJO de FormacionDePreciosService.PrecioFinal / Redondear (backend): acá solo sirve para el ejemplo vivo
// de la configuración. El sugerido de cada artículo lo calcula siempre el servidor.

/** El precio final antes de redondear, o null si la configuración no da un precio (margen sobre el precio de 100 % o más). */
export function precioFinal(
  costoNeto: number, costoConIva: number | null, ivaPct: number, impuestosInternosPct: number | null, margenPct: number,
  base: BaseMargen, discriminaIva: boolean,
): number | null {
  const costo = discriminaIva ? costoNeto : costoConIva ?? costoNeto * (1 + ivaPct / 100);
  const conInternos = costo * (1 + (impuestosInternosPct ?? 0) / 100);
  let neto: number;
  if (base === 'sobre_precio') {
    if (margenPct >= 100) return null;
    neto = conInternos / (1 - margenPct / 100);
  } else neto = conInternos * (1 + margenPct / 100);
  return discriminaIva ? neto * (1 + ivaPct / 100) : neto;
}

/** Al múltiplo, hacia arriba o al más cercano. "Termina en 9": de a 10 queda 1 abajo ($1.579); de a 100 o más, 10 abajo ($1.590). */
export function redondear(precio: number, multiplo: number, modo: RedondeoModo, terminarEn9: boolean): number {
  const m = multiplo > 0 ? multiplo : 1;
  // El 1e-9 evita que 1573.0000000001 / 10 suba un escalón por el punto flotante.
  const al = (x: number) => (modo === 'cercano' ? Math.round(x / m) : Math.ceil(x / m - 1e-9)) * m;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  if (!terminarEn9 || m < 10) return r2(al(precio));
  const resta = m >= 100 ? 10 : 1;
  return r2(al(precio + resta) - resta);
}

/** "Costo $1.000, margen 30 % sobre el costo, IVA 21 % → $1.573 → $1.580" (o el motivo si no da un precio). */
export function ejemploDeConfiguracion(c: Pick<ConfiguracionDePrecios, 'margenDefaultPct' | 'baseMargen' | 'redondeoMultiplo' | 'redondeoModo' | 'terminarEn9'>): string {
  const p = precioFinal(1000, null, 21, null, c.margenDefaultPct, c.baseMargen, true);
  const base = c.baseMargen === 'sobre_precio' ? 'sobre el precio' : 'sobre el costo';
  const inicio = `Costo ${pesos(1000)} sin IVA, margen ${pct(c.margenDefaultPct)} ${base}, IVA 21 %`;
  if (p == null) return `${inicio}: con el margen sobre el precio, 100 % o más no da un precio.`;
  return `${inicio} → ${pesos(p, true)} → ${pesos(redondear(p, c.redondeoMultiplo, c.redondeoModo, c.terminarEn9))}`;
}

/** "$1.580" (sin decimales si es entero) o, con `decimales`, "$1.572,99". */
export function pesos(n: number | null | undefined, decimales = false): string {
  if (n == null) return '—';
  const entero = Math.abs(n - Math.round(n)) < 0.005;
  const d = decimales || !entero ? 2 : 0;
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: d, maximumFractionDigits: d });
}

function pct(n: number): string {
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

/** "+7,1 %", "−3 %", "—". */
export function diferenciaTexto(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '0 %';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
}

/** El margen usado y de dónde sale: "30 % propio", "30 % (de Almacén)", "25 % (por defecto)". */
export function margenUsado(i: Pick<SugeridoItem, 'margenPct' | 'margenDe'>): string {
  if (i.margenDe === 'propio') return `${pct(i.margenPct)} propio`;
  return `${pct(i.margenPct)} (${i.margenDe === 'por defecto' ? 'por defecto' : `de ${i.margenDe}`})`;
}

/** "$6.950 – $7.200 – $8.415" (mín – referencia – máx). */
export function competenciaTexto(c: Competencia | null): string {
  if (!c || c.cadenas === 0) return '—';
  return [c.minimo, c.referencia, c.maximo].map((x) => pesos(x)).join(' – ');
}

export interface AvisoInfo {
  texto: string;
  clase: string;
  ayuda: string;
}

export const AVISOS: Record<Aviso, AvisoInfo> = {
  caro: { texto: 'Caro para la zona', clase: 'pill--danger', ayuda: 'El sugerido supera lo que cobra la competencia más cara.' },
  dejas_margen: { texto: 'Dejás margen', clase: 'pill--info', ayuda: 'El sugerido queda muy abajo de la competencia más barata: podrías cobrar más.' },
  testigo: { texto: 'Testigo fuera de meta', clase: 'pill--warning', ayuda: 'Es un producto testigo y el sugerido no cumple su meta (la nacional más barata + 3 %).' },
  renegociar: { texto: 'Renegociar costo', clase: 'pill--warning', ayuda: 'Tu costo ya supera lo que cobra la cadena más barata de la zona.' },
  dudosa: { texto: 'Comparación dudosa', clase: 'pill--neutral', ayuda: 'Puede ser otro producto con el mismo código (pack contra unidad, código dudoso): mirala antes de creerle.' },
  sin_costo: { texto: 'Sin costo', clase: 'pill--neutral', ayuda: 'Sin costo cargado no hay precio sugerido. Cargalo en la ficha del artículo o por planilla.' },
};

/** Los avisos que se pueden elegir como filtro, en orden. */
export const AVISOS_FILTRO: Aviso[] = ['caro', 'dejas_margen', 'testigo', 'renegociar', 'dudosa', 'sin_costo'];

export interface PrecioElegido {
  item: SugeridoItem;
  precio: number;
}

export interface ResumenDeAplicar {
  total: number;
  suben: number;
  bajan: number;
  iguales: number;
  masSube: { descripcion: string; pct: number } | null;
  masBaja: { descripcion: string; pct: number } | null;
}

/** "Suben 120, bajan 14, el que más sube +18 % Galletitas X". */
export function resumenDeAplicar(filas: PrecioElegido[]): ResumenDeAplicar {
  let suben = 0, bajan = 0, iguales = 0;
  let masSube: ResumenDeAplicar['masSube'] = null;
  let masBaja: ResumenDeAplicar['masBaja'] = null;
  for (const f of filas) {
    const actual = f.item.precioActual;
    if (actual == null || actual <= 0 || f.precio === actual) {
      iguales++;
      continue;
    }
    const d = Math.round(((f.precio - actual) / actual) * 1000) / 10;
    if (f.precio > actual) {
      suben++;
      if (!masSube || d > masSube.pct) masSube = { descripcion: f.item.descripcion, pct: d };
    } else {
      bajan++;
      if (!masBaja || d < masBaja.pct) masBaja = { descripcion: f.item.descripcion, pct: d };
    }
  }
  return { total: filas.length, suben, bajan, iguales, masSube, masBaja };
}

export function resumenTexto(r: ResumenDeAplicar): string {
  const partes = [`suben ${r.suben}`, `bajan ${r.bajan}`];
  if (r.iguales > 0) partes.push(`${r.iguales} quedan igual`);
  let t = partes.join(', ');
  if (r.masSube) t += `; el que más sube: ${diferenciaTexto(r.masSube.pct)} ${r.masSube.descripcion}`;
  if (r.masBaja) t += `; el que más baja: ${diferenciaTexto(r.masBaja.pct)} ${r.masBaja.descripcion}`;
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

/** Filas para el Excel de la tabla de sugeridos. */
export function filasExcelSugeridos(items: SugeridoItem[]): Record<string, string | number | null>[] {
  return items.map((i) => ({
    'Código': i.codigo,
    'Descripción': i.descripcion,
    'Marca': i.marca,
    'Rubro': i.rubro,
    'Proveedor': i.proveedor,
    'Costo sin IVA': i.costoNeto,
    'Costo desde': i.costoDesde,
    'IVA %': i.ivaAlicuota,
    'Margen %': i.margenPct,
    'Margen de': i.margenDe,
    'Precio actual': i.precioActual,
    'Sugerido': i.sugerido,
    'Diferencia %': i.diferenciaPct,
    'Competencia mínimo': i.competencia?.minimo ?? null,
    'Competencia referencia': i.competencia?.referencia ?? null,
    'Competencia máximo': i.competencia?.maximo ?? null,
    'Cadenas': i.competencia?.cadenas ?? null,
    'Avisos': i.avisos.map((a) => AVISOS[a].texto).join(', ') || null,
  }));
}

// ------------------------------------------------------------------ carteles de góndola
const KILO = new Set(['kg', 'kgm', 'kgr', 'kilo', 'kilos', 'kilogramo', 'kilogramos']);
const LITRO = new Set(['lt', 'l', 'ltr', 'litro', 'litros', 'lts']);
const GRAMO = new Set(['g', 'gr', 'grm', 'gramo', 'gramos', 'grs']);
const ML = new Set(['ml', 'cc', 'cm3', 'mililitro', 'mililitros']);
const UNIDAD = new Set(['un', 'u', 'ud', 'uni', 'unidad', 'unidades', 'ea', 'und']);

function normal(u: string | null | undefined): string {
  return (u ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/** "el kilo", "el litro", "los 100 g", o null (unidad suelta o desconocida: el cartel no lo muestra). */
export function unidadDeReferencia(unidad: string | null | undefined, cantidad: number | null | undefined): string | null {
  const u = normal(unidad);
  const q = cantidad ?? 1;
  if (KILO.has(u)) return q === 1 ? 'el kilo' : null;
  if (LITRO.has(u)) return q === 1 ? 'el litro' : null;
  if (GRAMO.has(u) && q === 100) return 'los 100 g';
  if (ML.has(u) && q === 100) return 'los 100 ml';
  return null;
}

/** "900 ml", "1 kg", "x 6"; vacío para "1 unidad". */
export function presentacionTexto(cantidad: number, unidad: string | null | undefined): string {
  const u = normal(unidad);
  const q = cantidad.toLocaleString('es-AR', { maximumFractionDigits: 3 });
  if (!u || UNIDAD.has(u)) return cantidad > 1 ? `x ${q}` : '';
  if (KILO.has(u)) return `${q} kg`;
  if (LITRO.has(u)) return `${q} l`;
  if (GRAMO.has(u)) return `${q} g`;
  if (ML.has(u)) return `${q} ml`;
  return `${q} ${unidad!.trim()}`;
}

/** "$4.250 el kilo", o null si no aporta (la unidad no es de medida o es el mismo precio del cartel). */
export function referenciaDelCartel(c: Pick<CartelItem, 'precio' | 'precioReferencia' | 'cantidadReferencia' | 'unidadReferencia'>): string | null {
  if (c.precioReferencia == null || c.precioReferencia <= 0) return null;
  const u = unidadDeReferencia(c.unidadReferencia, c.cantidadReferencia);
  if (!u || Math.abs(c.precioReferencia - c.precio) < 0.005) return null;
  return `${pesos(c.precioReferencia)} ${u}`;
}

/** El texto de la promo del cartel ("3x2") y su ejemplo ("Llevando 3 de $1.000: $2.000 (ahorra $1.000)"). */
export function promoDelCartel(c: Pick<CartelItem, 'precio' | 'promo'>, hoy: string): { texto: string; ejemplo: string | null } | null {
  if (!c.promo) return null;
  return { texto: textoDePromo(c.promo), ejemplo: vistaPreviaDePromo(c.promo, c.precio, hoy) };
}

/** El precio grande del cartel: los pesos y, si hay, los centavos aparte ("1.580" y null; "1.579" y "90"). */
export function precioPartido(n: number): { enteros: string; centavos: string | null } {
  const enteros = Math.trunc(n);
  const cent = Math.round((n - enteros) * 100);
  return {
    enteros: enteros.toLocaleString('es-AR'),
    centavos: cent > 0 ? String(cent).padStart(2, '0') : null,
  };
}

export type TamanoDeCartel = 'chico' | 'mediano' | 'grande';

/** Cuántos entran en una hoja A4 y la medida de cada uno. */
export const TAMANOS: Record<TamanoDeCartel, { porHoja: number; columnas: number; etiqueta: string }> = {
  chico: { porHoja: 24, columnas: 3, etiqueta: 'Chico (24 por hoja, 66 × 36 mm)' },
  mediano: { porHoja: 10, columnas: 2, etiqueta: 'Mediano (10 por hoja, 99 × 57 mm)' },
  grande: { porHoja: 4, columnas: 2, etiqueta: 'Grande (4 por hoja, 99 × 142 mm)' },
};

/** Los carteles en hojas: cada hoja, a lo sumo `porHoja`. */
export function enHojas<T>(items: T[], porHoja: number): T[][] {
  const hojas: T[][] = [];
  for (let i = 0; i < items.length; i += porHoja) hojas.push(items.slice(i, i + porHoja));
  return hojas;
}
