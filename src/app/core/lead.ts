import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreateLeadRequest } from './lead.models';

// Cliente de PublicLeadEndpoints.cs (POST /api/public/leads) -- sin auth, lo llena
// cualquier visitante desde el formulario "Solicitar demo" de la landing.
@Injectable({ providedIn: 'root' })
export class LeadService {
  private readonly http = inject(HttpClient);
  private readonly leadsUrl = `${environment.apiBaseUrl}public/leads`;

  create(request: CreateLeadRequest): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(this.leadsUrl, request);
  }
}
