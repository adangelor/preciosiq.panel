import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

// E1.8 (16-ago-2026) -- pedido explicito de Andres: "si tiene token y es valido, tiene
// que navegar directo al dashboard". Antes, un usuario ya logueado que volvia a la raiz
// del sitio (o a /login, por ejemplo con "atras" del navegador) se quedaba viendo la
// landing publica o el formulario de login de nuevo, en vez de ir directo a su panel.
// Espejo inverso de authGuard: aca el que TIENE sesion valida es el que se redirige (a
// /dashboard), no el que no la tiene.
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.hasValidSession()) {
    return router.createUrlTree(['/dashboard']);
  }

  return true;
};
