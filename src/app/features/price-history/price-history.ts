import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PriceHistoryService } from '../../core/price-history';
import { PriceHistoryPoint } from '../../core/price-history.models';
import { PriceHistoryChartComponent } from '../price-history-chart/price-history-chart';
import { planGateErrorMessage } from '../../core/plan-gate';
import { BusinessContextService } from '../../core/business-context';
import { BranchListItem } from '../../core/business-account.models';

// E7.4 -- pantalla que busca el historial de un producto propio y lo grafica con
// PriceHistoryChartComponent (reusable, pensado tambien para el dashboard E8).
//
// E1.9 (16-ago-2026) -- businessAccountId ya no se pide a mano (queda oculto, resuelto
// solo via BusinessContextService) y branchId paso de texto libre a un <select> con
// nombre de sucursal -- mismo fix que el resto del panel.
@Component({
  selector: 'app-price-history',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PriceHistoryChartComponent],
  templateUrl: './price-history.html',
  styleUrl: './price-history.scss',
})
export class PriceHistoryComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly historyService = inject(PriceHistoryService);
  private readonly context = inject(BusinessContextService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly branches = signal<BranchListItem[]>([]);

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.branches.set(ctx.branches);
        this.form.patchValue({ businessAccountId: ctx.account.businessAccountId });
        if (ctx.branches.length > 0) {
          this.form.patchValue({ branchId: ctx.branches[0].branchId });
        }
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly points = signal<PriceHistoryPoint[] | null>(null);

  // E9.3 -- badge de texto explicito con el origen del ultimo precio (el chart ya
  // codifica el origen por color/tooltip por punto, esto es un resumen legible sin
  // tener que pasar el mouse).
  protected readonly latestSource = computed(() => {
    const pts = this.points();
    if (!pts || pts.length === 0) return null;
    return pts[pts.length - 1].source;
  });

  protected sourceLabel(source: string): string {
    switch (source) {
      case 'sepa': return 'SEPA';
      case 'self_reported': return 'Cargado por vos';
      case 'crowd': return 'Consenso de usuarios';
      default: return source;
    }
  }

  protected readonly form = this.fb.nonNullable.group({
    businessAccountId: [null as number | null, [Validators.required]],
    branchId: ['', [Validators.required]],
    ean: ['', [Validators.required]],
    days: [180, [Validators.required, Validators.min(1), Validators.max(730)]],
  });

  protected search(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { businessAccountId, branchId, ean, days } = this.form.getRawValue();
    this.loading.set(true);
    this.errorMessage.set(null);

    this.historyService.get(businessAccountId!, branchId, ean, days).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.points.set(response.points);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(planGateErrorMessage(err) ?? err?.error?.error ?? 'No se pudo cargar el historial.');
      },
    });
  }
}
