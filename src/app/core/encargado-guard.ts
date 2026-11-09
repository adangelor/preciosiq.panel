import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { BusinessContextService } from './business-context';

// BP-226 (8-nov-2026) -- el Encargado de sucursal ve "Mis tareas" y los carteles de su sucursal. Si entra por URL a otra
// pantalla, va a "Mis tareas" con un aviso amable (?fuera=1). Es una ayuda de la interfaz: el 403 lo da el backend
// (CandadoDeEncargados).
export const ROL_ENCARGADO = 'Encargado';
const PERMITIDAS = ['/mis-tareas', '/carteles', '/perfil', '/invitacion'];

export const encargadoGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  return inject(BusinessContextService).load().pipe(
    map((ctx) => {
      if (ctx?.account.rol !== ROL_ENCARGADO) return true;
      if (PERMITIDAS.some((p) => state.url === p || state.url.startsWith(p + '/') || state.url.startsWith(p + '?'))) return true;
      return router.createUrlTree(['/mis-tareas'], { queryParams: { fuera: 1 } });
    }),
    catchError(() => of(true)),
  );
};
