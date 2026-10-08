import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { InstantBenchmarkResponse } from './business-benchmark.models';

// Cliente de BusinessBenchmarkEndpoints.cs (E3).
@Injectable({ providedIn: 'root' })
export class BusinessBenchmarkService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/benchmark`;

  getInstant(
    businessAccountId: number,
    branchId: string,
    maxDistanceMeters = 3000,
  ): Observable<InstantBenchmarkResponse> {
    return this.http.get<InstantBenchmarkResponse>(`${this.baseUrl}/instant`, {
      params: { businessAccountId, branchId, maxDistanceMeters },
    });
  }
}
