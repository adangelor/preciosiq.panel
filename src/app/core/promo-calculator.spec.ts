// ============================================================================================
// TEST DE LA CALCULADORA DE PROMOS -- COPIA GENERADA, NO EDITAR ACÁ.
// El original: Buscaprecios.web/shared-ts/promo-calculator.spec.ts (ver promo-calculator.ts).
// Corre igual en el `ng test` de la caja, del panel de PreciosIQ y de misuper.app.
// ============================================================================================
import { PromoRule, calcular, lineTotal, texto, textoCondicion, vistaPrevia } from './promo-calculator';

// Los diez casos de PROMPT_Caja_promos_por_cantidad_15sep.md §2.1. El harness de C#
// (Caja_promos_estado_16sep.md) corre exactamente los mismos contra PromoCalculator.cs.
const HOY = '2026-09-16';
const AYER = '2026-09-15';

function regla(r: Partial<PromoRule> & { tipo: string; minQty: number }): PromoRule {
  return {
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

  it('vista previa de la pantalla Producto', () => {
    expect(vistaPrevia(regla({ tipo: 'precio_unitario', minQty: 3, precioPromo: 2100 }), 2500, HOY))
      .toBe('Llevando 3 de $2.500: $6.300 (ahorra $1.200)');
    // La vista previa ignora la vigencia (muestra cómo va a quedar) y da null si no abarata nada.
    expect(vistaPrevia(regla({ tipo: 'porcentaje', minQty: 2, porcentaje: 10, validTo: AYER }), 1000, HOY))
      .toBe('Llevando 2 de $1.000: $1.800 (ahorra $200)');
    expect(vistaPrevia(regla({ tipo: 'precio_unitario', minQty: 1, precioPromo: 3000 }), 2500, HOY)).toBeNull();
  });
});
