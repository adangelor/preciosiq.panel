// Espejo de Data/DTOs/CreateBusinessAccountRequest.cs y BusinessAccountResponse.cs
// en Buscaprecios.web. Mantener sincronizado a mano -- no hay generacion automatica
// de tipos entre el backend .NET y este frontend todavia.

import { environment } from '../../environments/environment';

export interface CreateBusinessAccountRequest {
  razonSocial: string;
  cuit: string;
  branchName: string;
  street: string;
  streetNumber: string;
  city: string;
  provinceCode: string;
  postalCode: string;
  latitude?: number | null;
  longitude?: number | null;
}

// logoUrl (E1.6, 16-ago-2026): path RELATIVO servido por wwwroot del backend (ej.
// "/images/BusinessLogos/42.png"), null hasta que la cuenta cargue un logo via
// /logo/from-website o /logo/upload. Mismo campo/patron que ya usa DistribucionIQ
// (ProductoraAccountResponse) -- para mostrarlo hay que anteponerle
// environment.assetsBaseUrl (ver resolveLogoUrl abajo), no apiBaseUrl tal cual.
export interface BusinessAccountResponse {
  businessAccountId: number;
  commerceId: string;
  bannerId: string;
  branchId: string;
  razonSocial: string;
  // E-Cuenta (17-ago-2026) -- vive en Commerce.CommerceTaxId del lado del backend, se
  // suma aca para poder mostrarlo/prefillearlo en "Datos del negocio".
  cuit: string;
  subscriptionTier: string;
  createdAt: string;
  logoUrl: string | null;
}

// E1.6 -- pide el sitio web del comercio para traerle el favicon como logo.
export interface FetchLogoFromWebsiteRequest {
  websiteUrl: string;
}

export interface LogoResponse {
  logoUrl: string;
}

// logoUrl siempre viaja como path relativo (ver comentario arriba) -- este helper le
// antepone environment.assetsBaseUrl para poder usarlo directo en un [src] de <img>.
export function resolveLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  return `${environment.assetsBaseUrl}${logoUrl.replace(/^\//, '')}`;
}

// Espejo de CreateBranchRequest.cs / BranchResponse.cs (E2.1).
export interface CreateBranchRequest {
  businessAccountId: number;
  branchName: string;
  street: string;
  streetNumber: string;
  city: string;
  provinceCode: string;
  postalCode: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface BranchResponse {
  commerceId: string;
  bannerId: string;
  branchId: string;
  branchName: string;
  latitude?: number | null;
  longitude?: number | null;
  geocoded: boolean;
  isPublic: boolean;
}

// Espejo de BranchListItemResponse.cs (E6.3; se le sumaron street/streetNumber/
// provinceCode/postalCode en E-Cuenta 17-ago-2026 para poder prefillear el formulario
// de "Datos del negocio" sin pedir un endpoint aparte).
export interface BranchListItem {
  commerceId: string;
  bannerId: string;
  branchId: string;
  branchName: string;
  street: string;
  streetNumber: string;
  city: string;
  provinceCode: string;
  postalCode: string;
  latitude?: number | null;
  longitude?: number | null;
  isPublic: boolean;
}

// Espejo de UpdateBusinessAccountRequest.cs (E-Cuenta, 17-ago-2026).
export interface UpdateBusinessAccountRequest {
  razonSocial: string;
  cuit: string;
}

// Espejo de UpdateBranchAddressRequest.cs (E-Cuenta, 17-ago-2026). NO incluye lat/long
// -- eso sigue siendo UpdateBranchLocationRequest/RegeocodeBranchRequest, en /sucursales.
export interface UpdateBranchAddressRequest {
  businessAccountId: number;
  branchName: string;
  street: string;
  streetNumber: string;
  city: string;
  provinceCode: string;
  postalCode: string;
}

// Espejo de UpdateBranchVisibilityRequest.cs (E6.3).
export interface UpdateBranchVisibilityRequest {
  businessAccountId: number;
  isPublic: boolean;
}

// Espejo de UpdateBranchLocationRequest.cs / RegeocodeBranchRequest.cs (E2.3, 16-ago-2026).
export interface UpdateBranchLocationRequest {
  businessAccountId: number;
  latitude: number;
  longitude: number;
}

export interface RegeocodeBranchRequest {
  businessAccountId: number;
}
