import { accionDeCobro, diasDeGracia, pagoDeLaUrl, pesos, textoDeGracia } from './cobro';
import { EstadoCobro } from './business-subscription.models';

// BP-196 (22-oct-2026) -- reglas de pantalla del cobro con Nave.
describe('cobro (BP-196)', () => {
  const base: EstadoCobro = {
    cobroPendiente: null, enGraciaHasta: null, ultimoRechazo: null, tierProximoPeriodo: null, cicloProximoPeriodo: null,
    proximoPlanRigeDesde: null, cobraPorMercadoPago: false, cobroHabilitado: true,
  };

  it('con link: ir a pagar (checkoutUrl primero, initPoint si es un backend viejo)', () => {
    expect(accionDeCobro({ initPoint: 'https://a', paymentId: 1, checkoutUrl: 'https://b' })).toEqual({ tipo: 'pagar', url: 'https://b' });
    expect(accionDeCobro({ initPoint: 'https://a', paymentId: 1 })).toEqual({ tipo: 'pagar', url: 'https://a' });
  });

  it('programado o aplicado: un mensaje, sin ir a pagar', () => {
    expect(accionDeCobro({ initPoint: null, paymentId: null, programado: true, mensaje: 'Desde el 02/12 pasás a Pyme.' }))
      .toEqual({ tipo: 'mensaje', texto: 'Desde el 02/12 pasás a Pyme.' });
    expect(accionDeCobro({ initPoint: null, paymentId: null, aplicado: true })).toEqual({ tipo: 'mensaje', texto: 'Listo.' });
  });

  it('sin link ni cambio: error', () => {
    expect(accionDeCobro({ initPoint: null, paymentId: null }).tipo).toBe('error');
    expect(accionDeCobro(null).tipo).toBe('error');
  });

  it('dias de gracia: cuenta los dias que faltan, 0 el ultimo, null si no esta en gracia', () => {
    const ahora = new Date('2026-12-02T15:00:00Z');
    expect(diasDeGracia({ ...base, enGraciaHasta: '2026-12-05T12:00:00Z' }, ahora)).toBe(2);
    expect(diasDeGracia({ ...base, enGraciaHasta: '2026-12-03T12:00:00Z' }, ahora)).toBe(0);
    expect(diasDeGracia({ ...base, enGraciaHasta: '2026-12-01T12:00:00Z' }, ahora)).toBe(0);
    expect(diasDeGracia(base, ahora)).toBeNull();
    expect(diasDeGracia(null, ahora)).toBeNull();
  });

  it('texto de gracia: plural, singular, ultimo dia y el motivo', () => {
    expect(textoDeGracia(2, null)).toBe('No pudimos cobrar tu plan. Te quedan 2 días antes de pasar al plan Gratis.');
    expect(textoDeGracia(1, null)).toContain('Te queda 1 día');
    expect(textoDeGracia(0, 'La tarjeta no tiene saldo.')).toBe('No pudimos cobrar tu plan. Hoy es el último día antes de pasar al plan Gratis. La tarjeta no tiene saldo.');
  });

  it('pesos en criollo', () => {
    expect(pesos(120000)).toBe('$120.000');
    expect(pesos(1234.5)).toBe('$1.234,5');
    expect(pesos(null)).toBe('');
  });

  it('el cobro que vuelve de Nave en la URL', () => {
    expect(pagoDeLaUrl('?pago=123')).toBe(123);
    expect(pagoDeLaUrl('?pago=abc')).toBeNull();
    expect(pagoDeLaUrl('')).toBeNull();
  });
});
