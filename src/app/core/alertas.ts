import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// BP-352 (24-nov-2026) -- cliente de BusinessAlertasEndpoints.cs: la bandeja de alertas de precio (productos testigo contra
// las cadenas cerca) y su configuración. Desde Pyme; sin el plan el backend contesta 402 y la pantalla muestra el candado.

export type TipoAlerta = 'te_pasaron' | 'se_acercan' | 'oferta' | 'caro' | 'regalado' | 'mayorista';

export interface DetalleAlerta {
  descripcion?: string;
  bandera?: string;
  miPrecio?: number;
  suPrecio?: number;
  pct?: number;
  sucursales?: number;
  sucursalEjemplo?: string;
  metros?: number;
  sucursalPropia?: string;
  sucursalPropiaNombre?: string;
  mediana?: number;
  minimo?: number;
  banderas?: number;
  precioLista?: number;
  desde?: string;
  costo?: number;
  km?: number;
  texto?: string;
}

export interface AlertaEnBandeja {
  id: number;
  tipo: TipoAlerta;
  ean: string;
  commerceId: string;
  bannerId: string;
  paraRevisar: boolean;
  sucursales: string[];
  abiertaAt: string;
  desdeDato: string | null;
  cerradaAt: string | null;
  motivoCierre: string | null;
  lineaDeBase: boolean;
  leida: boolean;
  detalle: DetalleAlerta | null;
}

export interface ConteoPorTipo {
  tipo: TipoAlerta;
  abiertas: number;
  sinLeer: number;
  paraRevisar: number;
  nuevas: number;
}

export interface BandejaDeAlertas {
  items: AlertaEnBandeja[];
  total: number;
  conteos: ConteoPorTipo[];
  abiertas: number;
  /** Abiertas que no son de la línea de base. */
  nuevas: number;
  sinLeer: number;
  testigos: number;
  lineaDeBaseAt: string | null;
  ultimaCorrida: { fecha: string; estado: string; tiposSinDato: string[]; corridaAt: string } | null;
  tiposDelPlan: TipoAlerta[];
  tiposPrendidos: TipoAlerta[];
  encendidas: boolean;
  esEncargado: boolean;
}

export interface ConfigAlertas {
  radioMetros: number;
  cadenas: string[];
  tePasaron: boolean;
  seAcercan: boolean;
  seAcercanPct: number;
  oferta: boolean;
  ofertaPct: number;
  caro: boolean;
  caroPct: number;
  regalado: boolean;
  regaladoPct: number;
  mayorista: boolean;
}

export interface BanderaCerca {
  clave: string;
  bandera: string;
  sucursales: number;
  metros: number;
}

export interface ConfigDeAlertasRespuesta {
  config: ConfigAlertas;
  defecto: ConfigAlertas;
  limites: { radioMin: number; radioMax: number; histeresis: number };
  cadenas: BanderaCerca[];
  testigos: number;
  tiposDelPlan: TipoAlerta[];
  lineaDeBaseAt: string | null;
}

export interface VistaPreviaAlertas {
  testigos: number;
  sucursalesPropias: number;
  sucursalesSinUbicacion: number;
  sucursalesCerca: number;
  porTipo: Record<TipoAlerta, number>;
  paraRevisar: number;
  tiposSinDato: TipoAlerta[];
  fechaDato: string | null;
}

export interface FiltroDeAlertas {
  tipo?: TipoAlerta | null;
  cerradas?: boolean;
  branchId?: string | null;
  /** false = solo lo nuevo; true = solo lo que ya pasaba al prender las alertas. */
  lineaDeBase?: boolean | null;
  pagina?: number;
  porPagina?: number;
}

@Injectable({ providedIn: 'root' })
export class AlertasService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/alertas`;

  /** Avisa cuando cambió lo leído, para que el menú refresque su globito. */
  readonly cambios = new Subject<void>();

  bandeja(businessAccountId: number, f: FiltroDeAlertas = {}): Observable<BandejaDeAlertas> {
    let p = new HttpParams().set('businessAccountId', businessAccountId);
    if (f.tipo) p = p.set('tipo', f.tipo);
    if (f.cerradas) p = p.set('cerradas', true);
    if (f.branchId) p = p.set('branchId', f.branchId);
    if (f.lineaDeBase != null) p = p.set('lineaDeBase', f.lineaDeBase);
    if (f.pagina) p = p.set('pagina', f.pagina);
    if (f.porPagina) p = p.set('porPagina', f.porPagina);
    return this.http.get<BandejaDeAlertas>(this.baseUrl, { params: p });
  }

  contador(businessAccountId: number): Observable<{ sinLeer: number; abiertas: number }> {
    return this.http.get<{ sinLeer: number; abiertas: number }>(`${this.baseUrl}/contador`, {
      params: new HttpParams().set('businessAccountId', businessAccountId),
    });
  }

  marcarLeidas(businessAccountId: number, tipo?: TipoAlerta | null, ids?: number[]): Observable<{ marcadas: number; sinLeer: number }> {
    return this.http
      .post<{ marcadas: number; sinLeer: number }>(`${this.baseUrl}/leidas`, { businessAccountId, tipo: tipo ?? null, ids: ids ?? null })
      .pipe(tap(() => this.cambios.next()));
  }

  config(businessAccountId: number): Observable<ConfigDeAlertasRespuesta> {
    return this.http.get<ConfigDeAlertasRespuesta>(`${this.baseUrl}/config`, {
      params: new HttpParams().set('businessAccountId', businessAccountId),
    });
  }

  guardarConfig(businessAccountId: number, c: ConfigAlertas): Observable<{ config: ConfigAlertas }> {
    return this.http.put<{ config: ConfigAlertas }>(`${this.baseUrl}/config`, { businessAccountId, ...c });
  }

  vistaPrevia(businessAccountId: number, c: ConfigAlertas): Observable<VistaPreviaAlertas> {
    return this.http.post<VistaPreviaAlertas>(`${this.baseUrl}/config/vista-previa`, { businessAccountId, ...c });
  }
}

// ------------------------------------------------------------------------------------------------ textos

export interface TextoDeAviso {
  tipo: TipoAlerta;
  titulo: string;
  /** Lo que dice el interruptor de la configuración. */
  explica: string;
  icono: string;
  /** rojo = perdés ventas; ambar = mirar; verde = hay margen; azul = costo. */
  tono: 'rojo' | 'ambar' | 'verde' | 'azul';
}

export const AVISOS: TextoDeAviso[] = [
  { tipo: 'te_pasaron', titulo: 'Te pasaron', explica: 'Una cadena de la zona tiene un producto testigo más barato que vos.', icono: 'trending_down', tono: 'rojo' },
  { tipo: 'se_acercan', titulo: 'Se te acercan', explica: 'Una cadena de la zona quedó apenas arriba de tu precio.', icono: 'compare_arrows', tono: 'ambar' },
  { tipo: 'oferta', titulo: 'Oferta fuerte cerca', explica: 'Una cadena de la zona puso un producto testigo en oferta de verdad (sin subirlo antes).', icono: 'local_offer', tono: 'rojo' },
  { tipo: 'caro', titulo: 'Quedaste caro', explica: 'Tu precio supera la mediana de las cadenas de la zona.', icono: 'north', tono: 'ambar' },
  { tipo: 'regalado', titulo: 'Quedaste regalado', explica: 'Estás muy por debajo de la más barata de la zona: hay lugar para subir.', icono: 'south', tono: 'verde' },
  { tipo: 'mayorista', titulo: 'Mayorista más barato', explica: 'Un mayorista cerca vende un producto testigo por debajo de tu costo.', icono: 'warehouse', tono: 'azul' },
];

export const AVISO_POR_TIPO: Record<TipoAlerta, TextoDeAviso> = Object.fromEntries(AVISOS.map((a) => [a.tipo, a])) as Record<TipoAlerta, TextoDeAviso>;

export function pesos(v: number | null | undefined): string {
  if (v == null) return '—';
  const entero = Number.isInteger(v) || v >= 10000;
  return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: entero ? 0 : 2 });
}

export function distancia(metros: number | null | undefined): string {
  if (metros == null) return '';
  if (metros < 1000) return `a ${Math.max(10, Math.round(metros / 10) * 10)} m`;
  return `a ${(metros / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`;
}

export function porciento(v: number | null | undefined): string {
  if (v == null) return '';
  return `${v.toLocaleString('es-AR', { maximumFractionDigits: v < 10 ? 1 : 0 })} %`;
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(d)}-${meses[Number(m) - 1]}`;
}

/** El número grande de la tarjeta y la línea de abajo. */
export function cifra(a: AlertaEnBandeja): { grande: string; chica: string } {
  const d = a.detalle ?? {};
  switch (a.tipo) {
    case 'te_pasaron':
      return { grande: pesos(d.suPrecio), chica: `vos ${pesos(d.miPrecio)} · −${porciento(d.pct)}` };
    case 'se_acercan':
      return { grande: pesos(d.suPrecio), chica: (d.pct ?? 0) === 0 ? `igual que vos (${pesos(d.miPrecio)})` : `vos ${pesos(d.miPrecio)} · a ${porciento(d.pct)}` };
    case 'oferta':
      return { grande: pesos(d.suPrecio), chica: `${porciento(d.pct)} de descuento${d.miPrecio != null ? ` · vos ${pesos(d.miPrecio)}` : ''}` };
    case 'caro':
      return { grande: `+${porciento(d.pct)}`, chica: `vos ${pesos(d.miPrecio)} · la zona ${pesos(d.mediana)}` };
    case 'regalado':
      return { grande: `−${porciento(d.pct)}`, chica: `vos ${pesos(d.miPrecio)} · la más barata ${pesos(d.minimo)}` };
    case 'mayorista':
      return { grande: pesos(d.suPrecio), chica: `tu costo ${pesos(d.costo)} · −${porciento(d.pct)}` };
  }
}

/** La frase que explica el aviso. Nunca nombra a otro negocio de la red: solo cadenas y mayoristas. */
export function explicacion(a: AlertaEnBandeja): string {
  const d = a.detalle ?? {};
  const propias = a.sucursales.length;
  const enMis = propias > 1 ? ` Te pasa en ${propias} de tus sucursales.` : '';
  const cerca = d.sucursalPropiaNombre ? ` de tu sucursal ${d.sucursalPropiaNombre}` : '';
  const cuantas = (d.sucursales ?? 1) > 1 ? `, en ${d.sucursales} sucursales cerca (la más barata, ${distancia(d.metros)}${cerca})` : `, ${distancia(d.metros)}${cerca}`;
  switch (a.tipo) {
    case 'te_pasaron':
      return a.paraRevisar
        ? `${d.bandera}${cuantas}. Está a menos de la mitad de tu precio: puede ser otro tamaño con el mismo código o un precio mal cargado. Revisalo antes de moverte.`
        : `${d.bandera}${cuantas}.${enMis}`;
    case 'se_acercan':
      return `${d.bandera}${cuantas}.`;
    case 'oferta':
      return `${d.bandera}${cuantas}. Precio de lista ${pesos(d.precioLista)}${d.desde ? `, en oferta desde el ${fechaCorta(d.desde)}` : ''}. Oferta de verdad: no subió el precio antes.`;
    case 'caro':
      return `Sobre la mediana de ${d.banderas} banderas de la zona${d.sucursalPropiaNombre ? ` de ${d.sucursalPropiaNombre}` : ''}. La más barata lo tiene a ${pesos(d.minimo)}.`;
    case 'regalado':
      return `Ninguna de las ${d.banderas} banderas de la zona${d.sucursalPropiaNombre ? ` de ${d.sucursalPropiaNombre}` : ''} lo vende a menos de ${pesos(d.minimo)}. Hay lugar para subir.`;
    case 'mayorista':
      return d.texto ?? `${d.bandera}${d.km != null ? `, a ${d.km.toLocaleString('es-AR', { maximumFractionDigits: 1 })} km` : ''}.`;
  }
}

export const MOTIVO_DE_CIERRE: Record<string, string> = {
  resuelto: 'Dejó de pasar',
  precio: 'Cambiaste tu precio',
  cambio: 'Pasó a «Te pasaron»',
  testigo: 'Ya no es producto testigo',
  config: 'Lo sacaste de la configuración',
  vencido: 'Sin dato hace 30 días',
};
