import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessBenchmarkService } from '../../core/business-benchmark';
import { BenchmarkCategoryResult, InstantBenchmarkResponse } from '../../core/business-benchmark.models';
import { BusinessContextService } from '../../core/business-context';
import { BenchmarkPreferencesService } from '../../core/benchmark-preferences';
import { BranchListItem } from '../../core/business-account.models';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { RadiusAdvisorComponent } from '../../layout/radius-advisor/radius-advisor';

// E3.4 -- pantalla "aha moment": el comerciante ve como esta parado contra la
// competencia sin haber cargado nada previo (E3.1), agrupado por categoria/subcategoria
// real de la base (dbo.Categories/dbo.Subcategories via dbo.ProductCategoryMaps, E3.2).
// Categorias con menos de 3 competidores distintos muestran "cobertura insuficiente"
// en vez de un numero (E3.3/E8.5) -- el backend ya viaja sin el precio en ese caso,
// aca solo se decide como se lo comunica.
//
// E1.9 (16-ago-2026) -- businessAccountId ya no se pide a mano (queda oculto, resuelto
// solo via BusinessContextService) y branchId paso de texto libre a un <select> con
// nombre de sucursal -- mismo fix que el resto del panel.
interface BenchmarkCategoryGroup {
  key: string;
  total: BenchmarkCategoryResult;
  children: BenchmarkCategoryResult[];
}

type BenchmarkSortColumn = 'categoryName' | 'competitorCount' | 'ownAvgPrice' | 'competitorAvgPrice' | 'delta';

@Component({
  selector: 'app-instant-benchmark',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet, LoadingBarComponent, RadiusAdvisorComponent],
  templateUrl: './instant-benchmark.html',
  styleUrl: './instant-benchmark.scss',
})
export class InstantBenchmarkComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly benchmarkService = inject(BusinessBenchmarkService);
  private readonly context = inject(BusinessContextService);
  private readonly prefs = inject(BenchmarkPreferencesService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly branches = signal<BranchListItem[]>([]);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<InstantBenchmarkResponse | null>(null);

  // 25-ago-2026 -- pedido de Andres: tabla agrupada (categoría desplegable -> sus
  // subcategorías), con buscador y paginada de a pageSize categorías. Todo en memoria:
  // el backend ya devuelve el total de cada categoría (isCategoryTotal) y sus hojas.
  protected readonly pageSize = 10;
  protected readonly page = signal(1);
  protected readonly filterText = signal('');
  private readonly openKeys = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed<BenchmarkCategoryGroup[]>(() => {
    const rows = this.result()?.categories ?? [];
    const byCategory = new Map<string, BenchmarkCategoryGroup>();
    const order: string[] = [];
    for (const row of rows) {
      let g = byCategory.get(row.categoryId);
      if (!g) {
        // Si una categoría viniera sin fila total (no debería), el primer hijo hace de
        // cabecera: el nombre de categoría es el mismo.
        g = { key: row.categoryId, total: row, children: [] };
        byCategory.set(row.categoryId, g);
        order.push(row.categoryId);
      }
      if (row.isCategoryTotal) {
        g.total = row;
      } else {
        g.children.push(row);
      }
    }
    return order.map((k) => byCategory.get(k)!);
  });

  // Orden por columna (pedido de Andres). 'default' = como lo manda el backend. Ordena
  // las categorías por su fila total y, adentro de cada una, sus subcategorías con el
  // mismo criterio. Los "—" (sin dato) van siempre al final, suba o baje el orden.
  protected readonly sortColumn = signal<BenchmarkSortColumn | 'default'>('default');
  protected readonly sortDirection = signal<'asc' | 'desc'>('desc');

  private sortValue(row: BenchmarkCategoryResult, column: BenchmarkSortColumn): number | string | null {
    switch (column) {
      case 'categoryName':
        return (row.isCategoryTotal ? row.categoryName : row.subcategoryName ?? row.categoryName).toLowerCase();
      case 'competitorCount':
        return row.competitorCount;
      case 'ownAvgPrice':
        return row.ownAvgPrice;
      case 'competitorAvgPrice':
        return row.sufficientCoverage ? row.competitorAvgPrice : null;
      case 'delta':
        return row.deltaVsCompetitorsPct;
    }
  }

  private sortRows<T>(items: T[], pick: (item: T) => BenchmarkCategoryResult): T[] {
    const column = this.sortColumn();
    if (column === 'default') return items;
    const mult = this.sortDirection() === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = this.sortValue(pick(a), column);
      const vb = this.sortValue(pick(b), column);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'es') * mult;
      return ((va as number) - (vb as number)) * mult;
    });
  }

  protected readonly filteredGroups = computed(() => {
    const q = this.filterText().trim().toLowerCase();
    const base = q
      ? this.groups().filter(
          (g) =>
            g.total.categoryName.toLowerCase().includes(q) ||
            g.children.some((c) => (c.subcategoryName ?? '').toLowerCase().includes(q)),
        )
      : this.groups();
    return this.sortRows(base, (g) => g.total).map((g) => ({
      ...g,
      children: this.sortRows(g.children, (c) => c),
    }));
  });

  protected toggleSort(column: BenchmarkSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set(column === 'categoryName' ? 'asc' : 'desc');
    }
    this.page.set(1);
  }

  protected sortIcon(column: BenchmarkSortColumn): string {
    if (this.sortColumn() !== column) return 'fa-sort sort-icon sort-icon--idle';
    return this.sortDirection() === 'asc' ? 'fa-sort-up sort-icon' : 'fa-sort-down sort-icon';
  }

  protected ariaSort(column: BenchmarkSortColumn): string | null {
    if (this.sortColumn() !== column) return null;
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredGroups().length / this.pageSize)),
  );

  protected readonly pagedGroups = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.filteredGroups().slice(start, start + this.pageSize);
  });

  protected setFilter(value: string): void {
    this.filterText.set(value);
    this.page.set(1);
  }

  protected goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
  }

  protected isOpen(key: string): boolean {
    // Con filtro activo se abren todas: si buscaste "alfajores" querés ver la subcategoría.
    return this.filterText().trim() !== '' || this.openKeys().has(key);
  }

  protected toggle(key: string): void {
    this.openKeys.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected readonly form = this.fb.nonNullable.group({
    businessAccountId: [null as number | null, [Validators.required]],
    branchId: ['', [Validators.required]],
    maxDistanceMeters: [3000, [Validators.required, Validators.min(200), Validators.max(20000)]],
  });

  // 25-ago-2026 -- para el asesor de radio: la sucursal elegida (sus coordenadas) y el
  // radio tipeado, como signals a partir del formulario.
  protected readonly ownCommerceId = signal<string | null>(null);
  private readonly branchIdValue = toSignal(this.form.controls.branchId.valueChanges, {
    initialValue: this.form.controls.branchId.value,
  });
  protected readonly radiusValue = toSignal(this.form.controls.maxDistanceMeters.valueChanges, {
    initialValue: this.form.controls.maxDistanceMeters.value,
  });
  protected readonly selectedBranch = computed(
    () => this.branches().find((b) => b.branchId === this.branchIdValue()) ?? null,
  );

  // Radio guardado para la sucursal elegida (ver BenchmarkPreferencesService). Al
  // cambiar de sucursal se aplica el suyo; si no tiene, el asesor sugiere uno solo.
  protected readonly hasSavedRadius = computed(() => {
    const id = this.branchIdValue();
    return !!id && this.prefs.getRadius(id) !== null;
  });

  protected applyRadius(radius: number): void {
    this.form.patchValue({ maxDistanceMeters: radius });
  }

  private applySavedRadius(branchId: string): void {
    const saved = this.prefs.getRadius(branchId);
    if (saved !== null) this.form.patchValue({ maxDistanceMeters: saved });
  }

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.branches.set(ctx.branches);
        this.ownCommerceId.set(ctx.account.commerceId);
        this.form.patchValue({ businessAccountId: ctx.account.businessAccountId });
        if (ctx.branches.length > 0) {
          this.form.patchValue({ branchId: ctx.branches[0].branchId });
          this.applySavedRadius(ctx.branches[0].branchId);
        }
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
    this.form.controls.branchId.valueChanges.subscribe((branchId) => {
      if (branchId) this.applySavedRadius(branchId);
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();

    this.loading.set(true);
    this.errorMessage.set(null);
    this.result.set(null);

    this.benchmarkService.getInstant(businessAccountId!, branchId, maxDistanceMeters).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.result.set(response);
        this.page.set(1);
        this.filterText.set('');
        this.openKeys.set(new Set());
        this.sortColumn.set('default');
        // Corrio bien con este radio: queda como preferencia de la sucursal.
        this.prefs.saveRadius(branchId, maxDistanceMeters);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(
          err?.error?.error ?? 'No se pudo calcular el benchmark. Intenta de nuevo en unos minutos.',
        );
      },
    });
  }

  protected deltaLabel(row: BenchmarkCategoryResult): string {
    if (row.deltaVsCompetitorsPct === null) return '—';
    const pct = (row.deltaVsCompetitorsPct * 100).toFixed(1);
    return row.deltaVsCompetitorsPct > 0 ? `+${pct}% más caro` : `${pct}% más barato`;
  }

  protected deltaClass(row: BenchmarkCategoryResult): string {
    if (row.deltaVsCompetitorsPct === null) return '';
    return row.deltaVsCompetitorsPct > 0 ? 'delta--above' : 'delta--below';
  }
}
