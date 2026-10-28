// BP-209 (28-oct-2026, bloque 4) -- "un mayorista cerca lo vende más barato que tu proveedor": los DTOs de
// GET /api/business/mayoristas/mas-baratos y la columna "Mayorista cerca" de la formación de precios
// (Services/Mayoristas/MayoristasCercaService.cs).

export type EtiquetaMayorista = 'mas_barato' | 'parecido' | 'mas_caro' | 'atipico';

export interface MayoristaCerca {
  commerceId: string;
  /** "Makro", "Maxiconsumo", "Yaguar"... */
  mayorista: string;
  sucursal: string | null;
  localidad: string | null;
  km: number;
  unidadSinIva: number | null;
  unidadConIva: number;
  /** Cuántas unidades trae el bulto (1 = se vende por unidad). */
  bulto: number;
  promoConIva: number | null;
  promoTexto: string | null;
  /** El precio del mayorista con el que se comparó (sin IVA, o con IVA si el comercio factura C). */
  precioComparado: number;
  costoComparado: number;
  comparaCon: 'sin_iva' | 'con_iva';
  /** (costo / mayorista − 1) × 100. */
  diferenciaPct: number;
  etiqueta: EtiquetaMayorista;
  /** "Makro (Olivos, a 12 km) lo vende a $ 2.896 + IVA por unidad, en bulto de 12. Tu costo: $ 3.410 (18 % más)." */
  texto: string;
  fechaDato: string;
}

export interface MayoristaMasBaratoItem {
  ean: string;
  descripcion: string;
  proveedor: string | null;
  costoNeto: number;
  costoConIva: number | null;
  precioGondola: number | null;
  mayorista: MayoristaCerca;
  unidadesMes: number | null;
  plataEnJuegoMes: number | null;
}

export interface MayoristasCercaResumen {
  costosCargados: number;
  conMayoristaCerca: number;
  masBaratos: number;
  atipicos: number;
  sucursalesMayoristas: number;
  mayoristaMasCerca: string | null;
  kmMasCerca: number | null;
  sucursalesPropias: number;
  sucursalesSinUbicacion: number;
  condicionIva: string;
  comparaConIva: boolean;
}

export interface MayoristasCercaRespuesta {
  resumen: MayoristasCercaResumen;
  /** false = el plan no incluye la lista (Avanzado y Cadena): llega el resumen solo. */
  detalle: boolean;
  items: MayoristaMasBaratoItem[];
  total: number;
  radioKm: number;
  umbralPct: number;
  topeAtipicoPct: number;
  /** El servidor todavía no tiene el script de BP-209. */
  noDisponible: string | null;
}

/** "Makro Olivos · 12 km". */
export function dondeMayorista(m: MayoristaCerca): string {
  const km = m.km < 1 ? 'menos de 1 km' : `${m.km.toLocaleString('es-AR', { maximumFractionDigits: m.km < 10 ? 1 : 0 })} km`;
  return `${m.mayorista}${m.sucursal ? ' ' + m.sucursal : ''} · ${km}`;
}

/** "en bulto de 12" o "por unidad". */
export function bultoTexto(bulto: number): string {
  return bulto > 1 ? `en bulto de ${bulto.toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : 'por unidad';
}
