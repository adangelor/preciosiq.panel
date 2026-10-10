// BP-38 (16-sep-2026) -- copia de caja.app/src/app/services/promo-calculator.spec.ts: los
// mismos diez casos que la caja y que PromoCalculator.cs.
import { calcular, lineTotal, texto, textoCondicion } from './promo-calculator';
import { PromoRule } from './business-price.models';

// Los diez casos de PROMPT_Caja_promos_por_cantidad_15sep.md §2.1. El harness de C#
// (Caja_promos_estado_16sep.md) corre exactamente los mismos contra PromoCalculator.cs.
const HOY = '2026-09-16';
const AYER = '2026-09-15';

function regla(r: Partial<PromoRule> & { tipo: PromoRule['tipo']; minQty: number }): PromoRule {
  return {
    id: null,
    branchId: null,
    maxQty: null,
    precioPromo: null,
    porcentaje: null,
    grupoN: null,
    pagaM: null,
    cadaN: null,
    validFrom: null,
    validTo: null,
    activa: true,
    ...r,
  };
}

const CASOS: { nombre: string; regla: PromoRule; lista: number; cant: number; descuento: number; total: number }[] = [
  { nombre: 'precio_unitario 2.100, min 3 / cant 2', regla: regla({ tipo: 'precio_unitario', minQty: 3, precioPromo: 2100 }), lista: 2500, cant: 2, descuento: 0, total: 5000 },
  { nombre: 'precio_unitario 2.100, min 3 / cant 3', regla: regla({ tipo: 'precio_unitario', minQty: 3, precioPromo: 2100 }), lista: 2500, cant: 3, descuento: 1200, total: 6300 },
  { nombre: 'precio_unitario 2.100, min 3, max 6 / cant 8', regla: regla({ tipo: 'precio_unitario', minQty: 3, maxQty: 6, precioPromo: 2100 }), lista: 2500, cant: 8, descuento: 2400, total: 17600 },
  { nombre: 'porcentaje 15, min 3 / cant 3', regla: regla({ tipo: 'porcentaje', minQty: 3, porcentaje: 15 }), lista: 1000, cant: 3, descuento: 450, total: 2550 },
  { nombre: 'n_x_m 3x2 (min 3) / cant 5', regla: regla({ tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2 }), lista: 1000, cant: 5, descuento: 1000, total: 4000 },
  { nombre: 'n_x_m 3x2 (min 3) / cant 6', regla: regla({ tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2 }), lista: 1000, cant: 6, descuento: 2000, total: 4000 },
  { nombre: 'enesima 2 al 50 % (min 2) / cant 1', regla: regla({ tipo: 'enesima_porcentaje', minQty: 2, porcentaje: 50, cadaN: 2 }), lista: 1000, cant: 1, descuento: 0, total: 1000 },
  { nombre: 'enesima 2 al 50 % (min 2) / cant 5', regla: regla({ tipo: 'enesima_porcentaje', minQty: 2, porcentaje: 50, cadaN: 2 }), lista: 1000, cant: 5, descuento: 1000, total: 4000 },
  { nombre: 'n_x_m 3x2 / cant 2,5 (pesable)', regla: regla({ tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2 }), lista: 1000, cant: 2.5, descuento: 0, total: 2500 },
  { nombre: 'cualquiera, ValidTo ayer / cant 10', regla: regla({ tipo: 'porcentaje', minQty: 1, porcentaje: 10, validTo: AYER }), lista: 1000, cant: 10, descuento: 0, total: 10000 },
];

describe('promo-calculator (los diez casos del prompt, iguales a PromoCalculator.cs)', () => {
  for (const c of CASOS) {
    it(c.nombre, () => {
      const r = calcular(c.regla, c.cant, c.lista, HOY);
      expect(r.descuento).toBe(c.descuento);
      expect(lineTotal(c.cant, c.lista, r.descuento)).toBe(c.total);
      expect(r.aplica).toBe(c.descuento > 0);
    });
  }

  it('sin regla no hay descuento', () => {
    expect(calcular(null, 10, 1000, HOY)).toEqual({ descuento: 0, texto: null, aplica: false });
  });

  it('una promo mas cara que la lista no es promo', () => {
    expect(calcular(regla({ tipo: 'precio_unitario', minQty: 1, precioPromo: 3000 }), 3, 2500, HOY).descuento).toBe(0);
  });

  it('textos cortos', () => {
    expect(texto(regla({ tipo: 'precio_unitario', minQty: 3, precioPromo: 2100 }))).toBe('Llevando 3+: $2.100 c/u');
    expect(texto(regla({ tipo: 'porcentaje', minQty: 3, porcentaje: 15 }))).toBe('15 % llevando 3+');
    expect(texto(regla({ tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2, maxQty: 6 }))).toBe('3x2 (máx. 6)');
    // BP-46: "de 3 a 9999" es "desde 3": sin el maximo en el texto.
    expect(texto(regla({ tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2, maxQty: 9999 }))).toBe('3x2');
    expect(texto(regla({ tipo: 'enesima_porcentaje', minQty: 2, cadaN: 2, porcentaje: 50 }))).toBe('2da al 50 %');
    expect(textoCondicion(regla({ tipo: 'precio_unitario', minQty: 3, precioPromo: 2100 }))).toBe('Llevando 3: $2.100 c/u');
    expect(textoCondicion(regla({ tipo: 'porcentaje', minQty: 3, porcentaje: 15 }))).toBe('Llevando 3: 15 % off');
  });
});
