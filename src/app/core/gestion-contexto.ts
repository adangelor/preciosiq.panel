import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { BusinessContextService } from './business-context';
import { BranchListItem } from './business-account.models';
import { BusinessSubscriptionService } from './business-subscription';

/**
 * 24-oct-2026 -- Gestión (Artículos, Stock, Rubros, Proveedores, Compras, Libro IVA) queda ESCONDIDA hasta tener
 * 20-30 clientes en PreciosIQ. Con false: no aparece en el menú, la carga masiva no pide las columnas de la ficha y
 * "Cargar precio" no ofrece el alta sin código de barras. Las rutas siguen andando por URL (Formación de precios
 * enlaza a Rubros) y el backend no cambia. Para volver a mostrarla: true (y repasar landing, Tu plan y llms.txt).
 */
export const GESTION_VISIBLE = false;

// BP-178 (21-oct-2026) -- lo que necesitan las pantallas de Gestión (Artículos, Rubros, Proveedores): la cuenta, sus
// sucursales y qué trae el plan. El panel no esconde nada por plan (el 402 lo explica), pero la portada de Gestión dice
// qué plan la trae ANTES de llamar a la API, con los has* de /subscriptions/status (que ya incluyen el trial).
export interface GestionContexto {
  businessAccountId: number;
  branches: BranchListItem[];
  gestionArticulos: boolean;
  gestionStock: boolean;
  formacionPrecios: boolean;
  /** BP-180 -- compras (ficha completa del proveedor, su lista, órdenes, recepción, comprobantes). */
  compras: boolean;
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
              compras: s.hasCompras ?? false,
              tier: s.tier,
            })),
            catchError(() =>
              of({ businessAccountId: id, branches: ctx.branches, gestionArticulos: true, gestionStock: true, formacionPrecios: true, compras: true, tier: '' }),
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
