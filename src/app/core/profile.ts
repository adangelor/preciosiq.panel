import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';
import { RUTA_CAMBIAR_CONTRASENA } from './auth-guard';
import {
  EnviarConfirmacionResponse,
  UpdateProfilePictureResponse,
  UpdateProfileRequest,
  UserProfileResponse,
} from './profile.models';

// Cliente de IdentityEndpoints.cs -- GET/PUT /api/identity/profile + POST
// /api/identity/profile/picture. Generico de plataforma (mismo backend que ya usa
// StartOtp/VerifyOtp/Register), no especifico de PreciosIQ.
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly profileUrl = `${environment.apiBaseUrl}identity/profile`;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  getProfile(): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(this.profileUrl).pipe(tap((p) => this.revisarCambioObligado(p)));
  }

  // BP-282 (3-nov-2026) -- una sesion que ya estaba abierta cuando el admin blanqueo la contraseña: el perfil (que el
  // menu de cuenta pide en cada pantalla) trae la marca y la manda a "Cambiar contraseña".
  private revisarCambioObligado(p: UserProfileResponse): void {
    if (p.debeCambiarContrasena === undefined) return;   // backend viejo
    const antes = this.auth.debeCambiarContrasena();
    this.auth.marcarDebeCambiar(p.debeCambiarContrasena);
    if (p.debeCambiarContrasena && !antes && !this.router.url.startsWith(RUTA_CAMBIAR_CONTRASENA)) {
      this.router.navigate([RUTA_CAMBIAR_CONTRASENA], { queryParams: { volver: this.router.url } });
    }
  }

  updateProfile(request: UpdateProfileRequest): Observable<UserProfileResponse> {
    return this.http.put<UserProfileResponse>(this.profileUrl, request);
  }

  uploadPicture(file: File): Observable<UpdateProfilePictureResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UpdateProfilePictureResponse>(`${this.profileUrl}/picture`, formData);
  }

  // BP-196 (22-oct-2026) -- manda el mail con el link para confirmar el mail (la marca la decide el backend por el Origin).
  enviarConfirmacionEmail(): Observable<EnviarConfirmacionResponse> {
    return this.http.post<EnviarConfirmacionResponse>(`${environment.apiBaseUrl}identity/confirmar-email/enviar`, null);
  }
}
