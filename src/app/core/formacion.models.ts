// BP-181 (21-oct-2026) -- formación de precios: los DTOs de /api/business/pricing (Data/DTOs/FormacionDtos.cs).

export type BaseMargen = 'sobre_costo' | 'sobre_precio';
export type RedondeoModo = 'arriba' | 'cercano';
export type Aviso = 'caro' | 'dejas_margen' | 'testigo' | 'renegociar' | 'dudosa' | 'sin_costo';

export interface ConfiguracionDePrecios {
  margenDefaultPct: number;
  baseMargen: BaseMargen;
  redondeoMultiplo: number;
  redondeoModo: RedondeoModo;
  terminarEn9: boolean;
  avisoCompetenciaPct: number;
  /** false = son los valores por defecto (la cuenta nunca la guardó). */
  guardada: boolean;
}

export interface Competencia {
  minimo: number | null;
  referencia: number | null;
  maximo: number | null;
  cadenas: number;
  masBarata: number | null;
  cadenaMasBarata: string | null;
  masBarataEsNacional: boolean;
  promoMasBaja: number | null;
  promoCadena: string | null;
  promoTexto: string | null;
  /** Solo si es testigo (BP-78): la nacional más barata + 3 %. */
  metaTestigo: number | null;
}

export interface SugeridoItem {
  articuloId: number;
  codigo: string;
  descripcion: string;
  marca: string | null;
  rubro: string | null;
  proveedor: string | null;
  costoNeto: number | null;
  costoConIva: number | null;
  costoDesde: string | null;
  ivaAlicuota: number;
  margenPct: number;
  /** "propio" | nombre del rubro | "por defecto". */
  margenDe: string;
  precioActual: number | null;
  sucursalesConPrecio: number;
  preciosDistintos: boolean;
  /** null = sin costo: no se inventa. */
  sugerido: number | null;
  diferenciaPct: number | null;
  esTestigo: boolean;
  competencia: Competencia | null;
  avisos: Aviso[];
  motivoDudosa: string | null;
}

export interface SugeridosResumen {
  articulos: number;
  conCosto: number;
  sinCosto: number;
  cambian: number;
  suben: number;
  bajan: number;
  conAviso: number;
}

export interface SugeridosResponse {
  destino: string;
  competenciaDisponible: boolean;
  sinCompetenciaPorque: string | null;
  configuracion: ConfiguracionDePrecios;
  resumen: SugeridosResumen;
  total: number;
  page: number;
  pageSize: number;
  items: SugeridoItem[];
  /** BP-207: con qué condición frente al IVA se calculó, y si se supuso inscripto por falta de dato. */
  condicionIva?: 'ri' | 'mono' | 'exento';
  condicionIvaSupuesta?: boolean;
}

/** A quién se le forman los precios: exactamente uno. */
export type DestinoDePrecios =
  | { tipo: 'sucursal'; branchId: string }
  | { tipo: 'zona'; priceZoneId: number }
  | { tipo: 'todas' };

export interface SugeridosFiltros {
  rubroId?: number | null;
  proveedorId?: number | null;
  q?: string;
  soloCambios?: boolean;
  aviso?: Aviso | null;
  page?: number;
  pageSize?: number;
}

export interface AplicarPreciosResponse {
  batchId: number;
  /** Con varias sucursales: la carga agrupada (se deshace entera). */
  groupId: number | null;
  batchIds: number[];
  aplicados: number;
  sinCambio: number;
  sinPrecioEnLaSucursal: number;
  errores: { ean: string; motivo: string }[];
  nombreDeLaCarga: string;
}

export interface AjusteDeCostosRequest {
  businessAccountId: number;
  proveedorId: number | null;
  rubroId: number | null;
  porcentaje: number;
  vigenteDesde: string | null;
  zonaId: number | null;
}

export interface AjusteDeCostosResponse {
  articulos: number;
  sinCosto: number;
  vistaPrevia: boolean;
  ejemplos: { codigo: string; descripcion: string; costoAntes: number; costoDespues: number }[];
}

// ---- carteles de góndola
export interface CartelSucursal {
  branchId: string;
  nombre: string;
}

export interface CartelPromo {
  tipo: string;
  minQty: number;
  maxQty: number | null;
  precioPromo: number | null;
  porcentaje: number | null;
  grupoN: number | null;
  pagaM: number | null;
  cadaN: number | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface CartelItem {
  codigo: string;
  descripcion: string;
  marca: string | null;
  presentacionCantidad: number;
  presentacionUnidad: string | null;
  precio: number;
  precioReferencia: number | null;
  cantidadReferencia: number | null;
  unidadReferencia: string | null;
  promo: CartelPromo | null;
  /** Res. 4/2025: el precio sin IVA, con la alícuota de la ficha (21 % si no hay). Opcional: un backend viejo no lo manda. */
  precioSinImpuestos?: number | null;
  ivaAlicuota?: number | null;
  ivaDeLaFicha?: boolean;
}

export interface CartelesResponse {
  titulo: string;
  sucursal: CartelSucursal;
  sucursales: CartelSucursal[];
  items: CartelItem[];
  noEstan: string[];
}

/** De dónde salen los carteles: una carga (lote o grupo) o una lista de códigos. */
export interface CartelesOrigen {
  batchId?: number | null;
  groupId?: number | null;
  eans?: string[] | null;
  branchId?: string | null;
}
