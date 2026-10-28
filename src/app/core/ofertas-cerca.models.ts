// BP-204 (28-oct-2026, bloque 5) -- espejo de OfertasCercaService.cs (GET /api/business/ofertas-cerca). Mantener
// sincronizado a mano, como el resto de los *.models.ts. Fechas "yyyy-MM-dd".

/**
 * Las etiquetas de los paneles (decisiones de Andrés del 27-oct):
 *   subio_antes       la cadena subió el precio de lista antes de la oferta;
 *   mas_barato_cerca  la oferta está 5 % o más arriba de la mediana de las otras cadenas a 5 km;
 *   real              oferta de verdad;
 *   sin_marca         más cara que la zona por menos de 5 %: cuenta como oferta, sin insignia;
 *   sin_dato          no se pudo calificar.
 */
export type EtiquetaOferta = 'subio_antes' | 'mas_barato_cerca' | 'real' | 'sin_marca' | 'sin_dato';

export const NOMBRE_ETIQUETA: Record<EtiquetaOferta, string> = {
  subio_antes: 'Subió antes',
  mas_barato_cerca: 'Hay más barato cerca',
  real: 'Oferta real',
  sin_marca: 'Sin marca',
  sin_dato: 'Sin dato',
};

/** Productos distintos (no sucursales): un producto puede contar en dos etiquetas si está en dos cadenas. */
export interface OfertasConteo {
  ofertas: number;
  reales: number;
  subioAntes: number;
  masBaratoCerca: number;
  sinMarca: number;
  sinDato: number;
}

export interface OfertasCercaCadena {
  commerceId: string;
  bannerId: string;
  bandera: string;
  sucursales: number;
  productos: number;
  deLoQueVendes: number;
  subioAntes: number;
  masBaratoCerca: number;
  reales: number;
}

export interface OfertaCompetencia {
  bandera: string | null;
  sucursal: string | null;
  precio: number | null;
  metros: number | null;
  mediana: number | null;
  banderas: number | null;
  mismaCadena: boolean;
}

/** Un renglón: un producto en oferta en una cadena, con la sucursal más cercana de ejemplo. */
export interface OfertaCercaItem {
  ean: string;
  descripcion: string | null;
  commerceId: string;
  bannerId: string;
  bandera: string;
  branchId: string;
  sucursal: string | null;
  localidad: string | null;
  provincia: string | null;
  /** Metros de esa sucursal a la sucursal propia más cercana. */
  metros: number;
  /** Cuántas sucursales de esa cadena, a 5 km, lo tienen en oferta con la misma etiqueta. */
  sucursales: number;
  sucursalPropia: string;
  sucursalPropiaNombre: string | null;
  loVende: boolean;
  /** El precio del comercio en esa sucursal propia (con su promo si es más baja). */
  tuPrecio: number | null;
  clase: string;
  etiqueta: EtiquetaOferta;
  motivo: string | null;
  motivoSinDato: string | null;
  precioLista: number;
  precioOferta: number;
  descuentoPct: number;
  precioListaAntes: number | null;
  subaPct: number | null;
  fechaSuba: string | null;
  competencia: OfertaCompetencia;
  competenciaEsPropia: boolean;
  sobreLaMedianaPct: number | null;
}

export interface OfertasCercaCobertura {
  sucursales: number;
  sucursalesSinPromos: number;
  sinPromos: { commerceId: string; bannerId: string; bandera: string; presencias: number }[];
  aviso: string | null;
}

export interface OfertasCercaRespuesta {
  fecha: string | null;
  fechaUltimaIngesta: string | null;
  desactualizada: boolean;
  radioMetros: number;
  umbralMasBaratoPct: number;
  sucursalesPropias: number;
  sucursalesSinUbicacion: number;
  sucursalesCerca: number;
  ofertasEnSucursales: number;
  todas: OfertasConteo;
  deLoQueVendes: OfertasConteo;
  porCadena: OfertasCercaCadena[];
  totalLista: number;
  lista: OfertaCercaItem[];
  cobertura: OfertasCercaCobertura;
}

export interface FiltrosOfertasCerca {
  branchId?: string | null;
  etiqueta?: EtiquetaOferta | null;
  soloLoQueVendo?: boolean;
  top?: number;
}

/** "a 400 m" (de a 100 m) o "a 1,8 km", como los textos del servidor. */
export function distancia(metros: number): string {
  const redondo = Math.max(100, Math.round(metros / 100) * 100);
  if (redondo < 1000) return `a ${redondo} m`;
  return `a ${(Math.max(metros, 1000) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`;
}
