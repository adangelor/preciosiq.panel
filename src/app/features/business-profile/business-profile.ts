import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { BusinessAccountService } from '../../core/business-account';
import { BranchListItem, BusinessAccountResponse, resolveLogoUrl } from '../../core/business-account.models';
import { BusinessContextService } from '../../core/business-context';

// E-Cuenta (17-ago-2026) -- pedido de Andres: "otro menu mas que me permita cambiar
// los datos del negocio que cargue en el onboarding: posicionamiento geosatelitario,
// icono del negocio, domicilio, CUIT/CUIT". Reparto:
// - Razon social + Cuit: PATCH /api/business/accounts/{id} (UpdateBusinessAccount, nuevo).
// - Logo: ya existia (fetchLogoFromWebsite/uploadLogo, E1.6) pero solo se usaba en el
//   onboarding -- aca se reusa tal cual, ahora editable despues tambien.
// - Domicilio de la sucursal (calle/numero/ciudad/provincia/CP): PATCH
//   /api/business/branches/{id}/domicilio (UpdateBranchAddress, nuevo). A proposito NO
//   incluye lat/long -- el "posicionamiento geosatelitario" YA tiene su propia pantalla
//   completa (mapa Leaflet + reintentar geocoding) en /sucursales (E2.3), no se duplica
//   aca: se linkea.
@Component({
  selector: 'app-business-profile',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './business-profile.html',
  styleUrl: './business-profile.scss',
})
export class BusinessProfileComponent implements OnInit {
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly context = inject(BusinessContextService);
  private readonly fb = inject(FormBuilder);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly account = signal<BusinessAccountResponse | null>(null);
  protected readonly branches = signal<BranchListItem[]>([]);

  protected resolveLogoUrl = resolveLogoUrl;

  // --- Datos legales (razon social + cuit) ---
  protected readonly legalForm = this.fb.nonNullable.group({
    razonSocial: ['', Validators.required],
    cuit: ['', Validators.required],
  });
  protected readonly savingLegal = signal(false);
  protected readonly legalError = signal<string | null>(null);
  protected readonly legalSuccess = signal(false);

  // --- Logo ---
  protected readonly websiteUrl = signal('');
  protected readonly fetchingLogo = signal(false);
  protected readonly uploadingLogo = signal(false);
  protected readonly logoError = signal<string | null>(null);

  // --- Domicilio ---
  protected readonly selectedBranchId = signal<string | null>(null);
  protected readonly addressForm = this.fb.nonNullable.group({
    branchName: ['', Validators.required],
    street: ['', Validators.required],
    streetNumber: [''],
    city: ['', Validators.required],
    provinceCode: ['', Validators.required],
    postalCode: [''],
  });
  protected readonly savingAddress = signal(false);
  protected readonly addressError = signal<string | null>(null);
  protected readonly addressSuccess = signal(false);

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loading.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.account.set(ctx.account);
        this.branches.set(ctx.branches);
        this.legalForm.patchValue({ razonSocial: ctx.account.razonSocial, cuit: ctx.account.cuit });

        if (ctx.branches.length > 0) {
          this.selectBranch(ctx.branches[0].branchId);
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected selectBranch(branchId: string): void {
    this.selectedBranchId.set(branchId);
    const branch = this.branches().find((b) => b.branchId === branchId);
    if (!branch) return;
    this.addressForm.patchValue({
      branchName: branch.branchName,
      street: branch.street,
      streetNumber: branch.streetNumber,
      city: branch.city,
      provinceCode: branch.provinceCode,
      postalCode: branch.postalCode,
    });
    this.addressSuccess.set(false);
    this.addressError.set(null);
  }

  protected saveLegal(): void {
    const account = this.account();
    if (!account || this.legalForm.invalid) return;

    this.savingLegal.set(true);
    this.legalError.set(null);
    this.legalSuccess.set(false);

    this.businessAccountService.update(account.businessAccountId, this.legalForm.getRawValue()).subscribe({
      next: (updated) => {
        this.savingLegal.set(false);
        this.legalSuccess.set(true);
        this.account.set(updated);
        this.context.invalidate();
      },
      error: (err) => {
        this.savingLegal.set(false);
        this.legalError.set(err?.error?.error ?? 'No se pudo guardar. Probá de nuevo.');
      },
    });
  }

  protected fetchLogo(): void {
    const account = this.account();
    const url = this.websiteUrl().trim();
    if (!account || !url) return;

    this.fetchingLogo.set(true);
    this.logoError.set(null);

    this.businessAccountService.fetchLogoFromWebsite(account.businessAccountId, url).subscribe({
      next: (result) => {
        this.fetchingLogo.set(false);
        this.account.update((a) => (a ? { ...a, logoUrl: result.logoUrl } : a));
        this.context.invalidate();
      },
      error: (err) => {
        this.fetchingLogo.set(false);
        this.logoError.set(err?.error?.error ?? 'No pudimos traer el logo de ese sitio. Probá subirlo a mano.');
      },
    });
  }

  protected onLogoFileSelected(event: Event): void {
    const account = this.account();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!account || !file) return;

    this.uploadingLogo.set(true);
    this.logoError.set(null);

    this.businessAccountService.uploadLogo(account.businessAccountId, file).subscribe({
      next: (result) => {
        this.uploadingLogo.set(false);
        this.account.update((a) => (a ? { ...a, logoUrl: result.logoUrl } : a));
        this.context.invalidate();
        input.value = '';
      },
      error: (err) => {
        this.uploadingLogo.set(false);
        this.logoError.set(err?.error?.error ?? 'No se pudo subir la imagen. Probá con otro archivo.');
        input.value = '';
      },
    });
  }

  protected saveAddress(): void {
    const account = this.account();
    const branchId = this.selectedBranchId();
    if (!account || !branchId || this.addressForm.invalid) return;

    this.savingAddress.set(true);
    this.addressError.set(null);
    this.addressSuccess.set(false);

    this.businessAccountService
      .updateBranchAddress(branchId, { businessAccountId: account.businessAccountId, ...this.addressForm.getRawValue() })
      .subscribe({
        next: (updated) => {
          this.savingAddress.set(false);
          this.addressSuccess.set(true);
          this.branches.update((list) => list.map((b) => (b.branchId === updated.branchId ? updated : b)));
          this.context.invalidate();
        },
        error: (err) => {
          this.savingAddress.set(false);
          this.addressError.set(err?.error?.error ?? 'No se pudo guardar el domicilio. Probá de nuevo.');
        },
      });
  }
}
