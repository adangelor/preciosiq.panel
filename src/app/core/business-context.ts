import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, switchMap } from 'rxjs/operators';
import { BusinessAccountService } from './business-account';
import { BranchListItem, BusinessAccountResponse } from './business-account.models';

export interface BusinessContext {
  account: BusinessAccountResponse;
  branches: BranchListItem[];
}

// E1.9 (16-ago-2026) -- pedido de Andres: "¿ID de cuenta de negocio? De nuevo... y casi
// todas las pantallas lo tienen". El mismo bug de UX que ya se habia arreglado en
// benchmark-dashboard.ts (E1.7 -- pedir el businessAccountId/branchId a mano, en texto
// plano, como si fuera una pantalla de debugging) estaba repetido en TODAS las demas
// pantallas del panel (branch-signup, branches-list, csv-import, price-upsert,
// price-history, instant-benchmark). Este service centraliza la resolucion de "cual es
// mi cuenta y que sucursales tiene" UNA sola vez por sesion de panel (shareReplay), en
// vez de repetir el mismo par de llamadas (getMine + listBranches) en cada pantalla.
//
// Mismo criterio que ya usaba benchmark-dashboard: sin selector de cuenta todavia, se
// asume la primera cuenta que devuelve GET /me.
@Injectable({ providedIn: 'root' })
export class BusinessContextService {
  private readonly accountService = inject(BusinessAccountService);
  private context$: Observable<BusinessContext | null> | null = null;

  // null = el usuario todavia no dio de alta ningun comercio (distinto de un error de
  // red/servidor, que el Observable lo propaga como error -- cada pantalla decide como
  // mostrarlo, igual que ya hacia benchmark-dashboard).
  load(): Observable<BusinessContext | null> {
    if (!this.context$) {
      this.context$ = this.accountService.getMine().pipe(
        switchMap((accounts) => {
          if (accounts.length === 0) return of(null);

          const account = accounts[0];
          return this.accountService
            .listBranches(account.businessAccountId)
            .pipe(map((branches): BusinessContext => ({ account, branches })));
        }),
        shareReplay(1),
      );
    }
    return this.context$;
  }

  // Se llama despues de un alta de sucursal (o de cualquier cambio que la proxima
  // pantalla necesite ver fresco) para que el cache compartido no quede pisado con
  // datos viejos -- la proxima vez que alguna pantalla pida load(), vuelve a pedirle
  // todo al backend.
  invalidate(): void {
    this.context$ = null;
  }
}
