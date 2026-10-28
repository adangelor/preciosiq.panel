import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { FiltrosOfertasCerca, OfertasCercaRespuesta } from './ofertas-cerca.models';

// BP-204 (28-oct-2026, bloque 5) -- cliente de BusinessOfertasCercaEndpoints.cs. Desde Pyme: los demas planes reciben
// 402 y la tarjeta muestra el candado. Sin el script de BP-201 en el servidor, 503.
@Injectable({ providedIn: 'root' })
export class OfertasCercaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/ofertas-cerca`;

  leer(businessAccountId: number, f: FiltrosOfertasCerca = {}): Observable<OfertasCercaRespuesta> {
    let p = new HttpParams().set('businessAccountId', businessAccountId);
    if (f.branchId) p = p.set('branchId', f.branchId);
    if (f.etiqueta) p = p.set('etiqueta', f.etiqueta);
    if (f.soloLoQueVendo) p = p.set('soloLoQueVendo', true);
    if (f.top !== undefined) p = p.set('top', f.top);
    return this.http.get<OfertasCercaRespuesta>(this.baseUrl, { params: p });
  }
}
