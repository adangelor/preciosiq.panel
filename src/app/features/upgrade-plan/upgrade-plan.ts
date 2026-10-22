import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AvisosCuentaService } from '../../core/avisos-cuenta';
import { BusinessSubscriptionService } from '../../core/business-subscription';
import { BusinessContextService } from '../../core/business-context';
import {
  BillingCycle,
  CreateCheckoutResponse,
  PlanCatalogItem,
  SubscriptionStatusResponse,
} from '../../core/business-subscription.models';
import { accionDeCobro, pagoDeLaUrl, pesos } from '../../core/cobro';

// E10.4 -- pantalla de plan: plan actual + catalogo de planes. El gateo real (E10.2) vive en el backend -- esta
// pantalla es solo la puerta de entrada visual, no la unica proteccion.
//
// E1.9 (16-ago-2026) -- se resuelve sola via BusinessContextService (sin pedir el "ID de cuenta de negocio").
//
// BP-196 (22-oct-2026) -- el cobro pasa de Mercado Pago a Nave (Galicia). Nave no tiene debito automatico: cada
// periodo es un cobro con su link (el backend lo genera solo antes del vencimiento y lo manda por mail). Esta pantalla:
//   - pide un plan: alta o subida -> va a pagar a Nave; bajar o cambiar de ciclo -> queda programado para el
//     vencimiento (mensaje, sin pagar nada ahora);
//   - muestra "Tu cobro": el pago pendiente (con el motivo del ultimo rechazo), el cambio programado (con la opcion de
//     quedarse en el plan) y "pagar el proximo periodo";
//   - al volver de Nave (/plan?pago=123) espera hasta 30 s a que el pago se acredite.
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
  private readonly avisos = inject(AvisosCuentaService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  private businessAccountId: number | null = null;

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly infoMessage = signal<string | null>(null);
  protected readonly status = signal<SubscriptionStatusResponse | null>(null);
  protected readonly plans = signal<PlanCatalogItem[] | null>(null);
  protected readonly checkoutLoadingTier = signal<string | null>(null);
  protected readonly accionEnCurso = signal<string | null>(null); // 'pagar' | 'adelantado' | 'quedarme' | 'baja'
  protected readonly esperandoPago = signal(false);
  // Ciclo elegido para el checkout -- por default mensual.
  protected readonly billingCycle = signal<BillingCycle>('monthly');

  protected readonly cobro = computed(() => this.status()?.cobro ?? null);
  protected readonly pesos = pesos;

  ngOnInit(): void {
    const pagoQueVuelve = pagoDeLaUrl(window.location.search);
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId = ctx.account.businessAccountId;
        this.load();
        if (pagoQueVuelve) this.esperarPago(pagoQueVuelve);
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

  // Alta, subida (va a pagar) o bajada / cambio de ciclo (programado para el vencimiento).
  protected upgrade(tier: string): void {
    const businessAccountId = this.businessAccountId;
    if (!businessAccountId) return;
    this.checkoutLoadingTier.set(tier);
    this.limpiarMensajes();
    this.subscriptionService.createCheckout(businessAccountId, tier, this.billingCycle()).subscribe({
      next: (r) => {
        this.checkoutLoadingTier.set(null);
        this.resolver(r);
      },
      error: (err) => {
        this.checkoutLoadingTier.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo iniciar el pago. Intentá de nuevo.');
      },
    });
  }

  protected pagarPendiente(): void {
    this.accion('pagar', (id) => this.subscriptionService.pagar(id));
  }

  protected pagarAdelantado(): void {
    this.accion('adelantado', (id) => this.subscriptionService.pagarAdelantado(id));
  }

  // Deshacer un cambio programado: pedir el plan y el ciclo que ya tiene.
  protected quedarme(): void {
    const s = this.status();
    if (!s) return;
    this.accion('quedarme', (id) => this.subscriptionService.createCheckout(id, s.tier, s.billingCycle ?? 'monthly'));
  }

  protected downgrade(): void {
    if (!confirm('¿Pasar al plan Gratis? Si tenés un período pago, tu plan sigue hasta que vence y después pasa a Gratis. No se borra nada.')) return;
    this.accion('baja', (id) => this.subscriptionService.downgradeToFree(id));
  }

  private accion(nombre: string, llamada: (id: number) => Observable<CreateCheckoutResponse>): void {
    const id = this.businessAccountId;
    if (!id) return;
    this.accionEnCurso.set(nombre);
    this.limpiarMensajes();
    llamada(id).subscribe({
      next: (r) => {
        this.accionEnCurso.set(null);
        this.resolver(r);
      },
      error: (err) => {
        this.accionEnCurso.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo completar. Intentá de nuevo.');
      },
    });
  }

  private resolver(r: CreateCheckoutResponse): void {
    const accion = accionDeCobro(r);
    if (accion.tipo === 'pagar') {
      window.location.href = accion.url;
      return;
    }
    if (accion.tipo === 'mensaje') {
      this.infoMessage.set(accion.texto);
      this.load();
      this.avisos.refrescar();
      return;
    }
    this.errorMessage.set(accion.texto);
  }

  // Vuelve de Nave con ?pago=123: el webhook puede tardar unos segundos. Se consulta el estado cada 3 s, hasta 30 s,
  // hasta que ese cobro deja de estar pendiente.
  private esperarPago(pago: number): void {
    history.replaceState(null, '', window.location.pathname); // que un F5 no lo vuelva a esperar
    this.esperandoPago.set(true);
    let vueltas = 0;
    const timer = setInterval(() => {
      const id = this.businessAccountId;
      if (!id) return;
      vueltas++;
      this.subscriptionService.getStatus(id).subscribe({
        next: (s) => {
          if (s.cobro?.cobroPendiente?.paymentId !== pago) {
            clearInterval(timer);
            this.esperandoPago.set(false);
            this.status.set(s);
            this.infoMessage.set('¡Listo! Recibimos tu pago.');
            this.avisos.refrescar();
          } else if (vueltas >= 10) {
            clearInterval(timer);
            this.esperandoPago.set(false);
            this.status.set(s);
            this.infoMessage.set(s.cobro?.ultimoRechazo
              ? `El pago no se completó. ${s.cobro.ultimoRechazo}`
              : 'Tu pago se está procesando. Puede tardar unos minutos en verse acá; te avisamos por mail.');
          }
        },
      });
    }, 3000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  private limpiarMensajes(): void {
    this.errorMessage.set(null);
    this.infoMessage.set(null);
  }

  protected nombreCiclo(c: string | null | undefined): string {
    return c === 'annual' ? 'anual' : 'mensual';
  }

  protected nombreTipo(t: string): string {
    return t === 'renovacion' ? 'el próximo período' : t === 'cambio' ? 'la diferencia por el cambio de plan' : 'tu plan';
  }
}
