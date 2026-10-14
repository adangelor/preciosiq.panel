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
  PriceZoneDeleteResponse,
  PriceZonesResponse,
} from './advisor.models';

// Cliente de /api/business/advisor (BusinessAdvisorEndpoints.cs) -- Asesor de
// Precios, fase 1. La llamada al LLM ocurre SIEMPRE server-side (la API key jamas
// llega al navegador); este servicio solo pide el informe ya generado.
@Injectable({ providedIn: 'root' })
export class AdvisorService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/advisor`;

  /** De una sucursal ({ branchId }) o, desde BP-77, de una zona de precio ({ priceZoneId }). */
  generateReport(
    businessAccountId: number,
    de: { branchId: string } | { priceZoneId: number },
    maxDistanceMeters: number,
    refresh = false,
  ): Observable<AdvisorReportResponse> {
    return this.http.post<AdvisorReportResponse>(`${this.baseUrl}/report`, null, {
      params: { businessAccountId, ...de, maxDistanceMeters, refresh },
    });
  }

  // ---- BP-77: zonas de precio ----

  getPriceZones(businessAccountId: number): Observable<PriceZonesResponse> {
    return this.http.get<PriceZonesResponse>(`${this.baseUrl}/price-zones`, { params: { businessAccountId } });
  }

  createPriceZone(businessAccountId: number, nombre: string, branchIds: string[]): Observable<PriceZonesResponse> {
    return this.http.post<PriceZonesResponse>(`${this.baseUrl}/price-zones`, { businessAccountId, nombre, branchIds });
  }

  /** nombre o branchIds en null = no tocar ese campo. */
  updatePriceZone(
    businessAccountId: number,
    zoneId: number,
    nombre: string | null,
    branchIds: string[] | null,
  ): Observable<PriceZonesResponse> {
    return this.http.put<PriceZonesResponse>(`${this.baseUrl}/price-zones/${zoneId}`, { businessAccountId, nombre, branchIds });
  }

  deletePriceZone(businessAccountId: number, zoneId: number): Observable<PriceZoneDeleteResponse> {
    return this.http.delete<PriceZoneDeleteResponse>(`${this.baseUrl}/price-zones/${zoneId}`, { params: { businessAccountId } });
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
