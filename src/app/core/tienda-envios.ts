import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-193 (22-oct-2026) -- Mi tienda -> Envios. Espejo de Buscaprecios.web/Endpoints/TiendaEnviosEndpoints.cs.
// Las reglas viven en el servidor (Services/EnvioDeSucursal.cs); aca solo se repite la frase para mostrarla en vivo
// mientras el comercio tipea (fraseDeEnvio, con los mismos textos).

export interface CondicionesEnvio {
  configurado: boolean;
  haceEnvio: boolean;
  radioKm: number | null;
  pedidoMinimo: number | null;
  costo: number | null;
  gratisDesde: number | null;
  nota: string | null;
}

export interface EnvioDeSucursal {
  branchId: string;
  nombre: string;
  calle: string | null;
  ciudad: string | null;
  lat: number | null;
  lon: number | null;
  tieneUbicacion: boolean;
  /** Si esta en la tienda (habilitada). Las que no estan se pueden configurar igual, pero no se ofrecen. */
  enLaTienda: boolean;
  condiciones: CondicionesEnvio;
  frase: string;
}

export interface EnviosDeLaTienda {
  tiendaId: number;
  /** false = la base no tiene el script todavia: todo sin configurar y no se puede guardar. */
  disponible: boolean;
  ningunaConfigurada: boolean;
  sucursales: EnvioDeSucursal[];
  avisos: string[];
}

export interface EnvioSucursalRequest {
  branchId: string;
  haceEnvio: boolean;
  radioKm: number | null;
  pedidoMinimo: number | null;
  costo: number | null;
  gratisDesde: number | null;
  nota: string | null;
  /** true = volver a "sin configurar" (envio sin condiciones, como antes). */
  sinConfigurar?: boolean;
}

/** Un 400 del PUT: el campo y la sucursal (errores trae todos los de esa sucursal). */
export interface ErrorDeEnvio {
  error: string;
  campo: string;
  branchId: string | null;
  errores?: { campo: string; mensaje: string; branchId: string }[];
}

export interface LocalidadCubierta {
  nombre: string;
  provincia: string;
  km: number;
  sucursalesDeReferencia: number;
}

export interface CoberturaSucursal {
  branchId: string;
  nombre: string;
  radioKm: number;
  /** true = la sucursal no tiene radio: se midio con el de referencia (10 km). */
  radioDeReferencia: boolean;
  localidades: LocalidadCubierta[];
  totalLocalidades: number;
  aclaracion: string;
}

export interface PruebaSucursal {
  branchId: string;
  nombre: string;
  km: number | null;
  llega: 'llega' | 'no-llega' | 'sin-dato' | 'no-envia';
  frase: string;
}

export interface PruebaDePunto {
  lat: number;
  lon: number;
  atiende: PruebaSucursal | null;
  texto: string;
  sucursales: PruebaSucursal[];
  direccionBuscada: string | null;
}

export interface ResumenEntregas {
  pedidos: number;
  envios: number;
  retiros: number;
  fueraDelRadio: number;
  ticketEnvio: number | null;
  ticketRetiro: number | null;
  costoDeEnvios: number;
}

export interface ResumenDeEnvios {
  dias: number;
  disponible: boolean;
  total: ResumenEntregas;
  porSucursal: { branchId: string; nombre: string; numeros: ResumenEntregas }[];
}

@Injectable({ providedIn: 'root' })
export class TiendaEnviosService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}business/tienda`;

  listar(tiendaId: number): Observable<EnviosDeLaTienda> {
    return this.http.get<EnviosDeLaTienda>(`${this.url}/${tiendaId}/envios`);
  }

  guardar(tiendaId: number, sucursales: EnvioSucursalRequest[]): Observable<EnviosDeLaTienda> {
    return this.http.put<EnviosDeLaTienda>(`${this.url}/${tiendaId}/envios`, { sucursales });
  }

  /** radioKm: el que esta tipeando (para ver antes de guardar); sin el, el guardado. */
  cobertura(tiendaId: number, sucursal: string, radioKm: number | null): Observable<CoberturaSucursal> {
    const params: Record<string, string> = { sucursal };
    if (radioKm != null) params['radioKm'] = String(radioKm);
    return this.http.get<CoberturaSucursal>(`${this.url}/${tiendaId}/envios/cobertura`, { params });
  }

  probarPunto(tiendaId: number, lat: number, lon: number): Observable<PruebaDePunto> {
    return this.http.get<PruebaDePunto>(`${this.url}/${tiendaId}/envios/probar`, { params: { lat: String(lat), lon: String(lon) } });
  }

  probarDireccion(tiendaId: number, direccion: string): Observable<PruebaDePunto> {
    return this.http.get<PruebaDePunto>(`${this.url}/${tiendaId}/envios/probar`, { params: { direccion } });
  }

  resumen(tiendaId: number, dias = 30): Observable<ResumenDeEnvios> {
    return this.http.get<ResumenDeEnvios>(`${this.url}/${tiendaId}/envios/resumen`, { params: { dias: String(dias) } });
  }
}

// ------------------------------------------------------------------ la frase, en vivo

const plata = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const kms = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

export function pesosEnvio(n: number): string {
  return '$' + plata.format(n);
}

export function kmEnvio(n: number): string {
  return kms.format(n);
}

/** La misma frase que arma el servidor (EnvioDeSucursal.Frase): lo que ve el comprador en la tienda. */
export function fraseDeEnvio(c: CondicionesEnvio): string {
  if (!c.configurado) return 'Envío a domicilio: se coordina con el comercio por WhatsApp';
  if (!c.haceEnvio) return 'Solo retiro en la sucursal';
  const partes = [c.radioKm != null ? `Envío a domicilio hasta ${kmEnvio(c.radioKm)} km` : 'Envío a domicilio'];
  if (c.pedidoMinimo != null && c.pedidoMinimo > 0) partes.push(`pedido mínimo ${pesosEnvio(c.pedidoMinimo)}`);
  const gratis = c.gratisDesde != null && c.gratisDesde > 0 ? `, gratis desde ${pesosEnvio(c.gratisDesde)}` : '';
  if (c.costo == null) partes.push(c.gratisDesde === 0 ? 'envío gratis' : 'costo a coordinar' + gratis);
  else if (c.costo === 0) partes.push('envío gratis');
  else partes.push(`envío ${pesosEnvio(c.costo)}` + gratis);
  return partes.join(' · ');
}
