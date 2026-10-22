// BP-178 (21-oct-2026) -- espejo de Data/DTOs/ArticulosDtos.cs (ficha de artículo de la cuenta, "ERP para cadenas").

export interface ArticuloListaItem {
  id: number;
  codigo: string;
  esEan: boolean;
  codigoInterno: string | null;
  descripcion: string;
  marca: string | null;
  presentacionCantidad: number | null;
  presentacionUnidad: string | null;
  rubroId: number | null;
  /** El camino: "Almacén > Galletitas". */
  rubro: string | null;
  proveedorHabitualId: number | null;
  proveedor: string | null;
  ivaAlicuota: number;
  /** Vigente, de la cuenta (sin zona). */
  costoNeto: number | null;
  costoDesde: string | null;
  /** El que se usa: el propio, el del rubro (heredado) o null. */
  margenObjetivoPct: number | null;
  /** "propio" | nombre del rubro de donde sale | null. */
  margenDe: string | null;
  /** En cuántas sucursales tiene precio. */
  sucursales: number;
  activo: boolean;
  /** 21 % puesto al armar, en un rubro que suele ir al 10,5. */
  ivaParaRevisar?: boolean;
}

export interface ArticuloListaResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ArticuloListaItem[];
}

export interface ArticuloFiltros {
  q?: string;
  rubroId?: number | null;
  proveedorId?: number | null;
  sinRubro?: boolean;
  sinCosto?: boolean;
  ivaParaRevisar?: boolean;
  incluirInactivos?: boolean;
  page?: number;
  pageSize?: number;
}

export type TipoDeCodigo = 'alternativo' | 'bulto';

export interface ArticuloCodigo {
  id: number;
  codigo: string;
  tipo: TipoDeCodigo;
  factor: number;
}

export interface ArticuloSucursal {
  branchId: string;
  sucursal: string | null;
  listPrice: number;
  promo1UnitPrice: number | null;
  promo1Text: string | null;
}

export type OrigenDelCosto = 'csv' | 'panel' | 'ingreso' | 'ajuste_masivo';

export interface ArticuloCosto {
  id: number;
  costoNeto: number;
  costoConIva: number | null;
  proveedor: string | null;
  vigenteDesde: string;
  zonaId: number | null;
  origen: OrigenDelCosto;
  cargadoAtUtc: string;
}

export interface ArticuloFicha {
  articulo: ArticuloListaItem;
  impuestosInternosPct: number | null;
  unidadesPorBulto: number | null;
  margenPropioPct: number | null;
  codigos: ArticuloCodigo[];
  precios: ArticuloSucursal[];
  costos: ArticuloCosto[];
}

export interface ArticuloGuardado {
  ficha: ArticuloFicha;
  sucursalesActualizadas: number;
}

/** PUT completo: lo que no viene queda vacío (salvo IVA y activo). El código solo va en el alta. */
export interface ArticuloGuardarRequest {
  businessAccountId: number;
  codigo?: string | null;
  codigoInterno: string | null;
  descripcion: string;
  marca: string | null;
  presentacionCantidad: number | null;
  presentacionUnidad: string | null;
  rubroId: number | null;
  proveedorHabitualId: number | null;
  ivaAlicuota: number | null;
  impuestosInternosPct: number | null;
  unidadesPorBulto: number | null;
  margenObjetivoPct: number | null;
  activo?: boolean | null;
}

export interface ArticuloCostoRequest {
  businessAccountId: number;
  costoNeto: number;
  costoConIva: number | null;
  proveedor: string | null;
  zonaId: number | null;
  vigenteDesde: string | null;
}

export interface ArticuloArmadoMuestra {
  codigo: string;
  descripcion: string;
  rubro: string | null;
}

export interface ArmarArticulosResponse {
  creados: number;
  yaEstaban: number;
  conRubro: number;
  conProveedor: number;
  rubrosCreados: number;
  proveedoresCreados: number;
  ivaParaRevisar: number;
  ivaParaRevisarMuestra: ArticuloArmadoMuestra[];
  enConflicto: number;
  productosSinEanCorregidos: number;
  milisegundos: number;
  soloMedido: boolean;
  /** BP-178 bloque 10 -- fichas que ya existían a las que se les completó el rubro o el proveedor. */
  completados?: number;
}

export interface ArticuloExportItem {
  articulo: ArticuloListaItem;
  impuestosInternosPct: number | null;
  unidadesPorBulto: number | null;
  margenPropioPct: number | null;
  codigosAlternativos: string | null;
  codigosDeBulto: string | null;
}

// ------------------------------------------------------------------ rubros
export interface Rubro {
  id: number;
  parentId: number | null;
  nombre: string;
  camino: string;
  nivel: number;
  /** El propio (vacío = hereda). */
  margenObjetivoPct: number | null;
  /** El que se usa. */
  margenEfectivoPct: number | null;
  /** Nombre del rubro de donde sale, si no es el propio. */
  margenHeredadoDe: string | null;
  orden: number;
  activo: boolean;
  /** Artículos activos con este rubro (solo este nivel). */
  articulos: number;
}

export interface RubroGuardarRequest {
  businessAccountId: number;
  nombre: string;
  parentId?: number | null;
  margenObjetivoPct: number | null;
  orden?: number | null;
  activo?: boolean | null;
}

// ------------------------------------------------------------------ proveedores
export interface Proveedor {
  id: number;
  nombre: string;
  cuit: string | null;
  activo: boolean;
  articulos: number;
}

export interface ProveedorGuardarRequest {
  businessAccountId: number;
  nombre: string;
  cuit: string | null;
  activo?: boolean | null;
}

/** Las alícuotas que acepta la factura (Factumaster). */
export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const;
