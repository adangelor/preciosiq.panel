// 5-nov-2026 -- la pantalla "Carteles de góndola" (features/carteles-elegir): elegir productos sueltos para imprimir
// sus carteles. Acá van las cuentas puras (con spec); la impresión es la de siempre, /precios/carteles?eans=.

/** Un producto elegido. Los pegados a mano llegan sin descripción ni precio: la hoja de carteles los completa. */
export interface ProductoElegido {
  ean: string;
  descripcion: string | null;
  marca: string | null;
  precio: number | null;
}

/**
 * Tope por tanda. Los códigos viajan en la dirección (?eans=) y los servidores cortan direcciones largas
 * (IIS, 2.048 caracteres por defecto): 100 códigos de 13 dígitos entran con margen.
 */
export const MAX_CARTELES = 100;

/** Los códigos de un texto pegado (una columna de Excel, separados por coma, espacio o punto y coma), sin repetir. */
export function codigosPegados(texto: string): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const t of texto.split(/[\s,;]+/)) {
    const c = t.trim();
    // 4 o más: un "00" suelto de un precio pegado ("4.370,00") no es un código.
    if (!/^[0-9A-Za-z-]{4,40}$/.test(c) || vistos.has(c)) continue;
    vistos.add(c);
    salida.push(c);
  }
  return salida;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * ¿El producto responde a la búsqueda? El backend ya filtra; esto es el resguardo contra un backend viejo que
 * ignora `q` y devuelve los primeros de la lista. Solo números = el código empieza así; si no, todas las palabras
 * tienen que estar en la descripción o la marca, sin importar tildes ni mayúsculas.
 */
export function coincide(p: { ean: string; description: string | null; brand: string | null }, q: string): boolean {
  const texto = q.trim();
  if (!texto) return false;
  if (/^\d+$/.test(texto)) return p.ean.startsWith(texto);
  const donde = normalizar(`${p.description ?? ''} ${p.brand ?? ''}`);
  return normalizar(texto).split(/\s+/).filter(Boolean).every((w) => donde.includes(w));
}

/** Suma productos a la selección sin repetir y sin pasar el tope. `sobran` = los que no entraron. */
export function sumar(
  actual: readonly ProductoElegido[],
  nuevos: readonly ProductoElegido[],
  max = MAX_CARTELES,
): { lista: ProductoElegido[]; sumados: number; sobran: number } {
  const lista = [...actual];
  const ya = new Set(actual.map((p) => p.ean));
  let sumados = 0;
  let sobran = 0;
  for (const n of nuevos) {
    if (ya.has(n.ean)) continue;
    if (lista.length >= max) {
      sobran++;
      continue;
    }
    lista.push(n);
    ya.add(n.ean);
    sumados++;
  }
  return { lista, sumados, sobran };
}
