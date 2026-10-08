import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

// E10.5 (18-ago-2026) -- guarda de UI para /admin/cuentas (pantalla de trials). NO es
// la seguridad real -- eso lo hace AdminBusinessAccountEndpoints.cs con la policy
// "AdminsOnly" en el backend, que revalida el rol server-side en cada request. Esto
// solo evita que alguien sin el rol "Admins" vea la pantalla y se lleve un 403 al
// primer click -- lo manda derecho a /dashboard.
export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAdmin()) {
    return true;
  }

  return router.createUrlTree(['/dashboard']);
};
