// Espejo de Data/DTOs/BenchmarkTrendDtos.cs (E8.1/E8.2).

export interface BenchmarkTrendPoint {
  weekBucket: string;
  categoryId: string;
  subcategoryId: string | null;
  categoryName: string;
  subcategoryName: string | null;
  competitorCount: number;
  sufficientCoverage: boolean;
  competitorAvgPrice: number | null;
  ownAvgPrice: number | null;
}

export interface BenchmarkTrendResponse {
  branchId: string;
  dateFrom: string;
  dateTo: string;
  bucketDays: number;
  minCompetitors: number;
  points: BenchmarkTrendPoint[];
}

// E8.6 (16-ago-2026) -- pedido de Andres: cadenas SEPA (obligadas por ley a reportar,
// dato publico) se nombran individualmente; cuentas autoreportadas de la familia
// PreciosIQ siguen 100% anonimas (solo entran al agregado Family* de abajo).
export interface SepaChainPrice {
  commerceId: string;
  bannerId: string;
  chainName: string | null;
  avgPrice: number;
  branchCount: number;
}

export interface CategoryProductDetailItem {
  ean: string;
  description: string | null;
  brand: string | null;
  // v2 (21-ago-2026, "la bomba"): a que categoria pertenece cada producto
  // ('SIN-CATEGORIZAR' si no esta clasificado) -- lo usan la vista por productos
  // y la hoja "Productos" del export.
  categoryId: string;
  subcategoryId: string | null;
  categoryName: string;
  subcategoryName: string | null;
  ownPrice: number | null;
  // E9.3 -- origen del ultimo precio propio cargado ('sepa' | 'self_reported' | 'crowd').
  ownPriceSource: string | null;
  // Agregado ANONIMO de cuentas family (999-), con piso de MinCompetitors -- ver E8.5.
  familyCompetitorCount: number;
  familySufficientCoverage: boolean;
  familyAvgPrice: number | null;
  familyMinPrice: number | null;
  familyMaxPrice: number | null;
  // Cadenas SEPA nombradas, sin piso -- dato publico por ley.
  sepaChains: SepaChainPrice[];
}

export interface CategoryProductDetailResponse {
  branchId: string;
  // v2: null = catalogo completo (sin filtro de categoria).
  categoryId: string | null;
  subcategoryId: string | null;
  minCompetitors: number;
  products: CategoryProductDetailItem[];
}
