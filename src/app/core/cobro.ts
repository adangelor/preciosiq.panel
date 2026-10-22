import { CreateCheckoutResponse, EstadoCobro } from './business-subscription.models';

// BP-196 (22-oct-2026) -- reglas de pantalla del cobro con Nave, como funciones puras (con spec en cobro.spec.ts).
// La misma logica vive en distribucioniq.panel (copia a proposito: cada panel es un proyecto Angular aparte).

export type AccionDeCobro =
  | { tipo: 'pagar'; url: string } // ir a Nave
  | { tipo: 'mensaje'; texto: string } // no hay nada que pagar ahora (programado o aplicado)
  | { tipo: 'error'; texto: string };

/** Que hacer con la respuesta de /checkout, /pagar, /pagar-adelantado o /downgrade-to-free. */
export function accionDeCobro(r: CreateCheckoutResponse | null | undefined): AccionDeCobro {
  const url = r?.checkoutUrl ?? r?.initPoint ?? null;
  if (url) return { tipo: 'pagar', url };
  if (r?.programado || r?.aplicado) return { tipo: 'mensaje', texto: r.mensaje || 'Listo.' };
  return { tipo: 'error', texto: r?.mensaje || 'No pudimos generar el link de pago. Probá de nuevo en un rato.' };
}

/** Dias que le quedan a la gracia (0 = hoy es el ultimo dia), o null si no esta en gracia. */
export function diasDeGracia(cobro: EstadoCobro | null | undefined, ahora: Date = new Date()): number | null {
  if (!cobro?.enGraciaHasta) return null;
  const hasta = new Date(cobro.enGraciaHasta).getTime();
  if (Number.isNaN(hasta)) return null;
  return Math.max(0, Math.ceil((hasta - ahora.getTime()) / 86_400_000) - 1);
}

/** El texto del cartel de gracia que se ve en todo el panel. */
export function textoDeGracia(dias: number, motivo: string | null): string {
  const cuando = dias <= 0 ? 'Hoy es el último día' : dias === 1 ? 'Te queda 1 día' : `Te quedan ${dias} días`;
  const base = `No pudimos cobrar tu plan. ${cuando} antes de pasar al plan Gratis.`;
  return motivo ? `${base} ${motivo}` : base;
}

/** "120000" -> "$120.000". */
export function pesos(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return '';
  return '$' + monto.toLocaleString('es-AR', { maximumFractionDigits: Number.isInteger(monto) ? 0 : 2 });
}

/** El id de cobro que vuelve de Nave en la URL (/plan?pago=123), o null. */
export function pagoDeLaUrl(search: string): number | null {
  const v = new URLSearchParams(search).get('pago');
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
