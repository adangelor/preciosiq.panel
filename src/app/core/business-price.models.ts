// Espejo de UpsertBusinessPriceRequest.cs / BusinessPriceResponse.cs / ProductSearchResult (E4).

// BP-38 (16-sep-2026) -- regla de promo por cantidad (dbo.BusinessPromoRules, DTO
// CajaPromoRuleDto): la MISMA que cobra la caja. Es la única fuente de verdad de una promo;
// promo1UnitPrice/promo1Text son su espejo y los escribe el servidor. Fechas 'YYYY-MM-DD'.
export type PromoTipo = 'precio_unitario' | 'porcentaje' | 'n_x_m' | 'enesima_porcentaje';

export interface PromoRule {
  id: number | null;
  branchId: string | null; // null = toda la cuenta
  tipo: PromoTipo;
  minQty: number;
  maxQty: number | null;
  precioPromo: number | null;
  porcentaje: number | null;
  grupoN: number | null;
  pagaM: number | null;
  cadaN: number | null;
  validFrom: string | null;
  validTo: string | null;
  activa?: boolean;
  updatedAtUtc?: string | null;
  texto?: string | null;
  textoCondicion?: string | null;
  /** Texto del comerciante para la red ("2x1400"); si falta, la red muestra `texto`. */
  leyenda?: string | null;
}

/**
 * Pesable = se vende por peso o volumen (KG, LT). Misma regla que la caja
 * (cart.service.ts isWeighable) y el servidor (PromoRuleService.EsPesable): "500 GR" o
 * "1000 CC" son el contenido de UNA unidad, así que admiten 3x2.
 */
export function esPesable(unit: string | null | undefined): boolean {
  const u = (unit ?? '').trim().toUpperCase();
  return u === 'KG' || u === 'LT';
}

// E12 (19-ago-2026) -- promociones. Promo1/Promo2 espejan dbo.Products.Promo1UnitPrice/
// Promo1Text/Promo2UnitPrice/Promo2Text.
// BP-38 -- promo1 ya NO se manda desde el formulario nuevo: va `promoRule` (ausente = no
// tocar la regla; null = borrarla; objeto = reemplazarla). Si un cliente viejo manda
// promo1UnitPrice sin promoRule, el servidor lo convierte en regla. Promo2 sigue siendo una
// leyenda informativa para la red (la caja no la cobra).
export interface UpsertBusinessPriceRequest {
  businessAccountId: number;
  branchId: string;
  ean: string;
  listPrice: number;
  description?: string | null;
  brand?: string | null;
  presentationQuantity?: number | null;
  presentationUnit?: string | null;
  promo1UnitPrice?: number | null;
  promo1Text?: string | null;
  promo2UnitPrice?: number | null;
  promo2Text?: string | null;
  /** Ausente = no tocar la regla; null = desactivarla; objeto = reemplazarla. */
  promoRule?: PromoRule | null;
  /** true = la regla vale para todas las sucursales de la cuenta. */
  promoRuleTodasLasSucursales?: boolean;
}

export interface BusinessPriceResponse {
  commerceId: string;
  bannerId: string;
  branchId: string;
  ean: string;
  listPrice: number;
  previousListPrice?: number | null;
  wasNewProduct: boolean;
  promo1UnitPrice?: number | null;
  promo1Text?: string | null;
  promo2UnitPrice?: number | null;
  promo2Text?: string | null;
  /** BP-38 -- regla activa que quedó para esa sucursal (la de la sucursal gana sobre la de la cuenta). */
  promoRule?: PromoRule | null;
  promoRuleTexto?: string | null;
}

export interface ProductSearchResult {
  ean: string;
  description: string;
  brand: string;
}

// Espejo de BusinessPriceProductsDtos.cs (E10.6) -- lista paginada de EAN ya cargados
// por la cuenta, para mostrar cuando se llega al cupo del plan (ver plan-gate.ts).
export interface BusinessAccountProductItem {
  branchId: string;
  ean: string;
  description: string;
  brand: string;
  presentationQuantity: number;
  presentationUnit: string;
  listPrice: number;
  promo1UnitPrice?: number | null;
  promo1Text?: string | null;
  promo2UnitPrice?: number | null;
  promo2Text?: string | null;
  /** BP-38 -- regla activa de esta fila (branchId null = de toda la cuenta) y su texto. */
  promoRule?: PromoRule | null;
  promoRuleTexto?: string | null;
}

export interface PagedBusinessAccountProductsResponse {
  items: BusinessAccountProductItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  maxProducts: number | null;
}

export interface ChangeProductEanRequest {
  businessAccountId: number;
  branchId: string;
  oldEan: string;
  newEan: string;
}

// E10.6 -- pedido de Andres: combo de unidades en vez de texto libre, para que dejen
// de aparecer presentaciones mal cargadas ("1 unidad" cuando en realidad son "1500
// cc"). Lista acotada a lo mas comun en retail argentino -- "OTRA" como escape hatch
// para lo que no entre (el campo sigue siendo un string libre del lado del backend).
export interface PresentationUnitOption {
  value: string;
  label: string;
}

export const PRESENTATION_UNIT_OPTIONS: PresentationUnitOption[] = [
  { value: 'UN', label: 'Unidad (UN)' },
  { value: 'KG', label: 'Kilogramo (KG)' },
  { value: 'GR', label: 'Gramo (GR)' },
  { value: 'LT', label: 'Litro (LT)' },
  { value: 'ML', label: 'Mililitro (ML)' },
  { value: 'CC', label: 'Centímetro cúbico (CC)' },
  { value: 'MT', label: 'Metro (MT)' },
  { value: 'CM', label: 'Centímetro (CM)' },
  { value: 'DOC', label: 'Docena (DOC)' },
  { value: 'PACK', label: 'Pack' },
  { value: 'OTRA', label: 'Otra unidad…' },
];
