import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BusinessSubscriptionService } from '../../core/business-subscription';
import { BusinessContextService } from '../../core/business-context';
import {
  BillingCycle,
  PlanCatalogItem,
  SubscriptionStatusResponse,
} from '../../core/business-subscription.models';

// E10.4 -- pantalla de upgrade: plan actual + limites consumidos + catalogo de planes
// con boton para pasar a Mercado Pago. El gateo real (E10.2) vive en el backend --
// esta pantalla es solo la puerta de entrada visual, no la unica proteccion.
//
// E10.3b (2026-08-14) -- suma el selector de ciclo (mensual/anual): ahora existen
// preapproval_plan_id reales para los dos ciclos, asi que el checkout crea una
// suscripcion recurrente de verdad en vez de una Preferencia de pago unico.
//
// ADVERTENCIA: el boton "Suscribirme" redirige al checkout de Mercado Pago
// (initPoint) que devuelve el backend. No se probo este flujo de punta a punta contra
// una cuenta real de Mercado Pago -- ver la nota en Services/MercadoPagoService.cs.
//
// E1.9 (16-ago-2026) -- BUG real: esta pantalla se me habia pasado en la primera pasada
// de sacar el "ID de cuenta de negocio" del panel (Andres, con capturas: "¡qué feo!").
// Un grep completo de "ID de cuenta de negocio" sobre TODO src/ confirma que era la
// unica que quedaba. Mismo fix que el resto: se resuelve sola via
// BusinessContextService y carga el plan directo, sin formulario ni boton "Ver mi plan".
@Component({
  selector: 'app-upgrade-plan',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './upgrade-plan.html',
  styleUrl: './upgrade-plan.scss',
})
export class UpgradePlanComponent implements OnInit {
  private readonly subscriptionService = inject(BusinessSubscriptionService);
  private readonly context = inject(BusinessContextService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  private businessAccountId: number | null = null;

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly status = signal<SubscriptionStatusResponse | null>(null);
  protected readonly plans = signal<PlanCatalogItem[] | null>(null);
  protected readonly checkoutLoadingTier = signal<string | null>(null);
  // Ciclo elegido para el checkout -- por default mensual, el comerciante lo puede
  // cambiar a anual antes de apretar "Suscribirme" en cualquiera de los planes pagos.
  protected readonly billingCycle = signal<BillingCycle>('monthly');

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId = ctx.account.businessAccountId;
        this.load();
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected load(): void {
    const businessAccountId = this.businessAccountId;
    if (businessAccountId === null) return;

    this.loading.set(true);
    this.errorMessage.set(null);

    this.subscriptionService.getStatus(businessAccountId).subscribe({
      next: (status) => this.status.set(status),
      error: (err) => this.errorMessage.set(err?.error?.error ?? 'No se pudo cargar el plan de la cuenta.'),
      complete: () => this.loading.set(false),
    });

    this.subscriptionService.getPlans().subscribe({
      next: (plans) => this.plans.set(plans),
      error: () => this.plans.set([]),
    });
  }

  protected setBillingCycle(cycle: BillingCycle): void {
    this.billingCycle.set(cycle);
  }

  protected upgrade(tier: string): void {
    const businessAccountId = this.businessAccountId;
    if (!businessAccountId) return;

    this.checkoutLoadingTier.set(tier);
    this.errorMessage.set(null);

    this.subscriptionService.createCheckout(businessAccountId, tier, this.billingCycle()).subscribe({
      next: (result) => {
        this.checkoutLoadingTier.set(null);
        if (result.initPoint) {
          window.location.href = result.initPoint;
        } else {
          this.errorMessage.set('Mercado Pago no devolvió un link de pago. Probá de nuevo en un momento.');
        }
      },
      error: (err) => {
        this.checkoutLoadingTier.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo iniciar el pago. Intentá de nuevo.');
      },
    });
  }

  protected downgrade(): void {
    const businessAccountId = this.businessAccountId;
    if (!businessAccountId) return;
    if (!confirm('¿Bajar a plan Gratis? Perdés acceso a carga masiva, historial y dashboard completo.')) return;

    this.subscriptionService.downgradeToFree(businessAccountId).subscribe({
      next: () => this.load(),
      error: (err) => this.errorMessage.set(err?.error?.error ?? 'No se pudo cambiar el plan.'),
    });
  }
}
