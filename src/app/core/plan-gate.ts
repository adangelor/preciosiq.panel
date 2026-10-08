import { HttpErrorResponse } from '@angular/common/http';

// E10.2 -- los endpoints gateados por plan devuelven 402 Payment Required
// (Services/PlanLimits.cs, FeatureGateResult / el chequeo de cupo de productos en
// BusinessPriceUpsertService). Este helper le da un
// mensaje consistente en toda la app en vez de mostrar el error generico "No se pudo
// cargar X" cuando en realidad es "esto no esta en tu plan".
export function planGateErrorMessage(err: unknown): string | null {
  if (err instanceof HttpErrorResponse && err.status === 402) {
    return `${err.error?.error ?? 'Esta funcion no esta incluida en tu plan actual.'} Mirá /plan para hacer el upgrade.`;
  }
  return null;
}
