import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

// Sin esto, cualquier ruta protegida (alta de comercio, dashboard, etc.) se renderizaba
// igual y recien fallaba al primer POST/GET con 401 -- ahora manda directo a /login si
// no hay sesion.
//
// E1.8 (16-ago-2026) -- hasValidSession() en vez de getAccessToken(): un token vencido
// (presente en localStorage pero con "exp" pasado) antes pasaba el guard igual y recien
// fallaba en el primer request real. Ahora un token vencido manda a /login como si no
// hubiera sesion.
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.hasValidSession()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};
