import { environment } from '../../environments/environment';

// Espejo de Data/DTOs/UserProfileResponse.cs y ViewModels/UpdateProfileRequest.cs en
// Buscaprecios.web (GET/PUT /api/identity/profile, POST /api/identity/profile/picture).
// E-Cuenta (17-ago-2026) -- mismo patron que business-account.models.ts: mantener
// sincronizado a mano. Este endpoint es de plataforma (Identity), no especifico de
// PreciosIQ -- lo mismo existe igual en distribucioniq.panel (duplicado a proposito,
// cada panel es un proyecto Angular independiente).

export interface UserProfileResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
  locationId: number | null;
  roles: string[];
  totalPoints: number | null;
}

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
}

export interface UpdateProfilePictureResponse {
  message: string;
  profilePictureUrl: string;
}

// profilePictureUrl llega como ruta relativa ("/Images/Users/xxx"), igual que
// BusinessAccountResponse.logoUrl -- mismo criterio que resolveLogoUrl de
// business-account.models.ts, pero duplicado aca a proposito: perfil de usuario y
// cuenta de negocio son dos conceptos distintos, no queremos acoplarlos.
export function resolveProfilePictureUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return `${environment.assetsBaseUrl}${url.replace(/^\//, '')}`;
}

// Iniciales para el avatar cuando no hay foto -- primera letra de nombre + apellido, o
// la primera del email si todavia no cargo nombre (cuenta que nacio por OTP/Google sin
// pedirlo).
export function profileInitials(profile: Pick<UserProfileResponse, 'firstName' | 'lastName' | 'email'>): string {
  const first = profile.firstName?.trim()?.[0] ?? '';
  const last = profile.lastName?.trim()?.[0] ?? '';
  const initials = `${first}${last}`.toUpperCase();
  return initials || profile.email?.[0]?.toUpperCase() || '?';
}
