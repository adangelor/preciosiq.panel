// Espejo de Data/DTOs/CsvImportDtos.cs (E5).

// E12 (19-ago-2026) -- columnas de promo opcionales en el mapeo, mismo tratamiento que
// descriptionColumn/brandColumn: si quedan null, esta carga masiva no toca esa promo
// (ver updatePromo1/updatePromo2 en BusinessCsvImportEndpoints.cs).
export interface CsvMapping {
  id: number;
  name: string;
  delimiter: string;
  decimalSeparator: string;
  eanColumn: string;
  descriptionColumn: string | null;
  brandColumn: string | null;
  priceColumn: string;
  presentationQuantityColumn: string | null;
  presentationUnitColumn: string | null;
  promo1UnitPriceColumn: string | null;
  promo1TextColumn: string | null;
  promo2UnitPriceColumn: string | null;
  promo2TextColumn: string | null;
  // E13 (25-ago-2026) -- costos de proveedor, opcionales (alimentan el Asesor).
  costPriceColumn: string | null;
  costPriceWithTaxColumn: string | null;
  supplierColumn: string | null;
  costValidFromColumn: string | null;
  // BP-38 (16-sep-2026) -- "llevando desde" / "llevando hasta" de la promo (opcionales).
  promoMinQtyColumn?: string | null;
  promoMaxQtyColumn?: string | null;
  // 17-sep-2026 -- descuento % (crea una regla de porcentaje) y administracion de mapeos.
  promoPercentColumn?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  timesUsed?: number;
  lastUsedAt?: string | null;
  // 10-oct-2026 -- "Esta planilla es mi catálogo completo": al terminar la carga, lo publicado que no
  // vino en el archivo pasa a "sin stock" (sale de la app; misuper.app lo muestra sin precio).
  catalogoCompleto?: boolean;
  // BP-77 (14-oct-2026) -- columna con el nombre de la zona de precio del costo (vacia = toda la cuenta).
  costZoneColumn?: string | null;
}

// 17-sep-2026 -- "probar este mapeo con un archivo": no carga nada, solo dice que columnas
// encuentra, cuales faltan y como interpretaria las primeras filas.
export interface CsvMappingTestColumn {
  campo: string;
  columna: string;
  encontrada: boolean;
}

export interface CsvMappingTestRow {
  rowNumber: number;
  ean: string | null;
  description: string | null;
  listPrice: number | null;
  promo1UnitPrice: number | null;
  promoPercent: number | null;
  promoMinQty: number | null;
  promoMaxQty: number | null;
  motivo: string | null;
}

export interface CsvMappingTestResult {
  mappingId: number;
  name: string;
  headers: string[];
  detectedDelimiter: string;
  delimiterCoincide: boolean;
  encontradas: number;
  faltantes: number;
  columnas: CsvMappingTestColumn[];
  muestra: CsvMappingTestRow[];
  avisos: string[];
}

export interface CsvPreviewResponse {
  headers: string[];
  sampleRows: string[][];
  detectedDelimiter: string;
  savedMappings: CsvMapping[];
}

export interface SaveCsvMappingRequest {
  businessAccountId: number;
  name: string;
  delimiter: string;
  decimalSeparator: string;
  eanColumn: string;
  descriptionColumn: string | null;
  brandColumn: string | null;
  priceColumn: string;
  presentationQuantityColumn: string | null;
  presentationUnitColumn: string | null;
  promo1UnitPriceColumn: string | null;
  promo1TextColumn: string | null;
  promo2UnitPriceColumn: string | null;
  promo2TextColumn: string | null;
  // E13 (25-ago-2026) -- costos de proveedor, opcionales (alimentan el Asesor).
  costPriceColumn: string | null;
  costPriceWithTaxColumn: string | null;
  supplierColumn: string | null;
  costValidFromColumn: string | null;
  // BP-38 (16-sep-2026)
  promoMinQtyColumn: string | null;
  promoMaxQtyColumn: string | null;
  // 17-sep-2026 -- descuento %.
  promoPercentColumn: string | null;
  // 10-oct-2026 -- ver CsvMapping.catalogoCompleto.
  catalogoCompleto?: boolean;
  // BP-77 -- ver CsvMapping.costZoneColumn.
  costZoneColumn?: string | null;
}

export interface CsvImportRowError {
  rowNumber: number;
  reason: string;
}

// E5.4 (16-ago-2026) -- pedido de Andres despues de un import real que le disparo casi
// todos los precios +900% (separador decimal mal configurado en el mapeo): "si el
// sistema detecta que tengo precios 993% encima de la general, avisame". referenceType
// dice contra que se comparo -- 'previous' (lo que la cuenta ya tenia cargado para ese
// EAN) o 'zone' (promedio de competidores cercanos, para EANs sin precio propio previo).
// E12 -- priceField distingue si la anomalia salio del precio de lista o de una promo.
// No hay señal 'zone' para promos (ver comentario en el DTO backend) -- solo ListPrice
// puede traer referenceType 'zone'.
export interface CsvImportPriceAnomaly {
  ean: string;
  description: string | null;
  newPrice: number;
  referencePrice: number;
  referenceType: 'previous' | 'zone';
  priceField: 'ListPrice' | 'Promo1' | 'Promo2';
  // BP-132 (16-oct-2026) -- en una carga a varias sucursales, en cuales aparecio (BranchId). "Corregir" aplica a
  // esas. null en la carga a una sola sucursal.
  sucursales?: string[] | null;
}

export interface CsvImportResult {
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  errors: CsvImportRowError[];
  priceAnomalies: CsvImportPriceAnomaly[];
  // E5.5 -- id de dbo.CsvImportBatch para esta corrida, para poder ofrecer "Deshacer
  // esta importación" directo desde la pantalla de resultado.
  batchId: number;
  // E5.7 (25-ago-2026) -- carga por lotes. created/updated/failed son ACUMULADOS del
  // lote; errors/priceAnomalies solo los de las filas de esta llamada. nextOffset =
  // desde donde seguir, null cuando terminó (o cortó por cupo de plan).
  processedRows: number;
  nextOffset: number | null;
  stoppedByPlanLimit: boolean;
  // E13 -- costos de proveedor insertados en esta llamada (el panel los suma).
  costsLoaded: number;
  // BP-38 (16-sep-2026) -- promos de ESTA llamada (el panel las suma). Con la columna de
  // precio promo mapeada, cada fila crea o desactiva una regla (la que cobra la caja).
  // promosIgnoradas = filas cuyo precio se cargo pero la promo no, con el motivo por fila.
  promosIgnoradas?: number;
  promosIgnoradasDetalle?: CsvImportRowError[] | null;
  promoRulesSaved?: number;
  promoRulesDeactivated?: number;
  // 17-sep-2026 -- la promo se cargo igual, pero hay algo para avisar (la fila traia precio
  // promo y descuento % a la vez y gano el precio).
  promosConAviso?: number;
  promosConAvisoDetalle?: CsvImportRowError[] | null;
  // BP-77 (14-oct-2026) -- filas con costo de una zona que la cuenta no tiene: el precio se cargo, el costo no.
  costosZonaDesconocida?: CsvImportRowError[] | null;
  // BP-135 (16-oct-2026) -- filas de esta llamada dadas de alta con marca vacia (la fila no la traia y ni la red ni
  // el nombre la daban; antes eran error). reason = "EAN · nombre". El panel las suma.
  altasSinMarca?: number;
  altasSinMarcaDetalle?: CsvImportRowError[] | null;
  // BP-136 -- altas donde la marca que la red tiene para el EAN no se uso (no aparece en el nombre).
  marcasDeRedDescartadas?: number;
  marcasDeRedDescartadasDetalle?: CsvImportRowError[] | null;
  // BP-137 -- filas cuyo EAN en la red es otro producto: el tablero no las compara.
  eanDudosos?: number;
  eanDudososDetalle?: CsvImportRowError[] | null;
  // BP-132 (16-oct-2026) -- carga a una zona o a todas las sucursales: groupId (va en las tandas siguientes en
  // vez de batchId) y lo de cada sucursal, acumulado. Ahi created/updated suman las sucursales y failed son
  // las filas del archivo con error, contadas una vez. null en la carga a una sola sucursal.
  groupId?: number | null;
  porSucursal?: CsvImportSucursalResult[] | null;
}

export interface CsvImportSucursalResult {
  branchId: string;
  branchName: string;
  batchId: number;
  created: number;
  updated: number;
  failed: number;
  stoppedByPlanLimit: boolean;
}

// BP-132 -- a que sucursales va la carga.
export type CsvImportDestino =
  | { tipo: 'sucursal'; branchId: string }
  | { tipo: 'zona'; priceZoneId: number }
  | { tipo: 'todas' };

export interface CsvImportChunkOptions {
  offset: number;
  limit: number;
  batchId: number | null;
  groupId?: number | null;   // BP-132: desde la segunda tanda de una carga agrupada
}

// E5.5 (16-ago-2026) -- pedido de Andres tras el incidente real de import con separador
// decimal mal configurado ("como elimino los precios que cargo el ñato"): historial de
// importaciones + poder deshacer una corrida completa.
export interface CsvImportBatch {
  id: number;
  branchId: string;
  branchName: string;
  fileName: string | null;
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  importedAt: string;
  revertedAt: string | null;
  groupId?: number | null;   // BP-132: la carga agrupada de la que es parte (null = una sola sucursal)
}

// BP-132 (16-oct-2026) -- GET /groups: una carga a una zona o a todas las sucursales, con el lote de cada una.
export interface CsvImportGroup {
  id: number;
  destino: 'zona' | 'todas';
  priceZoneId: number | null;
  zonaNombre: string | null;
  sucursales: number;
  fileName: string | null;
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  importedAt: string;
  revertedAt: string | null;
  deshechaEnParte: boolean;
  lotes: CsvImportBatch[];
}

export interface UndoCsvImportGroupResult {
  groupId: number;
  restoredCount: number;
  deletedCount: number;
  reactivadosCount: number;
  promosDesactivadas: number;
  promosReactivadas: number;
  revertedAt: string;
  lotesDeshechos: number;
  lotesYaDeshechos: number;
  mensaje: string;
}

// BP-132 -- catalogo completo de una carga agrupada: las bajas de cada sucursal en una sola confirmacion.
export interface CatalogoCompletoSucursal {
  branchId: string;
  branchName: string;
  batchId: number;
  aplicado: boolean;
  sospechoso: boolean;
  bajas: number;
  publicadosAntes: number;
  vinieronEnElArchivo: number;
  ejemplos: string[];
  aplicadoAt: string | null;
}

export interface CatalogoCompletoGrupoResult {
  groupId: number;
  aplicado: boolean;
  sospechoso: boolean;
  bajas: number;
  porSucursal: CatalogoCompletoSucursal[];
}

export interface UndoCsvImportBatchResult {
  restoredCount: number;
  deletedCount: number;
  revertedAt: string;
  // 10-oct-2026 -- productos que esta carga habia pasado a "sin stock" y volvieron a publicarse.
  reactivadosCount?: number;
  // BP-44 (10-oct-2026) -- reglas de promo que la carga había creado (se apagan) y reemplazado (vuelven).
  promosDesactivadas?: number;
  promosReactivadas?: number;
}

// 10-oct-2026 -- POST /batches/{id}/catalogo-completo. aplicar = false solo cuenta (para preguntar).
export interface CatalogoCompletoResult {
  batchId: number;
  aplicado: boolean;
  bajas: number;
  publicadosAntes: number;
  vinieronEnElArchivo: number;
  ejemplos: string[];
  aplicadoAt: string | null;
}

// BP-136 / BP-137 / BP-138 (16-oct-2026) -- "Revisar mis productos" (GET /csv-import/revision).
export interface RevisionProductos {
  tablasListas: boolean;
  productosRevisados: number;
  marcasARevisar: number;
  ejemplosMarcas: { ean: string; descripcion: string | null; marcaActual: string; marcaPropuesta: string }[];
  eanDudosos: number;
  ejemplosDudosos: { ean: string; descripcion: string; nombreRed: string }[];
  categoriasAdivinadas: number;
  // Los dudosos que todavia no estan marcados (los marcados ya no se comparan; "Corregir" marca el resto).
  eanDudososPendientes?: number;
}

export interface RevisionAplicada {
  marcasCorregidas: number;
  eanDudosos: number;
  categoriasAdivinadas: number;
}
