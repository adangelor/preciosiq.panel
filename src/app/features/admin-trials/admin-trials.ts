import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, switchMap, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminBusinessAccountService } from '../../core/admin-business-account';
import {
  AdminBusinessAccountSummary,
  TRIAL_TIER_OPTIONS,
} from '../../core/admin-business-account.models';

// PreciosIQ E10.5 (18-ago-2026) -- pantalla de admin (solo visible/accesible con el
// rol "Admins", ver core/admin-guard.ts + AdminBusinessAccountEndpoints.cs) para que
// Andres pueda darle a una cadena puntual un trial del plan mas caro por X dias, sin
// tocar la base a mano. Deliberadamente simple (sin tabla de historial, sin
// paginacion): el caso de uso es "unos pocos onboardings a la vez", no una operacion
// masiva -- si eso cambia, esto se puede hacer mas sofisticado despues.
@Component({
  selector: 'app-admin-trials',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './admin-trials.html',
  styleUrl: './admin-trials.scss',
})
export class AdminTrialsComponent {
  private readonly service = inject(AdminBusinessAccountService);
  private readonly querySubject = new Subject<string>();

  protected readonly tierOptions = TRIAL_TIER_OPTIONS;
  protected readonly query = signal('');
  protected readonly results = signal<AdminBusinessAccountSummary[]>([]);
  protected readonly searching = signal(false);

  // Por cuenta: tier/dias elegidos en el mini-form de la fila (por id de cuenta).
  protected readonly selectedTier = signal<Record<number, string>>({});
  protected readonly selectedDays = signal<Record<number, number>>({});
  protected readonly savingId = signal<number | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.querySubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          this.searching.set(true);
          return this.service.search(q);
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (results) => {
          this.searching.set(false);
          this.results.set(results);
        },
        error: () => {
          this.searching.set(false);
          this.errorMessage.set('No se pudo buscar. Intenta de nuevo.');
        },
      });
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    this.querySubject.next(value);
  }

  protected tierFor(accountId: number): string {
    return this.selectedTier()[accountId] ?? 'cadena';
  }

  protected setTierFor(accountId: number, tier: string): void {
    this.selectedTier.update((map) => ({ ...map, [accountId]: tier }));
  }

  protected daysFor(accountId: number): number {
    return this.selectedDays()[accountId] ?? 15;
  }

  protected setDaysFor(accountId: number, days: number): void {
    this.selectedDays.update((map) => ({ ...map, [accountId]: days }));
  }

  protected grantTrial(account: AdminBusinessAccountSummary): void {
    this.savingId.set(account.id);
    this.errorMessage.set(null);
    this.service
      .grantTrial(account.id, { tier: this.tierFor(account.id), days: this.daysFor(account.id) })
      .subscribe({
        next: (updated) => {
          this.savingId.set(null);
          this.replaceResult(updated);
        },
        error: (err) => {
          this.savingId.set(null);
          this.errorMessage.set(err?.error?.error ?? 'No se pudo otorgar el trial.');
        },
      });
  }

  protected revokeTrial(account: AdminBusinessAccountSummary): void {
    this.savingId.set(account.id);
    this.errorMessage.set(null);
    this.service.revokeTrial(account.id).subscribe({
      next: (updated) => {
        this.savingId.set(null);
        this.replaceResult(updated);
      },
      error: (err) => {
        this.savingId.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo quitar el trial.');
      },
    });
  }

  private replaceResult(updated: AdminBusinessAccountSummary): void {
    this.results.update((list) => list.map((a) => (a.id === updated.id ? updated : a)));
  }

  protected isTrialActive(account: AdminBusinessAccountSummary): boolean {
    return !!account.trialTier && !!account.trialExpiresAt && new Date(account.trialExpiresAt) > new Date();
  }
}
