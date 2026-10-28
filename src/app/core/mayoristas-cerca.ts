import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MayoristasCercaRespuesta } from './mayoristas.models';

// BP-209 (28-oct-2026, bloque 4) -- cliente de BusinessMayoristasEndpoints.cs. El resumen (la tarjeta del dashboard) llega
// en todos los planes; la lista, en Avanzado y Cadena (detalle = true). Sin el script de BP-209, noDisponible.
@Injectable({ providedIn: 'root' })
export class MayoristasCercaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/mayoristas/mas-baratos`;

  leer(businessAccountId: number, top = 500): Observable<MayoristasCercaRespuesta> {
    const p = new HttpParams().set('businessAccountId', businessAccountId).set('top', top);
    return this.http.get<MayoristasCercaRespuesta>(this.baseUrl, { params: p });
  }
}
