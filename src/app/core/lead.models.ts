// DTO de PublicLeadEndpoints.cs -- formulario "Solicitar demo" de la landing publica.
export interface CreateLeadRequest {
  name: string;
  businessName?: string | null;
  email: string;
  phone?: string | null;
  message?: string | null;
  source: string;
}
