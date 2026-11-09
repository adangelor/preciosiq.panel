import { HttpClient, HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-226 (8-nov-2026) -- tareas con foto para las sucursales: cliente de BusinessTareasEndpoints.cs.
export type EstadoSucursal = 'pendiente' | 'respondida' | 'nosepudo' | 'aprobada' | 'pedida';

export interface ProductoDeTarea {
  ean: string;
  descripcion: string | null;
}

export interface ResumenTarea {
  id: number;
  titulo: string;
  venceUtc: string;
  origen: 'panel' | 'carteles';
  estado: 'abierta' | 'cerrada';
  creadaUtc: string;
  creadaPor: string | null;
  sucursales: number;
  respondidas: number;
  aprobadas: number;
  pendientes: number;
  noSePudo: number;
  atrasadas: number;
  productos: number;
}

export interface FotoDeTarea {
  id: number;
  orden: number;
  bytes: number;
  ancho: number | null;
  alto: number | null;
  borrada: boolean;
  ean: string | null;
  ocrEstado: string | null;
  ocrDetalle: string | null;
}

export interface RespuestaDeTarea {
  id: number;
  creadaUtc: string;
  autor: string | null;
  noSePudo: boolean;
  motivo: string | null;
  comentario: string | null;
  fueraDeTermino: boolean;
  distanciaMetros: number | null;
  fotos: FotoDeTarea[];
}

export interface SucursalDeTarea {
  branchId: string;
  nombre: string | null;
  estado: EstadoSucursal;
  respondidaUtc: string | null;
  revisadaUtc: string | null;
  revisadaPor: string | null;
  comentarioRevision: string | null;
  atrasada: boolean;
  respuestas: RespuestaDeTarea[];
}

export interface DetalleTarea {
  id: number;
  titulo: string;
  instrucciones: string | null;
  venceUtc: string;
  origen: 'panel' | 'carteles';
  estado: 'abierta' | 'cerrada';
  creadaUtc: string;
  creadaPor: string | null;
  cerradaUtc: string | null;
  productos: ProductoDeTarea[];
  sucursales: SucursalDeTarea[];
}

export interface MiTarea {
  tareaId: number;
  titulo: string;
  instrucciones: string | null;
  venceUtc: string;
  branchId: string;
  sucursal: string | null;
  estado: EstadoSucursal;
  comentarioRevision: string | null;
  respondidaUtc: string | null;
  atrasada: boolean;
  productos: ProductoDeTarea[];
  /** Bloque 6: con 1 a 10 productos se pide una foto de cada uno, para controlar el precio del cartel. */
  maxFotos: number;
  porProducto: boolean;
}

export interface MisTareasResponse {
  encargado: boolean;
  sucursales: number;
  pendientes: number;
  items: MiTarea[];
}

export interface NuevaTarea {
  businessAccountId: number;
  titulo: string;
  instrucciones: string | null;
  vence: string;   // ISO con zona
  destino: 'todas' | 'sucursales' | 'zona';
  sucursales?: string[];
  priceZoneId?: number | null;
  eans?: string[];
  origen?: 'panel' | 'carteles';
}

/** Bloque 7: el globito del menú. */
export interface ContadorDeTareas {
  encargado: boolean;
  pendientes: number;
  paraRevisar: number;
}

/** Bloque 6: la marca del control del precio por foto. */
export const OCR: Record<string, { texto: string; icono: string; clase: string }> = {
  coincide: { texto: 'El precio coincide', icono: 'fa-circle-check', clase: 'ok' },
  nocoincide: { texto: 'El precio no coincide', icono: 'fa-triangle-exclamation', clase: 'mal' },
  noleido: { texto: 'No se pudo leer el precio', icono: 'fa-circle-question', clase: 'gris' },
  sinprecio: { texto: 'Sin precio cargado', icono: 'fa-circle-minus', clase: 'gris' },
};

export const ESTADOS: Record<EstadoSucursal, string> = {
  pendiente: 'Pendiente',
  respondida: 'Para revisar',
  nosepudo: 'No se pudo',
  aprobada: 'Aprobada',
  pedida: 'Pedida de nuevo',
};

@Injectable({ providedIn: 'root' })
export class TareasService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}business/tareas`;

  /** Bloque 7: avisa que alguien respondió o revisó, para que el globito del menú se actualice enseguida. */
  readonly cambios = new Subject<void>();
  avisarCambio(): void {
    this.cambios.next();
  }

  listar(cuenta: number, estado: 'abiertas' | 'cerradas' | 'todas'): Observable<{ estado: string; sucursales: number; items: ResumenTarea[] }> {
    return this.http.get<{ estado: string; sucursales: number; items: ResumenTarea[] }>(this.base, { params: { businessAccountId: cuenta, estado } });
  }

  crear(req: NuevaTarea): Observable<{ id: number; sucursales: number }> {
    return this.http.post<{ id: number; sucursales: number }>(this.base, req);
  }

  detalle(cuenta: number, id: number): Observable<DetalleTarea> {
    return this.http.get<DetalleTarea>(`${this.base}/${id}`, { params: { businessAccountId: cuenta } });
  }

  mias(cuenta: number): Observable<MisTareasResponse> {
    return this.http.get<MisTareasResponse>(`${this.base}/mias`, { params: { businessAccountId: cuenta } });
  }

  contador(cuenta: number): Observable<ContadorDeTareas> {
    return this.http.get<ContadorDeTareas>(`${this.base}/contador`, { params: { businessAccountId: cuenta } });
  }

  /** Multipart con progreso: el panel ya achicó las fotos. Cada foto puede decir de qué producto es (un "eans" por foto). */
  responder(cuenta: number, tarea: number, branchId: string, datos: {
    fotos: { blob: Blob; ean?: string | null }[]; comentario?: string | null; noSePudo?: boolean; motivo?: string | null; latitud?: number | null; longitud?: number | null;
  }): Observable<HttpEvent<{ respuestaId: number; fotos: number }>> {
    const form = new FormData();
    form.append('businessAccountId', String(cuenta));
    datos.fotos.forEach((f, i) => {
      form.append('fotos', f.blob, `foto-${i + 1}.jpg`);
      form.append('eans', f.ean ?? '');
    });
    if (datos.comentario) form.append('comentario', datos.comentario);
    if (datos.noSePudo) form.append('noSePudo', 'true');
    if (datos.motivo) form.append('motivo', datos.motivo);
    if (datos.latitud != null && datos.longitud != null) {
      form.append('latitud', datos.latitud.toFixed(6));
      form.append('longitud', datos.longitud.toFixed(6));
    }
    return this.http.post<{ respuestaId: number; fotos: number }>(
      `${this.base}/${tarea}/sucursales/${encodeURIComponent(branchId)}/responder`, form, { reportProgress: true, observe: 'events' });
  }

  aprobar(cuenta: number, tarea: number, branchId: string, comentario: string | null): Observable<unknown> {
    return this.http.post(`${this.base}/${tarea}/sucursales/${encodeURIComponent(branchId)}/aprobar`, { businessAccountId: cuenta, comentario });
  }

  pedir(cuenta: number, tarea: number, branchId: string, comentario: string): Observable<unknown> {
    return this.http.post(`${this.base}/${tarea}/sucursales/${encodeURIComponent(branchId)}/pedir`, { businessAccountId: cuenta, comentario });
  }

  cerrar(cuenta: number, tarea: number, cerrar: boolean): Observable<unknown> {
    return this.http.post(`${this.base}/${tarea}/${cerrar ? 'cerrar' : 'reabrir'}`, { businessAccountId: cuenta });
  }

  /** Las fotos no son públicas: se bajan con la sesión y se muestran como blob. */
  foto(cuenta: number, fotoId: number, miniatura: boolean): Observable<Blob> {
    return this.http.get(`${this.base}/fotos/${fotoId}`, {
      params: { businessAccountId: cuenta, miniatura: miniatura ? 'true' : 'false' },
      responseType: 'blob',
    });
  }
}

/**
 * Achica una foto del teléfono en el navegador antes de subirla (decisión C): lado mayor 1600 px, JPEG 80. createImageBitmap
 * con imageOrientation 'from-image' la endereza según el EXIF. Si el navegador no puede, va la original (el servidor la
 * achica igual si pasa de 2000 px).
 */
export async function achicarFoto(archivo: File, lado = 1600, calidad = 0.8): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));
    return blob && blob.size > 0 ? blob : archivo;
  } catch {
    return archivo;
  }
}

/** "vence hoy 18:00", "venció el 12/11", "vence el jue 14/11 18:00". */
export function textoVencimiento(venceUtc: string): string {
  const v = new Date(venceUtc);
  const ahora = new Date();
  const hora = v.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const mismoDia = v.toDateString() === ahora.toDateString();
  const manana = new Date(ahora.getTime() + 86400000).toDateString() === v.toDateString();
  if (v < ahora) return mismoDia ? `venció hoy a las ${hora}` : `venció el ${v.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`;
  if (mismoDia) return `vence hoy a las ${hora}`;
  if (manana) return `vence mañana a las ${hora}`;
  return `vence el ${v.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })} a las ${hora}`;
}
