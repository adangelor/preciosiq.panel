import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-180 (22-oct-2026) -- Compras (Endpoints/BusinessComprasEndpoints.cs). Plan Compras (Avanzado y Cadena); sin el script
// la API contesta 503. Bloque 2: la ficha completa del proveedor y su lista (codigo, bulto, costo, bonificacion).

export type CondicionIva = 'ri' | 'mono' | 'exento' | 'otro';

export const CONDICIONES_IVA: { valor: CondicionIva; texto: string }[] = [
  { valor: 'ri', texto: 'Responsable inscripto' },
  { valor: 'mono', texto: 'Monotributo' },
  { valor: 'exento', texto: 'Exento' },
  { valor: 'otro', texto: 'Otra' },
];

export interface ProveedorFicha {
  id: number;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: CondicionIva;
  domicilio: string | null;
  telefono: string | null;
  email: string | null;
  contacto: string | null;
  plazoPagoDias: number | null;
  nota: string | null;
  activo: boolean;
  articulosEnLista: number;
  articulosHabituales: number;
}

export interface ProveedorFichaRequest {
  businessAccountId: number;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: CondicionIva;
  domicilio: string | null;
  telefono: string | null;
  email: string | null;
  contacto: string | null;
  plazoPagoDias: number | null;
  nota: string | null;
  activo?: boolean | null;
}

export interface ArticuloDeProveedor {
  articuloId: number;
  codigo: string;
  descripcion: string;
  marca: string | null;
  codigoProveedor: string | null;
  unidadesPorBulto: number | null;
  /** Por unidad, sin IVA, antes de la bonificación. */
  costoNeto: number | null;
  bonificacionPct: number | null;
  /** Por unidad, sin IVA, bonificado. */
  costoFinal: number | null;
  vigenteDesde: string | null;
  costoVigente: number | null;
  costoVigenteDesde: string | null;
  costoVigenteOrigen: string | null;
  costoVigenteProveedor: string | null;
  esHabitual: boolean;
}

export interface ListaDeProveedor {
  total: number;
  page: number;
  pageSize: number;
  items: ArticuloDeProveedor[];
}

export interface RenglonListaProveedor {
  fila: number;
  codigo: string | null;
  codigoProveedor: string | null;
  descripcion: string | null;
  costo: number | null;
  bonificacionPct: number | null;
  unidadesPorBulto: number | null;
}

export interface CambioDeCosto {
  articuloId: number;
  codigo: string;
  descripcion: string;
  costoAnteriorLista: number | null;
  costoVigente: number | null;
  costoNuevo: number;
  variacionPct: number | null;
}

export interface ImportarListaResponse {
  vistaPrevia: boolean;
  renglones: number;
  emparejados: number;
  nuevos: number;
  actualizados: number;
  sinCambios: number;
  subas: number;
  bajas: number;
  costosCargados: number;
  habitualesMarcados: number;
  cambios: CambioDeCosto[];
  noEncontrados: { fila: number; codigo: string | null; codigoProveedor: string | null; descripcion: string | null }[];
  errores: { fila: number; codigo: string | null; motivo: string }[];
}

// ------------------------------------------------------------------ órdenes de compra (bloque 3)

export type EstadoOrden = 'borrador' | 'enviada' | 'recibida_parcial' | 'recibida' | 'cancelada';

export const ESTADOS_ORDEN: { valor: EstadoOrden; texto: string }[] = [
  { valor: 'borrador', texto: 'Borrador' },
  { valor: 'enviada', texto: 'Enviada' },
  { valor: 'recibida_parcial', texto: 'Recibida en parte' },
  { valor: 'recibida', texto: 'Recibida' },
  { valor: 'cancelada', texto: 'Cancelada' },
];

export interface OrdenResumen {
  id: number;
  numero: number;
  numeroTexto: string;
  supplierId: number;
  proveedor: string;
  branchId: string;
  sucursal: string;
  estado: EstadoOrden;
  entregaEsperada: string | null;
  renglones: number;
  totalEstimado: number;
  createdAtUtc: string;
  enviadaAtUtc: string | null;
}

export interface OrdenLista {
  total: number;
  page: number;
  pageSize: number;
  items: OrdenResumen[];
}

export interface RenglonOrden {
  articuloId: number;
  codigo: string;
  descripcion: string;
  marca: string | null;
  codigoProveedor: string | null;
  /** Siempre en unidades de venta. */
  unidades: number;
  /** Si se pidió por bulto. */
  bultos: number | null;
  unidadesPorBulto: number | null;
  /** Por unidad, sin IVA, antes de la bonificación. */
  costoNetoPactado: number | null;
  bonificacionPct: number | null;
  /** Por unidad, bonificado. */
  costoFinal: number | null;
  subtotal: number | null;
}

export interface Orden {
  id: number;
  numero: number;
  numeroTexto: string;
  estado: EstadoOrden;
  entregaEsperada: string | null;
  nota: string | null;
  createdAtUtc: string;
  enviadaAtUtc: string | null;
  supplierId: number;
  proveedor: string;
  proveedorCuit: string | null;
  proveedorTelefono: string | null;
  proveedorEmail: string | null;
  proveedorContacto: string | null;
  branchId: string;
  sucursal: string;
  sucursalDomicilio: string | null;
  comercio: string;
  items: RenglonOrden[];
  totalEstimado: number;
}

export interface RenglonOrdenRequest {
  articuloId: number | null;
  codigo: string | null;
  unidades: number | null;
  bultos: number | null;
  costoNetoPactado: number | null;
  bonificacionPct: number | null;
}

export interface OrdenRequest {
  businessAccountId: number;
  supplierId: number;
  branchId: string;
  entregaEsperada: string | null;
  nota: string | null;
  renglones: RenglonOrdenRequest[];
}

export interface SugeridaRenglon {
  articuloId: number;
  codigo: string;
  descripcion: string;
  codigoProveedor: string | null;
  vendido: number;
  stock: number;
  minimo: number | null;
  maximo: number | null;
  unidadesPorBulto: number | null;
  sugerido: number;
  bultos: number | null;
  motivo: string;
  costoFinal: number | null;
}

export interface Sugerida {
  supplierId: number;
  branchId: string;
  dias: number;
  diasACubrir: number;
  /** Cuántos artículos miró (los de la lista del proveedor y de los que es el habitual). */
  articulos: number;
  conSugerido: number;
  totalEstimado: number;
  milisegundos: number;
  items: SugeridaRenglon[];
}

@Injectable({ providedIn: 'root' })
export class ComprasService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}business/compras`;

  proveedores(businessAccountId: number): Observable<ProveedorFicha[]> {
    return this.http.get<ProveedorFicha[]>(`${this.url}/proveedores`, { params: { businessAccountId } });
  }

  proveedor(businessAccountId: number, id: number): Observable<ProveedorFicha> {
    return this.http.get<ProveedorFicha>(`${this.url}/proveedores/${id}`, { params: { businessAccountId } });
  }

  crearProveedor(req: ProveedorFichaRequest): Observable<ProveedorFicha> {
    return this.http.post<ProveedorFicha>(`${this.url}/proveedores`, req);
  }

  editarProveedor(id: number, req: ProveedorFichaRequest): Observable<ProveedorFicha> {
    return this.http.put<ProveedorFicha>(`${this.url}/proveedores/${id}`, req);
  }

  lista(businessAccountId: number, id: number, q: string, page: number, pageSize = 50): Observable<ListaDeProveedor> {
    const params: Record<string, string | number> = { businessAccountId, page, pageSize };
    if (q.trim()) params['q'] = q.trim();
    return this.http.get<ListaDeProveedor>(`${this.url}/proveedores/${id}/articulos`, { params });
  }

  guardarArticulo(
    id: number,
    req: { businessAccountId: number; codigo: string; codigoProveedor: string | null; unidadesPorBulto: number | null;
      costoNeto: number | null; bonificacionPct: number | null; costoPorBulto: boolean; aplicarCosto: boolean },
  ): Observable<ImportarListaResponse> {
    return this.http.put<ImportarListaResponse>(`${this.url}/proveedores/${id}/articulos`, req);
  }

  quitarArticulo(businessAccountId: number, id: number, articuloId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/proveedores/${id}/articulos/${articuloId}`, { params: { businessAccountId } });
  }

  importar(
    id: number,
    req: { businessAccountId: number; renglones: RenglonListaProveedor[]; costoPorBulto: boolean; vistaPrevia: boolean;
      aplicarCostos: boolean; marcarHabitual: boolean },
  ): Observable<ImportarListaResponse> {
    return this.http.post<ImportarListaResponse>(`${this.url}/proveedores/${id}/lista`, { vigenteDesde: null, ...req });
  }

  // ---- órdenes de compra

  /** estado: uno de los estados, o 'abiertas' (borrador, enviada o recibida en parte); vacío = todas. */
  ordenes(
    businessAccountId: number,
    filtro: { estado?: string; sucursal?: string; proveedorId?: number; page?: number; pageSize?: number },
  ): Observable<OrdenLista> {
    const params: Record<string, string | number> = { businessAccountId, page: filtro.page ?? 1, pageSize: filtro.pageSize ?? 30 };
    if (filtro.estado) params['estado'] = filtro.estado;
    if (filtro.sucursal) params['sucursal'] = filtro.sucursal;
    if (filtro.proveedorId) params['proveedorId'] = filtro.proveedorId;
    return this.http.get<OrdenLista>(`${this.url}/ordenes`, { params });
  }

  orden(businessAccountId: number, id: number): Observable<Orden> {
    return this.http.get<Orden>(`${this.url}/ordenes/${id}`, { params: { businessAccountId } });
  }

  crearOrden(req: OrdenRequest): Observable<Orden> {
    return this.http.post<Orden>(`${this.url}/ordenes`, req);
  }

  editarOrden(id: number, req: OrdenRequest): Observable<Orden> {
    return this.http.put<Orden>(`${this.url}/ordenes/${id}`, req);
  }

  enviarOrden(businessAccountId: number, id: number): Observable<Orden> {
    return this.http.post<Orden>(`${this.url}/ordenes/${id}/enviar`, { businessAccountId });
  }

  cancelarOrden(businessAccountId: number, id: number): Observable<Orden> {
    return this.http.post<Orden>(`${this.url}/ordenes/${id}/cancelar`, { businessAccountId });
  }

  /** Sin "todos", solo los artículos que hay que pedir. */
  sugerida(businessAccountId: number, proveedorId: number, sucursal: string, dias: number, cubrir: number, todos = false): Observable<Sugerida> {
    const params: Record<string, string | number | boolean> = { businessAccountId, proveedorId, sucursal, dias, cubrir };
    if (todos) params['todos'] = true;
    return this.http.get<Sugerida>(`${this.url}/sugerida`, { params });
  }
}

// ------------------------------------------------------------------ la planilla del proveedor

export type ColumnaLista = 'codigo' | 'codigoProveedor' | 'descripcion' | 'costo' | 'bonificacionPct' | 'unidadesPorBulto';

export const COLUMNAS_LISTA: { campo: ColumnaLista; texto: string; obligatoria: boolean }[] = [
  { campo: 'codigo', texto: 'Código de barras o interno', obligatoria: false },
  { campo: 'codigoProveedor', texto: 'Código del proveedor', obligatoria: false },
  { campo: 'descripcion', texto: 'Descripción', obligatoria: false },
  { campo: 'costo', texto: 'Costo (sin IVA)', obligatoria: true },
  { campo: 'bonificacionPct', texto: 'Bonificación %', obligatoria: false },
  { campo: 'unidadesPorBulto', texto: 'Unidades por bulto', obligatoria: false },
];

/** Columna elegida para cada campo: el índice de la columna en la planilla, o null. */
export type MapeoLista = Record<ColumnaLista, number | null>;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Adivina qué columna es cada cosa por el encabezado ("EAN", "Cód. barras", "Precio neto", "Bonif.", "Unid x bulto"…).
 * Lo que no reconoce queda en null y lo elige el comercio.
 */
export function adivinarColumnas(encabezados: string[]): MapeoLista {
  const h = encabezados.map((e) => sinTildes(String(e ?? '')));
  const buscar = (prueba: (t: string) => boolean, usadas: Set<number>): number | null => {
    const i = h.findIndex((t, idx) => !usadas.has(idx) && t !== '' && prueba(t));
    return i >= 0 ? i : null;
  };
  const usadas = new Set<number>();
  const tomar = (prueba: (t: string) => boolean) => {
    const i = buscar(prueba, usadas);
    if (i != null) usadas.add(i);
    return i;
  };
  // El orden importa: "cod. proveedor" antes que "codigo", y "precio x bulto" no es "bulto".
  const codigoProveedor = tomar((t) => /(cod|codigo|art).*(prov|fabr)|(prov|fabr).*(cod|art)/.test(t));
  const codigo = tomar((t) => /ean|barra|gtin|^cod|^codigo|^sku|plu|interno/.test(t));
  const unidadesPorBulto = tomar((t) => /(unid|u\.?).*(bulto|caja|pack)|(bulto|caja|pack).*(unid|x)|^bulto$/.test(t) && !/precio|costo|\$/.test(t));
  const bonificacionPct = tomar((t) => /bonif|descuento|^dto|^desc\.? ?%/.test(t));
  const costo = tomar((t) => /costo|precio|neto|importe|\$|lista/.test(t));
  const descripcion = tomar((t) => /desc|detalle|producto|articulo|nombre/.test(t));
  return { codigo, codigoProveedor, descripcion, costo, bonificacionPct, unidadesPorBulto };
}

/**
 * Un importe como viene en una planilla argentina: número (Excel), "1.234,56", "1234,56", "1234.56", "$ 1.500".
 * "1.500" con un solo punto y tres decimales es mil quinientos (separador de miles), no 1,5.
 */
export function importeAr(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).trim().replace(/\$|\s|%/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Un código como texto, sin espacios ni el ".0" que a veces deja Excel. */
function codigoDe(v: unknown): string | null {
  if (v == null) return null;
  const t = (typeof v === 'number' ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : String(v)).trim().replace(/\.0$/, '');
  return t === '' ? null : t;
}

/**
 * Las filas de la planilla (la primera es el encabezado) con el mapeo, a renglones para la API. Se saltean las filas
 * vacías; la fila es la de la planilla (la 2 es la primera de datos), para que los errores digan dónde mirar.
 */
export function leerListaDeProveedor(filas: unknown[][], mapeo: MapeoLista): RenglonListaProveedor[] {
  const celda = (fila: unknown[], col: number | null) => (col == null ? null : fila[col]);
  const renglones: RenglonListaProveedor[] = [];
  filas.slice(1).forEach((fila, i) => {
    if (!fila || fila.every((c) => c == null || String(c).trim() === '')) return;
    const codigo = codigoDe(celda(fila, mapeo.codigo));
    const codigoProveedor = codigoDe(celda(fila, mapeo.codigoProveedor));
    if (!codigo && !codigoProveedor) return;
    const desc = celda(fila, mapeo.descripcion);
    renglones.push({
      fila: i + 2,
      codigo,
      codigoProveedor,
      descripcion: desc == null ? null : String(desc).trim() || null,
      costo: importeAr(celda(fila, mapeo.costo)),
      bonificacionPct: importeAr(celda(fila, mapeo.bonificacionPct)),
      unidadesPorBulto: importeAr(celda(fila, mapeo.unidadesPorBulto)),
    });
  });
  return renglones;
}

/** "30-50001091-2" a partir de los 11 números. */
export function cuitConGuiones(cuit: string | null): string {
  if (!cuit || cuit.length !== 11) return cuit ?? '—';
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

export function textoCondicion(c: CondicionIva): string {
  return CONDICIONES_IVA.find((x) => x.valor === c)?.texto ?? c;
}

// ------------------------------------------------------------------ la orden para mandar (WhatsApp, mail, copiar)

export function textoEstadoOrden(e: EstadoOrden): string {
  return ESTADOS_ORDEN.find((x) => x.valor === e)?.texto ?? e;
}

const cant = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const pesosAr = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-10-28" -> "28/10/2026". */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Un instante UTC del servidor ("2026-10-22T18:30:00", a veces sin Z) como fecha local: "22/10/2026". */
export function fechaDeUtc(utc: string | null): string {
  if (!utc) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : `${utc}Z`);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "3 bultos (36 u.)" o "24 u.". */
export function cantidadDeRenglon(r: Pick<RenglonOrden, 'unidades' | 'bultos'>): string {
  if (r.bultos != null) return `${cant.format(r.bultos)} ${r.bultos === 1 ? 'bulto' : 'bultos'} (${cant.format(r.unidades)} u.)`;
  return `${cant.format(r.unidades)} u.`;
}

/**
 * El texto de la orden para pegar en WhatsApp o en un mail: lo manda el comprador, nosotros no mandamos nada.
 * conCostos = con el costo pactado y el total (algunos prefieren no mandarlo).
 */
export function mensajeDeOrden(o: Orden, conCostos = true): string {
  const lineas: string[] = [];
  lineas.push(`Orden de compra ${o.numeroTexto}${o.comercio ? ` de ${o.comercio}` : ''}`);
  lineas.push(`Entregar en: ${o.sucursal}${o.sucursalDomicilio ? ` (${o.sucursalDomicilio})` : ''}`);
  if (o.entregaEsperada) lineas.push(`Para el ${fechaCorta(o.entregaEsperada)}`);
  lineas.push('');
  for (const r of o.items) {
    const cod = r.codigoProveedor ? `[${r.codigoProveedor}] ` : '';
    let l = `- ${cantidadDeRenglon(r)} ${cod}${r.descripcion} (${r.codigo})`;
    if (conCostos && r.costoNetoPactado != null) {
      l += ` a $${pesosAr.format(r.costoNetoPactado)}`;
      if (r.bonificacionPct) l += ` -${cant.format(r.bonificacionPct)} %`;
    }
    lineas.push(l);
  }
  if (conCostos && o.totalEstimado > 0) {
    lineas.push('');
    lineas.push(`Total estimado sin IVA: $${pesosAr.format(o.totalEstimado)}`);
  }
  if (o.nota) {
    lineas.push('');
    lineas.push(o.nota);
  }
  return lineas.join('\n');
}

/**
 * El teléfono del proveedor para wa.me (549 + característica + número), o null si no se entiende (WhatsApp abre igual
 * y el comprador elige el chat). Acepta "0266 4123456", "+54 9 266 412-3456", "2664123456".
 */
export function telefonoParaWhatsApp(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  return d.length === 10 ? `549${d}` : null;
}

export function linkWhatsApp(tel: string | null, texto: string): string {
  const n = telefonoParaWhatsApp(tel);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(texto)}`;
}

export function linkMail(email: string | null, o: Orden, texto: string): string {
  const asunto = `Orden de compra ${o.numeroTexto}${o.comercio ? ` — ${o.comercio}` : ''}`;
  return `mailto:${email ?? ''}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
}
