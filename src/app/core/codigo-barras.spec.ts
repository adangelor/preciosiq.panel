import { CODE128_PATRONES, codigoDeBarras, digitoVerificador, modulosCode128, modulosEan13, modulosEan8 } from './codigo-barras';

describe('Código de barras del cartel (BP-190)', () => {
  it('el dígito verificador de EAN reales', () => {
    expect(digitoVerificador('779816704792')).toBe(3);   // 7798167047923, fernet con cola
    expect(digitoVerificador('779279801395')).toBe(1);   // 7792798013951, cerveza 473 ml
    expect(digitoVerificador('400638133393')).toBe(1);   // 4006381333931, el ejemplo clásico de EAN-13
  });

  it('EAN-13: 95 módulos, guardas en su lugar y la primera cifra por paridad', () => {
    const m = modulosEan13('4006381333931')!;
    expect(m.length).toBe(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(92)).toBe('101');
    // 4 -> paridad LGLLGG: la 1.ª cifra de la izquierda (0) va en L = 0001101
    expect(m.slice(3, 10)).toBe('0001101');
    // la 2.ª (0) va en G = 0100111
    expect(m.slice(10, 17)).toBe('0100111');
    // la 1.ª de la derecha (3) va en R = 1000010
    expect(m.slice(50, 57)).toBe('1000010');
  });

  it('EAN-13 con el verificador mal: no lo dibuja como EAN', () => {
    expect(modulosEan13('4006381333932')).toBeNull();
    expect(codigoDeBarras('4006381333932')!.tipo).toBe('code128');
  });

  it('EAN-8 y UPC-A', () => {
    expect(modulosEan8('96385074')!.length).toBe(67);
    const upc = codigoDeBarras('036000291452');   // UPC-A = EAN-13 con un 0 adelante
    expect(upc!.tipo).toBe('ean13');
  });

  it('Code128: cada símbolo mide 11 módulos (el de fin, 13)', () => {
    CODE128_PATRONES.forEach((p, i) => {
      const suma = [...p].reduce((s, d) => s + Number(d), 0);
      expect(suma).withContext(`símbolo ${i}`).toBe(i === 106 ? 13 : 11);
    });
  });

  it('Code128-B de un código interno: inicio, datos, verificador 59 y fin', () => {
    // C=35, 0=16, 0, 0, 1=17: 104 + 35 + 32 + 48 + 64 + 85 = 368; 368 % 103 = 59
    const m = modulosCode128('C0001')!;
    expect(m.length).toBe(7 * 11 + 13);
    const anchos = (p: string) => [...p].map((d, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(d))).join('');
    expect(m.slice(0, 11)).toBe(anchos(CODE128_PATRONES[104]));
    expect(m.slice(66, 77)).toBe(anchos(CODE128_PATRONES[59]));
    expect(m.slice(77)).toBe(anchos(CODE128_PATRONES[106]));
  });

  it('las barras como rectángulos, con zona en blanco', () => {
    const b = codigoDeBarras('7798167047923')!;
    expect(b.tipo).toBe('ean13');
    expect(b.ancho).toBe(95 + 20);
    expect(b.barras[0]).toEqual({ x: 10, w: 1 });
    expect(b.barras.reduce((s, r) => s + r.w, 0)).toBe([...b.modulos].filter((x) => x === '1').length);
  });

  it('vacío o con caracteres raros: sin barras', () => {
    expect(codigoDeBarras('')).toBeNull();
    expect(codigoDeBarras('ñandú')).toBeNull();
  });
});
