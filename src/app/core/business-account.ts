import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BranchListItem,
  BranchResponse,
  BusinessAccountResponse,
  CreateBranchRequest,
  CreateBusinessAccountRequest,
  LogoResponse,
  RegeocodeBranchRequest,
  UpdateBranchAddressRequest,
  UpdateBranchLocationRequest,
  UpdateBranchVisibilityRequest,
  UpdateBusinessAccountRequest,
} from './business-account.models';

// Cliente de BusinessAccountEndpoints.cs (E1/E2). RequireAuthorization() en el backend --
// el Bearer token lo agrega authInterceptor (ver core/auth-interceptor.ts), registrado
// junto con el login del panel (features/login).
@Injectable({ providedIn: 'root' })
export class BusinessAccountService {
  private readonly http = inject(HttpClient);
  private readonly accountsUrl = `${environment.apiBaseUrl}business/accounts`;
  private readonly branchesUrl = `${environment.apiBaseUrl}business/branches`;

  create(request: CreateBusinessAccountRequest): Observable<BusinessAccountResponse> {
    return this.http.post<BusinessAccountResponse>(this.accountsUrl, request);
  }

  getMine(): Observable<BusinessAccountResponse[]> {
    return this.http.get<BusinessAccountResponse[]>(`${this.accountsUrl}/me`);
  }

  // E-Cuenta (17-ago-2026) -- pedido de Andres: corregir RazonSocial/Cuit despues del
  // alta, desde el nuevo menu lateral "Datos del negocio".
  update(businessAccountId: number, request: UpdateBusinessAccountRequest): Observable<BusinessAccountResponse> {
    return this.http.patch<BusinessAccountResponse>(`${this.accountsUrl}/${businessAccountId}`, request);
  }

  createBranch(request: CreateBranchRequest): Observable<BranchResponse> {
    return this.http.post<BranchResponse>(this.branchesUrl, request);
  }

  listBranches(businessAccountId: number): Observable<BranchListItem[]> {
    return this.http.get<BranchListItem[]>(this.branchesUrl, { params: { businessAccountId } });
  }

  updateBranchVisibility(branchId: string, request: UpdateBranchVisibilityRequest): Observable<BranchListItem> {
    return this.http.patch<BranchListItem>(`${this.branchesUrl}/${branchId}/visibilidad`, request);
  }

  // E2.3 (16-ago-2026) -- pedido de Andres: cuando el geocoding automatico del alta no
  // encontro la direccion, el panel tiene que poder capturar la ubicacion despues, de
  // dos formas: reintentar el geocoding automatico (mismo proveedor, por si la
  // direccion se corrigio o el proveedor fallo transitoriamente), o que el usuario
  // clickee el punto exacto en un mapa.
  setBranchLocation(branchId: string, request: UpdateBranchLocationRequest): Observable<BranchListItem> {
    return this.http.patch<BranchListItem>(`${this.branchesUrl}/${branchId}/ubicacion`, request);
  }

  regeocodeBranch(branchId: string, request: RegeocodeBranchRequest): Observable<BranchListItem> {
    return this.http.post<BranchListItem>(`${this.branchesUrl}/${branchId}/geocodificar`, request);
  }

  // E-Cuenta (17-ago-2026) -- companero de updateBranchVisibility/setBranchLocation:
  // corrige el domicilio en si (no lat/long, eso sigue en /sucursales).
  updateBranchAddress(branchId: string, request: UpdateBranchAddressRequest): Observable<BranchListItem> {
    return this.http.patch<BranchListItem>(`${this.branchesUrl}/${branchId}/domicilio`, request);
  }

  // E1.6 -- le pasa el sitio web del comercio al backend, que le trae el favicon y lo
  // guarda como logo de la cuenta. Devuelve el path relativo ya guardado (logoUrl).
  fetchLogoFromWebsite(businessAccountId: number, websiteUrl: string): Observable<LogoResponse> {
    return this.http.post<LogoResponse>(`${this.accountsUrl}/${businessAccountId}/logo/from-website`, {
      websiteUrl,
    });
  }

  // E1.6 -- subida manual, para el comercio que no tiene sitio web. multipart/form-data,
  // sin Content-Type explicito: HttpClient lo arma solo a partir del FormData (incluyendo
  // el boundary), fijarlo a mano rompe el parseo del lado del backend.
  uploadLogo(businessAccountId: number, file: File): Observable<LogoResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<LogoResponse>(`${this.accountsUrl}/${businessAccountId}/logo/upload`, formData);
  }
}
