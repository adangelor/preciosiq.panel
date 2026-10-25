/**
 * BP-190 (25-oct-2026) -- el código de barras del cartel de góndola, dibujado en SVG sin librerías.
 * EAN-13 (y UPC-A de 12 dígitos como EAN-13 con un 0 adelante), EAN-8, y Code128-B para los códigos internos de la
 * ficha (C0001) o cualquier otro texto imprimible. Devuelve los "módulos": '1' = barra, '0' = espacio, de ancho 1.
 * El cartel los dibuja como rectángulos; la caja los lee con la cámara.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const G = R.map((p) => [...p].reverse().join(''));
const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Dígito verificador EAN/UPC de los dígitos sin el último: pesos 3 y 1 alternados desde la derecha. */
export function digitoVerificador(sinVerificador: string): number {
  let suma = 0;
  const n = sinVerificador.length;
  for (let i = 0; i < n; i++) suma += Number(sinVerificador[n - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (suma % 10)) % 10;
}

function verificadorOk(codigo: string): boolean {
  return digitoVerificador(codigo.slice(0, -1)) === Number(codigo[codigo.length - 1]);
}

export function modulosEan13(codigo: string): string | null {
  if (!/^\d{13}$/.test(codigo) || !verificadorOk(codigo)) return null;
  const paridad = PARIDAD[Number(codigo[0])];
  let izq = '';
  for (let i = 0; i < 6; i++) {
    const d = Number(codigo[1 + i]);
    izq += paridad[i] === 'L' ? L[d] : G[d];
  }
  let der = '';
  for (let i = 7; i < 13; i++) der += R[Number(codigo[i])];
  return '101' + izq + '01010' + der + '101';
}

export function modulosEan8(codigo: string): string | null {
  if (!/^\d{8}$/.test(codigo) || !verificadorOk(codigo)) return null;
  let izq = '';
  for (let i = 0; i < 4; i++) izq += L[Number(codigo[i])];
  let der = '';
  for (let i = 4; i < 8; i++) der += R[Number(codigo[i])];
  return '101' + izq + '01010' + der + '101';
}

// Code 128: ancho de barra, espacio, barra... de cada símbolo (0-102 datos, 103/104/105 inicio A/B/C, 106 fin).
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATRONES = C128;   // para la prueba de que cada símbolo mide 11 módulos

function anchosAModulos(anchos: string): string {
  let m = '';
  for (let i = 0; i < anchos.length; i++) m += (i % 2 === 0 ? '1' : '0').repeat(Number(anchos[i]));
  return m;
}

/** Code128-B: letras, números y signos ASCII imprimibles. Null si hay otro carácter. */
export function modulosCode128(texto: string): string | null {
  if (!texto || ![...texto].every((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126)) return null;
  const valores = [...texto].map((ch) => ch.charCodeAt(0) - 32);
  let suma = 104;
  valores.forEach((v, i) => (suma += v * (i + 1)));
  const simbolos = [104, ...valores, suma % 103, 106];
  return simbolos.map((s) => anchosAModulos(C128[s])).join('');
}

export interface CodigoDeBarras {
  tipo: 'ean13' | 'ean8' | 'code128';
  modulos: string;
  /** Las barras como rectángulos (x y ancho en módulos), ya con la zona en blanco de cada lado. */
  barras: { x: number; w: number }[];
  /** El ancho total en módulos, con la zona en blanco. */
  ancho: number;
}

/** El código de barras de un código del cartel: EAN si es un EAN válido, Code128 si no. Null si no se puede. */
export function codigoDeBarras(codigo: string | null | undefined): CodigoDeBarras | null {
  const c = (codigo ?? '').trim();
  let tipo: CodigoDeBarras['tipo'];
  let modulos: string | null = null;
  if (/^\d{13}$/.test(c)) { modulos = modulosEan13(c); tipo = 'ean13'; }
  else if (/^\d{12}$/.test(c)) { modulos = modulosEan13('0' + c); tipo = 'ean13'; }
  else if (/^\d{8}$/.test(c)) { modulos = modulosEan8(c); tipo = 'ean8'; }
  else tipo = 'code128';
  if (!modulos) { modulos = modulosCode128(c); tipo = 'code128'; }   // EAN con verificador mal: igual se puede leer como Code128
  if (!modulos) return null;
  const blanco = 10;   // zona en blanco de cada lado, en módulos
  const barras: { x: number; w: number }[] = [];
  for (let i = 0; i < modulos.length; ) {
    if (modulos[i] !== '1') { i++; continue; }
    let j = i;
    while (j < modulos.length && modulos[j] === '1') j++;
    barras.push({ x: blanco + i, w: j - i });
    i = j;
  }
  return { tipo, modulos, barras, ancho: modulos.length + 2 * blanco };
}
