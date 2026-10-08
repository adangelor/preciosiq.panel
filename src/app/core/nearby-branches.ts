import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Cliente de GET /api/branches/nearby (BranchesEndpoints.cs) -- el mismo endpoint publico
// que usa la app de consumidores para "sucursales cerca". Solo se tipan los campos que el
// panel usa; el endpoint devuelve bastante mas (horarios, domicilio, logo).
export interface NearbyBranch {
  commerceId: string;
  bannerId: string;
  branchId: string;
  branchName: string;
  commerceName: string | null;
  distanceMeters: number;
}

@Injectable({ providedIn: 'root' })
export class NearbyBranchesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}branches/nearby`;

  getNearby(latitude: number, longitude: number, maxDistanceMeters: number, maxResults: number): Observable<NearbyBranch[]> {
    return this.http.get<NearbyBranch[]>(this.url, {
      params: {
        latitude: String(latitude),
        longitude: String(longitude),
        maxDistanceMeters: String(maxDistanceMeters),
        maxResults: String(maxResults),
      },
    });
  }
}
