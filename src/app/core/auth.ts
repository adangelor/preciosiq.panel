import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  GoogleLoginRequest,
  GoogleLoginResponse,
  PasswordLoginRequest,
  PasswordLoginResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  StartOtpRequest,
  StartOtpResponse,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from './auth.models';

// Login del panel: tres caminos, mismo resultado (accessToken/refreshToken/user) --
// contraseña (default), OTP por mail o Google. El token queda en localStorage para
// que el interceptor (ver auth-interceptor.ts) lo agregue como Bearer.
const ACCESS_TOKEN_KEY = 'retailiq.accessToken';
const REFRESH_TOKEN_KEY = 'retailiq.refreshToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly identityUrl = `${environment.apiBaseUrl}identity`;

  readonly isAuthenticated = signal(this.hasValidSession());

  // E10.5 (18-ago-2026) -- "Admins" ya existe como rol de ASP.NET Identity en el
  // backend (Database/Make_Admin.sql, policy "AdminsOnly") y TokenService.cs ya mete
  // los roles del usuario como claims en el JWT -- esto solo lee ese claim del lado
  // del cliente para poder mostrar/ocultar la pantalla de admin (AdminBusinessAccountEndpoints.cs
  // igual revalida todo server-side; esto es SOLO para no mostrar un link que va a
  // devolver 403 si el usuario no es admin).
  readonly isAdmin = signal(this.hasRole('Admins'));

  startOtp(request: StartOtpRequest): Observable<StartOtpResponse> {
    return this.http.post<StartOtpResponse>(`${this.identityUrl}/StartOtp`, request);
  }

  verifyOtp(request: VerifyOtpRequest): Observable<VerifyOtpResponse> {
    return this.http
      .post<VerifyOtpResponse>(`${this.identityUrl}/VerifyOtp`, request)
      .pipe(tap((response) => this.storeSession(response)));
  }

  googleLogin(request: GoogleLoginRequest): Observable<GoogleLoginResponse> {
    return this.http
      .post<GoogleLoginResponse>(`${this.identityUrl}/google-login`, request)
      .pipe(tap((response) => this.storeSession(response)));
  }

  register(request: RegisterRequest): Observable<RegisterResponse> {
    return this.http
      .post<RegisterResponse>(`${this.identityUrl}/register`, request)
      .pipe(tap((response) => this.storeSession(response)));
  }

  passwordLogin(request: PasswordLoginRequest): Observable<PasswordLoginResponse> {
    return this.http
      .post<PasswordLoginResponse>(`${this.identityUrl}/login`, request)
      .pipe(tap((response) => this.storeSession(response)));
  }

  forgotPassword(request: ForgotPasswordRequest): Observable<ForgotPasswordResponse> {
    return this.http.post<ForgotPasswordResponse>(`${this.identityUrl}/forgot-password`, request);
  }

  resetPassword(request: ResetPasswordRequest): Observable<ResetPasswordResponse> {
    return this.http.post<ResetPasswordResponse>(`${this.identityUrl}/reset-password`, request);
  }

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  // E1.8 (16-ago-2026) -- pedido explicito de Andres: "si tiene token y es valido".
  // authGuard (y ahora guestGuard) usaban solo "hay un token en localStorage" como
  // sinonimo de sesion valida -- un token vencido pasaba igual y recien fallaba al
  // primer 401 real contra la API. Esto decodifica el JWT (sin verificar firma, eso
  // solo lo puede hacer el backend) y chequea el claim "exp" contra la hora local.
  hasValidSession(): boolean {
    const token = this.getAccessToken();
    return token !== null && !this.isTokenExpired(token);
  }

  private isTokenExpired(token: string): boolean {
    const payload = this.decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') {
      // Sin "exp" decodificable: no podemos asegurar que vencio -- se trata como
      // valido y que el interceptor/401 real corte la sesion si el backend lo rechaza.
      return payload === null;
    }
    return payload.exp * 1000 <= Date.now();
  }

  private decodeJwtPayload(token: string): { exp?: number; role?: string | string[] } | null {
    try {
      const base64Url = token.split('.')[1];
      if (!base64Url) return null;
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null; // token corrupto/no parseable -- tratarlo como invalido
    }
  }

  // E10.5 -- TokenService.cs manda los roles como Claim(ClaimTypes.Role, ...), que el
  // JwtSecurityTokenHandler serializa en el JWT bajo la clave corta "role" (uno solo
  // como string, dos o mas como array -- por eso el chequeo cubre ambos casos).
  private hasRole(role: string): boolean {
    const token = this.getAccessToken();
    if (!token) return false;
    const payload = this.decodeJwtPayload(token);
    if (!payload?.role) return false;
    return Array.isArray(payload.role) ? payload.role.includes(role) : payload.role === role;
  }

  logout(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.isAuthenticated.set(false);
    this.isAdmin.set(false);
  }

  private storeSession(response: VerifyOtpResponse | GoogleLoginResponse): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, response.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
    this.isAuthenticated.set(true);
    this.isAdmin.set(this.hasRole('Admins'));
  }
}
