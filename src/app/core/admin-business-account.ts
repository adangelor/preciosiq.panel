import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminBusinessAccountSummary, GrantTrialRequest } from './admin-business-account.models';

// Cliente de AdminBusinessAccountEndpoints.cs (E10.5) -- protegido server-side por la
// policy "AdminsOnly" (rol de ASP.NET Identity), no por nada de este lado.
@Injectable({ providedIn: 'root' })
export class AdminBusinessAccountService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}admin/business-accounts`;

  search(query: string): Observable<AdminBusinessAccountSummary[]> {
    return this.http.get<AdminBusinessAccountSummary[]>(`${this.baseUrl}/search`, {
      params: { query },
    });
  }

  grantTrial(businessAccountId: number, request: GrantTrialRequest): Observable<AdminBusinessAccountSummary> {
    return this.http.post<AdminBusinessAccountSummary>(`${this.baseUrl}/${businessAccountId}/trial`, request);
  }

  revokeTrial(businessAccountId: number): Observable<AdminBusinessAccountSummary> {
    return this.http.delete<AdminBusinessAccountSummary>(`${this.baseUrl}/${businessAccountId}/trial`);
  }
}
