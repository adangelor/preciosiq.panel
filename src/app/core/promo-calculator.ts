// ============================================================================================
// CALCULADORA DE PROMOS -- COPIA GENERADA, NO EDITAR ACÁ.
//
// El original vive en el repo del backend: Buscaprecios.web/shared-ts/promo-calculator.ts, al lado de
// Services/PromoCalculator.cs, que tiene que dar EXACTAMENTE lo mismo (si no, el ticket entra al
// servidor como 'guardado_con_diferencia', y eso es un bug, no una tolerancia).
//
// La usan la caja (caja.app/src/app/services), el panel de PreciosIQ (preciosiq.panel/src/app/core)
// y misuper.app (misuper.app/src/app/core). BP-41 (10-oct-2026): antes eran tres copias mantenidas a
// mano. Para cambiarla: se edita el original y se corre
//     pwsh Buscaprecios.web/shared-ts/Sync-PromoCalculator.ps1          (copia a los tres repos)
//     pwsh Buscaprecios.web/shared-ts/Sync-PromoCalculator.ps1 -Check   (falla si alguna difiere)
// El test (promo-calculator.spec.ts) viaja igual y corre en el `ng test` de cada uno.
//
// No importa nada de ningún proyecto: declara su propia PromoRule con lo que necesita. Los modelos de
// cada app (que tienen además id, sucursal, leyenda...) son compatibles y se le pasan tal cual.
// ============================================================================================

/** La regla de promo, con los mismos campos que usan la caja y el panel. */
export interface PromoRule {
  tipo: string;
  minQty: number;
  maxQty: number | null;
  precioPromo: number | null;
  porcentaje: number | null;
  grupoN: number | null;
  pagaM: number | null;
  cadaN: number | null;
  validFrom: string | null;
  validTo: string | null;
  activa?: boolean;
}

/**
 * Caja v1.1 (16-sep-2026) -- la MISMA funcion que
 * Buscaprecios.web/Services/PromoCalculator.cs, linea por linea.
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

/** BP-169 -- lo que devuelve proximoBeneficio. */
export interface ProximoBeneficio {
  /** Cuantas unidades mas hay que sumar. */
  faltan: number;
  /** Cuanto mas se ahorra con esas unidades. */
  ahorroExtra: number;
  /** El total del renglon con esa cantidad. */
  totalCon: number;
}

/**
 * BP-169 (19-oct-2026) -- el empujon del carrito ("Sumá 1 más y te llevás 2 por $5.317"): la menor cantidad `faltan`
 * (1 a grupoN / cadaN, o lo que falte para el minimo) con la que el descuento AUMENTA. Null si no hay regla, si no esta
 * vigente, si ya esta en el tope, si la cantidad no es entera (pesable) o si es un precio / porcentaje que ya llego al
 * minimo (ahi cada unidad suma el mismo descuento: no hay escalon que empujar). Igual a PromoCalculator.Proximo en C#.
 */
export function proximoBeneficio(
  regla: PromoRule | null | undefined, cantidad: number, precioLista: number, hoy: string,
): ProximoBeneficio | null {
  if (!regla || regla.activa === false || precioLista <= 0 || cantidad < 0 || !esEntera(cantidad)) return null;
  if (regla.validFrom && hoy < regla.validFrom) return null;
  if (regla.validTo && hoy > regla.validTo) return null;
  const porGrupo = regla.tipo === 'n_x_m' || regla.tipo === 'enesima_porcentaje';
  if (!porGrupo && cantidad >= regla.minQty) return null;

  const paso = regla.tipo === 'n_x_m' ? regla.grupoN ?? 0 : regla.tipo === 'enesima_porcentaje' ? regla.cadaN ?? 0 : 0;
  const maximoAProbar = Math.max(paso, Math.ceil(regla.minQty - cantidad));
  const actual = calcular(regla, cantidad, precioLista, hoy).descuento;
  for (let faltan = 1; faltan <= maximoAProbar; faltan++) {
    const con = cantidad + faltan;
    if (regla.maxQty != null && con > regla.maxQty) return null;
    const d = calcular(regla, con, precioLista, hoy).descuento;
    if (d > actual) return { faltan, ahorroExtra: round2Away(d - actual), totalCon: lineTotal(con, precioLista, d) };
  }
  return null;
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

/** BP-46: un máximo de 999 o más se muestra como "sin tope" (igual que PromoCalculator.MaximoSinTope en el backend). */
export const MAXIMO_SIN_TOPE = 999;

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
  // BP-46 (10-oct-2026): un máximo de 999 o más es "sin tope" EN EL TEXTO (no en el cálculo): las planillas
  // dicen "de 3 a 9999" para decir "desde 3". Mismo umbral que el backend (PromoCalculator.MaximoSinTope).
  return regla.maxQty != null && regla.maxQty < MAXIMO_SIN_TOPE ? `${t} (máx. ${cantidadTxt(regla.maxQty)})` : t;
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
