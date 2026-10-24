import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { concat, retry, timer, toArray } from 'rxjs';
import { CsvImportService } from '../../core/csv-import';
import {
  CatalogoCompletoGrupoResult,
  CatalogoCompletoResult,
  CsvImportDestino,
  CsvImportPriceAnomaly,
  CsvImportResult,
  CsvImportRowError,
  CsvMapping,
  CsvPreviewResponse,
  PromoParaConfirmar,
} from '../../core/csv-import.models';
import { PromosParaConfirmarComponent } from '../../shared/promos-para-confirmar/promos-para-confirmar';
import { BusinessPriceService } from '../../core/business-price';
import { BusinessAccountProductItem, UpsertBusinessPriceRequest } from '../../core/business-price.models';
import { planGateErrorMessage } from '../../core/plan-gate';
import { BusinessContextService } from '../../core/business-context';
import { GESTION_VISIBLE, GestionContextoService } from '../../core/gestion-contexto';
import { BranchListItem } from '../../core/business-account.models';
import { AdvisorService } from '../../core/advisor';
import { PriceZoneItem } from '../../core/advisor.models';
import { environment } from '../../../environments/environment';

type Step = 'upload' | 'map' | 'result';

// E5 -- carga masiva por CSV con mapeo de columnas configurable (no se fuerza el
// formato SEPA). Flujo en 3 pasos: subir archivo -> mapear columnas (o reusar un
// mapeo ya guardado) -> correr la carga y ver el resumen.
//
// E1.9 (16-ago-2026) -- businessAccountId ya no se pide a mano (queda oculto en el
// formulario, resuelto solo via BusinessContextService) y branchId paso de texto libre
// a un <select> con nombre de sucursal -- mismo fix que el resto del panel.
@Component({
  selector: 'app-csv-import',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RouterLink, NgTemplateOutlet, PromosParaConfirmarComponent],
  templateUrl: './csv-import.html',
  styleUrl: './csv-import.scss',
})
export class CsvImportComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly csvImportService = inject(CsvImportService);
  private readonly context = inject(BusinessContextService);
  // BP-178 (21-oct-2026) -- las columnas de la ficha de artículo se ofrecen solo con el plan que la trae.
  private readonly gestion = inject(GestionContextoService);
  protected readonly conArticulos = signal(false);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly branches = signal<BranchListItem[]>([]);

  protected readonly step = signal<Step>('upload');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly preview = signal<CsvPreviewResponse | null>(null);
  protected readonly result = signal<CsvImportResult | null>(null);

  // E5.7 (25-ago-2026) -- pedido de Andres: la carga se hacia en UN request y con un
  // archivo real (~5600 filas) daba timeout siempre. Ahora se manda el mismo archivo
  // en tandas de chunkRows filas (POST /run con offset/limit/batchId) y se muestra el
  // avance. 300 filas son unos segundos por llamada, lejos de cualquier timeout de
  // IIS/proxy; con 5600 filas son ~19 llamadas. Los valores viven en environment.ts.
  protected readonly chunkRows = environment.csvImport.chunkRows;
  protected readonly progress = signal<{
    done: number;
    total: number;
    created: number;
    updated: number;
    failed: number;
  } | null>(null);

  protected progressPct(): number {
    const p = this.progress();
    if (!p || p.total === 0) return 0;
    return Math.min(100, Math.round((p.done / p.total) * 100));
  }
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly useExistingMapping = signal(true);
  // 25-ago-2026 -- pedido de Andres: el chip del mapeo elegido tiene que verse elegido.
  // Antes el click cargaba el formulario pero no dejaba rastro visual de cual era.
  protected readonly selectedMappingId = signal<number | null>(null);
  // 17-sep-2026 -- pedido de Andres: en esta pantalla se ve SOLO el ultimo mapeo usado (el
  // backend los devuelve ordenados por uso real). Los demas, atras de "Otros mapeos"; la
  // administracion completa vive en /precios/mapeos.
  protected readonly verTodosLosMapeos = signal(false);

  protected otrosMapeos(mappings: CsvMapping[]): CsvMapping[] {
    return mappings.slice(1);
  }

  protected readonly uploadForm = this.fb.nonNullable.group({
    businessAccountId: [null as number | null, [Validators.required]],
    branchId: ['', [Validators.required]],
  });

  // ─────────────────────────────────────────────────────────────
  // BP-132 (16-oct-2026) -- "¿A qué sucursales?". Rufino tiene 4 sucursales y una sola lista: la carga va a una
  // sucursal (como siempre), a una zona de precio (BP-77) o a todas. El backend aplica cada tanda en todas las
  // sucursales del destino y las junta en una carga (groupId). Las zonas salen de AdvisorService.getPriceZones,
  // que tiene compuerta de plan: si falla o la tabla no esta, la opcion "zona" no aparece; "todas" va en todos
  // los planes. El destino se recuerda por cuenta en localStorage (si no se puede, arranca en "una sucursal").
  // ─────────────────────────────────────────────────────────────
  private readonly advisorService = inject(AdvisorService);
  protected readonly zonas = signal<PriceZoneItem[]>([]);
  protected readonly destinoTipo = signal<'sucursal' | 'zona' | 'todas'>('sucursal');
  protected readonly zonaId = signal<number | null>(null);
  private readonly branchIdValue = toSignal(this.uploadForm.controls.branchId.valueChanges, {
    initialValue: this.uploadForm.controls.branchId.value,
  });
  private destinoGuardado: { tipo: string; branchId?: string; zonaId?: number } | null = null;

  protected readonly zonaElegida = computed(() => this.zonas().find((z) => z.id === this.zonaId()) ?? null);
  /** La zona de la sucursal elegida (para ofrecer "cargar en toda la zona"). */
  protected readonly zonaDeLaSucursal = computed(
    () => this.zonas().find((z) => z.sucursales.some((s) => s.branchId === this.branchIdValue())) ?? null,
  );
  /** Las sucursales en las que se va a cargar (id + nombre). */
  protected readonly sucursalesDelDestino = computed<{ branchId: string; nombre: string }[]>(() => {
    switch (this.destinoTipo()) {
      case 'zona':
        return (this.zonaElegida()?.sucursales ?? []).map((s) => ({ branchId: s.branchId, nombre: s.nombre }));
      case 'todas':
        return this.branches().map((b) => ({ branchId: b.branchId, nombre: b.branchName }));
      default:
        return this.branches()
          .filter((b) => b.branchId === this.branchIdValue())
          .map((b) => ({ branchId: b.branchId, nombre: b.branchName }));
    }
  });
  /** Con destino zona: las sucursales de la cuenta que quedan afuera. */
  protected readonly fueraDeLaZona = computed(() => {
    const z = this.zonaElegida();
    if (this.destinoTipo() !== 'zona' || !z) return [];
    const ids = new Set(z.sucursales.map((s) => s.branchId));
    return this.branches().filter((b) => !ids.has(b.branchId)).map((b) => b.branchName);
  });

  protected nombresDe(lista: string[]): string {
    return lista.length <= 1 ? (lista[0] ?? '') : `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
  }

  protected otrasDeLaZona(z: PriceZoneItem): string[] {
    return z.sucursales.filter((s) => s.branchId !== this.branchIdValue()).map((s) => s.nombre);
  }

  protected nombresDelDestino(): string {
    return this.nombresDe(this.sucursalesDelDestino().map((s) => s.nombre));
  }

  /** En la tabla de anomalias: "Las 3" si aparecio en todas las sucursales de la carga; si no, cuales. */
  protected sucursalesDeLaAnomaliaTexto(a: CsvImportPriceAnomaly, r: CsvImportResult): string {
    const total = r.porSucursal?.length ?? 0;
    return total > 1 && this.sucursalesDeLaAnomalia(a).length === total ? `Las ${total}` : this.nombresDeLaAnomalia(a);
  }

  protected nombresDeLaAnomalia(a: CsvImportPriceAnomaly): string {
    return this.nombresDe(this.sucursalesDeLaAnomalia(a).map((id) => this.nombreDeSucursal(id)));
  }

  protected nombreDeSucursal(branchId: string): string {
    return this.branches().find((b) => b.branchId === branchId)?.branchName ?? branchId;
  }

  private destinoActual(): CsvImportDestino | null {
    switch (this.destinoTipo()) {
      case 'zona': {
        const id = this.zonaId();
        return id === null ? null : { tipo: 'zona', priceZoneId: id };
      }
      case 'todas':
        return { tipo: 'todas' };
      default:
        return { tipo: 'sucursal', branchId: this.uploadForm.getRawValue().branchId };
    }
  }

  protected elegirDestino(tipo: 'sucursal' | 'zona' | 'todas'): void {
    this.destinoTipo.set(tipo);
    if (tipo === 'zona' && this.zonaId() === null) this.zonaId.set(this.zonaDeLaSucursal()?.id ?? this.zonas()[0]?.id ?? null);
    this.guardarDestino();
  }

  protected elegirZona(id: string | number): void {
    this.zonaId.set(Number(id));
    this.guardarDestino();
  }

  /** "¿Cargar la lista en toda la zona?" desde el aviso de la sucursal. */
  protected cargarEnTodaLaZona(z: PriceZoneItem): void {
    this.zonaId.set(z.id);
    this.destinoTipo.set('zona');
    this.guardarDestino();
  }

  private claveDestino(): string | null {
    const id = this.uploadForm.getRawValue().businessAccountId;
    return id ? `preciosiq.csvImport.destino.${id}` : null;
  }

  protected guardarDestino(): void {
    const clave = this.claveDestino();
    if (!clave) return;
    try {
      localStorage.setItem(clave, JSON.stringify({
        tipo: this.destinoTipo(),
        branchId: this.uploadForm.getRawValue().branchId,
        zonaId: this.zonaId() ?? undefined,
      }));
    } catch {
      // Sin almacenamiento (ventana privada, bloqueado): no se recuerda, nada mas.
    }
  }

  private leerDestinoGuardado(): void {
    const clave = this.claveDestino();
    if (!clave) return;
    try {
      const v = localStorage.getItem(clave);
      this.destinoGuardado = v ? JSON.parse(v) : null;
    } catch {
      this.destinoGuardado = null;
    }
    const g = this.destinoGuardado;
    if (!g) return;
    if (g.branchId && this.branches().some((b) => b.branchId === g.branchId)) this.uploadForm.patchValue({ branchId: g.branchId });
    if (g.tipo === 'todas' && this.branches().length > 1) this.destinoTipo.set('todas');
    // 'zona' se aplica cuando llegan las zonas (cargarZonas), si la zona sigue existiendo.
  }

  private cargarZonas(businessAccountId: number): void {
    this.advisorService.getPriceZones(businessAccountId).subscribe({
      next: (r) => {
        const conSucursales = r.tablaLista ? r.zonas.filter((z) => z.sucursales.length > 0) : [];
        this.zonas.set(conSucursales);
        const g = this.destinoGuardado;
        if (g?.tipo === 'zona' && g.zonaId && conSucursales.some((z) => z.id === g.zonaId)) {
          this.zonaId.set(g.zonaId);
          this.destinoTipo.set('zona');
        }
      },
      error: () => this.zonas.set([]),
    });
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
        this.gestion.load().subscribe({ next: (g) => this.conArticulos.set(GESTION_VISIBLE && !!g?.gestionArticulos), error: () => {} });
        this.uploadForm.patchValue({ businessAccountId: ctx.account.businessAccountId });
        if (ctx.branches.length > 0) {
          this.uploadForm.patchValue({ branchId: ctx.branches[0].branchId });
        }
        // BP-132 -- con una sola sucursal no hay destino que elegir (ni zonas que pedir).
        if (ctx.branches.length > 1) {
          this.leerDestinoGuardado();
          this.cargarZonas(ctx.account.businessAccountId);
        }
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected readonly mappingForm = this.fb.nonNullable.group({
    savedMappingId: [null as number | null],
    name: ['', [Validators.required]],
    delimiter: [',', [Validators.required]],
    decimalSeparator: [',', [Validators.required]],
    eanColumn: ['', [Validators.required]],
    priceColumn: ['', [Validators.required]],
    descriptionColumn: [''],
    brandColumn: [''],
    presentationQuantityColumn: [''],
    presentationUnitColumn: [''],
    // E12 (19-ago-2026) -- columnas de promo opcionales. Si se dejan sin mapear, esta
    // carga masiva no toca las promos de los productos que actualiza.
    promo1UnitPriceColumn: [''],
    promo1TextColumn: [''],
    promo2UnitPriceColumn: [''],
    promo2TextColumn: [''],
    // BP-38 (16-sep-2026) -- "llevando desde / hasta" de la promo 1, opcionales.
    promoMinQtyColumn: [''],
    promoMaxQtyColumn: [''],
    // 17-sep-2026 -- descuento %: la fila crea una regla de porcentaje.
    promoPercentColumn: [''],
    // BP-169 (19-oct-2026) -- la mecanica de la promo ("2x1", "3x2", "2da 50"): gana sobre la leyenda.
    promoMecanicaColumn: [''],
    // 10-oct-2026 -- "Esta planilla es mi catalogo completo" (ver catalogo() mas abajo).
    catalogoCompleto: [false],
    costPriceColumn: [''],
    costPriceWithTaxColumn: [''],
    supplierColumn: [''],
    costValidFromColumn: [''],
    costZoneColumn: [''],   // BP-77
    // BP-178 (21-oct-2026) -- ficha de artículo, opcionales (solo con el plan que la trae).
    codigoInternoColumn: [''],
    ivaColumn: [''],
    rubroColumn: [''],
    unidadesPorBultoColumn: [''],
    eanBultoColumn: [''],
    margenColumn: [''],
  });

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  protected loadPreview(): void {
    if (this.uploadForm.invalid || !this.selectedFile()) {
      this.uploadForm.markAllAsTouched();
      if (!this.selectedFile()) this.errorMessage.set('Elegí un archivo CSV.');
      return;
    }

    const businessAccountId = this.uploadForm.getRawValue().businessAccountId!;
    this.loading.set(true);
    this.errorMessage.set(null);

    this.csvImportService.preview(businessAccountId, this.selectedFile()!).subscribe({
      next: (preview) => {
        this.loading.set(false);
        this.preview.set(preview);
        this.mappingForm.patchValue({ delimiter: preview.detectedDelimiter });
        this.useExistingMapping.set(preview.savedMappings.length > 0);
        // Preselecciona el mapeo mas reciente (el backend ya los devuelve ordenados)
        // para que "Cargar con este mapeo" funcione sin que el usuario tenga que
        // tocar un chip primero.
        if (preview.savedMappings.length > 0) {
          this.pickSavedMapping(preview.savedMappings[0]);
        }
        this.step.set('map');
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(planGateErrorMessage(err) ?? err?.error?.error ?? 'No se pudo leer el archivo.');
      },
    });
  }

  protected pickSavedMapping(mapping: CsvMapping): void {
    this.selectedMappingId.set(mapping.id);
    // Si venia de "+ Nuevo mapeo", volver a tocar un chip guardado vuelve a ese mapeo.
    this.useExistingMapping.set(true);
    this.mappingForm.patchValue({
      savedMappingId: mapping.id,
      name: mapping.name,
      delimiter: mapping.delimiter,
      decimalSeparator: mapping.decimalSeparator,
      eanColumn: mapping.eanColumn,
      priceColumn: mapping.priceColumn,
      descriptionColumn: mapping.descriptionColumn ?? '',
      brandColumn: mapping.brandColumn ?? '',
      presentationQuantityColumn: mapping.presentationQuantityColumn ?? '',
      presentationUnitColumn: mapping.presentationUnitColumn ?? '',
      promo1UnitPriceColumn: mapping.promo1UnitPriceColumn ?? '',
      promo1TextColumn: mapping.promo1TextColumn ?? '',
      promo2UnitPriceColumn: mapping.promo2UnitPriceColumn ?? '',
      promo2TextColumn: mapping.promo2TextColumn ?? '',
      promoMinQtyColumn: mapping.promoMinQtyColumn ?? '',
      promoMaxQtyColumn: mapping.promoMaxQtyColumn ?? '',
      promoPercentColumn: mapping.promoPercentColumn ?? '',
      promoMecanicaColumn: mapping.promoMecanicaColumn ?? '',
      costPriceColumn: mapping.costPriceColumn ?? '',
      costPriceWithTaxColumn: mapping.costPriceWithTaxColumn ?? '',
      supplierColumn: mapping.supplierColumn ?? '',
      costValidFromColumn: mapping.costValidFromColumn ?? '',
      costZoneColumn: mapping.costZoneColumn ?? '',
      codigoInternoColumn: mapping.codigoInternoColumn ?? '',
      ivaColumn: mapping.ivaColumn ?? '',
      rubroColumn: mapping.rubroColumn ?? '',
      unidadesPorBultoColumn: mapping.unidadesPorBultoColumn ?? '',
      eanBultoColumn: mapping.eanBultoColumn ?? '',
      margenColumn: mapping.margenColumn ?? '',
      catalogoCompleto: mapping.catalogoCompleto ?? false,
    });
  }

  protected startNewMapping(): void {
    this.useExistingMapping.set(false);
    this.selectedMappingId.set(null);
    this.mappingForm.patchValue({ savedMappingId: null, name: '', catalogoCompleto: false });
  }

  /** El mapeo elegido (guardado) dice que la planilla es el catalogo completo. */
  protected mapeoEsCatalogoCompleto(): boolean {
    const id = this.selectedMappingId();
    return this.useExistingMapping() && !!this.preview()?.savedMappings.find((m) => m.id === id)?.catalogoCompleto;
  }

  // ─────────────────────────────────────────────────────────────
  // 10-oct-2026 -- catalogo completo. Pedido de Andres: "si el producto NO ESTA EN LA PAGINA DE MAG,
  // que caduque el precio anterior, porque eso quiere decir que esta sin stock". Con el mapeo marcado,
  // al terminar la carga se pregunta cuantos productos publicados NO vinieron en el archivo, con
  // ejemplos, y recien con el "si" pasan a "sin stock": salen de la app y misuper.app los muestra sin
  // precio. Se deshace con la carga entera, desde Importaciones.
  // ─────────────────────────────────────────────────────────────
  protected readonly catalogo = signal<CatalogoCompletoResult | null>(null);
  protected readonly catalogoLoading = signal(false);
  protected readonly catalogoError = signal<string | null>(null);
  protected readonly catalogoDescartado = signal(false);

  private consultarCatalogo(businessAccountId: number, batchId: number): void {
    this.catalogo.set(null);
    this.catalogoError.set(null);
    this.catalogoDescartado.set(false);
    this.catalogoLoading.set(true);
    this.csvImportService.catalogoCompleto(batchId, businessAccountId, false).subscribe({
      next: (r) => {
        this.catalogoLoading.set(false);
        this.catalogo.set(r);
      },
      error: (err) => {
        this.catalogoLoading.set(false);
        this.catalogoError.set(err?.error?.error ?? 'No pudimos contar los productos que no vinieron en el archivo.');
      },
    });
  }

  protected aplicarCatalogo(): void {
    const c = this.catalogo();
    const { businessAccountId } = this.uploadForm.getRawValue();
    if (!c || !businessAccountId) return;
    this.catalogoLoading.set(true);
    this.catalogoError.set(null);
    this.csvImportService.catalogoCompleto(c.batchId, businessAccountId, true).subscribe({
      next: (r) => {
        this.catalogoLoading.set(false);
        this.catalogo.set(r);
      },
      error: (err) => {
        this.catalogoLoading.set(false);
        this.catalogoError.set(err?.error?.error ?? 'No se pudieron dar de baja. Probá de nuevo.');
      },
    });
  }

  // BP-132 -- catalogo completo de una carga agrupada: UNA confirmacion con las bajas de cada sucursal; el
  // backend lo aplica en todas o en ninguna.
  protected readonly catalogoGrupo = signal<CatalogoCompletoGrupoResult | null>(null);

  private consultarCatalogoGrupo(businessAccountId: number, groupId: number): void {
    this.catalogoGrupo.set(null);
    this.catalogoError.set(null);
    this.catalogoDescartado.set(false);
    this.catalogoLoading.set(true);
    this.csvImportService.catalogoCompletoGrupo(groupId, businessAccountId, false).subscribe({
      next: (r) => {
        this.catalogoLoading.set(false);
        this.catalogoGrupo.set(r);
      },
      error: (err) => {
        this.catalogoLoading.set(false);
        this.catalogoError.set(err?.error?.error ?? 'No pudimos contar los productos que no vinieron en el archivo.');
      },
    });
  }

  protected aplicarCatalogoGrupo(): void {
    const c = this.catalogoGrupo();
    const { businessAccountId } = this.uploadForm.getRawValue();
    if (!c || !businessAccountId) return;
    this.catalogoLoading.set(true);
    this.catalogoError.set(null);
    this.csvImportService.catalogoCompletoGrupo(c.groupId, businessAccountId, true).subscribe({
      next: (r) => {
        this.catalogoLoading.set(false);
        this.catalogoGrupo.set(r);
      },
      error: (err) => {
        this.catalogoLoading.set(false);
        this.catalogoError.set(err?.error?.error ?? 'No se pudieron dar de baja. Probá de nuevo.');
      },
    });
  }

  /** Mas de la mitad de lo publicado se iria a sin stock: casi seguro no es el catalogo entero. */
  protected catalogoSospechoso(c: CatalogoCompletoResult): boolean {
    return c.publicadosAntes > 0 && c.bajas > c.publicadosAntes / 2;
  }

  protected runImport(): void {
    if (this.mappingForm.invalid) {
      this.mappingForm.markAllAsTouched();
      return;
    }

    const { businessAccountId } = this.uploadForm.getRawValue();
    const value = this.mappingForm.getRawValue();
    const file = this.selectedFile();
    if (!file) return;
    // BP-132 -- el destino (una sucursal, una zona o todas) y en cuantas sucursales se aplica cada tanda.
    const destino = this.destinoActual();
    const sucursales = this.sucursalesDelDestino();
    if (!destino || sucursales.length === 0) {
      this.errorMessage.set('Elegí a qué sucursales va la lista.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const nullIfEmpty = (s: string) => (s?.trim() ? s.trim() : null);

    const proceedWithMapping = (mappingId: number, catalogoCompleto: boolean) =>
      this.runInChunks(businessAccountId!, destino, sucursales.length, mappingId, file, catalogoCompleto);

    if (value.savedMappingId) {
      proceedWithMapping(value.savedMappingId, this.mapeoEsCatalogoCompleto());
      return;
    }

    // Mapeo nuevo -- se guarda antes de correr la carga, para que quede disponible
    // la proxima vez sin tener que volver a configurarlo.
    this.csvImportService
      .saveMapping({
        businessAccountId: businessAccountId!,
        name: value.name,
        delimiter: value.delimiter,
        decimalSeparator: value.decimalSeparator,
        eanColumn: value.eanColumn,
        priceColumn: value.priceColumn,
        descriptionColumn: nullIfEmpty(value.descriptionColumn),
        brandColumn: nullIfEmpty(value.brandColumn),
        presentationQuantityColumn: nullIfEmpty(value.presentationQuantityColumn),
        presentationUnitColumn: nullIfEmpty(value.presentationUnitColumn),
        promo1UnitPriceColumn: nullIfEmpty(value.promo1UnitPriceColumn),
        promo1TextColumn: nullIfEmpty(value.promo1TextColumn),
        promo2UnitPriceColumn: nullIfEmpty(value.promo2UnitPriceColumn),
        promo2TextColumn: nullIfEmpty(value.promo2TextColumn),
        promoMinQtyColumn: nullIfEmpty(value.promoMinQtyColumn),
        promoMaxQtyColumn: nullIfEmpty(value.promoMaxQtyColumn),
        promoPercentColumn: nullIfEmpty(value.promoPercentColumn),
        promoMecanicaColumn: nullIfEmpty(value.promoMecanicaColumn),
        costPriceColumn: nullIfEmpty(value.costPriceColumn),
        costPriceWithTaxColumn: nullIfEmpty(value.costPriceWithTaxColumn),
        supplierColumn: nullIfEmpty(value.supplierColumn),
        costValidFromColumn: nullIfEmpty(value.costValidFromColumn),
        costZoneColumn: nullIfEmpty(value.costZoneColumn),
        // BP-178 -- sin el plan no se muestran, pero si el mapeo ya las tenía se conservan.
        codigoInternoColumn: nullIfEmpty(value.codigoInternoColumn),
        ivaColumn: nullIfEmpty(value.ivaColumn),
        rubroColumn: nullIfEmpty(value.rubroColumn),
        unidadesPorBultoColumn: nullIfEmpty(value.unidadesPorBultoColumn),
        eanBultoColumn: nullIfEmpty(value.eanBultoColumn),
        margenColumn: nullIfEmpty(value.margenColumn),
        catalogoCompleto: value.catalogoCompleto,
      })
      .subscribe({
        next: (saved) => proceedWithMapping(saved.id, saved.catalogoCompleto ?? false),
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(err?.error?.error ?? 'No se pudo guardar el mapeo.');
        },
      });
  }

  protected startOver(): void {
    this.step.set('upload');
    this.preview.set(null);
    this.result.set(null);
    this.selectedFile.set(null);
    this.errorMessage.set(null);
    this.catalogo.set(null);
    this.catalogoGrupo.set(null);
    this.catalogoError.set(null);
  }

  // E5.4 -- true si alguna de las anomalias de este resultado vino de la señal "zone"
  // (promedio de competidores), no solo "previous" -- cambia el texto de aviso.
  // E5.7 -- una tanda por llamada, en serie. Errores y anomalias se juntan aca; los
  // contadores ya vienen acumulados del backend (son los del lote en dbo.CsvImportBatch).
  // BP-132 -- con N sucursales cada tanda se aplica N veces: se piden ceil(chunkRows / N) filas por tanda (el
  // servidor ademas capea filas x sucursales). La barra cuenta filas DEL ARCHIVO, no filas x sucursales.
  private runInChunks(
    businessAccountId: number,
    destino: CsvImportDestino,
    cantidadDeSucursales: number,
    mappingId: number,
    file: File,
    catalogoCompleto = false,
  ): void {
    this.catalogo.set(null);
    this.catalogoGrupo.set(null);
    this.catalogoError.set(null);
    this.cargaBranchId = destino.tipo === 'sucursal' ? destino.branchId : null;
    const limit = Math.max(1, Math.ceil(this.chunkRows / Math.max(1, cantidadDeSucursales)));
    const errors: CsvImportRowError[] = [];
    const anomalies: CsvImportPriceAnomaly[] = [];
    let batchId: number | null = null;
    let groupId: number | null = null;
    let costsLoaded = 0;
    // BP-38 -- promos: los contadores vienen por llamada, se suman aca.
    const promosIgnoradasDetalle: CsvImportRowError[] = [];
    const promosConAvisoDetalle: CsvImportRowError[] = [];
    const costosZonaDesconocida: CsvImportRowError[] = [];   // BP-77
    const altasSinMarcaDetalle: CsvImportRowError[] = [];    // BP-135
    const marcasDescartadas: CsvImportRowError[] = [];       // BP-136
    const eanDudosos: CsvImportRowError[] = [];              // BP-137
    const paraConfirmar: PromoParaConfirmar[] = [];          // BP-169
    let paraConfirmarGuardadas = true;
    let promoRulesSaved = 0;
    let promoRulesDeactivated = 0;
    // BP-178 -- fichas de artículo.
    let articulosCreados = 0;
    let articulosActualizados = 0;
    const articulosAvisos: CsvImportRowError[] = [];

    this.progress.set({ done: 0, total: 0, created: 0, updated: 0, failed: 0 });

    const runChunk = (offset: number): void => {
      this.csvImportService
        .run(businessAccountId, destino, mappingId, file, { offset, limit, batchId, groupId })
        .pipe(
          // Reintentos solo ante cortes de red/proxy (status 0, 502/503/504) -- no ante
          // un 4xx, que es un error real. Reprocesar una tanda es seguro: el upsert es
          // idempotente por EAN, a lo sumo los contadores del lote suman de mas.
          retry({
            count: environment.csvImport.retryCount,
            delay: (err) => {
              const status = err?.status as number | undefined;
              if (status === 0 || status === 502 || status === 503 || status === 504) {
                return timer(environment.csvImport.retryDelayMs);
              }
              throw err;
            },
          }),
        )
        .subscribe({
          next: (r) => {
            batchId = r.batchId;
            groupId = r.groupId ?? null;
            errors.push(...r.errors);
            anomalies.push(...r.priceAnomalies);
            costsLoaded += r.costsLoaded ?? 0;
            promosIgnoradasDetalle.push(...(r.promosIgnoradasDetalle ?? []));
            promosConAvisoDetalle.push(...(r.promosConAvisoDetalle ?? []));
            costosZonaDesconocida.push(...(r.costosZonaDesconocida ?? []));
            altasSinMarcaDetalle.push(...(r.altasSinMarcaDetalle ?? []));
            marcasDescartadas.push(...(r.marcasDeRedDescartadasDetalle ?? []));
            eanDudosos.push(...(r.eanDudososDetalle ?? []));
            paraConfirmar.push(...(r.promosParaConfirmarDetalle ?? []));
            if (r.promosParaConfirmarGuardadas === false) paraConfirmarGuardadas = false;
            promoRulesSaved += r.promoRulesSaved ?? 0;
            promoRulesDeactivated += r.promoRulesDeactivated ?? 0;
            articulosCreados += r.articulosCreados ?? 0;
            articulosActualizados += r.articulosActualizados ?? 0;
            articulosAvisos.push(...(r.articulosAvisos ?? []));

            const finished = r.nextOffset === null;
            this.progress.set({
              done: finished ? r.totalRows : r.nextOffset!,
              total: r.totalRows,
              created: r.created,
              updated: r.updated,
              failed: r.failed,
            });

            if (!finished) {
              runChunk(r.nextOffset!);
              return;
            }

            this.loading.set(false);
            this.progress.set(null);
            this.result.set({
              ...r,
              costsLoaded,
              promosIgnoradas: promosIgnoradasDetalle.length,
              promosIgnoradasDetalle,
              promosConAviso: promosConAvisoDetalle.length,
              promosConAvisoDetalle,
              costosZonaDesconocida,
              altasSinMarca: altasSinMarcaDetalle.length,
              altasSinMarcaDetalle,
              marcasDeRedDescartadas: marcasDescartadas.length,
              marcasDeRedDescartadasDetalle: marcasDescartadas,
              eanDudosos: eanDudosos.length,
              eanDudososDetalle: eanDudosos,
              promosParaConfirmar: paraConfirmar.length,
              promosParaConfirmarDetalle: paraConfirmar,
              promosParaConfirmarGuardadas: paraConfirmarGuardadas,
              promoRulesSaved,
              promoRulesDeactivated,
              articulosCreados,
              articulosActualizados,
              articulosAvisos,
              errors,
              // Mismo tope que el backend (MaxAnomalyExamples): 6 ejemplos alcanzan como
              // sanity-check, mas es otra tabla para escanear.
              priceAnomalies: anomalies.slice(0, 6),
            });
            this.step.set('result');
            // Cortada por el cupo del plan no se ofrece: el backend tampoco la deja (archivo incompleto).
            if (catalogoCompleto && !r.stoppedByPlanLimit) {
              if (r.groupId) this.consultarCatalogoGrupo(businessAccountId, r.groupId);
              else this.consultarCatalogo(businessAccountId, r.batchId);
            }
          },
          error: (err) => {
            this.loading.set(false);
            const p = this.progress();
            this.progress.set(null);
            const base = planGateErrorMessage(err) ?? err?.error?.error ?? 'No se pudo procesar el archivo.';
            // Si ya se procesaron tandas, que se sepa: lo cargado quedo cargado y se
            // puede deshacer entero desde el historial (el lote existe).
            this.errorMessage.set(
              batchId !== null && p
                ? groupId !== null
                  ? `${base} Se alcanzaron a procesar ${p.done} de ${p.total} filas antes del error; lo que se cargo queda como una carga en ${cantidadDeSucursales} sucursales en "Importaciones", desde donde podés deshacerla entera o repetir la carga.`
                  : `${base} Se alcanzaron a procesar ${p.done} de ${p.total} filas antes del error; lo que se cargo queda como el lote #${batchId} en "Importaciones", desde donde podés deshacerlo entero o repetir la carga.`
                : base,
            );
          },
        });
    };

    runChunk(0);
  }

  // ─────────────────────────────────────────────────────────────
  // 17-sep-2026 -- corrector de precios en la misma tabla de "precios para revisar".
  // Pedido de Andres: "que me aparezca un boton de editar y se habiliten los campos de
  // precio, para que no queden esos precios feos". El caso tipico es el separador decimal
  // mal configurado ($199.004 donde iban $1.529), asi que ademas del campo editable hay un
  // boton "Volver al anterior" cuando la referencia ES el precio anterior de ese producto.
  //
  // Guarda con el MISMO endpoint que el formulario de Cargar precio (PUT /business/prices),
  // asi pasa por las mismas validaciones, deja su fila en el historial y re-espeja la promo.
  // La promo solo se edita aca si la regla activa es "precio por cantidad": un 3x2 o un
  // porcentaje no se corrigen con un precio suelto (se avisa y se manda a Cargar precio).
  // ─────────────────────────────────────────────────────────────
  private readonly priceService = inject(BusinessPriceService);

  protected readonly editingKey = signal<string | null>(null);
  protected readonly editLoading = signal(false);
  protected readonly editSaving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editListPrice = signal<number | null>(null);
  protected readonly editPromoPrice = signal<number | null>(null);
  /** Producto tal como quedo en la base despues del import (precio, promo y regla activa). */
  protected readonly editItem = signal<BusinessAccountProductItem | null>(null);
  /** Filas ya corregidas: clave -> texto para mostrar en verde. */
  protected readonly corregidas = signal<Record<string, string>>({});

  /** BP-132 -- sucursal de la ultima carga cuando fue a UNA sola (con zona / todas, cada anomalia trae las suyas). */
  private cargaBranchId: string | null = null;

  /** Sucursales donde se corrige esta anomalia: donde aparecio (carga agrupada) o la de la carga. */
  protected sucursalesDeLaAnomalia(a: CsvImportPriceAnomaly): string[] {
    if (a.sucursales?.length) return a.sucursales;
    return [this.cargaBranchId ?? this.uploadForm.getRawValue().branchId];
  }

  protected anomalyKey(a: CsvImportPriceAnomaly): string {
    return `${a.ean}::${a.priceField}`;
  }

  /** true si esta fila toca la promo (no el precio de lista). */
  protected esPromo(a: CsvImportPriceAnomaly): boolean {
    return a.priceField !== 'ListPrice';
  }

  /** La promo de este producto se puede corregir con un precio suelto (regla precio por cantidad). */
  protected promoEditable(): boolean {
    const rule = this.editItem()?.promoRule;
    return !rule || rule.tipo === 'precio_unitario';
  }

  protected startEdit(a: CsvImportPriceAnomaly): void {
    const { businessAccountId } = this.uploadForm.getRawValue();
    const branchId = this.sucursalesDeLaAnomalia(a)[0];
    if (!businessAccountId) return;
    this.editingKey.set(this.anomalyKey(a));
    this.editError.set(null);
    this.editItem.set(null);
    this.editLoading.set(true);
    this.editListPrice.set(null);
    this.editPromoPrice.set(null);

    this.priceService.getOwnProduct(businessAccountId, branchId, a.ean).subscribe({
      next: (page) => {
        this.editLoading.set(false);
        const item = page.items[0] ?? null;
        this.editItem.set(item);
        this.editListPrice.set(item?.listPrice ?? a.newPrice);
        this.editPromoPrice.set(item?.promoRule?.precioPromo ?? item?.promo1UnitPrice ?? null);
        if (!item) this.editError.set('No encontramos ese producto en esta sucursal.');
      },
      error: () => {
        this.editLoading.set(false);
        this.editError.set('No pudimos leer el producto. Probá de nuevo.');
      },
    });
  }

  protected cancelEdit(): void {
    this.editingKey.set(null);
    this.editError.set(null);
  }

  /** "Volver al anterior": pone en el campo el precio contra el que se detectó la anomalía. */
  protected usarReferencia(a: CsvImportPriceAnomaly): void {
    if (this.esPromo(a)) this.editPromoPrice.set(a.referencePrice);
    else this.editListPrice.set(a.referencePrice);
  }

  protected saveEdit(a: CsvImportPriceAnomaly): void {
    const { businessAccountId } = this.uploadForm.getRawValue();
    // BP-132 -- en una carga agrupada se corrige en todas las sucursales donde aparecio la anomalia.
    const sucursales = this.sucursalesDeLaAnomalia(a);
    const branchId = sucursales[0];
    const item = this.editItem();
    const listPrice = Number(this.editListPrice());
    if (!businessAccountId || !item) return;
    if (!(listPrice > 0)) {
      this.editError.set('El precio tiene que ser mayor a cero.');
      return;
    }

    const promoPrice = this.editPromoPrice() === null ? null : Number(this.editPromoPrice());
    const rule = item.promoRule ?? null;
    const request: UpsertBusinessPriceRequest = {
      businessAccountId,
      branchId,
      ean: a.ean,
      listPrice,
      description: item.description,
      brand: item.brand,
      presentationQuantity: item.presentationQuantity,
      presentationUnit: item.presentationUnit,
      promo2UnitPrice: null,
      promo2Text: item.promo2Text ?? null,
    };
    // Con promoRule AUSENTE el servidor no toca la regla (y re-espeja con el precio nuevo).
    // Solo se manda regla si se cambió el precio promo de una regla "precio por cantidad",
    // o si se está sacando la promo.
    if (this.esPromo(a) && this.promoEditable()) {
      request.promoRule =
        promoPrice && promoPrice > 0
          ? {
              id: null,
              branchId: rule?.branchId ?? null,
              tipo: 'precio_unitario',
              minQty: rule?.minQty ?? 1,
              maxQty: rule?.maxQty ?? null,
              precioPromo: promoPrice,
              porcentaje: null,
              grupoN: null,
              pagaM: null,
              cadaN: null,
              validFrom: rule?.validFrom ?? null,
              validTo: rule?.validTo ?? null,
              leyenda: rule?.leyenda ?? null,
            }
          : null;
      // BP-40 (10-oct-2026) -- corregir el precio de una promo de cuenta la sigue guardando como de
      // cuenta; SACARLA desde acá la apaga solo en esta sucursal (para todas, desde Cargar precio).
      request.promoRuleTodasLasSucursales = request.promoRule && rule ? rule.branchId === null : false;
    }

    this.editSaving.set(true);
    this.editError.set(null);
    // Una por sucursal, en serie. Una regla de sucursal se guarda como de ESA sucursal; una de cuenta, de cuenta.
    const pedidos = sucursales.map((b) =>
      this.priceService.upsert({
        ...request,
        branchId: b,
        promoRule: request.promoRule ? { ...request.promoRule, branchId: request.promoRule.branchId === null ? null : b } : request.promoRule,
      }),
    );
    concat(...pedidos).pipe(toArray()).subscribe({
      next: (respuestas) => {
        const resp = respuestas[respuestas.length - 1];
        this.editSaving.set(false);
        this.editingKey.set(null);
        const donde = sucursales.length > 1 ? ` en ${sucursales.length} sucursales` : '';
        const texto =
          this.esPromo(a) && this.promoEditable()
            ? `corregido${donde}: lista $${resp.listPrice}${resp.promo1UnitPrice ? ` · promo $${resp.promo1UnitPrice}` : ' · sin promo'}`
            : `corregido${donde}: $${resp.listPrice}`;
        this.corregidas.set({ ...this.corregidas(), [this.anomalyKey(a)]: texto });
      },
      error: (err) => {
        this.editSaving.set(false);
        this.editError.set(err?.error?.error ?? 'No se pudo guardar el precio.');
      },
    });
  }

  /** BP-136 -- los primeros de una lista de avisos, para mostrar en una linea. */
  protected ejemplos(lista: CsvImportRowError[]): string {
    return lista.slice(0, 6).map((e) => e.reason).join(' · ');
  }

  /** BP-135 -- los primeros productos que quedaron sin marca, para el aviso del resultado. */
  protected ejemplosSinMarca(r: CsvImportResult): string {
    return (r.altasSinMarcaDetalle ?? []).slice(0, 8).map((e) => e.reason).join(' · ');
  }

  protected hasZoneAnomaly(result: CsvImportResult): boolean {
    return result.priceAnomalies.some((a) => a.referenceType === 'zone');
  }

  protected anomalyDeltaLabel(anomaly: CsvImportPriceAnomaly): string {
    if (!anomaly.referencePrice) return '—';
    const ratio = anomaly.newPrice / anomaly.referencePrice;
    const pct = ((ratio - 1) * 100).toFixed(0);
    return ratio > 1 ? `+${pct}%` : `${pct}%`;
  }

  // E12 (19-ago-2026) -- de que campo salio la anomalia (lista o una de las promos),
  // para la columna "Campo" de la tabla de anomalias del resultado.
  protected anomalyFieldLabel(anomaly: CsvImportPriceAnomaly): string {
    switch (anomaly.priceField) {
      case 'Promo1':
        return 'Promo 1';
      case 'Promo2':
        return 'Promo 2';
      default:
        return 'Precio de lista';
    }
  }
}
