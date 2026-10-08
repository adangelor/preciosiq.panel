import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessAccountService } from '../../core/business-account';
import { BusinessContextService } from '../../core/business-context';
import { BranchResponse } from '../../core/business-account.models';

// E2.3 -- alta de sucursal adicional (2da, 3ra...) para una cuenta ya existente.
//
// E1.9 (16-ago-2026) -- pedido de Andres: businessAccountId ya no se pide a mano (era
// "un campo manual por ahora", segun la nota vieja de este archivo) -- ahora se resuelve
// solo via BusinessContextService, primera cuenta del usuario. Mismo fix que el resto
// del panel (branches-list, csv-import, price-upsert, price-history, instant-benchmark).
@Component({
  selector: 'app-branch-signup',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './branch-signup.html',
  styleUrl: './branch-signup.scss',
})
export class BranchSignupComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly context = inject(BusinessContextService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly businessAccountId = signal<number | null>(null);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly created = signal<BranchResponse | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    branchName: ['', [Validators.required]],
    street: ['', [Validators.required]],
    streetNumber: ['', [Validators.required]],
    city: ['', [Validators.required]],
    provinceCode: ['', [Validators.required]],
    postalCode: ['', [Validators.required]],
  });

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId.set(ctx.account.businessAccountId);
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected submit(): void {
    const businessAccountId = this.businessAccountId();
    if (this.form.invalid || businessAccountId === null) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.created.set(null);

    const value = this.form.getRawValue();
    this.businessAccountService.createBranch({ ...value, businessAccountId }).subscribe({
      next: (branch) => {
        this.submitting.set(false);
        this.created.set(branch);
        this.form.reset();
        // E1.9 -- la proxima vez que alguna pantalla pida el contexto (ej. /sucursales,
        // recien creada esta sucursal), tiene que ver la lista fresca, no la cacheada
        // de antes de este alta.
        this.context.invalidate();
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(
          err?.error?.error ?? 'No se pudo crear la sucursal. Intenta de nuevo en unos minutos.'
        );
      },
    });
  }
}
