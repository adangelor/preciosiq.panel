import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { retry, timer } from 'rxjs';
import { CsvImportService } from '../../core/csv-import';
import {
  CsvImportPriceAnomaly,
  CsvImportResult,
  CsvImportRowError,
  CsvMapping,
  CsvPreviewResponse,
} from '../../core/csv-import.models';
import { BusinessPriceService } from '../../core/business-price';
import { BusinessAccountProductItem, UpsertBusinessPriceRequest } from '../../core/business-price.models';
import { planGateErrorMessage } from '../../core/plan-gate';
import { BusinessContextService } from '../../core/business-context';
import { BranchListItem } from '../../core/business-account.models';
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
  imports: [ReactiveFormsModule, FormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './csv-import.html',
  styleUrl: './csv-import.scss',
})
export class CsvImportComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly csvImportService = inject(CsvImportService);
  private readonly context = inject(BusinessContextService);

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

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.branches.set(ctx.branches);
        this.uploadForm.patchValue({ businessAccountId: ctx.account.businessAccountId });
        if (ctx.branches.length > 0) {
          this.uploadForm.patchValue({ branchId: ctx.branches[0].branchId });
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
    costPriceColumn: [''],
    costPriceWithTaxColumn: [''],
    supplierColumn: [''],
    costValidFromColumn: [''],
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
      costPriceColumn: mapping.costPriceColumn ?? '',
      costPriceWithTaxColumn: mapping.costPriceWithTaxColumn ?? '',
      supplierColumn: mapping.supplierColumn ?? '',
      costValidFromColumn: mapping.costValidFromColumn ?? '',
    });
  }

  protected startNewMapping(): void {
    this.useExistingMapping.set(false);
    this.selectedMappingId.set(null);
    this.mappingForm.patchValue({ savedMappingId: null, name: '' });
  }

  protected runImport(): void {
    if (this.mappingForm.invalid) {
      this.mappingForm.markAllAsTouched();
      return;
    }

    const { businessAccountId, branchId } = this.uploadForm.getRawValue();
    const value = this.mappingForm.getRawValue();
    const file = this.selectedFile();
    if (!file) return;

    this.loading.set(true);
    this.errorMessage.set(null);

    const nullIfEmpty = (s: string) => (s?.trim() ? s.trim() : null);

    const proceedWithMapping = (mappingId: number) => this.runInChunks(businessAccountId!, branchId, mappingId, file);

    if (value.savedMappingId) {
      proceedWithMapping(value.savedMappingId);
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
        costPriceColumn: nullIfEmpty(value.costPriceColumn),
        costPriceWithTaxColumn: nullIfEmpty(value.costPriceWithTaxColumn),
        supplierColumn: nullIfEmpty(value.supplierColumn),
        costValidFromColumn: nullIfEmpty(value.costValidFromColumn),
      })
      .subscribe({
        next: (saved) => proceedWithMapping(saved.id),
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
  }

  // E5.4 -- true si alguna de las anomalias de este resultado vino de la señal "zone"
  // (promedio de competidores), no solo "previous" -- cambia el texto de aviso.
  // E5.7 -- una tanda por llamada, en serie. Errores y anomalias se juntan aca; los
  // contadores ya vienen acumulados del backend (son los del lote en dbo.CsvImportBatch).
  private runInChunks(businessAccountId: number, branchId: string, mappingId: number, file: File): void {
    const errors: CsvImportRowError[] = [];
    const anomalies: CsvImportPriceAnomaly[] = [];
    let batchId: number | null = null;
    let costsLoaded = 0;
    // BP-38 -- promos: los contadores vienen por llamada, se suman aca.
    const promosIgnoradasDetalle: CsvImportRowError[] = [];
    const promosConAvisoDetalle: CsvImportRowError[] = [];
    let promoRulesSaved = 0;
    let promoRulesDeactivated = 0;

    this.progress.set({ done: 0, total: 0, created: 0, updated: 0, failed: 0 });

    const runChunk = (offset: number): void => {
      this.csvImportService
        .run(businessAccountId, branchId, mappingId, file, { offset, limit: this.chunkRows, batchId })
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
            errors.push(...r.errors);
            anomalies.push(...r.priceAnomalies);
            costsLoaded += r.costsLoaded ?? 0;
            promosIgnoradasDetalle.push(...(r.promosIgnoradasDetalle ?? []));
            promosConAvisoDetalle.push(...(r.promosConAvisoDetalle ?? []));
            promoRulesSaved += r.promoRulesSaved ?? 0;
            promoRulesDeactivated += r.promoRulesDeactivated ?? 0;

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
              promoRulesSaved,
              promoRulesDeactivated,
              errors,
              // Mismo tope que el backend (MaxAnomalyExamples): 6 ejemplos alcanzan como
              // sanity-check, mas es otra tabla para escanear.
              priceAnomalies: anomalies.slice(0, 6),
            });
            this.step.set('result');
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
                ? `${base} Se alcanzaron a procesar ${p.done} de ${p.total} filas antes del error; lo que se cargo queda como el lote #${batchId} en "Importaciones", desde donde podés deshacerlo entero o repetir la carga.`
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
    const { businessAccountId, branchId } = this.uploadForm.getRawValue();
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
    const { businessAccountId, branchId } = this.uploadForm.getRawValue();
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
      request.promoRuleTodasLasSucursales = rule ? rule.branchId === null : false;
    }

    this.editSaving.set(true);
    this.editError.set(null);
    this.priceService.upsert(request).subscribe({
      next: (resp) => {
        this.editSaving.set(false);
        this.editingKey.set(null);
        const texto =
          this.esPromo(a) && this.promoEditable()
            ? `corregido: lista $${resp.listPrice}${resp.promo1UnitPrice ? ` · promo $${resp.promo1UnitPrice}` : ' · sin promo'}`
            : `corregido: $${resp.listPrice}`;
        this.corregidas.set({ ...this.corregidas(), [this.anomalyKey(a)]: texto });
      },
      error: (err) => {
        this.editSaving.set(false);
        this.editError.set(err?.error?.error ?? 'No se pudo guardar el precio.');
      },
    });
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
