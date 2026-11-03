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

// BP-282 (3-nov-2026) -- si el admin le blanqueo la contraseña, no deja pasar de "Cambiar contraseña" hasta que elija
// una propia. Va como canActivate (la primera entrada) y canActivateChild del shell (la navegacion entre pantallas).
// Es una ayuda de la interfaz: la API no frena nada mientras tanto.
export const RUTA_CAMBIAR_CONTRASENA = '/perfil/cambiar-contrasena';

export const cambioObligadoGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  if (!authService.debeCambiarContrasena() || state.url.startsWith(RUTA_CAMBIAR_CONTRASENA)) return true;
  return inject(Router).createUrlTree([RUTA_CAMBIAR_CONTRASENA], { queryParams: { volver: state.url } });
};
