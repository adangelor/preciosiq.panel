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
  // BP-178/179/181 (21-oct-2026) -- "ERP para cadenas", Avanzado y Cadena. Opcionales: un backend viejo no los manda.
  hasGestionArticulos?: boolean;
  hasGestionStock?: boolean;
  hasFormacionPrecios?: boolean;
  // BP-180 (22-oct-2026) -- compras, Avanzado y Cadena.
  hasCompras?: boolean;
  // 23-oct-2026 (reestructura de precios) -- tienda desde Inicial, factura de la caja, asistente con IA. Opcionales.
  hasTiendaOnline?: boolean;
  hasCajaInvoicing?: boolean;
  hasTiendaAsistente?: boolean;
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
  // BP-178/179/181 (21-oct-2026) -- "ERP para cadenas", Avanzado y Cadena. Opcionales: un backend viejo no los manda.
  hasGestionArticulos?: boolean;
  hasGestionStock?: boolean;
  hasFormacionPrecios?: boolean;
  // BP-180 (22-oct-2026) -- compras, Avanzado y Cadena.
  hasCompras?: boolean;
  // BP-196 (22-oct-2026) -- el cobro con Nave. Opcional: un backend viejo no lo manda.
  cobro?: EstadoCobro | null;
}

// BP-196 (22-oct-2026) -- espejo de EstadoCobroDto / CobroPendienteDto (Services/Cobro/CobroService.cs).
export interface CobroPendiente {
  paymentId: number;
  tipo: 'alta' | 'renovacion' | 'cambio' | 'manual' | string;
  tier: string;
  ciclo: BillingCycle | null;
  monto: number;
  periodoDesde: string | null;
  periodoHasta: string | null;
  linkVenceAt: string | null; // null = el link vencio: hay que pedir uno nuevo (POST /pagar)
  checkoutUrl: string | null;
  intentos: number;
}

export interface EstadoCobro {
  cobroPendiente: CobroPendiente | null;
  enGraciaHasta: string | null; // vencio sin pagar: sigue con su plan hasta esta fecha
  ultimoRechazo: string | null; // el motivo del ultimo rechazo, en criollo
  tierProximoPeriodo: string | null;
  cicloProximoPeriodo: BillingCycle | null;
  proximoPlanRigeDesde: string | null;
  cobraPorMercadoPago: boolean;
  cobroHabilitado: boolean;
}

// BP-196 -- con Nave el checkout puede no tener nada que pagar ahora: un cambio programado para el vencimiento
// (programado) o uno aplicado en el acto (aplicado). initPoint = checkoutUrl (el backend lo manda igual).
export interface CreateCheckoutResponse {
  initPoint: string | null;
  paymentId: number | null;
  checkoutUrl?: string | null;
  monto?: number | null;
  tipo?: string | null;
  programado?: boolean;
  aplicado?: boolean;
  rigeDesde?: string | null;
  mensaje?: string | null;
}
