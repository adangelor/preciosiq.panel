// Espejo de Data/DTOs/SubscriptionDtos.cs (E10).
// REDISEÑO (2026-08-13): maxBranches -> maxProducts (null = sin límite). El eje de
// cobro pasó de sucursales a productos cargados (ver Services/PlanLimits.cs).
// E10.3b (2026-08-14): suscripciones reales de Mercado Pago (antes: Preferencia +
// renovación simulada a 30 días). Se suma el ciclo anual, ya con plan real en MP.
export type BillingCycle = 'monthly' | 'annual';

export interface PlanCatalogItem {
  tier: string;
  displayName: string;
  maxProducts: number | null;
  hasCsvBulkImport: boolean;
  hasPriceHistory: boolean;
  hasFullDashboard: boolean;
  priceArs: number | null; // mensual
  priceArsAnnual: number | null; // anual (10 meses, ~16.7% de descuento)
  // 18-sep-2026 -- lo que diferencia a los planes pagos entre sí (antes las tarjetas de
  // Pyme, Avanzado y Cadena mostraban exactamente lo mismo).
  hasAdvisorReport: boolean;
  hasMarginAnalysis: boolean;
  hasProfitAnalysis: boolean;
}

export interface SubscriptionStatusResponse {
  businessAccountId: number;
  tier: string;
  status: string;
  renewsAt: string | null;
  billingCycle: BillingCycle | null;
  currentBranchCount: number;
  currentProductCount: number;
  maxProducts: number | null;
  hasCsvBulkImport: boolean;
  hasPriceHistory: boolean;
  hasFullDashboard: boolean;
  // E10.5 -- "tier" arriba SIEMPRE es el plan realmente contratado (el que
  // upgrade/downgrade tocan). maxProducts/has* en cambio YA incluyen el trial si hay
  // uno vigente -- son "lo que la cuenta puede hacer ahora mismo". Si isTrial es
  // true, usar trialTier/trialExpiresAt para avisar "estás probando el plan X hasta
  // tal fecha" además de mostrar el plan contratado real.
  isTrial: boolean;
  trialTier: string | null;
  trialExpiresAt: string | null;
  // 18-sep-2026 -- ver PlanCatalogItem; también vienen resueltas con el trial incluido.
  hasAdvisorReport: boolean;
  hasMarginAnalysis: boolean;
  hasProfitAnalysis: boolean;
}

export interface CreateCheckoutResponse {
  initPoint: string;
  paymentId: number;
}
