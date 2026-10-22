import { Injectable, inject, signal } from '@angular/core';
import { catchError, of, switchMap } from 'rxjs';
import { BusinessContextService } from './business-context';
import { BusinessSubscriptionService } from './business-subscription';
import { SubscriptionStatusResponse } from './business-subscription.models';
import { ProfileService } from './profile';

// BP-196 (22-oct-2026) -- lo que los carteles de arriba del panel necesitan saber: el estado del cobro de la cuenta
// (gracia, link pendiente) y si el usuario confirmo su mail. Se pide UNA vez por sesion; la pantalla de plan llama a
// refrescar() despues de un pago o un cambio. Si algo falla, los carteles simplemente no aparecen (no rompen el panel).
@Injectable({ providedIn: 'root' })
export class AvisosCuentaService {
  private readonly context = inject(BusinessContextService);
  private readonly subscriptions = inject(BusinessSubscriptionService);
  private readonly profile = inject(ProfileService);

  readonly estado = signal<SubscriptionStatusResponse | null>(null);
  readonly emailSinConfirmar = signal<string | null>(null); // el mail, si falta confirmarlo
  readonly businessAccountId = signal<number | null>(null);
  private cargado = false;

  cargar(): void {
    if (this.cargado) return;
    this.cargado = true;
    this.refrescar();
  }

  refrescar(): void {
    this.context.load().pipe(
      switchMap((ctx) => {
        if (!ctx) return of(null);
        this.businessAccountId.set(ctx.account.businessAccountId);
        return this.subscriptions.getStatus(ctx.account.businessAccountId);
      }),
      catchError(() => of(null)),
    ).subscribe((s) => this.estado.set(s));

    this.profile.getProfile().pipe(catchError(() => of(null))).subscribe((p) =>
      this.emailSinConfirmar.set(p && p.emailConfirmado === false ? p.email : null),
    );
  }
}
