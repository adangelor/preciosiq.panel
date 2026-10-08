import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { BusinessBenchmarkService } from '../../core/business-benchmark';
import { BenchmarkCategoryResult } from '../../core/business-benchmark.models';
import { BenchmarkTrendService } from '../../core/benchmark-trend';
import { BenchmarkTrendPoint, CategoryProductDetailItem } from '../../core/benchmark-trend.models';
import {
  BenchmarkDetailDialogComponent,
  BenchmarkDetailDialogData,
  ProductDetailRow,
  ProductSortColumn,
} from './benchmark-detail-dialog';
import { AdvisorReportDialogComponent, AdvisorReportDialogData } from './advisor-report-dialog';
import { planGateErrorMessage } from '../../core/plan-gate';
import { BusinessAccountService } from '../../core/business-account';
import { BranchListItem } from '../../core/business-account.models';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { toSignal } from '@angular/core/rxjs-interop';
import { RadiusAdvisorComponent } from '../../layout/radius-advisor/radius-advisor';
import { BenchmarkPreferencesService } from '../../core/benchmark-preferences';
import { BrandLabelPipe } from '../../core/brand-label';

export type CategorySortColumn = 'categoryName' | 'competitorCount' | 'delta' | 'ownProducts' | 'zoneProducts' | 'matched';

// Vista por productos ("la bomba" punto 3): columnas ordenables de la tabla plana.
export type FlatSortColumn = 'description' | 'category' | 'ownPrice' | 'delta' | 'family';

// Fila de la vista por productos: el detalle por producto + a que categoria pertenece
// (viene del backend desde la v2 de category-detail) + los derivados de precio de
// referencia/diferencia que ya se calculaban para el dialog.
export interface FlatProductRow extends ProductDetailRow {}

// E8.3/E8.4 -- dashboard completo: indice general por categoria (E3), tendencia
// historica de la categoria elegida (E8.1/E8.2) y detalle producto por producto
// (E8.1), con estados vacios explicitos en cada seccion (E8.4).
//
// v3 (21-ago-2026) -- "LA BOMBA" (pedido de Andres, los 4 puntos):
//   1. Navegacion jerarquica: el panel inicial muestra las CATEGORIAS (las 17
//      canonicas post-aplanamiento, filas isCategoryTotal de la SP v3); clickear una
//      hace drilldown a sus subcategorias (filas hoja), y clickear una subcategoria
//      abre el detalle por producto de siempre (dialog con tendencia + productos).
//      Breadcrumb arriba de la tabla para volver.
//   2. El export a Excel ahora suma una hoja "Productos" (tabla producto por
//      producto, catalogo completo del radio via getAllProductsDetail), ademas de
//      las hojas "Categorias" y "Subcategorias".
//   3. Toggle de vista: "Por categoria" (la jerarquia de 1) / "Por producto" (tabla
//      plana de todos los productos con buscador, ordenable; cada fila tiene "Ver
//      categoria" que salta a la vista jerarquica ya drilleada en su categoria).
//   4. Numerales nuevos en las dos tablas jerarquicas: "Tus productos"
//      (ownProductCount) y "Productos en zona" (zoneProductCount, EANs distintos de
//      la competencia) -- ambos ordenables como cualquier otra columna.
//
// E1.7 (16-ago-2026) -- BUG real marcado por Andres: "¿Qué carajo quiere decir 'ID de
// cuenta de negocio'?" -- el formulario pedia el businessAccountId y el branchId a
// mano. Ahora se resuelven solos con BusinessAccountService (ver resolveContext).
@Component({
  selector: 'app-benchmark-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LoadingBarComponent, RadiusAdvisorComponent, BrandLabelPipe],
  templateUrl: './benchmark-dashboard.html',
  styleUrl: './benchmark-dashboard.scss',
})
export class BenchmarkDashboardComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly benchmarkService = inject(BusinessBenchmarkService);
  private readonly trendService = inject(BenchmarkTrendService);
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly dialog = inject(MatDialog);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  // E1.8 -- distingue "todavia no diste de alta tu comercio" de un error real.
  protected readonly noAccountYet = signal(false);
  protected readonly branches = signal<BranchListItem[] | null>(null);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly categories = signal<BenchmarkCategoryResult[] | null>(null);
  protected readonly selectedCategory = signal<BenchmarkCategoryResult | null>(null);

  protected readonly trendPoints = signal<BenchmarkTrendPoint[] | null>(null);
  protected readonly products = signal<CategoryProductDetailItem[] | null>(null);
  protected readonly loadingDetail = signal(false);

  // ==========================================================================
  // v3.1 -- navegacion jerarquica.
  // ==========================================================================
  // 'categorias' = jerarquia (categorias -> subcategorias -> dialog de productos);
  // 'productos'  = tabla plana de todos los productos con buscador.
  protected readonly viewMode = signal<'categorias' | 'productos'>('categorias');

  // null = raiz (las categorias); seteado = drilldown en ESA categoria.
  protected readonly drillCategoryId = signal<string | null>(null);

  // La SP v3 devuelve los dos niveles juntos, separados por flag (isCategoryTotal) --
  // NO por subcategoryId null, que tambien aparece en hojas legitimas.
  protected readonly categoryTotals = computed<BenchmarkCategoryResult[]>(
    () => (this.categories() ?? []).filter((c) => c.isCategoryTotal),
  );
  protected readonly leafRows = computed<BenchmarkCategoryResult[]>(
    () => (this.categories() ?? []).filter((c) => !c.isCategoryTotal),
  );

  // Lo que muestra la tabla jerarquica segun el nivel: raiz = totales de categoria;
  // drilleado = las hojas (subcategorias) de la categoria elegida.
  protected readonly currentLevelRows = computed<BenchmarkCategoryResult[]>(() => {
    const drill = this.drillCategoryId();
    if (drill === null) return this.categoryTotals();
    return this.leafRows().filter((c) => c.categoryId === drill);
  });

  protected readonly drillCategoryName = computed<string | null>(() => {
    const drill = this.drillCategoryId();
    if (drill === null) return null;
    return this.categoryTotals().find((c) => c.categoryId === drill)?.categoryName ?? drill;
  });

  protected drillInto(category: BenchmarkCategoryResult): void {
    this.drillCategoryId.set(category.categoryId);
    this.categoryPage.set(1);
    this.categorySortColumn.set('default');
  }

  protected drillBack(): void {
    this.drillCategoryId.set(null);
    this.categoryPage.set(1);
    this.categorySortColumn.set('default');
  }

  // 16-ago-2026 -- el detalle (tendencia + productos) va en POPUP; paginado en las
  // dos tablas para no escrolear de mas.
  protected readonly categoryPageSize = 15;
  protected readonly categoryPage = signal(1);
  protected readonly categoryTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.currentLevelRows().length / this.categoryPageSize)),
  );

  // 19-ago-2026 -- orden por cualquier columna; v3 suma 'ownProducts'/'zoneProducts'
  // (pedido de Andres: "que me permita ordenar tambien por ese criterio, ¿eh?").
  protected readonly categorySortColumn = signal<CategorySortColumn | 'default'>('default');
  protected readonly categorySortDirection = signal<'asc' | 'desc'>('desc');

  protected readonly sortedCategories = computed<BenchmarkCategoryResult[]>(() => {
    const cats = [...this.currentLevelRows()];
    const column = this.categorySortColumn();

    // 22-ago-2026 -- pedido de Andres: el orden POR DEFECTO ya no es el que manda
    // el backend (competidores) sino "mas productos a comparar primero" -- la
    // cantidad de matcheados por EAN es EL indicador de calidad de la comparacion
    // (un delta sobre 80 productos vale mas que uno sobre 1). Empate: alfabetico,
    // para el TOC de todos nosotros.
    if (column === 'default') {
      cats.sort((a, b) => {
        if (a.matchedProductCount !== b.matchedProductCount) return b.matchedProductCount - a.matchedProductCount;
        return (a.categoryName + (a.subcategoryName ?? '')).localeCompare(b.categoryName + (b.subcategoryName ?? ''));
      });
      return cats;
    }

    const mult = this.categorySortDirection() === 'asc' ? 1 : -1;
    cats.sort((a, b) => {
      let cmp = 0;
      switch (column) {
        case 'categoryName':
          cmp = (a.categoryName + (a.subcategoryName ?? '')).localeCompare(b.categoryName + (b.subcategoryName ?? ''));
          break;
        case 'competitorCount':
          cmp = a.competitorCount - b.competitorCount;
          break;
        case 'ownProducts':
          cmp = a.ownProductCount - b.ownProductCount;
          break;
        case 'zoneProducts':
          cmp = a.zoneProductCount - b.zoneProductCount;
          break;
        case 'matched':
          cmp = a.matchedProductCount - b.matchedProductCount;
          break;
        case 'delta':
          cmp = (a.deltaVsCompetitorsPct ?? -Infinity) - (b.deltaVsCompetitorsPct ?? -Infinity);
          break;
      }
      return cmp * mult;
    });
    return cats;
  });

  protected readonly pagedCategories = computed(() => {
    const cats = this.sortedCategories();
    const start = (this.categoryPage() - 1) * this.categoryPageSize;
    return cats.slice(start, start + this.categoryPageSize);
  });

  protected toggleCategorySort(column: CategorySortColumn): void {
    if (this.categorySortColumn() === column) {
      this.categorySortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.categorySortColumn.set(column);
      this.categorySortDirection.set(column === 'categoryName' ? 'asc' : 'desc');
    }
    this.categoryPage.set(1);
  }

  protected categorySortArrow(column: CategorySortColumn): string {
    if (this.categorySortColumn() !== column) return '';
    return this.categorySortDirection() === 'asc' ? ' ▲' : ' ▼';
  }

  // ==========================================================================
  // Detalle por producto DENTRO del dialog (sin cambios de fondo en v3).
  // ==========================================================================
  protected readonly productPageSize = 20;
  protected readonly productPage = signal(1);
  protected readonly productTotalPages = computed(() =>
    Math.max(1, Math.ceil((this.products()?.length ?? 0) / this.productPageSize)),
  );

  // 16-ago-2026 -- competitorRefPrice = promedio simple de todo lo visible para ese
  // producto (cadenas SEPA + family con piso); deltaPct contra eso. Solo derivados
  // de presentacion, no datos nuevos del backend. v3: extraido a un helper porque
  // ahora tambien lo usa la vista plana por productos.
  private toDetailRow(p: CategoryProductDetailItem): ProductDetailRow {
    const points = p.sepaChains.map((c) => c.avgPrice);
    if (p.familySufficientCoverage && p.familyAvgPrice != null) points.push(p.familyAvgPrice);
    const competitorRefPrice = points.length > 0 ? points.reduce((a, b) => a + b, 0) / points.length : null;
    const deltaPct =
      competitorRefPrice !== null && competitorRefPrice > 0 && p.ownPrice != null
        ? (p.ownPrice - competitorRefPrice) / competitorRefPrice
        : null;
    return { ...p, competitorRefPrice, deltaPct };
  }

  protected readonly productRows = computed<ProductDetailRow[]>(() =>
    (this.products() ?? []).map((p) => this.toDetailRow(p)),
  );

  protected readonly sortColumn = signal<ProductSortColumn | 'default'>('default');
  protected readonly sortDirection = signal<'asc' | 'desc'>('desc');

  protected readonly sortedProducts = computed<ProductDetailRow[]>(() => {
    const rows = [...this.productRows()];
    const column = this.sortColumn();

    if (column === 'default') {
      rows.sort((a, b) => {
        const aHas = a.ownPrice != null;
        const bHas = b.ownPrice != null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        const aDelta = a.deltaPct ?? -Infinity;
        const bDelta = b.deltaPct ?? -Infinity;
        if (aDelta !== bDelta) return bDelta - aDelta;
        return (a.description ?? a.ean).localeCompare(b.description ?? b.ean);
      });
      return rows;
    }

    const mult = this.sortDirection() === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (column) {
        case 'description':
          cmp = (a.description ?? a.ean).localeCompare(b.description ?? b.ean);
          break;
        case 'ownPrice':
          cmp = (a.ownPrice ?? -Infinity) - (b.ownPrice ?? -Infinity);
          break;
        case 'delta':
          cmp = (a.deltaPct ?? -Infinity) - (b.deltaPct ?? -Infinity);
          break;
        case 'family':
          cmp = (a.familyAvgPrice ?? -Infinity) - (b.familyAvgPrice ?? -Infinity);
          break;
      }
      return cmp * mult;
    });
    return rows;
  });

  protected readonly pagedProducts = computed(() => {
    const prods = this.sortedProducts();
    const start = (this.productPage() - 1) * this.productPageSize;
    return prods.slice(start, start + this.productPageSize);
  });

  // ==========================================================================
  // v3.3 -- vista por PRODUCTOS (tabla plana, catalogo completo del radio).
  // ==========================================================================
  protected readonly allProducts = signal<CategoryProductDetailItem[] | null>(null);
  protected readonly loadingAllProducts = signal(false);
  protected readonly allProductsError = signal<string | null>(null);

  protected readonly flatSearch = signal('');
  protected readonly flatPageSize = 20;
  protected readonly flatPage = signal(1);
  protected readonly flatSortColumn = signal<FlatSortColumn | 'default'>('default');
  protected readonly flatSortDirection = signal<'asc' | 'desc'>('desc');

  protected readonly flatRows = computed<FlatProductRow[]>(() =>
    (this.allProducts() ?? []).map((p) => this.toDetailRow(p)),
  );

  protected readonly filteredFlatRows = computed<FlatProductRow[]>(() => {
    const term = this.flatSearch().trim().toLowerCase();
    const rows = this.flatRows();
    if (!term) return rows;
    return rows.filter((p) =>
      (p.description ?? '').toLowerCase().includes(term) ||
      p.ean.includes(term) ||
      (p.brand ?? '').toLowerCase().includes(term) ||
      p.categoryName.toLowerCase().includes(term) ||
      (p.subcategoryName ?? '').toLowerCase().includes(term),
    );
  });

  protected readonly sortedFlatRows = computed<FlatProductRow[]>(() => {
    const rows = [...this.filteredFlatRows()];
    const column = this.flatSortColumn();

    // Mismo orden sugerido que el dialog: primero lo que EL cargo, y entre esos,
    // primero donde mas caro esta respecto a la zona.
    if (column === 'default') {
      rows.sort((a, b) => {
        const aHas = a.ownPrice != null;
        const bHas = b.ownPrice != null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        const aDelta = a.deltaPct ?? -Infinity;
        const bDelta = b.deltaPct ?? -Infinity;
        if (aDelta !== bDelta) return bDelta - aDelta;
        return (a.description ?? a.ean).localeCompare(b.description ?? b.ean);
      });
      return rows;
    }

    const mult = this.flatSortDirection() === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (column) {
        case 'description':
          cmp = (a.description ?? a.ean).localeCompare(b.description ?? b.ean);
          break;
        case 'category':
          cmp = (a.categoryName + (a.subcategoryName ?? '')).localeCompare(b.categoryName + (b.subcategoryName ?? ''));
          break;
        case 'ownPrice':
          cmp = (a.ownPrice ?? -Infinity) - (b.ownPrice ?? -Infinity);
          break;
        case 'delta':
          cmp = (a.deltaPct ?? -Infinity) - (b.deltaPct ?? -Infinity);
          break;
        case 'family':
          cmp = (a.familyAvgPrice ?? -Infinity) - (b.familyAvgPrice ?? -Infinity);
          break;
      }
      return cmp * mult;
    });
    return rows;
  });

  protected readonly flatTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.sortedFlatRows().length / this.flatPageSize)),
  );

  protected readonly pagedFlatRows = computed(() => {
    const rows = this.sortedFlatRows();
    const start = (this.flatPage() - 1) * this.flatPageSize;
    return rows.slice(start, start + this.flatPageSize);
  });

  protected setViewMode(mode: 'categorias' | 'productos'): void {
    this.viewMode.set(mode);
    if (mode === 'productos') this.ensureAllProducts();
  }

  protected onFlatSearch(term: string): void {
    this.flatSearch.set(term);
    this.flatPage.set(1);
  }

  protected toggleFlatSort(column: FlatSortColumn): void {
    if (this.flatSortColumn() === column) {
      this.flatSortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.flatSortColumn.set(column);
      this.flatSortDirection.set(column === 'description' || column === 'category' ? 'asc' : 'desc');
    }
    this.flatPage.set(1);
  }

  protected flatSortArrow(column: FlatSortColumn): string {
    if (this.flatSortColumn() !== column) return '';
    return this.flatSortDirection() === 'asc' ? ' ▲' : ' ▼';
  }

  protected goToFlatPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.flatTotalPages());
    this.flatPage.set(clamped);
  }

  // "Partiendo del producto, llegar a la categoria": desde una fila de la vista
  // plana, saltar a la vista jerarquica ya drilleada en la categoria del producto --
  // y si su subcategoria tiene cobertura, abrir directo el detalle de siempre.
  protected goToProductCategory(p: FlatProductRow): void {
    this.viewMode.set('categorias');
    this.drillCategoryId.set(p.categoryId);
    this.categoryPage.set(1);

    const leaf = this.leafRows().find(
      (c) => c.categoryId === p.categoryId && c.subcategoryId === p.subcategoryId,
    );
    if (leaf && leaf.sufficientCoverage) this.selectCategory(leaf);
  }

  private ensureAllProducts(): void {
    if (this.allProducts() !== null || this.loadingAllProducts()) return;

    const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();
    if (businessAccountId == null || !branchId) return;

    this.loadingAllProducts.set(true);
    this.allProductsError.set(null);

    this.trendService.getAllProductsDetail(businessAccountId, branchId, maxDistanceMeters).subscribe({
      next: (response) => {
        this.loadingAllProducts.set(false);
        this.allProducts.set(response.products);
        this.flatPage.set(1);
      },
      error: (err) => {
        this.loadingAllProducts.set(false);
        const gateMessage = planGateErrorMessage(err);
        this.allProductsError.set(gateMessage ?? 'No pudimos cargar el detalle por producto. Probá de nuevo.');
      },
    });
  }

  // ==========================================================================
  // Contexto de cuenta/sucursal (E1.7, sin cambios en v3).
  // ==========================================================================
  protected readonly form = this.fb.nonNullable.group({
    businessAccountId: [null as number | null, [Validators.required]],
    branchId: ['', [Validators.required]],
    maxDistanceMeters: [3000, [Validators.required, Validators.min(200), Validators.max(20000)]],
  });

  // 25-ago-2026 -- asesor de radio (misma pieza que en el benchmark instantaneo).
  protected readonly ownCommerceId = signal<string | null>(null);
  private readonly branchIdValue = toSignal(this.form.controls.branchId.valueChanges, {
    initialValue: this.form.controls.branchId.value,
  });
  protected readonly radiusValue = toSignal(this.form.controls.maxDistanceMeters.valueChanges, {
    initialValue: this.form.controls.maxDistanceMeters.value,
  });
  protected readonly selectedBranch = computed(
    () => this.branches()?.find((b) => b.branchId === this.branchIdValue()) ?? null,
  );

  // 25-ago-2026 -- radio guardado por sucursal (BenchmarkPreferencesService). El
  // dashboard SOLO se calcula solo al entrar si la sucursal ya tiene un radio que corrio
  // bien alguna vez; si no, espera a que la persona (con la sugerencia del asesor a la
  // vista) toque "Ver dashboard". Antes se disparaba con 3000 m fijos y en una zona
  // densa eso era un timeout en cada entrada.
  private readonly prefs = inject(BenchmarkPreferencesService);
  protected readonly hasSavedRadius = computed(() => {
    const id = this.branchIdValue();
    return !!id && this.prefs.getRadius(id) !== null;
  });

  protected applyRadius(radius: number): void {
    this.form.patchValue({ maxDistanceMeters: radius });
  }

  private applySavedRadius(branchId: string): boolean {
    const saved = this.prefs.getRadius(branchId);
    if (saved !== null) this.form.patchValue({ maxDistanceMeters: saved });
    return saved !== null;
  }

  ngOnInit(): void {
    this.form.controls.branchId.valueChanges.subscribe((branchId) => {
      if (branchId) this.applySavedRadius(branchId);
    });
    this.resolveContext();
  }

  private resolveContext(): void {
    this.loadingContext.set(true);
    this.contextErrorMessage.set(null);

    this.businessAccountService.getMine().subscribe({
      next: (accounts) => {
        if (accounts.length === 0) {
          this.loadingContext.set(false);
          this.noAccountYet.set(true);
          this.contextErrorMessage.set('Todavía no tenés un comercio dado de alta.');
          return;
        }

        const account = accounts[0];
        this.ownCommerceId.set(account.commerceId);
        this.form.patchValue({ businessAccountId: account.businessAccountId });

        this.businessAccountService.listBranches(account.businessAccountId).subscribe({
          next: (branches) => {
            this.loadingContext.set(false);
            this.branches.set(branches);

            if (branches.length === 0) {
              this.contextErrorMessage.set('Todavía no tenés sucursales cargadas.');
              return;
            }

            this.form.patchValue({ branchId: branches[0].branchId });
            if (this.applySavedRadius(branches[0].branchId)) {
              this.loadDashboard();
            }
          },
          error: () => {
            this.loadingContext.set(false);
            this.contextErrorMessage.set('No pudimos cargar tus sucursales. Probá recargar la página.');
          },
        });
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  // E8.3 -- resumen agregado. v3: SOLO sobre filas hoja (las totales duplicarian
  // cada categoria en el promedio).
  protected readonly summary = computed(() => {
    const cats = this.leafRows().filter((c) => c.sufficientCoverage && c.deltaVsCompetitorsPct !== null);
    if (cats.length === 0) return null;

    const avgDelta = cats.reduce((sum, c) => sum + (c.deltaVsCompetitorsPct ?? 0), 0) / cats.length;
    const above = cats.filter((c) => (c.deltaVsCompetitorsPct ?? 0) > 0).length;
    const below = cats.filter((c) => (c.deltaVsCompetitorsPct ?? 0) < 0).length;

    return { categoriesWithData: cats.length, avgDeltaPct: avgDelta * 100, above, below };
  });

  // ==========================================================================
  // v3.2 -- export a Excel: hojas "Categorías" + "Subcategorías" + "Productos".
  // ==========================================================================
  // 19-ago-2026 -- 'xlsx' (SheetJS) importado dinamico para no engordar el bundle.
  // v3 -- la hoja de productos usa el catalogo completo (getAllProductsDetail); si
  // el plan no lo permite (gate FullDashboard), el Excel sale igual con las hojas
  // de categorias y se avisa por que falta la de productos.
  protected readonly exportingReport = signal(false);

  protected async exportReport(): Promise<void> {
    const totals = this.categoryTotals();
    const leafs = this.leafRows();
    if (totals.length === 0 && leafs.length === 0) return;

    this.exportingReport.set(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();

      const categoryRow = (c: BenchmarkCategoryResult) => ({
        Categoría: c.categoryName,
        Subcategoría: c.subcategoryName ?? '',
        'Competidores cerca': c.competitorCount,
        'Tus productos': c.ownProductCount,
        'Productos en zona': c.zoneProductCount,
        'Cobertura suficiente': c.sufficientCoverage ? 'Sí' : 'No',
        'Tu precio promedio': c.ownAvgPrice ?? '',
        'Precio promedio zona': c.competitorAvgPrice ?? '',
        'Precio mínimo zona': c.competitorMinPrice ?? '',
        'Precio máximo zona': c.competitorMaxPrice ?? '',
        // 19-ago-2026 -- matcheado por EAN, no canasta contra canasta.
        'Diferencia vs. zona (%, por producto matcheado)': c.deltaVsCompetitorsPct !== null ? +(c.deltaVsCompetitorsPct * 100).toFixed(1) : '',
        'Productos matcheados (mismo EAN)': c.matchedProductCount,
      });
      const catWidths = [
        { wch: 28 }, { wch: 26 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 16 },
        { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 26 }, { wch: 20 },
      ];

      const totalsSheet = XLSX.utils.json_to_sheet(totals.map(categoryRow));
      totalsSheet['!cols'] = catWidths;
      XLSX.utils.book_append_sheet(workbook, totalsSheet, 'Categorías');

      const leafsSheet = XLSX.utils.json_to_sheet(leafs.map(categoryRow));
      leafsSheet['!cols'] = catWidths;
      XLSX.utils.book_append_sheet(workbook, leafsSheet, 'Subcategorías');

      // Hoja "Productos" -- catalogo completo. Si todavia no se cargo (el usuario no
      // paso por la vista por productos), se pide aca mismo; si el plan lo gatea, el
      // Excel sale sin esta hoja y se explica en pantalla.
      let productos = this.allProducts();
      if (productos === null) {
        try {
          const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();
          const response = await firstValueFrom(
            this.trendService.getAllProductsDetail(businessAccountId!, branchId, maxDistanceMeters),
          );
          productos = response.products;
          this.allProducts.set(productos);
        } catch (err) {
          const gateMessage = planGateErrorMessage(err);
          this.allProductsError.set(gateMessage ?? 'No pudimos armar la hoja de productos del Excel.');
          productos = null;
        }
      }

      if (productos !== null) {
        const productRows = productos.map((p) => {
          const row = this.toDetailRow(p);
          return {
            EAN: p.ean,
            Producto: p.description ?? '',
            Marca: p.brand ?? '',
            Categoría: p.categoryName,
            Subcategoría: p.subcategoryName ?? '',
            'Tu precio': p.ownPrice ?? '',
            'Origen de tu precio': p.ownPriceSource ? this.sourceLabel(p.ownPriceSource) : '',
            'Precio ref. zona': row.competitorRefPrice !== null ? +row.competitorRefPrice.toFixed(2) : '',
            'Diferencia (%)': row.deltaPct !== null ? +(row.deltaPct * 100).toFixed(1) : '',
            // E8.6 -- cadenas SEPA nombradas (dato publico por ley); family SIEMPRE
            // como agregado anonimo, igual que en pantalla.
            'Cadenas SEPA (precio promedio)': p.sepaChains
              .map((c) => `${c.chainName ?? c.commerceId + '-' + c.bannerId}: $${c.avgPrice.toFixed(2)}`)
              .join('; '),
            'Otras cuentas de la zona (promedio)': p.familySufficientCoverage ? p.familyAvgPrice ?? '' : '',
          };
        });
        const productsSheet = XLSX.utils.json_to_sheet(productRows);
        productsSheet['!cols'] = [
          { wch: 15 }, { wch: 42 }, { wch: 16 }, { wch: 20 }, { wch: 26 }, { wch: 11 },
          { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 50 }, { wch: 22 },
        ];
        XLSX.utils.book_append_sheet(workbook, productsSheet, 'Productos');
      }

      const branchId = this.form.controls.branchId.value;
      const branchName = this.branches()?.find((b) => b.branchId === branchId)?.branchName ?? branchId;
      const today = new Date();
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const safeBranch = (branchName ?? 'sucursal').replace(/[^\w\-]+/g, '_').slice(0, 40);
      XLSX.writeFile(workbook, `comparacion-precios_${safeBranch}_${stamp}.xlsx`);
    } finally {
      this.exportingReport.set(false);
    }
  }

  // Asesor de Precios, fase 1 (21-ago-2026, PreciosIQ_Asesor_Spec.md P0.3): el boton
  // "Analizar mi posicion" abre el dialog del informe. El dialog hace su propia
  // request (POST /api/business/advisor/report) -- el gate por plan y la cache
  // diaria viven en el backend; aca solo se pasa el contexto de sucursal/radio.
  protected openAdvisor(): void {
    const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();
    if (businessAccountId == null || !branchId) return;

    this.dialog.open<AdvisorReportDialogComponent, AdvisorReportDialogData>(AdvisorReportDialogComponent, {
      data: { businessAccountId, branchId, maxDistanceMeters },
      width: '90vw',
      maxWidth: '820px',
      maxHeight: '90vh',
      autoFocus: false,
    });
  }

  protected loadDashboard(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();
    this.loading.set(true);
    this.errorMessage.set(null);
    this.selectedCategory.set(null);
    this.trendPoints.set(null);
    this.products.set(null);
    this.categoryPage.set(1);
    this.productPage.set(1);
    // v3 -- cambiar sucursal/radio invalida el drilldown y el catalogo plano.
    this.drillCategoryId.set(null);
    this.allProducts.set(null);
    this.allProductsError.set(null);
    this.flatPage.set(1);

    this.benchmarkService.getInstant(businessAccountId!, branchId, maxDistanceMeters).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.categories.set(response.categories);
        // Corrio bien con este radio: queda como preferencia de la sucursal, y la
        // proxima entrada al dashboard arranca directo con el.
        this.prefs.saveRadius(branchId, maxDistanceMeters);
        // Si el usuario recargo estando en la vista por productos, refrescarla tambien.
        if (this.viewMode() === 'productos') this.ensureAllProducts();
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo calcular el benchmark.');
      },
    });
  }

  // E9.3 -- misma nomenclatura de origen que PriceHistoryChartComponent.
  protected sourceLabel(source: string): string {
    switch (source) {
      case 'sepa': return 'SEPA';
      case 'self_reported': return 'Cargado por vos';
      case 'crowd': return 'Consenso de usuarios';
      default: return source;
    }
  }

  protected selectCategory(category: BenchmarkCategoryResult): void {
    if (!category.sufficientCoverage) return;

    this.selectedCategory.set(category);
    this.loadingDetail.set(true);
    this.trendPoints.set(null);
    this.products.set(null);
    this.productPage.set(1);
    this.sortColumn.set('default');
    this.sortDirection.set('desc');

    const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 90);

    this.trendService
      .getTrend(businessAccountId!, branchId, maxDistanceMeters, dateFrom.toISOString(), dateTo.toISOString())
      .subscribe({
        next: (response) => {
          this.trendPoints.set(
            response.points.filter(
              (p) => p.categoryId === category.categoryId && p.subcategoryId === category.subcategoryId,
            ),
          );
        },
        error: (err) => {
          this.trendPoints.set([]);
          const gateMessage = planGateErrorMessage(err);
          if (gateMessage) this.errorMessage.set(gateMessage);
        },
      });

    this.trendService
      .getCategoryDetail(businessAccountId!, branchId, category.categoryId, maxDistanceMeters, category.subcategoryId)
      .subscribe({
        next: (response) => {
          this.loadingDetail.set(false);
          this.products.set(response.products);
        },
        error: (err) => {
          this.loadingDetail.set(false);
          this.products.set([]);
          const gateMessage = planGateErrorMessage(err);
          if (gateMessage) this.errorMessage.set(gateMessage);
        },
      });

    this.openDetailDialog(category);
  }

  // MatDialog (CDK Overlay) -- ver el comentario largo en benchmark-detail-dialog.ts.
  private openDetailDialog(category: BenchmarkCategoryResult): void {
    const dialogRef = this.dialog.open<BenchmarkDetailDialogComponent, BenchmarkDetailDialogData>(
      BenchmarkDetailDialogComponent,
      {
        data: {
          category,
          trendPoints: this.trendPoints,
          products: this.products,
          pagedProducts: this.pagedProducts,
          loadingDetail: this.loadingDetail,
          productPage: this.productPage,
          productTotalPages: this.productTotalPages,
          sortColumn: this.sortColumn,
          sortDirection: this.sortDirection,
          goToProductPage: (page: number) => this.goToProductPage(page),
          toggleSort: (column: ProductSortColumn) => this.toggleProductSort(column),
          resetSort: () => this.resetProductSort(),
          sourceLabel: (source: string) => this.sourceLabel(source),
        },
        width: '90vw',
        maxWidth: '960px',
        maxHeight: '90vh',
        autoFocus: false,
      },
    );

    dialogRef.afterClosed().subscribe(() => this.closeDetail());
  }

  protected goToCategoryPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.categoryTotalPages());
    this.categoryPage.set(clamped);
  }

  protected goToProductPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.productTotalPages());
    this.productPage.set(clamped);
  }

  protected toggleProductSort(column: ProductSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set(column === 'description' ? 'asc' : 'desc');
    }
    this.productPage.set(1);
  }

  protected resetProductSort(): void {
    this.sortColumn.set('default');
    this.productPage.set(1);
  }

  private closeDetail(): void {
    this.selectedCategory.set(null);
    this.trendPoints.set(null);
    this.products.set(null);
    this.productPage.set(1);
    this.sortColumn.set('default');
    this.sortDirection.set('desc');
  }
}
