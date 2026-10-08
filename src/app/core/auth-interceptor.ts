import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth';

// Agrega el Bearer token (si hay sesion) a los pedidos hacia nuestra propia API. Cierra
// el TODO que estaba anotado en business-account.ts desde E1.5 -- sin esto, todos los
// endpoints de negocio (RequireAuthorization()) devolvian 401 siempre porque nadie
// generaba ni adjuntaba el token.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getAccessToken();

  if (!token || !req.url.includes('/api/')) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
