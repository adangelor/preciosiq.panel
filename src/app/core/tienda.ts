import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-71 (08-oct-2026) -- cliente de Buscaprecios.web/Endpoints/TiendaEndpoints.cs ("Mi tienda"):
// la tienda en misuper.app/<slug>. Espejo de Data/DTOs/TiendaDtos.cs.
// BP-167 (19-oct-2026) -- UNA tienda por cuenta (antes, una por sucursal): GET /cuenta trae la tienda y TODAS las
// sucursales de la cuenta; PUT /{id}/sucursales habilita o saca cada una, su WhatsApp y la principal.

export interface TiendaConfig {
  id: number;
  slug: string;
  activa: boolean;
  publicadaAtUtc: string | null;
  nombreVisible: string;
  presentacion: string | null;
  whatsApp: string | null;
  alias: string | null;
  cvu: string | null;
  qrPagoUrl: string | null;
  mostrarDomicilio: boolean;
  /**
   * Slugs que la tienda uso y siguen llevando a ella: los de 30 dias (BP-71) y, desde BP-167, los de las tiendas
   * por sucursal que se fusionaron (permanentes: abren la tienda en esa sucursal).
   */
  slugsAnteriores: string[];
  /** BP-167 -- la sucursal principal que marco el comercio (null = abre en la habilitada de menor BranchId). */
  sucursalPrincipal?: string | null;
}

/**
 * BP-167 -- una sucursal de la cuenta en "Mi tienda". Habilitada = esta en la tienda. HabilitadaPorDefecto = estaria
 * sin tocar nada (tiene ubicacion y productos). HabilitadaAMano = lo que eligio el comercio (null = no la toco, vale la
 * regla por defecto). Principal = la que marco el comercio; PorDefecto = en la que abre la tienda. WhatsApp = el propio
 * (null = el de la tienda). SlugAnterior = su link de cuando era una tienda aparte (sigue llevando a esta sucursal).
 */
export interface SucursalDeTienda {
  branchId: string;
  nombre: string;
  domicilio: string | null;
  ciudad: string | null;
  tieneUbicacion: boolean;
  productos: number;
  habilitadaPorDefecto: boolean;
  habilitadaAMano: boolean | null;
  habilitada: boolean;
  principal: boolean;
  porDefecto: boolean;
  whatsApp: string | null;
  slugAnterior: string | null;
}

/** BP-167 -- GET /cuenta: la tienda (null = todavia no la creo: se crea con lo sugerido) y TODAS las sucursales. */
export interface TiendaDeCuenta {
  tienda: TiendaConfig | null;
  slugSugerido: string;
  nombreSugerido: string;
  /** La sucursal en la que abre la tienda (null = ninguna habilitada). */
  sucursalPorDefecto: string | null;
  sucursales: SucursalDeTienda[];
}

/**
 * BP-167 -- PUT /{id}/sucursales. Cada sucursal que viene queda como dice: habilitada true/false (a mano) o null (la
 * regla por defecto); whatsApp un celular o null/"" (el de la tienda). Las que no vienen no se tocan.
 * principal: null no la cambia, "" la saca, un branchId la fija.
 */
export interface SucursalTiendaRequest {
  branchId: string;
  habilitada: boolean | null;
  whatsApp: string | null;
}

export interface GuardarSucursalesRequest {
  sucursales: SucursalTiendaRequest[];
  principal: string | null;
}

export interface SlugDisponibilidad {
  slug: string;
  disponible: boolean;
  motivo: string | null;
}

export interface GuardarTiendaRequest {
  businessAccountId: number;
  /** BP-167: opcional. En el alta, esa sucursal entra a mano (aunque no tenga ubicacion) y queda principal. */
  branchId?: string | null;
  slug: string;
  activa: boolean;
  nombreVisible: string;
  presentacion: string | null;
  whatsApp: string | null;
  alias: string | null;
  cvu: string | null;
  mostrarDomicilio: boolean;
  /** BP-167: null (o sin mandar) no la cambia, "" la saca, un branchId la fija. */
  sucursalPrincipal?: string | null;
}

// BP-122 (15-oct-2026) -- visitas y pedidos de la tienda. Espejo de TiendaEstadisticas en TiendaDtos.cs.
// Fechas 'YYYY-MM-DD' en hora argentina. Monto = el total que estimo el sitio, no lo que se cobro.

export interface TiendaPeriodo {
  visitas: number;
  pedidos: number;
  monto: number;
}

export interface TiendaDiaStats extends TiendaPeriodo {
  fecha: string;
}

export interface TiendaProductoStats {
  ean: string;
  /** null = ya no esta en el catalogo de la sucursal. */
  descripcion: string | null;
  vistas: number;
  pedidos: number;
  unidades: number;
}

export interface TiendaEstadisticas {
  /** Los ultimos 7 dias (hoy incluido) contra los 7 anteriores. Todo plan. */
  resumen: { desde: string; hasta: string; actual: TiendaPeriodo; anterior: TiendaPeriodo };
  /** false = el plan no trae el detalle (desde Pyme): se muestra el "subi de plan". */
  detalleIncluido: boolean;
  detalle: {
    desde: string;
    hasta: string;
    total: TiendaPeriodo;
    dias: TiendaDiaStats[];
    masPedidos: TiendaProductoStats[];
    masVistos: TiendaProductoStats[];
  } | null;
  /** BP-167 -- la sucursal del filtro (?sucursal=), o null = toda la tienda. */
  sucursal?: string | null;
  /** BP-167 -- los ultimos 7 dias de cada sucursal (siempre de toda la tienda). */
  porSucursal?: TiendaSucursalStats[];
}

/** BP-167 -- branchId null = contado sin sucursal (el rato entre el script y el backend nuevo). */
export interface TiendaSucursalStats {
  branchId: string | null;
  nombre: string | null;
  actual: TiendaPeriodo;
}

/** El 400 de guardar: el mensaje y el campo al que va pegado. */
/** BP-175 (20-oct-2026) -- GET /api/business/tienda/{id}/asistente. */
export interface AsistenteTienda {
  activo: boolean;
  /** El plan incluye el asistente (Avanzado y Cadena). Si no, el interruptor va deshabilitado con el aviso de plan. */
  disponibleEnPlan: boolean;
  planActual: string;
  /** El servidor tiene el canal de omnivox.chat. Sin el, prenderlo no muestra nada todavia. */
  canalConfigurado: boolean;
  /** Charlas abiertas y productos agregados desde el chat en los ultimos 7 dias (todas las sucursales). */
  ultimos7Dias: { abiertos: number; agregados: number };
}

export interface ErrorDeCampo {
  error: string;
  campo?: string;
}

// BP-130 -- espejo de TiendaPedidosEndpoints.Pedido (camelCase).
export type EstadoPedido = 'nuevo' | 'visto' | 'preparado' | 'entregado' | 'cancelado';

export interface RenglonPedidoTienda {
  ean: string;
  descripcion: string;
  presentacion: string | null;
  cantidad: number;
  precioLista: number;
  total: number;
  promoTexto: string | null;
}

export interface PedidoTienda {
  codigo: string;
  creadoAtUtc: string;
  entrega: 'retiro' | 'envio';
  total: number;
  renglones: number;
  estado: EstadoPedido;
  estadoAtUtc: string;
  productos: RenglonPedidoTienda[];
  // BP-131 -- el chat del WhatsApp central (false/null/0 si el cliente no escribio ahi).
  tieneChat?: boolean;
  clienteNombre?: string | null;
  mensajesSinLeer?: number;
  ventanaHastaUtc?: string | null;
  // BP-167 -- la sucursal en la que se hizo el pedido (null = antes del cambio).
  sucursal?: string | null;
  sucursalNombre?: string | null;
  // BP-193 -- el envio: costo (0 = gratis, null = a coordinar o retiro), la distancia del cliente a la sucursal (si
  // midio su ubicacion) y si quedo fuera del radio. undefined con un backend anterior.
  costoEnvio?: number | null;
  envioKm?: number | null;
  envioFueraDelRadio?: boolean | null;
}

/** BP-193 -- "Envío $1.500 · 3,2 km", "Envío gratis", "Envío a coordinar · 6,3 km". Null con retiro o backend anterior. */
export function detalleEnvio(p: PedidoTienda): string | null {
  if (p.entrega !== 'envio' || p.costoEnvio === undefined) return null;
  const costo = p.costoEnvio == null ? 'Envío a coordinar'
    : p.costoEnvio === 0 ? 'Envío gratis'
    : 'Envío $' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(p.costoEnvio);
  return p.envioKm != null ? `${costo} · ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(p.envioKm)} km` : costo;
}

export interface MensajeChatPedido {
  autor: 'cliente' | 'almacen' | 'sistema';
  texto: string;
  creadoAtUtc: string;
}

export interface ChatPedido {
  conectado: boolean;
  clienteNombre: string | null;
  clienteTelefono: string | null;
  ventanaHastaUtc: string | null;
  ventanaAbierta: boolean;
  mensajes: MensajeChatPedido[];
}

// BP-145 / BP-146 (17-oct-2026) -- destacados y carrusel de inicio. Espejo de TiendaDtos.cs.

/** Un producto de la sucursal, para elegirlo. fotoUrl = la miniatura, o null si no tiene foto. */
export interface ProductoDeTienda {
  ean: string;
  descripcion: string;
  marca: string | null;
  precioLista: number | null;
  fotoUrl: string | null;
}

export interface TiendaDestacados {
  productos: ProductoDeTienda[];
  max: number;
}

/** BP-153: 'imagen' = solo el banner (no lleva a ningun lado); 'enlace' = un link https afuera de la tienda. */
export type TipoCartel = 'producto' | 'categoria' | 'ofertas' | 'imagen' | 'enlace';

/** BP-153 -- vigente hoy, programado (empieza despues) o vencido (ya no se ve en la tienda). */
export type EstadoCartel = 'vigente' | 'programado' | 'vencido';

/** BP-153 -- los numeros de un cartel en los ultimos TiendaCarrusel.diasNumeros dias. */
export interface NumerosCartel {
  vistas: number;
  clics: number;
  pedidos: number;
  monto: number;
}

export interface CartelConfig {
  id: number;
  tipo: TipoCartel;
  /** EAN (producto), id de la categoria o link (enlace); null en ofertas e imagen. */
  destino: string | null;
  /** El nombre del producto o de la categoria, para mostrar. */
  destinoNombre: string | null;
  titulo: string | null;
  bajada: string | null;
  imagenUrl: string | null;
  /** BP-153 -- 'yyyy-MM-dd' o null (sin limite). Fechas de Argentina, inclusive. */
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
  estado?: EstadoCartel;
  numeros?: NumerosCartel | null;
}

export interface CategoriaTienda {
  id: string;
  nombre: string;
  productos: number;
}

export interface TiendaCarrusel {
  carteles: CartelConfig[];
  categorias: CategoriaTienda[];
  max: number;
  /** BP-153 -- tope del banner propio (bytes) y dias de los numeros. 0 con un backend viejo. */
  imagenMaxBytes?: number;
  diasNumeros?: number;
}

export interface CartelRequest {
  id: number | null;
  tipo: TipoCartel;
  destino: string | null;
  titulo: string | null;
  bajada: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
}

@Injectable({ providedIn: 'root' })
export class TiendaService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}business/tienda`;

  /** BP-167 -- la tienda de la cuenta (o lo sugerido para crearla) y todas sus sucursales. */
  cuenta(businessAccountId: number): Observable<TiendaDeCuenta> {
    return this.http.get<TiendaDeCuenta>(`${this.url}/cuenta`, { params: { businessAccountId } });
  }

  /** BP-167 -- habilitar o sacar sucursales, el WhatsApp de cada una y la principal. Devuelve lo mismo que cuenta(). */
  guardarSucursales(tiendaId: number, request: GuardarSucursalesRequest): Observable<TiendaDeCuenta> {
    return this.http.put<TiendaDeCuenta>(`${this.url}/${tiendaId}/sucursales`, request);
  }

  /** BP-167: la tienda propia es la de la cuenta; branchId ya no hace falta. */
  chequearSlug(businessAccountId: number, slug: string): Observable<SlugDisponibilidad> {
    return this.http.get<SlugDisponibilidad>(`${this.url}/slug`, { params: { businessAccountId, slug } });
  }

  guardar(request: GuardarTiendaRequest): Observable<TiendaConfig> {
    return this.http.put<TiendaConfig>(this.url, request);
  }

  subirQr(tiendaId: number, imagen: Blob): Observable<{ qrPagoUrl: string }> {
    const form = new FormData();
    form.append('archivo', imagen, 'qr.png');
    return this.http.post<{ qrPagoUrl: string }>(`${this.url}/${tiendaId}/qr`, form);
  }

  quitarQr(tiendaId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${tiendaId}/qr`);
  }

  /** BP-167: sucursal = solo esa sucursal; null = toda la tienda. */
  /** BP-175 -- el asistente de compra con IA de la tienda: como esta y si se puede prender. */
  asistente(tiendaId: number): Observable<AsistenteTienda> {
    return this.http.get<AsistenteTienda>(`${this.url}/${tiendaId}/asistente`);
  }

  /** BP-175 -- prenderlo o apagarlo. 402 si el plan no lo incluye (el panel lo trata como el resto de los candados). */
  guardarAsistente(tiendaId: number, activo: boolean): Observable<{ activo: boolean }> {
    return this.http.patch<{ activo: boolean }>(`${this.url}/${tiendaId}/asistente`, { activo });
  }

  estadisticas(tiendaId: number, sucursal: string | null = null): Observable<TiendaEstadisticas> {
    const params: Record<string, string> = sucursal ? { sucursal } : {};
    return this.http.get<TiendaEstadisticas>(`${this.url}/${tiendaId}/estadisticas`, { params });
  }

  /**
   * BP-130 -- los pedidos guardados de la tienda (ultimos `dias` dias), del mas nuevo al mas viejo.
   * BP-167: sucursal = solo los de esa sucursal; null = todos.
   */
  pedidos(tiendaId: number, dias = 30, sucursal: string | null = null): Observable<PedidoTienda[]> {
    const params: Record<string, string | number> = sucursal ? { dias, sucursal } : { dias };
    return this.http.get<PedidoTienda[]>(`${this.url}/${tiendaId}/pedidos`, { params });
  }

  /** BP-130 -- cambia el estado de un pedido. Devuelve el estado que quedo ("visto" no pisa uno posterior). */
  cambiarEstadoPedido(tiendaId: number, codigo: string, estado: Exclude<EstadoPedido, 'nuevo'>): Observable<{ codigo: string; estado: EstadoPedido }> {
    return this.http.patch<{ codigo: string; estado: EstadoPedido }>(`${this.url}/${tiendaId}/pedidos/${codigo}`, { estado });
  }

  /** BP-131 -- para el aviso de la barra: pedidos nuevos y mensajes sin leer de la cuenta (ultimos 30 dias). */
  pendientes(businessAccountId: number): Observable<{ pedidosNuevos: number; mensajesSinLeer: number }> {
    return this.http.get<{ pedidosNuevos: number; mensajesSinLeer: number }>(`${this.url}/pendientes`, { params: { businessAccountId } });
  }

  /** BP-131 -- el chat de WhatsApp del pedido (numero central). Abrirlo lo marca leido. */
  chatPedido(tiendaId: number, codigo: string): Observable<ChatPedido> {
    return this.http.get<ChatPedido>(`${this.url}/${tiendaId}/pedidos/${codigo}/chat`);
  }

  /** BP-131 -- contestar por WhatsApp (solo dentro de las 24 h desde el ultimo mensaje del cliente; si no, 409). */
  contestarPedido(tiendaId: number, codigo: string, texto: string): Observable<MensajeChatPedido> {
    return this.http.post<MensajeChatPedido>(`${this.url}/${tiendaId}/pedidos/${codigo}/chat`, { texto });
  }

  /** BP-131 -- "tu pedido esta listo" por plantilla de WhatsApp (sale tambien fuera de las 24 h). */
  avisarListo(tiendaId: number, codigo: string): Observable<MensajeChatPedido> {
    return this.http.post<MensajeChatPedido>(`${this.url}/${tiendaId}/pedidos/${codigo}/listo`, {});
  }

  /** BP-145 -- productos de la sucursal que coinciden con q (hasta 20). */
  buscarProductos(tiendaId: number, q: string): Observable<ProductoDeTienda[]> {
    return this.http.get<ProductoDeTienda[]>(`${this.url}/${tiendaId}/productos`, { params: { q } });
  }

  destacados(tiendaId: number): Observable<TiendaDestacados> {
    return this.http.get<TiendaDestacados>(`${this.url}/${tiendaId}/destacados`);
  }

  guardarDestacados(tiendaId: number, eans: string[]): Observable<TiendaDestacados> {
    return this.http.put<TiendaDestacados>(`${this.url}/${tiendaId}/destacados`, { eans });
  }

  /** BP-146 -- el carrusel de inicio de la tienda y sus categorias. */
  carrusel(tiendaId: number): Observable<TiendaCarrusel> {
    return this.http.get<TiendaCarrusel>(`${this.url}/${tiendaId}/carrusel`);
  }

  guardarCarrusel(tiendaId: number, carteles: CartelRequest[]): Observable<TiendaCarrusel> {
    return this.http.put<TiendaCarrusel>(`${this.url}/${tiendaId}/carrusel`, { carteles });
  }

  subirImagenCartel(tiendaId: number, cartelId: number, imagen: Blob, nombre = 'cartel.jpg'): Observable<{ imagenUrl: string }> {
    const form = new FormData();
    form.append('archivo', imagen, nombre);
    return this.http.post<{ imagenUrl: string }>(`${this.url}/${tiendaId}/carrusel/${cartelId}/imagen`, form);
  }

  quitarImagenCartel(tiendaId: number, cartelId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${tiendaId}/carrusel/${cartelId}/imagen`);
  }

  /** La direccion publica: misuper.app/<slug>. */
  urlPublica(slug: string): string {
    return `${environment.misuperUrl}/${slug}`;
  }

  /** BP-167 -- la tienda abierta en una sucursal: misuper.app/<slug>?sucursal=<branchId> (el QR del cartel). */
  urlSucursal(slug: string, branchId: string): string {
    return `${this.urlPublica(slug)}?sucursal=${encodeURIComponent(branchId)}`;
  }

  /** BP-130 -- el link de un pedido (el mismo que va en el WhatsApp). */
  urlPedido(slug: string, codigo: string): string {
    return `${environment.misuperUrl}/${slug}/pedido/${codigo}`;
  }
}

/**
 * Achica la foto del QR en el navegador antes de subirla: a lo sumo 600 px de lado, en PNG. Una foto
 * de celular de 4 MB queda en unos 50-150 KB y entra holgada en el maximo de 1 MB del servidor.
 * BP-146: los carteles del carrusel van a 1200 px en JPEG (una foto en PNG a ese tamano pasaria el mega).
 */
export async function achicarImagen(archivo: File, ladoMax = 600, tipo: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No es una imagen que el navegador pueda abrir.'));
      i.src = url;
    });
    const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no pudo procesar la imagen.');
    ctx.fillStyle = '#ffffff'; // un QR con transparencia queda negro sobre negro en tema oscuro
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, mal) =>
      canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo convertir la imagen.'))), tipo, 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** +5492664123456 -> "266 412-3456" (como lo lee un vecino, sin el +54 9). BP-167: sale de cartel.ts, lo usa tambien Mi tienda. */
export function formatearWhatsApp(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^549/, '');
  if (d.length !== 10) return e164;
  const area = d.startsWith('11') ? 2 : 3; // CABA/GBA 11; el resto, 3 digitos alcanza para leerlo
  return `${d.slice(0, area)} ${d.slice(area, d.length - 4)}-${d.slice(-4)}`;
}
