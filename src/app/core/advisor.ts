import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdvisorReportResponse } from './advisor.models';

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
}
