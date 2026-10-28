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
import { PriceReviewDialogComponent, PriceReviewDialogData, PriceReviewResult } from './price-review-dialog';
import { AdvisorService } from '../../core/advisor';
import { PriceZoneItem } from '../../core/advisor.models';
import { planGateErrorMessage } from '../../core/plan-gate';
import { BusinessAccountService } from '../../core/business-account';
import { BranchListItem } from '../../core/business-account.models';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { toSignal } from '@angular/core/rxjs-interop';
import { RadiusAdvisorComponent } from '../../layout/radius-advisor/radius-advisor';
import { BenchmarkPreferencesService } from '../../core/benchmark-preferences';
import { BrandLabelPipe } from '../../core/brand-label';
import { OfertasCercaComponent } from './ofertas-cerca';
import { MayoristasCercaComponent } from './mayoristas-cerca';

// BP-164 (18-oct-2026): 'ownAvg' / 'zoneAvg', las columnas de promedios que traia el benchmark instantaneo.
export type CategorySortColumn = 'categoryName' | 'competitorCount' | 'delta' | 'ownProducts' | 'zoneProducts' | 'matched' | 'ownAvg' | 'zoneAvg';

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
// BP-164 (18-oct-2026) -- pedido de Andres: un solo benchmark. El "Benchmark instantaneo" (/benchmark) usaba los mismos
// datos (GET /business/benchmark/instant) con menos cosas: se borro, /benchmark redirige aca, y este suma lo unico que
// tenia y este no: las columnas "Tu promedio" / "Promedio zona" (sobre la misma canasta, BP-140) y el buscador de
// categorias. La tabla y el resumen son de todo plan; el detalle, la tendencia y la vista por producto, desde Pyme.
//
// E1.7 (16-ago-2026) -- BUG real marcado por Andres: "¿Qué carajo quiere decir 'ID de
// cuenta de negocio'?" -- el formulario pedia el businessAccountId y el branchId a
// mano. Ahora se resuelven solos con BusinessAccountService (ver resolveContext).
@Component({
  selector: 'app-benchmark-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LoadingBarComponent, RadiusAdvisorComponent, BrandLabelPipe, OfertasCercaComponent, MayoristasCercaComponent],
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
  // BP-204 (bloque 5): la cuenta como signal, para la tarjeta de ofertas de la competencia cerca.
  protected readonly cuentaId = signal<number | null>(null);
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
  // BP-152 (17-oct-2026) -- pedido de Andres: "si no vendo en una categoria NO ME LOS MUESTRES". Las categorias y
  // subcategorias sin productos propios salen del tablero, del resumen y del Excel (lo que vende la competencia y vos
  // no queda en la hoja "Solo en la zona" del Excel y en el Asesor, que lo pide aparte).
  private readonly ownCategories = computed<BenchmarkCategoryResult[]>(
    () => (this.categories() ?? []).filter((c) => c.ownProductCount > 0),
  );
  protected readonly categoryTotals = computed<BenchmarkCategoryResult[]>(
    () => this.ownCategories().filter((c) => c.isCategoryTotal),
  );
  protected readonly leafRows = computed<BenchmarkCategoryResult[]>(
    () => this.ownCategories().filter((c) => !c.isCategoryTotal),
  );

  // Lo que muestra la tabla jerarquica segun el nivel: raiz = totales de categoria;
  // drilleado = las hojas (subcategorias) de la categoria elegida.
  // BP-164 -- con texto en el buscador: las categorias y subcategorias (de cualquier categoria) cuyo nombre lo tiene.
  protected readonly categorySearch = signal('');
  protected readonly currentLevelRows = computed<BenchmarkCategoryResult[]>(() => {
    const q = this.categorySearch().trim().toLowerCase();
    if (q) {
      return [
        ...this.categoryTotals().filter((c) => c.categoryName.toLowerCase().includes(q)),
        ...this.leafRows().filter((c) => (c.subcategoryName ?? '').toLowerCase().includes(q)),
      ];
    }
    const drill = this.drillCategoryId();
    if (drill === null) return this.categoryTotals();
    return this.leafRows().filter((c) => c.categoryId === drill);
  });

  protected onCategorySearch(term: string): void {
    this.categorySearch.set(term);
    this.categoryPage.set(1);
  }

  // BP-164 (traido del benchmark instantaneo) -- BP-140: los dos promedios sobre la MISMA canasta, tus productos que
  // tienen precio en la zona sin los atipicos. Con un backend viejo, los de antes.
  protected tuPromedio(row: BenchmarkCategoryResult): number | null {
    return row.ownAvgMatchedPrice !== undefined ? row.ownAvgMatchedPrice : row.ownAvgPrice;
  }

  protected promedioZona(row: BenchmarkCategoryResult): number | null {
    if (!this.tienePrecioDeZona(row)) return null;
    return row.zoneAvgMatchedPrice !== undefined ? row.zoneAvgMatchedPrice : row.competitorAvgPrice;
  }

  protected pesos(n: number | null): string {
    return n === null || n === undefined ? '—' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected readonly drillCategoryName = computed<string | null>(() => {
    const drill = this.drillCategoryId();
    if (drill === null) return null;
    return this.categoryTotals().find((c) => c.categoryId === drill)?.categoryName ?? drill;
  });

  protected drillInto(category: BenchmarkCategoryResult): void {
    this.categorySearch.set('');
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
        case 'ownAvg':
          cmp = (this.tuPromedio(a) ?? -Infinity) - (this.tuPromedio(b) ?? -Infinity);
          break;
        case 'zoneAvg':
          cmp = (this.promedioZona(a) ?? -Infinity) - (this.promedioZona(b) ?? -Infinity);
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
    // BP-137 -- un EAN dudoso (en la red es otro producto) no se compara.
    if (p.eanDudoso) return { ...p, competitorRefPrice: null, deltaPct: null };
    const points = p.sepaChains.map((c) => c.avgPrice);
    if (p.familySufficientCoverage && p.familyAvgPrice != null) points.push(p.familyAvgPrice);
    const competitorRefPrice = points.length > 0 ? points.reduce((a, b) => a + b, 0) / points.length : null;
    const deltaPct =
      competitorRefPrice !== null && competitorRefPrice > 0 && p.ownPrice != null
        ? (p.ownPrice - competitorRefPrice) / competitorRefPrice
        : null;
    return { ...p, competitorRefPrice, deltaPct };
  }

  // BP-152 -- solo tus productos: lo que vende la competencia y vos no, no sirve para compararte.
  protected readonly productRows = computed<ProductDetailRow[]>(() =>
    (this.products() ?? []).filter((p) => p.ownPrice != null).map((p) => this.toDetailRow(p)),
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

  // BP-152 -- igual que el detalle: solo tus productos (el Excel arma "Solo en la zona" desde allProducts).
  protected readonly flatRows = computed<FlatProductRow[]>(() =>
    (this.allProducts() ?? []).filter((p) => p.ownPrice != null).map((p) => this.toDetailRow(p)),
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
    this.categorySearch.set('');
    this.drillCategoryId.set(p.categoryId);
    this.categoryPage.set(1);

    const leaf = this.leafRows().find(
      (c) => c.categoryId === p.categoryId && c.subcategoryId === p.subcategoryId,
    );
    if (leaf && this.tienePrecioDeZona(leaf)) this.selectCategory(leaf);
  }

  private ensureAllProducts(): void {
    if (this.allProducts() !== null || this.loadingAllProducts()) return;

    const { businessAccountId, branchId, maxDistanceMeters } = this.parametrosDelCalculo();
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

  // BP-77 (14-oct-2026) -- si la sucursal elegida esta en una zona de precio, el Asesor ofrece tambien el
  // informe de la zona. El tablero sigue siendo por sucursal. Sin plan con Asesor o sin zonas: lista vacia.
  private readonly advisorService = inject(AdvisorService);
  private readonly zonas = signal<PriceZoneItem[]>([]);
  protected readonly zonaDeLaSucursal = computed(
    () => this.zonas().find((z) => z.sucursales.some((s) => s.branchId === this.branchIdValue())) ?? null,
  );

  private cargarZonas(businessAccountId: number): void {
    this.advisorService.getPriceZones(businessAccountId).subscribe({
      next: (r) => this.zonas.set(r.tablaLista ? r.zonas : []),
      error: () => this.zonas.set([]),
    });
  }

  protected openAdvisorZona(): void {
    const { businessAccountId, maxDistanceMeters } = this.parametrosDelCalculo();
    const zona = this.zonaDeLaSucursal();
    if (businessAccountId == null || !zona) return;
    this.dialog.open<AdvisorReportDialogComponent, AdvisorReportDialogData>(AdvisorReportDialogComponent, {
      data: { businessAccountId, priceZoneId: zona.id, maxDistanceMeters },
      width: '90vw',
      maxWidth: '820px',
      maxHeight: '90vh',
      autoFocus: false,
    });
  }

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
        this.cuentaId.set(account.businessAccountId);

        this.businessAccountService.listBranches(account.businessAccountId).subscribe({
          next: (branches) => {
            this.loadingContext.set(false);
            this.branches.set(branches);
            if (branches.length > 1) this.cargarZonas(account.businessAccountId);   // BP-77

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
        'Cobertura suficiente (5+ comparables, 2+ competidores)': c.sufficientCoverage ? 'Sí' : 'No',
        // BP-140 -- promedios sobre la MISMA canasta (tus productos comparables, sin atipicos) y percentiles 5 / 95.
        'Tu precio promedio (comparables)': (c.ownAvgMatchedPrice !== undefined ? c.ownAvgMatchedPrice : c.ownAvgPrice) ?? '',
        'Precio promedio zona (comparables)': (c.zoneAvgMatchedPrice !== undefined ? c.zoneAvgMatchedPrice : c.competitorAvgPrice) ?? '',
        'Precio mínimo zona (percentil 5)': c.competitorP5Price ?? c.competitorMinPrice ?? '',
        'Precio máximo zona (percentil 95)': c.competitorP95Price ?? c.competitorMaxPrice ?? '',
        // 19-ago-2026 -- matcheado por EAN, no canasta contra canasta.
        // BP-143 -- mediana por producto, sin los precios atipicos (que se cuentan aparte).
        'Diferencia vs. zona (%, mediana sin atípicos)': c.deltaVsCompetitorsPct !== null ? +(c.deltaVsCompetitorsPct * 100).toFixed(1) : '',
        'Productos matcheados (mismo EAN)': c.matchedProductCount,
        'Precios para revisar (3x o más de diferencia, fuera de la mediana)': c.atypicalCount ?? 0,
      });
      const catWidths = [
        { wch: 28 }, { wch: 26 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 16 },
        { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 26 }, { wch: 20 }, { wch: 22 },
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
          const { businessAccountId, branchId, maxDistanceMeters } = this.parametrosDelCalculo();
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
        // BP-139 (16-oct-2026) -- dos hojas: "Tus productos" (los comparables primero, los mas caros contra la zona
        // arriba) y "Solo en la zona" (lo que vende la competencia y vos no, por cuantas cadenas lo tienen), sin filas sin
        // nombre ni codigos internos de las cadenas (0000000...). "Otras cuentas de la zona" salio: casi nunca tenia dato.
        const cadenas = (p: CategoryProductDetailItem) =>
          p.sepaChains.map((c) => `${c.chainName ?? c.commerceId + '-' + c.bannerId}: $${c.avgPrice.toFixed(2)}`).join('; ');
        const categoria = (p: CategoryProductDetailItem) => (p.categoriaAdivinada ? `${p.categoryName} (adivinada)` : p.categoryName);
        const propios = productos.filter((p) => p.ownPrice != null).map((p) => ({ p, row: this.toDetailRow(p) }));
        propios.sort((a, b) => {
          const da = a.row.deltaPct, db = b.row.deltaPct;
          if ((da === null) !== (db === null)) return da === null ? 1 : -1;
          if (da !== null && db !== null && da !== db) return db - da;
          return (a.p.description ?? a.p.ean).localeCompare(b.p.description ?? b.p.ean);
        });
        const propiosSheet = XLSX.utils.json_to_sheet(propios.map(({ p, row }) => ({
          EAN: p.ean,
          Producto: p.description ?? '',
          Marca: p.brand ?? '',
          Categoría: categoria(p),
          Subcategoría: p.subcategoryName ?? '',
          'Tu precio': p.ownPrice ?? '',
          'Precio ref. zona': row.competitorRefPrice !== null ? +row.competitorRefPrice.toFixed(2) : '',
          'Diferencia (%)': row.deltaPct !== null ? +(row.deltaPct * 100).toFixed(1) : '',
          'Para revisar': p.eanDudoso
            ? `EAN dudoso: en la red es «${p.nombreRed ?? ''}»`
            : row.deltaPct !== null && (row.deltaPct >= 2 || row.deltaPct <= -2 / 3) ? 'Precio 3x o más distinto de la zona' : '',
          'Cadenas SEPA (precio promedio)': cadenas(p),
        })));
        propiosSheet['!cols'] = [
          { wch: 15 }, { wch: 42 }, { wch: 16 }, { wch: 24 }, { wch: 26 }, { wch: 11 }, { wch: 14 }, { wch: 13 }, { wch: 40 }, { wch: 50 },
        ];
        XLSX.utils.book_append_sheet(workbook, propiosSheet, 'Tus productos');

        const soloZona = productos
          .filter((p) => p.ownPrice == null && !!p.description && !p.ean.startsWith('0000000'))
          .sort((a, b) => b.sepaChains.length - a.sepaChains.length || (a.description ?? '').localeCompare(b.description ?? ''));
        const zonaSheet = XLSX.utils.json_to_sheet(soloZona.map((p) => {
          const row = this.toDetailRow(p);
          return {
            EAN: p.ean,
            Producto: p.description ?? '',
            Marca: p.brand ?? '',
            Categoría: p.categoryName,
            Subcategoría: p.subcategoryName ?? '',
            'Cadenas que lo tienen': p.sepaChains.length,
            'Precio promedio zona': row.competitorRefPrice !== null ? +row.competitorRefPrice.toFixed(2) : '',
            'Cadenas SEPA (precio promedio)': cadenas(p),
          };
        }));
        zonaSheet['!cols'] = [{ wch: 15 }, { wch: 42 }, { wch: 16 }, { wch: 20 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 50 }];
        XLSX.utils.book_append_sheet(workbook, zonaSheet, 'Solo en la zona');
      }

      const branchId = this.parametrosDelCalculo().branchId;   // BP-142
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
    const { businessAccountId, branchId, maxDistanceMeters } = this.parametrosDelCalculo();
    if (businessAccountId == null || !branchId) return;

    this.dialog.open<AdvisorReportDialogComponent, AdvisorReportDialogData>(AdvisorReportDialogComponent, {
      data: { businessAccountId, branchId, maxDistanceMeters },
      width: '90vw',
      maxWidth: '820px',
      maxHeight: '90vh',
      autoFocus: false,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // BP-142 (16-oct-2026) -- la tabla queda con la sucursal y el radio del ultimo calculo, pero el detalle, la tendencia,
  // la vista por productos, el Excel y el Asesor leian el FORMULARIO en ese momento. Cambiar el radio o la sucursal
  // (que ademas carga el radio guardado de esa sucursal) sin recalcular hacia que la fila y el detalle hablaran de
  // radios distintos (Rufino, Libreria: la fila decia +62,3 % con 19 productos; el detalle, 1 producto a -32,2 %).
  // Ahora todo usa los parametros del ultimo calculo, y si el formulario cambio se avisa con "Recalcular".
  // ─────────────────────────────────────────────────────────────
  /** BP-140 -- hay algun precio de zona (con un backend viejo, sufficientCoverage decia eso). */
  protected tienePrecioDeZona(c: BenchmarkCategoryResult): boolean {
    return c.hasZonePrice ?? c.sufficientCoverage;
  }

  protected readonly calculo = signal<{ businessAccountId: number; branchId: string; maxDistanceMeters: number } | null>(null);
  protected readonly formularioCambiado = computed(() => {
    const c = this.calculo();
    if (!c || this.categories() === null) return false;
    return this.branchIdValue() !== c.branchId || Number(this.radiusValue()) !== c.maxDistanceMeters;
  });
  protected nombreDeSucursalDelCalculo(): string {
    const id = this.calculo()?.branchId;
    return this.branches()?.find((b) => b.branchId === id)?.branchName ?? id ?? '';
  }

  private parametrosDelCalculo(): { businessAccountId: number | null; branchId: string; maxDistanceMeters: number } {
    const c = this.calculo();
    if (c) return c;
    const { businessAccountId, branchId, maxDistanceMeters } = this.form.getRawValue();
    return { businessAccountId, branchId, maxDistanceMeters };
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
    this.categorySearch.set('');
    this.allProducts.set(null);
    this.allProductsError.set(null);
    this.flatPage.set(1);
    this.revisados.set(0);

    this.benchmarkService.getInstant(businessAccountId!, branchId, maxDistanceMeters).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.categories.set(response.categories);
        // BP-142 -- desde aca, detalle, tendencia, productos, Excel y Asesor usan ESTOS parametros.
        this.calculo.set({ businessAccountId: businessAccountId!, branchId, maxDistanceMeters: Number(maxDistanceMeters) });
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
    if (!this.tienePrecioDeZona(category)) return;

    this.selectedCategory.set(category);
    this.loadingDetail.set(true);
    this.trendPoints.set(null);
    this.products.set(null);
    this.productPage.set(1);
    this.sortColumn.set('default');
    this.sortDirection.set('desc');

    const { businessAccountId, branchId, maxDistanceMeters } = this.parametrosDelCalculo();
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
          review: (row: ProductDetailRow) => this.openPriceReview(row),
        },
        width: '90vw',
        maxWidth: '960px',
        maxHeight: '90vh',
        autoFocus: false,
      },
    );

    dialogRef.afterClosed().subscribe(() => this.closeDetail());
  }

  // ─────────────────────────────────────────────────────────────
  // BP-152 -- "para revisar" y "EAN dudoso" abren el popup de revision (price-review-dialog.ts). Un precio corregido se
  // actualiza en la fila al toque (las cadenas no cambian); un codigo corregido cambia contra que se compara, asi que se
  // vuelve a pedir el detalle. La fila de la categoria (mediana, "N para revisar") se pone al dia con Recalcular.
  // ─────────────────────────────────────────────────────────────
  protected readonly revisados = signal(0);

  protected openPriceReview(row: ProductDetailRow): void {
    const { businessAccountId, branchId } = this.parametrosDelCalculo();
    if (businessAccountId == null || !branchId) return;
    const branchName = this.branches()?.find((b) => b.branchId === branchId)?.branchName ?? branchId;

    this.dialog
      .open<PriceReviewDialogComponent, PriceReviewDialogData, PriceReviewResult>(PriceReviewDialogComponent, {
        data: { row, businessAccountId, branchId, branchName },
        width: '92vw',
        maxWidth: '560px',
        maxHeight: '90vh',
        autoFocus: false,
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) return;
        this.revisados.update((n) => n + 1);
        if (result.kind === 'price') {
          const fix = (list: CategoryProductDetailItem[] | null) =>
            list?.map((p) => (p.ean === result.ean ? { ...p, ownPrice: result.listPrice, ownPriceSource: 'self_reported' } : p)) ?? null;
          this.products.set(fix(this.products()));
          this.allProducts.set(fix(this.allProducts()));
          return;
        }
        const category = this.selectedCategory();
        if (category) this.reloadCategoryDetail(category);
        if (this.allProducts() !== null) {
          this.allProducts.set(null);
          if (this.viewMode() === 'productos') this.ensureAllProducts();
        }
      });
  }

  private reloadCategoryDetail(category: BenchmarkCategoryResult): void {
    const { businessAccountId, branchId, maxDistanceMeters } = this.parametrosDelCalculo();
    this.loadingDetail.set(true);
    this.trendService
      .getCategoryDetail(businessAccountId!, branchId, category.categoryId, maxDistanceMeters, category.subcategoryId)
      .subscribe({
        next: (response) => {
          this.loadingDetail.set(false);
          this.products.set(response.products);
        },
        error: () => this.loadingDetail.set(false),
      });
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
