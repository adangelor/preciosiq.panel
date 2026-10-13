import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AdvisorReportResponse,
  KeyProductSearchItem,
  KeyProductSuggestionsResponse,
  KeyProductsChangeResponse,
  KeyProductsResponse,
} from './advisor.models';

// Cliente de /api/business/advisor (BusinessAdvisorEndpoints.cs) -- Asesor de
// Precios, fase 1. La llamada al LLM ocurre SIEMPRE server-side (la API key jamas
// llega al navegador); este servicio solo pide el informe ya generado.
@Injectable({ providedIn: 'root' })
export class AdvisorService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/advisor`;

  generateReport(
    businessAccountId: number,
    branchId: string,
    maxDistanceMeters: number,
    refresh = false,
  ): Observable<AdvisorReportResponse> {
    return this.http.post<AdvisorReportResponse>(`${this.baseUrl}/report`, null, {
      params: { businessAccountId, branchId, maxDistanceMeters, refresh },
    });
  }

  submitFeedback(reportId: number, thumbsUp: boolean): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.baseUrl}/report/${reportId}/feedback`, { thumbsUp });
  }

  // ---- BP-78: productos testigo ----

  /** Los testigos confirmados. Con branchId, cada uno trae su posicion contra la referencia de ese radio. */
  getKeyProducts(
    businessAccountId: number,
    branchId: string | null,
    maxDistanceMeters: number,
  ): Observable<KeyProductsResponse> {
    const params: Record<string, string | number> = { businessAccountId, maxDistanceMeters };
    if (branchId) params['branchId'] = branchId;
    return this.http.get<KeyProductsResponse>(`${this.baseUrl}/key-products`, { params });
  }

  /** La sugerencia. No graba nada: se confirma con addKeyProducts. */
  getKeyProductSuggestions(businessAccountId: number): Observable<KeyProductSuggestionsResponse> {
    return this.http.get<KeyProductSuggestionsResponse>(`${this.baseUrl}/key-products/suggestions`, {
      params: { businessAccountId },
    });
  }

  searchKeyProductCandidates(businessAccountId: number, q: string): Observable<KeyProductSearchItem[]> {
    return this.http.get<KeyProductSearchItem[]>(`${this.baseUrl}/key-products/search`, {
      params: { businessAccountId, q },
    });
  }

  addKeyProducts(
    businessAccountId: number,
    eans: string[],
    origen: 'sugerido' | 'manual',
  ): Observable<KeyProductsChangeResponse> {
    return this.http.post<KeyProductsChangeResponse>(`${this.baseUrl}/key-products`, { businessAccountId, eans, origen });
  }

  removeKeyProduct(businessAccountId: number, ean: string): Observable<KeyProductsChangeResponse> {
    return this.http.delete<KeyProductsChangeResponse>(`${this.baseUrl}/key-products`, {
      params: { businessAccountId, ean },
    });
  }
}
