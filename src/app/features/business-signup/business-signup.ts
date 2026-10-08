import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { BusinessAccountService } from '../../core/business-account';
import { BusinessAccountResponse, CreateBranchRequest, resolveLogoUrl } from '../../core/business-account.models';
import { BusinessSubscriptionService } from '../../core/business-subscription';
import { BillingCycle, PlanCatalogItem } from '../../core/business-subscription.models';

// E1.5 -- flujo de registro "Soy comerciante". Alta minima: razon social, CUIT y la
// primera sucursal (nombre + direccion basica). El resto (horarios, geocodificacion
// asistida, sucursales adicionales) es E2, no esta pantalla.
//
// E1.6 (16-ago-2026) -- pedido de Andres: circuito de onboarding con logo. Mismo patron
// que ya se uso en DistribucionIQ (productora-signup.ts): "sitio web" es un campo
// opcional del mismo formulario, y apenas se crea la cuenta se dispara un llamado
// best-effort para traer el logo -- nunca bloquea el alta si falla. A diferencia de
// productora-signup, ademas se suma la subida MANUAL de un archivo (pedido explicito:
// "no todos los pequeños comercios tienen un sitio"). Si el comerciante carga los dos,
// gana el archivo subido a mano (mas confiable que un favicon adivinado). Si no carga
// ninguno, la cuenta queda sin logo -- se puede agregar mas adelante, no bloquea nada.
//
// E1.10 (17-ago-2026) -- pedido de Andres: el onboarding tiene que dejar elegir plan,
// no solo caer en Gratis en silencio. CreateBusinessAccount (backend) sigue
// hardcodeando SubscriptionTier = "free" SIEMPRE -- eso no cambia, y es intencional
// (el alta nunca depende de/nunca puede fallar por un checkout de Mercado Pago). Lo
// que agrega esta pantalla es un paso encima: si el comerciante elige un plan pago,
// apenas se crea la cuenta (ya en Gratis) se dispara el mismo flujo de checkout que
// usa UpgradePlanComponent (createCheckout + redirect a Mercado Pago). Si el checkout
// falla o el comerciante elige Gratis, se queda en la pantalla de éxito de siempre --
// la cuenta ya existe en cualquier caso, nunca se pierde el alta por un problema de
// pago.
//
// 25-ago-2026 -- pedido de Andres: (1) el formulario largo no se podia scrollear (el
// scroll del sitio vive adentro del shell, y esta pantalla esta afuera -- eso se arreglo
// en app.scss), y de paso pasa a ser un wizard de cuatro pasos: plan, comercio,
// sucursales, logo+resumen. (2) Se pueden cargar VARIAS sucursales en el alta: la
// primera viaja en CreateBusinessAccount (el backend sigue creando cuenta + una
// sucursal en una sola transaccion, eso no cambia); las demas se crean una por una con
// el mismo POST /business/branches que usa /sucursales/nueva, apenas existe la cuenta
// y ANTES de cualquier redirect a Mercado Pago. Son best-effort: si una falla, se
// informa en la pantalla de exito y se puede volver a cargar desde "Sucursales".
@Component({
  selector: 'app-business-signup',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './business-signup.html',
  styleUrl: './business-signup.scss',
})
export class BusinessSignupComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly subscriptionService = inject(BusinessSubscriptionService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly createdAccount = signal<BusinessAccountResponse | null>(null);

  protected readonly logoStatus = signal<'idle' | 'loading' | 'done' | 'error'>('idle');
  protected readonly logoUrl = signal<string | null>(null);
  protected readonly logoErrorMessage = signal<string | null>(null);
  protected readonly selectedLogoFile = signal<File | null>(null);
  protected readonly logoFileError = signal<string | null>(null);

  // Wizard: paso actual (1..steps.length). Los pasos ya completados se pueden reabrir
  // desde el indicador de arriba; para avanzar el paso actual tiene que estar valido.
  protected readonly steps = [
    { n: 1, label: 'Plan' },
    { n: 2, label: 'Comercio' },
    { n: 3, label: 'Sucursales' },
    { n: 4, label: 'Logo y resumen' },
  ] as const;
  protected readonly step = signal(1);

  // Sucursales extra (2da en adelante) creadas despues de la cuenta: que paso con cada una.
  protected readonly extraBranchResults = signal<{ name: string; ok: boolean; error?: string }[]>([]);

  // E1.10 -- selector de plan en el onboarding. "free" preseleccionado a proposito
  // (ver la decision de dejar el plan Gratis perpetuo, sin tarjeta, como puerta de
  // entrada de menor friccion) -- el comerciante puede cambiarlo antes de crear la cuenta.
  protected readonly plans = signal<PlanCatalogItem[] | null>(null);
  protected readonly selectedTier = signal<string>('free');
  protected readonly billingCycle = signal<BillingCycle>('monthly');
  protected readonly checkoutLoading = signal(false);
  protected readonly checkoutError = signal<string | null>(null);

  protected resolveLogoUrl = resolveLogoUrl;

  private static readonly MaxLogoBytes = 2 * 1024 * 1024; // 2 MB -- mismo limite que el backend (FaviconFetchService)

  private buildBranchGroup() {
    return this.fb.nonNullable.group({
      branchName: ['', [Validators.required]],
      street: ['', [Validators.required]],
      streetNumber: ['', [Validators.required]],
      city: ['', [Validators.required]],
      provinceCode: ['', [Validators.required]],
      postalCode: ['', [Validators.required]],
    });
  }

  protected readonly form = this.fb.nonNullable.group({
    business: this.fb.nonNullable.group({
      razonSocial: ['', [Validators.required, Validators.minLength(2)]],
      cuit: ['', [Validators.required, Validators.pattern(/^\d{10,11}$/)]],
    }),
    branches: this.fb.nonNullable.array([this.buildBranchGroup()]),
    sitioWeb: [''],
  });

  // Atajos para el template (los controles anidados quedan largos de escribir).
  protected get business() {
    return this.form.controls.business;
  }

  protected get branches() {
    return this.form.controls.branches;
  }

  protected addBranch(): void {
    this.branches.push(this.buildBranchGroup());
  }

  protected removeBranch(index: number): void {
    // La primera nunca se quita: el backend exige cuenta + al menos una sucursal.
    if (index === 0) return;
    this.branches.removeAt(index);
  }

  /** Paso 1 (plan) no tiene nada que validar; 4 (logo) es opcional. */
  private stepGroup(step: number) {
    if (step === 2) return this.business;
    if (step === 3) return this.branches;
    return null;
  }

  protected next(): void {
    const group = this.stepGroup(this.step());
    if (group && group.invalid) {
      group.markAllAsTouched();
      return;
    }
    if (this.step() < this.steps.length) {
      this.step.update((s) => s + 1);
      this.scrollToTop();
    }
  }

  protected prev(): void {
    if (this.step() > 1) {
      this.step.update((s) => s - 1);
      this.scrollToTop();
    }
  }

  /** Solo hacia atras (o al actual): los pasos futuros se abren con "Siguiente". */
  protected goToStep(step: number): void {
    if (step >= 1 && step <= this.step()) {
      this.step.set(step);
      this.scrollToTop();
    }
  }

  private scrollToTop(): void {
    // El scroll vive en app-root (ver app.scss), no en window.
    document.querySelector('app-root')?.scrollTo({ top: 0 });
  }

  ngOnInit(): void {
    // Best-effort: si falla, el selector queda vacio y selectedTier() sigue en "free"
    // por default -- el alta funciona igual, solo no se puede elegir un plan pago
    // desde esta pantalla (el comerciante siempre puede subir de plan despues desde
    // "Tu plan" una vez adentro).
    this.subscriptionService.getPlans().subscribe({
      next: (plans) => this.plans.set(plans),
      error: () => this.plans.set([]),
    });
  }

  protected selectTier(tier: string): void {
    this.selectedTier.set(tier);
  }

  protected setBillingCycle(cycle: BillingCycle): void {
    this.billingCycle.set(cycle);
  }

  protected planDisplayName(tier: string): string {
    return this.plans()?.find((p) => p.tier === tier)?.displayName ?? tier;
  }

  protected onLogoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.logoFileError.set(null);

    if (file && file.size > BusinessSignupComponent.MaxLogoBytes) {
      this.selectedLogoFile.set(null);
      input.value = '';
      this.logoFileError.set('El archivo pesa mas de 2 MB. Elegí uno más liviano.');
      return;
    }

    this.selectedLogoFile.set(file);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Mandar a la persona al primer paso con error, en vez de fallar en silencio en
      // el ultimo paso donde no se ve ningun campo en rojo.
      this.step.set(this.business.invalid ? 2 : 3);
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { sitioWeb, business, branches } = this.form.getRawValue();
    const [firstBranch, ...extraBranches] = branches;
    const accountRequest = { ...business, ...firstBranch };

    this.businessAccountService
      .create(accountRequest)
      .pipe(
        concatMap((account) =>
          this.createExtraBranches(account.businessAccountId, extraBranches).pipe(
            map((results) => {
              this.extraBranchResults.set(results);
              return account;
            }),
          ),
        ),
      )
      .subscribe({
        next: (account) => {
          this.submitting.set(false);

          const file = this.selectedLogoFile();
          if (file) {
            this.uploadLogo(account.businessAccountId, file);
          } else if (sitioWeb.trim()) {
            this.fetchLogo(account.businessAccountId, sitioWeb.trim());
          }

          // La cuenta YA quedo creada en "free" (backend, sin condiciones). Si eligieron
          // un plan pago, esto es un paso extra encima -- si falla, cae al mismo lugar
          // que si hubiera elegido Gratis (startCheckout hace el fallback).
          if (this.selectedTier() === 'free') {
            this.createdAccount.set(account);
          } else {
            this.startCheckout(account);
          }
        },
        error: (err) => {
          this.submitting.set(false);
          this.errorMessage.set(
            err?.error?.error ?? 'No se pudo crear la cuenta. Intenta de nuevo en unos minutos.'
          );
        },
      });
  }

  // Sucursales 2..n, en serie (el backend geocodifica cada alta, mejor no pisarlo con
  // todas a la vez). Nunca falla como un todo: cada una resuelve a ok/error propio.
  private createExtraBranches(
    businessAccountId: number,
    extras: Omit<CreateBranchRequest, 'businessAccountId'>[],
  ): Observable<{ name: string; ok: boolean; error?: string }[]> {
    if (extras.length === 0) return of([]);
    return from(extras).pipe(
      concatMap((branch) =>
        this.businessAccountService.createBranch({ ...branch, businessAccountId }).pipe(
          map(() => ({ name: branch.branchName, ok: true })),
          catchError((err) =>
            of({
              name: branch.branchName,
              ok: false,
              error: (err?.error?.error as string | undefined) ?? 'No se pudo crear.',
            }),
          ),
        ),
      ),
      toArray(),
    );
  }

  private startCheckout(account: BusinessAccountResponse): void {
    this.checkoutLoading.set(true);
    this.checkoutError.set(null);

    this.subscriptionService
      .createCheckout(account.businessAccountId, this.selectedTier(), this.billingCycle())
      .subscribe({
        next: (result) => {
          if (result.initPoint) {
            // Sale del SPA -- no hace falta apagar checkoutLoading, la pagina navega.
            window.location.href = result.initPoint;
          } else {
            this.checkoutLoading.set(false);
            this.checkoutError.set(
              'Mercado Pago no devolvió un link de pago. Tu cuenta ya quedó creada en el plan Gratis -- podés subir de plan más tarde desde "Tu plan".'
            );
            this.createdAccount.set(account);
          }
        },
        error: (err) => {
          this.checkoutLoading.set(false);
          this.checkoutError.set(
            err?.error?.error ??
              'No se pudo iniciar el pago. Tu cuenta ya quedó creada en el plan Gratis -- podés subir de plan más tarde desde "Tu plan".'
          );
          this.createdAccount.set(account);
        },
      });
  }

  protected continueToDashboard(): void {
    this.router.navigateByUrl('/dashboard');
  }

  private fetchLogo(businessAccountId: number, websiteUrl: string): void {
    this.logoStatus.set('loading');
    this.logoErrorMessage.set(null);

    this.businessAccountService.fetchLogoFromWebsite(businessAccountId, websiteUrl).subscribe({
      next: (result) => {
        this.logoStatus.set('done');
        this.logoUrl.set(result.logoUrl);
      },
      error: (err) => {
        this.logoStatus.set('error');
        this.logoErrorMessage.set(
          err?.error?.error ?? 'No pudimos traer el logo de ese sitio. Lo podés cargar mas adelante.'
        );
      },
    });
  }

  private uploadLogo(businessAccountId: number, file: File): void {
    this.logoStatus.set('loading');
    this.logoErrorMessage.set(null);

    this.businessAccountService.uploadLogo(businessAccountId, file).subscribe({
      next: (result) => {
        this.logoStatus.set('done');
        this.logoUrl.set(result.logoUrl);
      },
      error: (err) => {
        this.logoStatus.set('error');
        this.logoErrorMessage.set(
          err?.error?.error ?? 'No pudimos guardar esa imagen. Lo podés cargar mas adelante.'
        );
      },
    });
  }
}
