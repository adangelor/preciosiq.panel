// Espejo de Data/DTOs/InstantBenchmarkResponse.cs (E3).
// CORRECCION (2026-08-13): la clasificacion real es dbo.Categories/dbo.Subcategories
// (mapeadas por EAN en dbo.ProductCategoryMaps), no GPC -- brickCode nunca existio en
// la base real, se reemplaza por categoryId/subcategoryId.
export interface BenchmarkCategoryResult {
  // v3 (21-ago-2026, "la bomba"): true = fila TOTAL de la categoria (tarjeta del
  // panel inicial), false = fila hoja por subcategoria (drilldown). No alcanza con
  // subcategoryId === null para distinguirlas: una hoja legitima puede venir sin
  // subcategoria (EAN clasificado solo a nivel categoria, y todo SIN-CATEGORIZAR).
  isCategoryTotal: boolean;
  categoryId: string;
  subcategoryId: string | null;
  categoryName: string;
  subcategoryName: string | null;
  competitorCount: number;
  sufficientCoverage: boolean;
  competitorAvgPrice: number | null;
  competitorMinPrice: number | null;
  competitorMaxPrice: number | null;
  ownAvgPrice: number | null;
  ownProductCount: number;
  // v3 -- EANs distintos con precio en la competencia del radio para este grupo
  // (el "numeral" nuevo, ordenable en las dos tablas).
  zoneProductCount: number;
  // 19-ago-2026 -- fix del bug "120% vs -1.9%" (Andres): deltaVsCompetitorsPct ahora
  // sale matcheado por EAN (tu precio vs. competencia del MISMO producto), no canasta
  // contra canasta -- ver el comentario largo en InstantBenchmarkResponse.cs del back.
  // matchedProductCount dice sobre cuantos productos se armo ese promedio; si es 0,
  // deltaVsCompetitorsPct viaja en null (no hay nada matcheado, no un numero inventado).
  matchedProductCount: number;
  deltaVsCompetitorsPct: number | null;
  // BP-143 (16-oct-2026) -- deltaVsCompetitorsPct es la MEDIANA sin los atipicos (precio propio 3x arriba o abajo del de
  // la zona); atypicalCount dice cuantos quedaron afuera ("precios para revisar"). 0 con un backend sin BP-143.
  atypicalCount?: number;
  // BP-140 (16-oct-2026) -- hasZonePrice = hay algun precio de zona (lo que antes era sufficientCoverage). Ahora
  // sufficientCoverage = 5+ productos comparables y 2+ competidores. Promedios sobre la MISMA canasta (comparables no
  // atipicos) y percentiles 5 / 95 de la zona en vez de minimo / maximo crudos.
  hasZonePrice?: boolean;
  ownAvgMatchedPrice?: number | null;
  zoneAvgMatchedPrice?: number | null;
  competitorP5Price?: number | null;
  competitorP95Price?: number | null;
}

export interface InstantBenchmarkResponse {
  branchId: string;
  maxDistanceMeters: number;
  minCompetitors: number;
  categories: BenchmarkCategoryResult[];
}
