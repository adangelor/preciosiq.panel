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
}

export interface CsvImportChunkOptions {
  offset: number;
  limit: number;
  batchId: number | null;
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
}

export interface UndoCsvImportBatchResult {
  restoredCount: number;
  deletedCount: number;
  revertedAt: string;
}
