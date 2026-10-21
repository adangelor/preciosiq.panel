import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { BusinessContextService } from './business-context';
import { BranchListItem } from './business-account.models';
import { BusinessSubscriptionService } from './business-subscription';

// BP-178 (21-oct-2026) -- lo que necesitan las pantallas de Gestión (Artículos, Rubros, Proveedores): la cuenta, sus
// sucursales y qué trae el plan. El panel no esconde nada por plan (el 402 lo explica), pero la portada de Gestión dice
// qué plan la trae ANTES de llamar a la API, con los has* de /subscriptions/status (que ya incluyen el trial).
export interface GestionContexto {
  businessAccountId: number;
  branches: BranchListItem[];
  gestionArticulos: boolean;
  gestionStock: boolean;
  formacionPrecios: boolean;
  /** "avanzado", "cadena"… (el efectivo no viene; es el contratado, para el texto). */
  tier: string;
}

@Injectable({ providedIn: 'root' })
export class GestionContextoService {
  private readonly context = inject(BusinessContextService);
  private readonly subscriptions = inject(BusinessSubscriptionService);
  private cache$: Observable<GestionContexto | null> | null = null;

  /** null = todavía no hay comercio. Si el estado del plan no se puede leer, se asume que sí lo trae (decide el 402). */
  load(): Observable<GestionContexto | null> {
    if (!this.cache$) {
      this.cache$ = this.context.load().pipe(
        switchMap((ctx) => {
          if (!ctx) return of(null);
          const id = ctx.account.businessAccountId;
          return this.subscriptions.getStatus(id).pipe(
            map((s) => ({
              businessAccountId: id,
              branches: ctx.branches,
              gestionArticulos: s.hasGestionArticulos ?? false,
              gestionStock: s.hasGestionStock ?? false,
              formacionPrecios: s.hasFormacionPrecios ?? false,
              tier: s.tier,
            })),
            catchError(() =>
              of({ businessAccountId: id, branches: ctx.branches, gestionArticulos: true, gestionStock: true, formacionPrecios: true, tier: '' }),
            ),
          );
        }),
        shareReplay(1),
      );
    }
    return this.cache$;
  }

  invalidate(): void {
    this.cache$ = null;
  }
}
