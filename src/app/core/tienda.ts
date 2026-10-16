import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-71 (08-oct-2026) -- cliente de Buscaprecios.web/Endpoints/TiendaEndpoints.cs ("Mi tienda"):
// la tienda de cada sucursal en misuper.app/<slug>. Espejo de Data/DTOs/TiendaDtos.cs.

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
  /** Slugs que la tienda uso y siguen reservados (30 dias): el QR viejo sigue llevando aca. */
  slugsAnteriores: string[];
}

export interface TiendaDeSucursal {
  branchId: string;
  branchName: string;
  domicilio: string | null;
  ciudad: string | null;
  tieneUbicacion: boolean;
  productos: number;
  slugSugerido: string;
  nombreSugerido: string;
  tienda: TiendaConfig | null;
}

export interface SlugDisponibilidad {
  slug: string;
  disponible: boolean;
  motivo: string | null;
}

export interface GuardarTiendaRequest {
  businessAccountId: number;
  branchId: string;
  slug: string;
  activa: boolean;
  nombreVisible: string;
  presentacion: string | null;
  whatsApp: string | null;
  alias: string | null;
  cvu: string | null;
  mostrarDomicilio: boolean;
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
}

/** El 400 de guardar: el mensaje y el campo al que va pegado. */
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

@Injectable({ providedIn: 'root' })
export class TiendaService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}business/tienda`;

  listar(businessAccountId: number): Observable<TiendaDeSucursal[]> {
    return this.http.get<TiendaDeSucursal[]>(this.url, { params: { businessAccountId } });
  }

  chequearSlug(businessAccountId: number, branchId: string, slug: string): Observable<SlugDisponibilidad> {
    return this.http.get<SlugDisponibilidad>(`${this.url}/slug`, { params: { businessAccountId, branchId, slug } });
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

  estadisticas(tiendaId: number): Observable<TiendaEstadisticas> {
    return this.http.get<TiendaEstadisticas>(`${this.url}/${tiendaId}/estadisticas`);
  }

  /** BP-130 -- los pedidos guardados de la tienda (ultimos `dias` dias), del mas nuevo al mas viejo. */
  pedidos(tiendaId: number, dias = 30): Observable<PedidoTienda[]> {
    return this.http.get<PedidoTienda[]>(`${this.url}/${tiendaId}/pedidos`, { params: { dias } });
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

  /** La direccion publica: misuper.app/<slug>. */
  urlPublica(slug: string): string {
    return `${environment.misuperUrl}/${slug}`;
  }

  /** BP-130 -- el link de un pedido (el mismo que va en el WhatsApp). */
  urlPedido(slug: string, codigo: string): string {
    return `${environment.misuperUrl}/${slug}/pedido/${codigo}`;
  }
}

/**
 * Achica la foto del QR en el navegador antes de subirla: a lo sumo 600 px de lado, en PNG. Una foto
 * de celular de 4 MB queda en unos 50-150 KB y entra holgada en el maximo de 1 MB del servidor.
 */
export async function achicarImagen(archivo: File, ladoMax = 600): Promise<Blob> {
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
      canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo convertir la imagen.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
