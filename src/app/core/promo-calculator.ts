// BP-38 (16-sep-2026) -- Copia de la de la caja; las dos tienen que dar lo mismo que
// PromoCalculator.cs. Si cambiás una, cambiás las tres.
// (caja.app/src/app/services/promo-calculator.ts, sin cambios de lógica: solo el import de
// PromoRule. Un paquete compartido queda en el backlog.)
import { PromoRule } from './business-price.models';

/**
 * Caja v1.1 (16-sep-2026) -- la MISMA funcion que
 * Buscaprecios.web/Services/PromoCalculator.cs, linea por linea. Si los dos calculos no
 * dan lo mismo, el ticket entra al servidor como 'guardado_con_diferencia' y eso es un
 * bug, no una tolerancia. Los diez casos del prompt estan en promo-calculator.spec.ts y
 * en el harness de C# (ver Caja_promos_estado_16sep.md).
 *
 * Pura: sin base, sin reloj. `hoy` entra como 'YYYY-MM-DD' (fecha del dispositivo).
 */
export interface PromoResult {
  descuento: number;
  texto: string | null;
  aplica: boolean;
}

export const NADA: PromoResult = { descuento: 0, texto: null, aplica: false };

/** Redondeo a 2 decimales "away from zero" (como MidpointRounding.AwayFromZero de C#). */
export function round2Away(n: number): number {
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  // +1e-9 corrige el clasico 1.005 * 100 = 100.49999
  return (sign * Math.round(abs * 100 + 1e-9)) / 100;
}

function esEntera(q: number): boolean {
  return q === Math.floor(q);
}

export function calcular(regla: PromoRule | null | undefined, cantidad: number, precioLista: number, hoy: string): PromoResult {
  if (!regla || regla.activa === false) return NADA;
  if (regla.validFrom && hoy < regla.validFrom) return NADA;
  if (regla.validTo && hoy > regla.validTo) return NADA;
  if (cantidad < regla.minQty) return NADA;
  if (precioLista <= 0) return NADA;

  const elegibles = regla.maxQty != null ? Math.min(cantidad, regla.maxQty) : cantidad;
  let descuento: number;

  switch (regla.tipo) {
    case 'precio_unitario': {
      const promo = regla.precioPromo ?? 0;
      descuento = promo > 0 && promo < precioLista ? elegibles * (precioLista - promo) : 0;
      break;
    }
    case 'porcentaje':
      descuento = (elegibles * precioLista * (regla.porcentaje ?? 0)) / 100;
      break;
    case 'n_x_m': {
      const grupoN = regla.grupoN ?? 0;
      const pagaM = regla.pagaM ?? 0;
      if (!esEntera(cantidad) || grupoN <= pagaM || pagaM <= 0) return NADA;
      const grupos = Math.floor(elegibles / grupoN);
      descuento = grupos * (grupoN - pagaM) * precioLista;
      break;
    }
    case 'enesima_porcentaje': {
      const cadaN = regla.cadaN ?? 0;
      if (!esEntera(cantidad) || cadaN < 2) return NADA;
      const unidadesConDescuento = Math.floor(elegibles / cadaN);
      descuento = (unidadesConDescuento * precioLista * (regla.porcentaje ?? 0)) / 100;
      break;
    }
    default:
      return NADA;
  }

  descuento = round2Away(descuento);
  if (descuento <= 0) return NADA;
  return { descuento, texto: texto(regla), aplica: true };
}

/** LineTotal = round(cantidad x lista, 2) - descuento. */
export function lineTotal(cantidad: number, precioLista: number, descuento: number): number {
  return round2Away(round2Away(cantidad * precioLista) - descuento);
}

// ------------------------------------------------------------------ textos (iguales a C#)
const fmtAr = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function cantidadTxt(q: number): string {
  return esEntera(q) ? String(q) : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(q);
}

function pctTxt(p: number): string {
  return esEntera(p) ? String(p) : fmtAr.format(p);
}

function plataTxt(m: number): string {
  return '$' + fmtAr.format(m);
}

function ordinal(n: number): string {
  switch (n) {
    case 1: return '1ra';
    case 2: return '2da';
    case 3: return '3ra';
    case 7: return '7ma';
    case 8: return '8va';
    case 9: return '9na';
    case 10: return '10ma';
    default: return `${n}ta`;
  }
}

/** "Llevando 3+: $2.100 c/u", "15 % llevando 3+", "3x2", "2da al 50 %". Con maximo: " (máx. 6)". */
export function texto(regla: PromoRule): string {
  const min = cantidadTxt(regla.minQty);
  let t: string;
  switch (regla.tipo) {
    case 'precio_unitario': t = `Llevando ${min}+: ${plataTxt(regla.precioPromo ?? 0)} c/u`; break;
    case 'porcentaje': t = `${pctTxt(regla.porcentaje ?? 0)} % llevando ${min}+`; break;
    case 'n_x_m': t = `${regla.grupoN}x${regla.pagaM}`; break;
    case 'enesima_porcentaje': t = `${ordinal(regla.cadaN ?? 2)} al ${pctTxt(regla.porcentaje ?? 0)} %`; break;
    default: t = regla.tipo;
  }
  return regla.maxQty != null ? `${t} (máx. ${cantidadTxt(regla.maxQty)})` : t;
}

/** Lo que se le dice al cliente antes del minimo: "Llevando 3: $2.100 c/u", "Llevando 3: 15 % off", "3x2", "2da al 50 %". */
export function textoCondicion(regla: PromoRule): string {
  const min = cantidadTxt(regla.minQty);
  switch (regla.tipo) {
    case 'precio_unitario': return `Llevando ${min}: ${plataTxt(regla.precioPromo ?? 0)} c/u`;
    case 'porcentaje': return `Llevando ${min}: ${pctTxt(regla.porcentaje ?? 0)} % off`;
    case 'n_x_m': return `${regla.grupoN}x${regla.pagaM}`;
    case 'enesima_porcentaje': return `${ordinal(regla.cadaN ?? 2)} al ${pctTxt(regla.porcentaje ?? 0)} %`;
    default: return regla.tipo;
  }
}

/** Vista previa para la pantalla Producto: "Llevando 3 de $2.500: $6.300 (ahorra $1.200)". */
export function vistaPrevia(regla: PromoRule, precioLista: number, hoy: string): string | null {
  const cantidad = regla.tipo === 'n_x_m' ? regla.grupoN ?? 1 : regla.tipo === 'enesima_porcentaje' ? regla.cadaN ?? 2 : Math.max(regla.minQty, 1);
  const r = calcular({ ...regla, validFrom: null, validTo: null }, cantidad, precioLista, hoy);
  if (!r.aplica) return null;
  const total = lineTotal(cantidad, precioLista, r.descuento);
  return `Llevando ${cantidadTxt(cantidad)} de ${plataTxt(precioLista)}: ${plataTxt(total)} (ahorra ${plataTxt(r.descuento)})`;
}
