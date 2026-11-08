import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-219 (8-nov-2026) -- la cascada de margen: cliente de BusinessMargenEndpoints.cs.
export type FuenteDelCobro = 'caja' | 'planilla' | 'teorico' | 'sin_ventas';

export interface ArticuloMargen {
  ean: string;
  descripcion: string | null;
  rubro: string | null;
  branchId: string | null;
  precioGondola: number;
  costoNeto: number | null;
  costoEnGondolaSinIva: number | null;
  precioGondolaSinIva: number;
  cobrado: number | null;
  cobradoSinIva: number | null;
  fuente: FuenteDelCobro;
  unidades: number;
  margenGondola: number | null;
  margenReal: number | null;
  plataEnPromos: number;
  marcado: boolean;
  frase: string | null;
  promo: string | null;
}

export interface RubroMargen {
  nombre: string;
  articulos: number;
  unidades: number;
  margenGondola: number | null;
  margenReal: number | null;
  plataEnPromos: number;
  marcados: number;
}

export interface MargenResponse {
  tieneCostos: boolean;
  tieneVentas: boolean;
  tieneCaja: boolean;
  articulos: number;
  conCosto: number;
  conVentas: number;
  conCostoYVentas: number;
  margenGondola: number | null;
  margenReal: number | null;
  plataEnPromos: number;
  marcados: number;
  umbral: number;
  umbralGuardable: boolean;
  dias: number;
  desde: string;
  hasta: string;
  destino: string;
  rubros: RubroMargen[];
  total: number;
  page: number;
  pageSize: number;
  items: ArticuloMargen[];
}

export interface MargenFiltros {
  branchId: string | null;
  dias: number;
  filtro: string;
  rubro: string | null;
  q: string;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class MargenService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}business/margen`;

  leer(businessAccountId: number, f: MargenFiltros): Observable<MargenResponse> {
    const params: Record<string, string> = {
      businessAccountId: String(businessAccountId),
      dias: String(f.dias),
      filtro: f.filtro,
      page: String(f.page),
      pageSize: String(f.pageSize),
    };
    if (f.branchId) params['branchId'] = f.branchId;
    if (f.rubro) params['rubro'] = f.rubro;
    if (f.q.trim()) params['q'] = f.q.trim();
    return this.http.get<MargenResponse>(this.base, { params });
  }

  guardarUmbral(businessAccountId: number, umbral: number): Observable<{ umbral: number }> {
    return this.http.put<{ umbral: number }>(`${this.base}/umbral`, { businessAccountId, umbral });
  }
}
