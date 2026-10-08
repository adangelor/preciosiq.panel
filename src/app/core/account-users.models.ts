// Espejo de Data/DTOs/AccountUserDtos.cs en Buscaprecios.web (E4.7, 16-ago-2026;
// generalizado E-Cuenta 17-ago-2026). Mantener sincronizado a mano, mismo criterio que
// business-account.models.ts. Identico al de distribucioniq.panel -- el backend
// (AccountUsersEndpoints.cs) es el mismo para los dos productos, solo cambia la URL
// base (/api/business/...) que ya es comun.

export interface AccountMemberResponse {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'Owner' | 'Manager';
  createdAt: string;
  isCurrentUser: boolean;
}

export interface AccountInvitationResponse {
  id: number;
  email: string;
  role: 'Owner' | 'Manager';
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface AccountUsersResponse {
  members: AccountMemberResponse[];
  pendingInvitations: AccountInvitationResponse[];
}

export interface InviteMemberRequest {
  email: string;
  role: 'Owner' | 'Manager';
}

// GET /api/business/invitations/{token} -- AllowAnonymous del lado del backend, se
// llama antes de saber si quien mira el link ya esta logueado con el mail correcto.
export interface InvitationPreviewResponse {
  valid: boolean;
  error: string | null;
  razonSocial: string | null;
  email: string | null;
  role: string | null;
}

export interface AcceptInvitationResponse {
  businessAccountId: number;
  razonSocial: string;
}

// Nombre para mostrar de un miembro -- FirstName/LastName pueden venir null (cuenta que
// nacio por OTP sin pedir nombre todavia), en ese caso mostramos el email nomas.
export function memberDisplayName(member: AccountMemberResponse): string {
  const full = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  return full || member.email;
}
