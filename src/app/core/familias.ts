import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// BP-221 (8-nov-2026) -- familias de precio: cliente de BusinessFamiliasEndpoints.cs.
export type TipoFamilia = 'mismo' | 'atado';

export interface MiembroFamilia {
  ean: string;
  descripcion: string | null;
  esGuia: boolean;
  factor: number;
  ajuste: number;
  precio: number | null;
  fueraDeRegla: number;
}

export interface Familia {
  id: number;
  nombre: string;
  tipo: TipoFamilia;
  guiaEan: string;
  miembros: MiembroFamilia[];
  fueraDeRegla: number;
}

export interface FamiliasResponse {
  items: Familia[];
  sucursal: string | null;
}

export interface FamiliaRequest {
  businessAccountId: number;
  nombre: string;
  tipo: TipoFamilia;
  guiaEan: string;
  miembros: { ean: string; factor?: number | null; ajuste?: number | null }[];
}

export interface SugeridaMiembro {
  ean: string;
  descripcion: string | null;
  precio: number;
}

export interface Sugerida {
  nombre: string;
  guiaEan: string;
  miembros: SugeridaMiembro[];
}

export interface SugeridasResponse {
  yaConElMismoPrecio: Sugerida[];
  totalYa: number;
  posibles: Sugerida[];
  totalPosibles: number;
}

export interface CambioDeFamilia {
  branchId: string;
  sucursal: string | null;
  ean: string;
  descripcion: string | null;
  antes: number;
  despues: number;
}

export interface IgualarResponse {
  aplicados: number;
  batchId: number | null;
  groupId: number | null;
  batchIds: number[];
  nombreDeLaCarga: string;
}

@Injectable({ providedIn: 'root' })
export class FamiliasService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}business/familias`;

  listar(businessAccountId: number): Observable<FamiliasResponse> {
    return this.http.get<FamiliasResponse>(this.base, { params: { businessAccountId: String(businessAccountId) } });
  }

  crear(r: FamiliaRequest): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(this.base, r);
  }

  editar(id: number, r: FamiliaRequest): Observable<{ id: number }> {
    return this.http.put<{ id: number }>(`${this.base}/${id}`, r);
  }

  borrar(id: number, businessAccountId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`, { params: { businessAccountId: String(businessAccountId) } });
  }

  sugeridas(businessAccountId: number): Observable<SugeridasResponse> {
    return this.http.get<SugeridasResponse>(`${this.base}/sugeridas`, { params: { businessAccountId: String(businessAccountId) } });
  }

  verIgualar(id: number, businessAccountId: number): Observable<{ familia: string; cambios: CambioDeFamilia[] }> {
    return this.http.get<{ familia: string; cambios: CambioDeFamilia[] }>(`${this.base}/${id}/igualar`, {
      params: { businessAccountId: String(businessAccountId) },
    });
  }

  igualar(id: number, businessAccountId: number): Observable<IgualarResponse> {
    return this.http.post<IgualarResponse>(`${this.base}/${id}/igualar`, { businessAccountId });
  }

  /** Para Cargar precio: qué se mueve si el guía pasa a ese precio en esa sucursal. */
  seguidores(businessAccountId: number, branchId: string, ean: string, precio: number): Observable<{ familia: string | null; movimientos: CambioDeFamilia[] }> {
    return this.http.get<{ familia: string | null; movimientos: CambioDeFamilia[] }>(`${this.base}/seguidores`, {
      params: { businessAccountId: String(businessAccountId), branchId, ean, precio: String(precio) },
    });
  }
}
