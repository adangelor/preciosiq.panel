import { MAX_CARTELES, ProductoElegido, codigosPegados, coincide, sumar } from './carteles-seleccion';

const p = (ean: string): ProductoElegido => ({ ean, descripcion: null, marca: null, precio: null });

describe('carteles-seleccion', () => {
  it('codigosPegados: una columna de Excel, comas y punto y coma, sin repetir ni basura', () => {
    expect(codigosPegados('7790895000997\r\n7791813969488\n\n7790895000997')).toEqual(['7790895000997', '7791813969488']);
    expect(codigosPegados('7790070335944, 7792180004932;7798144941275')).toEqual(['7790070335944', '7792180004932', '7798144941275']);
    expect(codigosPegados('$ 4.370,00 hola')).toEqual(['hola']);
    expect(codigosPegados('')).toEqual([]);
  });

  it('coincide: por código, el comienzo', () => {
    const item = { ean: '7790895000997', description: 'GASEOSA COCA COLA 2,25 L', brand: 'COCA-COLA' };
    expect(coincide(item, '77908')).toBeTrue();
    expect(coincide(item, '0997')).toBeFalse();
  });

  it('coincide: por palabras, sin tildes ni mayúsculas, en descripción o marca', () => {
    const item = { ean: '1', description: 'QSO CREMÓN CREMOSO LIGHT', brand: 'LA SERENISIMA' };
    expect(coincide(item, 'cremon light')).toBeTrue();
    expect(coincide(item, 'serenisima cremoso')).toBeTrue();
    expect(coincide(item, 'cremon port')).toBeFalse();
    expect(coincide(item, '   ')).toBeFalse();
  });

  it('sumar: sin repetir y con tope', () => {
    const r = sumar([p('1'), p('2')], [p('2'), p('3')]);
    expect(r.lista.map((x) => x.ean)).toEqual(['1', '2', '3']);
    expect(r.sumados).toBe(1);
    expect(r.sobran).toBe(0);

    const llena = Array.from({ length: MAX_CARTELES }, (_, i) => p(String(i)));
    const r2 = sumar(llena, [p('x'), p('y'), p('0')]);
    expect(r2.lista.length).toBe(MAX_CARTELES);
    expect(r2.sumados).toBe(0);
    expect(r2.sobran).toBe(2);
  });
});
