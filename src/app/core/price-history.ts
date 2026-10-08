import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PriceHistoryResponse } from './price-history.models';

// Cliente de GET /api/business/prices/history (E7.3).
@Injectable({ providedIn: 'root' })
export class PriceHistoryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/prices/history`;

  get(businessAccountId: number, branchId: string, ean: string, days = 180): Observable<PriceHistoryResponse> {
    return this.http.get<PriceHistoryResponse>(this.baseUrl, {
      params: { businessAccountId, branchId, ean, days },
    });
  }
}
