import { filasVistaPrevia, plata, reglaDesdeValores, valoresAlCambiarTipo, valoresDesdeRegla } from './promo-regla-form';

// BP-169 -- la regla como formulario: validacion (la de la caja y el servidor), defaults por tipo y la vista previa.
describe('promo-regla-form', () => {
  const vacia = valoresDesdeRegla(null);
  const HOY = '2026-10-19';

  it('sin tipo es "sin promo"', () => {
    expect(reglaDesdeValores(vacia, 1000, 'UN')).toBeNull();
  });

  it('2x1 -> n_x_m con minimo 2', () => {
    const r = reglaDesdeValores({ ...vacia, tipo: 'n_x_m', grupoN: 2, pagaM: 1, min: 2 }, 5317, 'UN')!;
    expect(r).toEqual(jasmine.objectContaining({ tipo: 'n_x_m', grupoN: 2, pagaM: 1, minQty: 2, precioPromo: null, leyenda: null }));
  });

  it('un 3x2 en un pesable no va', () => {
    expect(() => reglaDesdeValores({ ...vacia, tipo: 'n_x_m', grupoN: 3, pagaM: 2, min: 3 }, 1000, 'KG')).toThrowError(/KG/);
  });

  it('precio promo mayor que la lista no es promo', () => {
    expect(() => reglaDesdeValores({ ...vacia, tipo: 'precio_unitario', precio: 1200, min: 1 }, 1000, 'UN')).toThrowError(/menor/);
  });

  it('al elegir "llevando X pagás Y" el minimo es X; con la 2da, 2', () => {
    expect(valoresAlCambiarTipo({ ...vacia, tipo: 'n_x_m' })).toEqual({ grupoN: 3, pagaM: 2, min: 3 });
    expect(valoresAlCambiarTipo({ ...vacia, tipo: 'n_x_m', grupoN: 2 })).toEqual({ grupoN: 2, pagaM: 1, min: 2 });
    expect(valoresAlCambiarTipo({ ...vacia, tipo: 'enesima_porcentaje' })).toEqual({ cadaN: 2, porcentaje: 50, min: 2 });
    expect(valoresAlCambiarTipo({ ...vacia, tipo: 'precio_unitario' })).toEqual({ min: 3 });
  });

  it('vista previa del 2x1 del bidon de Aiello: 1 -> $5.317, 2 -> $5.317 ($2.658,50 c/u), 3 y 4 -> $10.634', () => {
    const r = reglaDesdeValores({ ...vacia, tipo: 'n_x_m', grupoN: 2, pagaM: 1, min: 2 }, 5317, 'UN');
    expect(filasVistaPrevia(r, 5317, HOY)).toEqual([
      { cantidad: 1, total: 5317, porUnidad: null },
      { cantidad: 2, total: 5317, porUnidad: 2658.5 },
      { cantidad: 3, total: 10634, porUnidad: 3544.67 },
      { cantidad: 4, total: 10634, porUnidad: 2658.5 },
    ]);
  });

  it('vista previa de un precio por cantidad: 1, el minimo y uno mas', () => {
    const r = reglaDesdeValores({ ...vacia, tipo: 'precio_unitario', precio: 900, min: 3 }, 1000, 'UN');
    expect(filasVistaPrevia(r, 1000, HOY).map((f) => [f.cantidad, f.total])).toEqual([[1, 1000], [3, 2700], [4, 3600]]);
  });

  it('plata: sin centavos si es entero, si no siempre dos', () => {
    expect(plata(5317)).toBe('$5.317');
    expect(plata(2658.5)).toBe('$2.658,50');
    expect(plata(3544.67)).toBe('$3.544,67');
  });

  it('sin precio de lista no hay vista previa', () => {
    const r = reglaDesdeValores({ ...vacia, tipo: 'porcentaje', porcentaje: 10, min: 1 }, null, 'UN');
    expect(filasVistaPrevia(r, null, HOY)).toEqual([]);
  });
});
