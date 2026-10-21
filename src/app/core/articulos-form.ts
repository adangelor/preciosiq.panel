import { HttpErrorResponse } from '@angular/common/http';
import { ArticuloExportItem, ArticuloListaItem, Rubro } from './articulos.models';
import { planGateErrorMessage } from './plan-gate';

// BP-178 (21-oct-2026) -- lo que las pantallas de Gestión muestran y calculan, en funciones puras (con spec).

/** "10,5 %", "21 %". */
export function porcentaje(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

/** "$1.234,50". */
export function plata(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** El margen de un artículo: "30 % propio", "30 % (de Almacén)" o "—". */
export function margenTexto(a: Pick<ArticuloListaItem, 'margenObjetivoPct' | 'margenDe'>): string {
  if (a.margenObjetivoPct == null) return '—';
  const p = porcentaje(a.margenObjetivoPct);
  if (a.margenDe === 'propio') return `${p} propio`;
  return a.margenDe ? `${p} (de ${a.margenDe})` : p;
}

/** El margen de un rubro en el árbol: "30 %", "30 % (heredado de Almacén)" o "sin margen". */
export function margenDeRubro(r: Pick<Rubro, 'margenObjetivoPct' | 'margenEfectivoPct' | 'margenHeredadoDe'>): string {
  if (r.margenObjetivoPct != null) return porcentaje(r.margenObjetivoPct);
  if (r.margenEfectivoPct != null) return `${porcentaje(r.margenEfectivoPct)} (heredado de ${r.margenHeredadoDe ?? 'arriba'})`;
  return 'sin margen';
}

/** Opciones para un select de rubros: el árbol en orden, con sangría por nivel. Solo los activos (y el elegido). */
export function opcionesDeRubro(rubros: Rubro[], elegido: number | null = null): { id: number; etiqueta: string; nivel: number }[] {
  return rubros
    .filter((r) => r.activo || r.id === elegido)
    .map((r) => ({ id: r.id, nivel: r.nivel, etiqueta: `${' '.repeat(Math.max(0, r.nivel - 1))}${r.nombre}${r.activo ? '' : ' (desactivado)'}` }));
}

/** Los rubros a los que se puede mover uno: ni él ni sus descendientes, y que no quede con más de 3 niveles. */
export function destinosParaMover(rubros: Rubro[], id: number): Rubro[] {
  const hijos = new Map<number, number[]>();
  for (const r of rubros) if (r.parentId != null) hijos.set(r.parentId, [...(hijos.get(r.parentId) ?? []), r.id]);
  const subarbol = new Set<number>();
  const altura = (x: number): number => {
    subarbol.add(x);
    const h = hijos.get(x) ?? [];
    return 1 + (h.length ? Math.max(...h.map(altura)) : 0);
  };
  const alto = altura(id);
  return rubros.filter((r) => r.activo && !subarbol.has(r.id) && r.nivel + alto <= 3);
}

/** El texto de error de una llamada: plan, el del backend (en palabras de comercio) o el de reserva. */
export function mensajeDeError(err: unknown, reserva: string): string {
  const plan = planGateErrorMessage(err);
  if (plan) return plan;
  if (err instanceof HttpErrorResponse) {
    if (err.status === 503) return err.error?.error ?? 'La ficha de artículos todavía no está habilitada en el servidor.';
    if (typeof err.error?.error === 'string') return err.error.error;
  }
  return reserva;
}

/** Un número de un input, o null si está vacío o no es número. Acepta coma decimal. */
export function numeroONull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** El código: si parece EAN (8, 12, 13 o 14 dígitos) y no cierra el verificador, el aviso de antes de mandar. */
export function avisoDeCodigo(codigo: string): string | null {
  const c = codigo.trim();
  if (!c) return null;
  if (!/^\d+$/.test(c) || ![8, 12, 13, 14].includes(c.length)) return null;
  let suma = 0;
  let peso = 3;
  for (let i = c.length - 2; i >= 0; i--, peso = peso === 3 ? 1 : 3) suma += Number(c[i]) * peso;
  return (10 - (suma % 10)) % 10 === Number(c[c.length - 1])
    ? null
    : `${c.length} dígitos y no cierra el dígito verificador: ¿está bien copiado?`;
}

/** Las filas del Excel de artículos (una hoja), con encabezados en castellano. */
export function filasExcel(items: ArticuloExportItem[]): Record<string, string | number | null>[] {
  return items.map((x) => {
    const a = x.articulo;
    return {
      'Código': a.codigo,
      'Tiene código de barras': a.esEan ? 'Sí' : 'No',
      'Código interno': a.codigoInterno,
      'Descripción': a.descripcion,
      'Marca': a.marca,
      'Presentación': a.presentacionCantidad != null ? `${a.presentacionCantidad} ${a.presentacionUnidad ?? ''}`.trim() : a.presentacionUnidad,
      'Rubro': a.rubro,
      'Proveedor': a.proveedor,
      'IVA %': a.ivaAlicuota,
      'IVA para revisar': a.ivaParaRevisar ? 'Sí' : '',
      'Impuestos internos %': x.impuestosInternosPct,
      'Costo sin IVA': a.costoNeto,
      'Costo desde': a.costoDesde,
      'Margen %': a.margenObjetivoPct,
      'Margen de': a.margenDe,
      'Unidades por bulto': x.unidadesPorBulto,
      'Códigos alternativos': x.codigosAlternativos,
      'Códigos de bulto': x.codigosDeBulto,
      'Sucursales con precio': a.sucursales,
      'Activo': a.activo ? 'Sí' : 'No',
    };
  });
}
