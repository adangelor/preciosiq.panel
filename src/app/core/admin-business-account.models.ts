// Espejo de Data/DTOs/AdminBusinessAccountDtos.cs (E10.5).

export interface AdminBusinessAccountSummary {
  id: number;
  razonSocial: string;
  commerceId: string | null;
  subscriptionTier: string;
  trialTier: string | null;
  trialExpiresAt: string | null;
}

export interface GrantTrialRequest {
  tier: string; // 'inicial' | 'pyme' | 'avanzado' | 'cadena'
  days: number;
}

// Mismos tiers pagos que PlanLimits.Plans (Services/PlanLimits.cs) -- 'free' queda
// afuera a proposito, un trial siempre es de un plan pago.
export const TRIAL_TIER_OPTIONS: { value: string; label: string }[] = [
  { value: 'inicial', label: 'Inicial' },
  { value: 'pyme', label: 'Pyme' },
  { value: 'avanzado', label: 'Avanzado' },
  { value: 'cadena', label: 'Cadena' },
];
