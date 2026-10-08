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

/** El 400 de guardar: el mensaje y el campo al que va pegado. */
export interface ErrorDeCampo {
  error: string;
  campo?: string;
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

  /** La direccion publica: misuper.app/<slug>. */
  urlPublica(slug: string): string {
    return `${environment.misuperUrl}/${slug}`;
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
