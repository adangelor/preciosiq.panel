import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BusinessContextService } from '../../core/business-context';
import { BranchListItem } from '../../core/business-account.models';
import { SalesImportResult, SalesImportService, SalesPreviewResponse } from '../../core/sales-import';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

type Step = 'upload' | 'map' | 'result';

// E13 (25-ago-2026) -- "Cargar ventas": unidades vendidas por EAN y periodo, el segundo
// archivo que pide el Asesor de Precios (spec §7) para priorizar todo en $/mes (nivel
// Ganancia). Tres pasos, calcados de la carga masiva de precios: subir -> decir que
// columna es que (+ el periodo) -> resultado. No hay mapeos guardados en la base: son
// dos o tres columnas, y el ultimo mapeo queda recordado en el navegador por cuenta.
@Component({
  selector: 'app-sales-import',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LoadingBarComponent],
  templateUrl: './sales-import.html',
  styleUrl: './sales-import.scss',
})
export class SalesImportComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly salesImportService = inject(SalesImportService);
  private readonly context = inject(BusinessContextService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly branches = signal<BranchListItem[]>([]);
  private readonly businessAccountId = signal<number | null>(null);

  protected readonly step = signal<Step>('upload');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly preview = signal<SalesPreviewResponse | null>(null);
  protected readonly result = signal<SalesImportResult | null>(null);
  protected readonly selectedFile = signal<File | null>(null);

  protected readonly uploadForm = this.fb.nonNullable.group({
    // '' = total de la cuenta (sin sucursal).
    branchId: [''],
  });

  protected readonly mappingForm = this.fb.nonNullable.group({
    eanColumn: ['', [Validators.required]],
    unitsColumn: ['', [Validators.required]],
    revenueColumn: [''],
    decimalSeparator: [',' as ',' | '.'],
    periodMode: ['fixed' as 'fixed' | 'columns'],
    periodFrom: [''],
    periodTo: [''],
    periodFromColumn: [''],
    periodToColumn: [''],
  });

  protected readonly periodMode = toSignal(this.mappingForm.controls.periodMode.valueChanges, {
    initialValue: this.mappingForm.controls.periodMode.value,
  });

  protected readonly selectedBranchName = computed(() => {
    const id = this.uploadForm.controls.branchId.value;
    return this.branches().find((b) => b.branchId === id)?.branchName ?? null;
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
        this.businessAccountId.set(ctx.account.businessAccountId);
        this.restoreLastMapping(ctx.account.businessAccountId);
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
    // Default del periodo fijo: el mes pasado completo, que es el export tipico.
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    this.mappingForm.patchValue({ periodFrom: toIsoDate(from), periodTo: toIsoDate(to) });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  protected loadPreview(): void {
    const accountId = this.businessAccountId();
    const file = this.selectedFile();
    if (!accountId || !file) {
      this.errorMessage.set('Elegí un archivo CSV.');
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.salesImportService.preview(accountId, file).subscribe({
      next: (preview) => {
        this.loading.set(false);
        this.preview.set(preview);
        this.guessColumns(preview.headers);
        this.step.set('map');
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo leer el archivo.');
      },
    });
  }

  protected runImport(): void {
    const accountId = this.businessAccountId();
    const file = this.selectedFile();
    if (!accountId || !file) return;

    const v = this.mappingForm.getRawValue();
    if (this.mappingForm.invalid) {
      this.mappingForm.markAllAsTouched();
      return;
    }
    if (v.periodMode === 'fixed' && (!v.periodFrom || !v.periodTo)) {
      this.errorMessage.set('Indicá desde y hasta qué fecha son estas ventas.');
      return;
    }
    if (v.periodMode === 'fixed' && v.periodTo < v.periodFrom) {
      this.errorMessage.set('La fecha "hasta" no puede ser anterior a "desde".');
      return;
    }
    if (v.periodMode === 'columns' && !v.periodFromColumn) {
      this.errorMessage.set('Indicá qué columna trae la fecha del período.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.salesImportService
      .run({
        businessAccountId: accountId,
        branchId: this.uploadForm.controls.branchId.value || null,
        file,
        eanColumn: v.eanColumn,
        unitsColumn: v.unitsColumn,
        revenueColumn: v.revenueColumn || null,
        decimalSeparator: v.decimalSeparator,
        periodMode: v.periodMode,
        periodFrom: v.periodFrom,
        periodTo: v.periodTo,
        periodFromColumn: v.periodFromColumn || null,
        periodToColumn: v.periodToColumn || null,
      })
      .subscribe({
        next: (result) => {
          this.loading.set(false);
          this.result.set(result);
          this.rememberMapping(accountId);
          this.step.set('result');
        },
        error: (err) => {
          this.loading.set(false);
          this.errorMessage.set(err?.error?.error ?? 'No se pudieron cargar las ventas.');
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

  // Adivina las columnas por nombre (EAN / codigo de barras, unidades / cantidad /
  // vendidas, importe / total / ingresos) si no habia un mapeo recordado. Es solo un
  // prefill: la persona confirma en el paso 2.
  private guessColumns(headers: string[]): void {
    const has = (c: string) => headers.includes(c);
    const find = (patterns: RegExp[]) => headers.find((h) => patterns.some((p) => p.test(h.trim()))) ?? '';
    const v = this.mappingForm.getRawValue();
    this.mappingForm.patchValue({
      eanColumn: has(v.eanColumn) ? v.eanColumn : find([/^ean$/i, /ean/i, /barra/i, /c[oó]digo/i, /sku/i]),
      unitsColumn: has(v.unitsColumn) ? v.unitsColumn : find([/unidades/i, /cantidad/i, /vendid/i, /^cant/i, /^qty/i, /units/i]),
      revenueColumn: has(v.revenueColumn) ? v.revenueColumn : find([/importe/i, /total/i, /ingreso/i, /venta.*\$/i, /monto/i, /revenue/i]),
      periodFromColumn: has(v.periodFromColumn) ? v.periodFromColumn : find([/fecha/i, /desde/i, /periodo/i, /per[ií]odo/i, /^date/i]),
      periodToColumn: has(v.periodToColumn) ? v.periodToColumn : find([/hasta/i, /fecha.*fin/i]),
    });
  }

  private storageKey(accountId: number): string {
    return `retailiq.salesImportMapping.${accountId}`;
  }

  private rememberMapping(accountId: number): void {
    try {
      const { eanColumn, unitsColumn, revenueColumn, decimalSeparator, periodMode, periodFromColumn, periodToColumn } =
        this.mappingForm.getRawValue();
      localStorage.setItem(
        this.storageKey(accountId),
        JSON.stringify({ eanColumn, unitsColumn, revenueColumn, decimalSeparator, periodMode, periodFromColumn, periodToColumn }),
      );
    } catch {
      // sin storage: se pierde el recuerdo, no la carga
    }
  }

  private restoreLastMapping(accountId: number): void {
    try {
      const raw = localStorage.getItem(this.storageKey(accountId));
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<ReturnType<typeof this.mappingForm.getRawValue>>;
      this.mappingForm.patchValue(saved);
    } catch {
      // JSON roto o sin storage: arranca de cero
    }
  }
}

function toIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
