import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
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

const CLAVE_CUENTA_ELEGIDA = 'preciosiq.cuentaElegida';

/** BP-88: la cuenta elegida al principio; el resto en el orden en que vino. */
export function ponerPrimeroLaElegida<T extends { businessAccountId: number }>(cuentas: T[], elegida: number | null): T[] {
  const i = elegida == null ? -1 : cuentas.findIndex((c) => c.businessAccountId === elegida);
  return i <= 0 ? cuentas : [cuentas[i], ...cuentas.slice(0, i), ...cuentas.slice(i + 1)];
}

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

  // BP-88 (10-oct-2026) -- un usuario puede estar en varias empresas (invitaciones). Todo el panel usa
  // accounts[0], asi que en vez de tocar cada pantalla, getMine() devuelve la EMPRESA ELEGIDA PRIMERO
  // (la guarda elegirCuenta(), desde el selector del encabezado). Sin eleccion, o si la elegida ya no
  // esta en la lista, queda el orden del backend (estable: la cuenta mas vieja primero).
  getMine(): Observable<BusinessAccountResponse[]> {
    return this.http
      .get<BusinessAccountResponse[]>(`${this.accountsUrl}/me`)
      .pipe(map((cuentas) => ponerPrimeroLaElegida(cuentas, this.cuentaElegidaId())));
  }

  /** BP-88: recuerda la empresa elegida en este navegador. Despues de llamarla, recargar el panel. */
  elegirCuenta(businessAccountId: number): void {
    try {
      localStorage.setItem(CLAVE_CUENTA_ELEGIDA, String(businessAccountId));
    } catch {
      // sin localStorage (modo privado estricto): el selector no recuerda, pero no rompe nada
    }
  }

  cuentaElegidaId(): number | null {
    try {
      const v = Number(localStorage.getItem(CLAVE_CUENTA_ELEGIDA));
      return Number.isInteger(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
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
