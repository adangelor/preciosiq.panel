import { numeroONull } from './articulos-form';
import {
  MotivoDeMerma, StockItem, StockLimiteFila, StockMermasResponse, StockMovimiento, StockSucursal, TipoDeMovimiento,
} from './stock.models';

// BP-179 (21-oct-2026) -- lo que las pantallas de Stock muestran y calculan, en funciones puras (con spec).

export const MOTIVOS_DE_MERMA: { id: MotivoDeMerma; texto: string }[] = [
  { id: 'rotura', texto: 'Rotura' },
  { id: 'vencido', texto: 'Vencido' },
  { id: 'robo', texto: 'Robo o faltante' },
  { id: 'consumo', texto: 'Consumo interno' },
  { id: 'otro', texto: 'Otro' },
];

export function motivoTexto(m: string | null | undefined): string {
  return MOTIVOS_DE_MERMA.find((x) => x.id === m)?.texto ?? (m ?? '');
}

const TIPOS: Record<TipoDeMovimiento, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  recuento: 'Recuento',
  ingreso: 'Ingreso',
  merma: 'Merma',
  transferencia_salida: 'Transferencia (sale)',
  transferencia_entrada: 'Transferencia (entra)',
  ajuste: 'Ajuste',
  devolucion_proveedor: 'Devolución al proveedor',
};

export function tipoTexto(t: TipoDeMovimiento): string {
  return TIPOS[t] ?? t;
}

/** "1.234", "2,5", "−3". */
export function cantidad(n: number | null | undefined): string {
  if (n == null) return '—';
  const t = Math.abs(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  return n < 0 ? `−${t}` : t;
}

/** "+3", "−9", "0". */
export function diferencia(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('es-AR', { maximumFractionDigits: 3 })}`;
}

/** "14:32" de "2026-10-21T14:32:05". */
export function hora(local: string): string {
  return local.length >= 16 ? local.slice(11, 16) : local;
}

/** "21/10 14:32". */
export function fechaHora(local: string): string {
  return local.length >= 16 ? `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}` : local;
}

/** La caja, en corto: "caja-2" tal cual; un id largo, sus últimos 4. */
export function cajaCorta(d: string | null | undefined): string | null {
  if (!d) return null;
  return d.length <= 12 ? d : `…${d.slice(-4)}`;
}

/**
 * De dónde vino un movimiento, en palabras: "Venta, caja 2, ticket 14:32", "Recuento de Juan Pérez", "Transferencia #12:
 * a Norte", "Stock al pasar al historial".
 */
export function origenTexto(m: Pick<StockMovimiento, 'tipo' | 'origenTipo' | 'ocurridoAtLocal' | 'dispositivo' | 'usuario' | 'transferenciaId' | 'nota' | 'mermaMotivo'>): string {
  const de = m.usuario ? ` de ${m.usuario}` : '';
  const caja = cajaCorta(m.dispositivo);
  if (m.origenTipo === 'migracion') return 'Stock al pasar al historial';
  // BP-180: la recepción deja su número (y el proveedor) en la nota: "Recepción R-000012 (Distri Norte)".
  if (m.origenTipo === 'compra') return `${m.nota ?? (m.tipo === 'devolucion_proveedor' ? 'Devolución al proveedor' : 'Recepción de mercadería')}${de}`;
  if (m.origenTipo === 'transferencia' || m.tipo === 'transferencia_salida' || m.tipo === 'transferencia_entrada')
    return `Transferencia #${m.transferenciaId ?? '?'}${m.nota ? `: ${m.nota}` : ''}`;
  if (m.tipo === 'venta') return `Venta${caja ? `, caja ${caja}` : ''}, ticket ${hora(m.ocurridoAtLocal)}`;
  const donde = m.origenTipo === 'caja_ajuste' || m.origenTipo === 'caja_ticket' ? ` en la caja${caja ? ` ${caja}` : ''}`
    : m.origenTipo === 'planilla' ? ' por planilla' : '';
  if (m.tipo === 'recuento') return `Recuento${donde}${de}`;
  if (m.tipo === 'merma') return `Merma (${motivoTexto(m.mermaMotivo)})${donde}${de}`;
  // BP-180: el ingreso del panel es la "Recepción sin orden"; el de la caja sigue siendo "Entró mercadería".
  if (m.tipo === 'ingreso') return m.origenTipo === 'panel' ? `Recepción sin orden${de}` : `Ingreso de mercadería${donde}${de}`;
  return `${tipoTexto(m.tipo)}${donde}${de}`;
}

// ------------------------------------------------------------------ planillas
export interface PlanillaLeida<T> {
  filas: T[];
  errores: { fila: number; motivo: string }[];
}

const COL_CODIGO = ['codigo', 'código', 'ean', 'cod', 'codigo de barras', 'código de barras', 'articulo', 'artículo'];
const COL_CANTIDAD = ['cantidad', 'contado', 'contada', 'cant', 'stock', 'unidades', 'existencia'];
const COL_SUCURSAL = ['sucursal', 'branch', 'local'];
const COL_MINIMO = ['minimo', 'mínimo', 'min', 'stock minimo', 'stock mínimo'];
const COL_MAXIMO = ['maximo', 'máximo', 'max', 'stock maximo', 'stock máximo'];

function normal(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function columna(encabezado: unknown[], nombres: string[]): number {
  return encabezado.findIndex((c) => nombres.includes(normal(c)));
}

/** Un código de una celda: un número de Excel (7.79E+12) vuelve a ser texto sin decimales. */
function codigoDe(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v ?? '').trim();
}

/** Planilla de recuento: columnas código y cantidad (la primera fila con esos nombres es el encabezado). */
export function leerPlanillaDeRecuento(filas: unknown[][]): PlanillaLeida<{ codigo: string; cantidadContada: number }> {
  const enc = filas.findIndex((f) => columna(f, COL_CODIGO) >= 0 && columna(f, COL_CANTIDAD) >= 0);
  if (enc < 0) return { filas: [], errores: [{ fila: 0, motivo: 'No encontré las columnas «código» y «cantidad» en la planilla.' }] };
  const ci = columna(filas[enc], COL_CODIGO);
  const qi = columna(filas[enc], COL_CANTIDAD);
  const out: { codigo: string; cantidadContada: number }[] = [];
  const errores: { fila: number; motivo: string }[] = [];
  for (let i = enc + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    const codigo = codigoDe(f[ci]);
    if (!codigo && (f[qi] == null || String(f[qi]).trim() === '')) continue;   // fila vacía
    const q = numeroONull(f[qi] as string | number | null);
    if (!codigo) { errores.push({ fila: i + 1, motivo: 'Sin código.' }); continue; }
    if (q == null || q < 0) { errores.push({ fila: i + 1, motivo: `«${codigo}»: la cantidad no es un número válido.` }); continue; }
    out.push({ codigo, cantidadContada: q });
  }
  return { filas: out, errores };
}

/**
 * Planilla de mínimos y máximos: código, mínimo, máximo y, opcional, sucursal (su id o su nombre). Sin columna de
 * sucursal, va a `sucursalPorDefecto`.
 */
export function leerPlanillaDeLimites(
  filas: unknown[][], sucursales: StockSucursal[], sucursalPorDefecto: string | null,
): PlanillaLeida<StockLimiteFila> {
  const enc = filas.findIndex((f) => columna(f, COL_CODIGO) >= 0 && (columna(f, COL_MINIMO) >= 0 || columna(f, COL_MAXIMO) >= 0));
  if (enc < 0) return { filas: [], errores: [{ fila: 0, motivo: 'No encontré las columnas «código» y «mínimo» (o «máximo»).' }] };
  const ci = columna(filas[enc], COL_CODIGO);
  const si = columna(filas[enc], COL_SUCURSAL);
  const mi = columna(filas[enc], COL_MINIMO);
  const xi = columna(filas[enc], COL_MAXIMO);
  const out: StockLimiteFila[] = [];
  const errores: { fila: number; motivo: string }[] = [];
  for (let i = enc + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    const codigo = codigoDe(f[ci]);
    if (!codigo) continue;
    let branchId = sucursalPorDefecto;
    if (si >= 0 && String(f[si] ?? '').trim()) {
      const s = normal(f[si]);
      branchId = sucursales.find((x) => normal(x.branchId) === s || normal(x.nombre) === s)?.branchId ?? null;
      if (!branchId) { errores.push({ fila: i + 1, motivo: `«${codigo}»: no reconozco la sucursal «${String(f[si]).trim()}».` }); continue; }
    }
    if (!branchId) { errores.push({ fila: i + 1, motivo: `«${codigo}»: falta la sucursal (elegí una arriba o agregá la columna).` }); continue; }
    const minimo = mi >= 0 ? numeroONull(f[mi] as string | number | null) : null;
    const maximo = xi >= 0 ? numeroONull(f[xi] as string | number | null) : null;
    if ((minimo != null && minimo < 0) || (maximo != null && maximo < 0)) { errores.push({ fila: i + 1, motivo: `«${codigo}»: no puede ser negativo.` }); continue; }
    if (minimo != null && maximo != null && minimo > maximo) { errores.push({ fila: i + 1, motivo: `«${codigo}»: el mínimo es mayor que el máximo.` }); continue; }
    out.push({ branchId, codigo, minimo, maximo });
  }
  return { filas: out, errores };
}

// ------------------------------------------------------------------ Excel
export function filasExcelStock(items: StockItem[], sucursales: StockSucursal[]): Record<string, string | number | null>[] {
  return items.map((i) => {
    const fila: Record<string, string | number | null> = {
      'Código': i.codigo,
      'Descripción': i.descripcion,
      'Marca': i.marca,
      'Rubro': i.rubro,
    };
    for (const s of sucursales) {
      const c = i.porSucursal[s.branchId];
      fila[s.nombre] = c?.cantidad ?? 0;
      if (sucursales.length === 1) {
        fila['Mínimo'] = c?.minimo ?? null;
        fila['Máximo'] = c?.maximo ?? null;
      }
    }
    if (sucursales.length > 1) fila['Total'] = i.cantidad;
    fila['Costo sin IVA'] = i.costoNeto;
    fila['Valorizado'] = i.valorizado;
    return fila;
  });
}

export function filasExcelMermas(r: StockMermasResponse): { porMotivo: Record<string, string | number>[]; porRubro: Record<string, string | number>[] } {
  const fila = (clave: string, x: { cantidad: number; valor: number; sinCosto: number }) => ({
    [clave]: '', Cantidad: x.cantidad, 'Valor ($)': x.valor, 'Movimientos sin costo': x.sinCosto,
  });
  return {
    porMotivo: r.porMotivo.map((m) => ({ ...fila('Motivo', m), Motivo: motivoTexto(m.clave) })),
    porRubro: r.porRubro.map((m) => ({ ...fila('Rubro', m), Rubro: m.clave })),
  };
}
