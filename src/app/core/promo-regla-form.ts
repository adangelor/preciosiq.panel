import { FormBuilder, FormControl, FormGroup } from '@angular/forms';
import { PromoRule, PromoTipo, esPesable } from './business-price.models';
import { calcular, lineTotal } from './promo-calculator';

// BP-169 (19-oct-2026) -- la regla de promo como formulario, sin pantalla: la usan el selector de un producto
// (features/price-upsert) y las promos "para confirmar" de la carga masiva (shared/promos-para-confirmar), las dos con
// el mismo editor (shared/promo-regla-editor). Antes esto vivia adentro de price-upsert (BP-38).

/** Los valores del formulario de una regla (los numeros vacios son null). */
export interface PromoReglaValores {
  tipo: PromoTipo | '';
  precio: number | null;
  porcentaje: number | null;
  grupoN: number | null;
  pagaM: number | null;
  cadaN: number | null;
  min: number | null;
  max: number | null;
  desde: string;
  hasta: string;
  leyenda: string;
}

export type PromoReglaControles = { [K in keyof PromoReglaValores]: FormControl<PromoReglaValores[K]> };
export type PromoReglaGrupo = FormGroup<PromoReglaControles>;

/** Lo que ya se cargó, o vacío ("Sin promo"). */
export function valoresDesdeRegla(r: Partial<PromoRule> | null | undefined): PromoReglaValores {
  return {
    tipo: (r?.tipo as PromoTipo | undefined) ?? '',
    precio: r?.precioPromo ?? null,
    porcentaje: r?.porcentaje ?? null,
    grupoN: r?.grupoN ?? null,
    pagaM: r?.pagaM ?? null,
    cadaN: r?.cadaN ?? null,
    min: r?.minQty ?? null,
    max: r?.maxQty ?? null,
    desde: r?.validFrom ?? '',
    hasta: r?.validTo ?? '',
    leyenda: r?.leyenda ?? '',
  };
}

/** Un grupo nuevo con esos valores (las promos "para confirmar" arman uno por fila). */
export function crearGrupoPromo(fb: FormBuilder, v: PromoReglaValores = valoresDesdeRegla(null)): PromoReglaGrupo {
  return fb.nonNullable.group({
    tipo: [v.tipo],
    precio: [v.precio],
    porcentaje: [v.porcentaje],
    grupoN: [v.grupoN],
    pagaM: [v.pagaM],
    cadaN: [v.cadaN],
    min: [v.min],
    max: [v.max],
    desde: [v.desde],
    hasta: [v.hasta],
    leyenda: [v.leyenda],
  }) as PromoReglaGrupo;
}

/** Los atajos del selector. */
export interface AtajoPromo {
  etiqueta: string;
  valores: Partial<PromoReglaValores>;
}

export const ATAJOS_PROMO: AtajoPromo[] = [
  { etiqueta: '2x1', valores: { tipo: 'n_x_m', grupoN: 2, pagaM: 1, min: 2 } },
  { etiqueta: '3x2', valores: { tipo: 'n_x_m', grupoN: 3, pagaM: 2, min: 3 } },
  { etiqueta: '4x3', valores: { tipo: 'n_x_m', grupoN: 4, pagaM: 3, min: 4 } },
  { etiqueta: '6x5', valores: { tipo: 'n_x_m', grupoN: 6, pagaM: 5, min: 6 } },
  { etiqueta: '2da al 50 %', valores: { tipo: 'enesima_porcentaje', cadaN: 2, porcentaje: 50, min: 2 } },
  { etiqueta: '2da al 70 %', valores: { tipo: 'enesima_porcentaje', cadaN: 2, porcentaje: 70, min: 2 } },
];

/**
 * Valores razonables al cambiar de tipo, para que la vista previa aparezca de una (como la caja). Con NxM y N-ésima el
 * mínimo es el grupo / la unidad: no se pide aparte.
 */
export function valoresAlCambiarTipo(v: PromoReglaValores): Partial<PromoReglaValores> {
  switch (v.tipo) {
    case 'n_x_m': {
      const n = v.grupoN ?? 3;
      return { grupoN: n, pagaM: v.pagaM ?? Math.max(1, n - 1), min: n };
    }
    case 'enesima_porcentaje': {
      const n = v.cadaN ?? 2;
      return { cadaN: n, porcentaje: v.porcentaje ?? 50, min: n };
    }
    case 'precio_unitario':
    case 'porcentaje':
      return v.min == null ? { min: 3 } : {};
    default:
      return {};
  }
}

const num = (x: number | string | null | undefined): number | null =>
  x === null || x === '' || x === undefined ? null : Number(x);

/**
 * La regla tal como se manda (null = sin promo). Lanza un Error con un mensaje para la persona si está mal: las mismas
 * validaciones que la caja (pages/producto) y el servidor (PromoRuleService.ValidarRegla).
 */
export function reglaDesdeValores(v: PromoReglaValores, listPrice: number | null, unidad: string | null): PromoRule | null {
  const tipo = v.tipo;
  if (!tipo) return null;
  const lista = num(listPrice);
  const rule: PromoRule = {
    id: null,
    branchId: null,
    tipo,
    minQty: num(v.min) ?? 1,
    maxQty: num(v.max),
    precioPromo: tipo === 'precio_unitario' ? num(v.precio) : null,
    porcentaje: tipo === 'porcentaje' || tipo === 'enesima_porcentaje' ? num(v.porcentaje) : null,
    grupoN: tipo === 'n_x_m' ? num(v.grupoN) : null,
    pagaM: tipo === 'n_x_m' ? num(v.pagaM) : null,
    cadaN: tipo === 'enesima_porcentaje' ? num(v.cadaN) : null,
    validFrom: v.desde || null,
    validTo: v.hasta || null,
    activa: true,
    leyenda: v.leyenda?.trim() ? v.leyenda.trim() : null,
  };
  if (rule.minQty <= 0) throw new Error('El mínimo tiene que ser mayor a cero.');
  if (rule.maxQty != null && rule.maxQty < rule.minQty) throw new Error('El máximo no puede ser menor que el mínimo.');
  if (rule.validFrom && rule.validTo && rule.validTo < rule.validFrom)
    throw new Error('La vigencia termina antes de empezar: revisá las fechas.');
  switch (rule.tipo) {
    case 'precio_unitario':
      if (!rule.precioPromo || rule.precioPromo <= 0) throw new Error('Falta el precio promo (mayor a cero).');
      if (lista && rule.precioPromo >= lista) throw new Error('El precio promo tiene que ser menor que el de lista.');
      break;
    case 'porcentaje':
      if (!rule.porcentaje || rule.porcentaje <= 0 || rule.porcentaje > 100)
        throw new Error('El porcentaje tiene que estar entre 0 y 100.');
      break;
    case 'n_x_m':
      if (esPesable(unidad)) throw new Error(`Un producto que se vende por ${unidad} no puede tener 3x2.`);
      if (!rule.grupoN || !rule.pagaM || rule.pagaM <= 0 || rule.grupoN <= rule.pagaM)
        throw new Error('"Llevando X pagás Y" necesita que pagues menos de lo que llevás, y al menos 1 (ej. 3x2).');
      if (rule.minQty < rule.grupoN)
        throw new Error(`Con ${rule.grupoN}x${rule.pagaM} el mínimo tiene que ser al menos ${rule.grupoN}.`);
      if (rule.minQty !== Math.floor(rule.minQty)) throw new Error('Con "llevando X pagás Y" el mínimo tiene que ser entero.');
      break;
    case 'enesima_porcentaje':
      if (esPesable(unidad)) throw new Error(`Un producto que se vende por ${unidad} no puede tener "segunda al 50 %".`);
      if (!rule.cadaN || rule.cadaN < 2) throw new Error('La unidad con descuento tiene que ser la segunda o más.');
      if (!rule.porcentaje || rule.porcentaje <= 0 || rule.porcentaje > 100)
        throw new Error('El porcentaje tiene que estar entre 0 y 100.');
      if (rule.minQty < rule.cadaN)
        throw new Error(`Con la ${rule.cadaN}ª unidad con descuento el mínimo tiene que ser al menos ${rule.cadaN}.`);
      if (rule.minQty !== Math.floor(rule.minQty)) throw new Error('Con la N-ésima el mínimo tiene que ser entero.');
      break;
  }
  return rule;
}

/** Una fila de la vista previa: cuánto sale llevando `cantidad`, y cuánto cada una si hay descuento. */
export interface FilaVistaPrevia {
  cantidad: number;
  total: number;
  porUnidad: number | null;
}

/**
 * La vista previa del selector con la MISMA calculadora que cobra la caja, sin mirar la vigencia (muestra cómo va a
 * quedar): "1 → $5.317 · 2 → $5.317 ($2.658,50 c/u) · 3 → $10.634 · 4 → $10.634". Cantidades: con NxM 1, N, N+1 y 2N;
 * con la N-ésima 1, n, n+1 y 2n; con precio o % 1, el mínimo y el mínimo + 1.
 */
export function filasVistaPrevia(regla: PromoRule | null, listPrice: number | null, hoy: string): FilaVistaPrevia[] {
  const lista = num(listPrice);
  if (!regla || !lista || lista <= 0) return [];
  const n = regla.tipo === 'n_x_m' ? regla.grupoN ?? 0 : regla.tipo === 'enesima_porcentaje' ? regla.cadaN ?? 0 : 0;
  const min = Math.max(1, Math.ceil(regla.minQty));
  const cantidades = n >= 2 ? [1, n, n + 1, 2 * n] : [1, min, min + 1];
  const sinVigencia = { ...regla, validFrom: null, validTo: null };
  return [...new Set(cantidades)]
    .sort((a, b) => a - b)
    .map((cantidad) => {
      const r = calcular(sinVigencia, cantidad, lista, hoy);
      const total = lineTotal(cantidad, lista, r.descuento);
      return { cantidad, total, porUnidad: r.descuento > 0 && cantidad > 1 ? Math.round((total / cantidad) * 100) / 100 : null };
    });
}

/** "$5.317", "$2.658,50": sin centavos si es entero; si no, siempre dos (es plata). */
export function plata(n: number): string {
  const entero = Math.abs(n - Math.round(n)) < 0.005;
  return '$' + new Intl.NumberFormat('es-AR', { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: entero ? 0 : 2 }).format(n);
}

/** Hoy en el dispositivo, 'YYYY-MM-DD'. */
export function hoyIso(): string {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
