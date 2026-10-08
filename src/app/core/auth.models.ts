// DTOs de IdentityEndpoints.cs (StartOtp/VerifyOtp) -- el mismo login sin contraseña
// que ya usa la app de consumidores de BuscaPrecios. No hay endpoint de "password
// login": todo pasa por un codigo de 6 digitos mandado por mail.

export interface StartOtpRequest {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface StartOtpResponse {
  message: string;
  success: boolean;
}

export interface VerifyOtpRequest {
  email: string;
  otp: string;
}

export interface UserProfileResponse {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
  locationId?: number | null;
  roles?: string[];
  totalPoints?: number;
}

export interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  user: UserProfileResponse;
}

// GoogleAuthEndpoints.cs -- mismo endpoint que ya usa la app movil. El backend valida el
// ID token contra Google:WebClientId y devuelve exactamente la misma forma que VerifyOtp.
export interface GoogleLoginRequest {
  idToken: string;
}

export type GoogleLoginResponse = VerifyOtpResponse;

// Login estandar (E-Auth, 15-ago-2026) -- email + contraseña, en paralelo al OTP de
// arriba (Andres decidio quedarse con los dos: OTP para la app movil, y en la web
// tambien lo dejamos como alternativa). IdentityEndpoints.cs: Register/PasswordLogin/
// ForgotPassword/ResetPassword.
export interface RegisterRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export type RegisterResponse = VerifyOtpResponse;

export interface PasswordLoginRequest {
  email: string;
  password: string;
}

export type PasswordLoginResponse = VerifyOtpResponse;

export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  success: boolean;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

export interface ResetPasswordResponse {
  message: string;
  success: boolean;
}

