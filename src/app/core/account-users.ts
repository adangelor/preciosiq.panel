import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AcceptInvitationResponse,
  AccountInvitationResponse,
  AccountUsersResponse,
  InvitationPreviewResponse,
  InviteMemberRequest,
} from './account-users.models';

// Cliente de AccountUsersEndpoints.cs (E4.7, generalizado E-Cuenta 17-ago-2026), grupo
// /api/business/accounts/{id} + /api/business/invitations. Mismo backend exacto que
// usa distribucioniq.panel -- la logica de datos/permisos nunca dependio del producto,
// solo variaba la ruta (antes /api/distribucion/...) y el texto del mail de invitacion
// (eso lo resuelve el backend solo, segun AccountType). RequireAuthorization() salvo
// previewInvitation, que es AllowAnonymous del lado del backend.
@Injectable({ providedIn: 'root' })
export class AccountUsersService {
  private readonly http = inject(HttpClient);
  private readonly accountsUrl = `${environment.apiBaseUrl}business/accounts`;
  private readonly invitationsUrl = `${environment.apiBaseUrl}business/invitations`;

  list(businessAccountId: number): Observable<AccountUsersResponse> {
    return this.http.get<AccountUsersResponse>(`${this.accountsUrl}/${businessAccountId}/users`);
  }

  invite(businessAccountId: number, request: InviteMemberRequest): Observable<AccountInvitationResponse> {
    return this.http.post<AccountInvitationResponse>(`${this.accountsUrl}/${businessAccountId}/users/invite`, request);
  }

  removeMember(businessAccountId: number, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.accountsUrl}/${businessAccountId}/users/${userId}`);
  }

  // 09-oct-2026 -- el Owner cambia el rol de un miembro. El backend no deja la cuenta sin Owner (409).
  changeRole(businessAccountId: number, userId: string, role: 'Owner' | 'Manager'): Observable<{ userId: string; role: string }> {
    return this.http.put<{ userId: string; role: string }>(`${this.accountsUrl}/${businessAccountId}/users/${userId}/role`, { role });
  }

  revokeInvitation(businessAccountId: number, invitationId: number): Observable<void> {
    return this.http.delete<void>(`${this.accountsUrl}/${businessAccountId}/invitations/${invitationId}`);
  }

  previewInvitation(token: string): Observable<InvitationPreviewResponse> {
    return this.http.get<InvitationPreviewResponse>(`${this.invitationsUrl}/${token}`);
  }

  acceptInvitation(token: string): Observable<AcceptInvitationResponse> {
    return this.http.post<AcceptInvitationResponse>(`${this.invitationsUrl}/${token}/accept`, {});
  }
}
