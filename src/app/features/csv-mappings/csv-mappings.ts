import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CsvImportService } from '../../core/csv-import';
import { CsvMapping, CsvMappingTestResult, SaveCsvMappingRequest } from '../../core/csv-import.models';
import { BusinessContextService } from '../../core/business-context';

/** Las columnas de un mapeo que se pueden reasignar (BP-47). */
type CampoColumna = Extract<
  keyof SaveCsvMappingRequest & keyof CsvMapping,
  | 'eanColumn' | 'priceColumn' | 'descriptionColumn' | 'brandColumn' | 'presentationQuantityColumn'
  | 'presentationUnitColumn' | 'promo1UnitPriceColumn' | 'promo1TextColumn' | 'promoPercentColumn'
  | 'promoMinQtyColumn' | 'promoMaxQtyColumn' | 'promo2UnitPriceColumn' | 'promo2TextColumn'
  | 'costPriceColumn' | 'costPriceWithTaxColumn' | 'supplierColumn' | 'costValidFromColumn'
>;

// 17-sep-2026 -- pedido de Andres: "que el mapeo de columnas se pueda guardar y administrar;
// que en la carga masiva me muestre solo el ultimo usado, y una pagina con todos los mapeos
// historicos que me muestre sus caracteristicas -- si no, se me acumulan 1000 mapeos y no
// tengo idea de cual es la diferencia que los diferencia. Y poder probar cada mapeo con un
// archivo, a ver si coincide".
//
// Un mapeo NO se borra: se archiva. dbo.CsvImportBatch.MappingId apunta a estas filas y el
// historial de importaciones muestra con que mapeo se cargo cada vez; borrarlo dejaria esas
// cargas sin nombre. Un archivado no aparece en la carga masiva y se puede desarchivar.
@Component({
  selector: 'app-csv-mappings',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './csv-mappings.html',
  styleUrl: './csv-mappings.scss',
})
export class CsvMappingsComponent implements OnInit {
  private readonly csvImportService = inject(CsvImportService);
  private readonly context = inject(BusinessContextService);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly businessAccountId = signal<number | null>(null);

  protected readonly mappings = signal<CsvMapping[]>([]);
  protected readonly incluirArchivados = signal(false);

  /** Fila abierta: se ven sus columnas y el bloque para probarla con un archivo. */
  protected readonly expandedId = signal<number | null>(null);
  protected readonly renamingId = signal<number | null>(null);
  protected readonly newName = signal('');
  protected readonly saving = signal(false);

  protected readonly testFile = signal<File | null>(null);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<CsvMappingTestResult | null>(null);

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        if (!ctx) {
          this.loading.set(false);
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId.set(ctx.account.businessAccountId);
        this.load();
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected load(): void {
    const accountId = this.businessAccountId();
    if (!accountId) return;
    this.loading.set(true);
    this.csvImportService.listMappings(accountId, this.incluirArchivados()).subscribe({
      next: (mappings) => {
        this.loading.set(false);
        this.mappings.set(mappings);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos cargar tus mapeos.');
      },
    });
  }

  protected toggleArchivados(): void {
    this.incluirArchivados.set(!this.incluirArchivados());
    this.load();
  }

  protected toggle(m: CsvMapping): void {
    const abierto = this.expandedId() === m.id;
    this.expandedId.set(abierto ? null : m.id);
    this.testResult.set(null);
    this.testFile.set(null);
    this.editandoId.set(null);
  }

  /** Las columnas mapeadas, en el orden en que se usan. Las que no se mapearon no se muestran. */
  protected columnas(m: CsvMapping): { campo: string; columna: string }[] {
    const todos: [string, string | null | undefined][] = [
      ['EAN', m.eanColumn],
      ['Precio', m.priceColumn],
      ['Descripción', m.descriptionColumn],
      ['Marca', m.brandColumn],
      ['Cantidad', m.presentationQuantityColumn],
      ['Unidad', m.presentationUnitColumn],
      ['Precio promo', m.promo1UnitPriceColumn],
      ['Leyenda de promo', m.promo1TextColumn],
      ['Descuento %', m.promoPercentColumn],
      ['Llevando desde', m.promoMinQtyColumn],
      ['Llevando hasta', m.promoMaxQtyColumn],
      ['Precio promo 2', m.promo2UnitPriceColumn],
      ['Leyenda adicional', m.promo2TextColumn],
      ['Costo sin IVA', m.costPriceColumn],
      ['Costo con IVA', m.costPriceWithTaxColumn],
      ['Proveedor', m.supplierColumn],
      ['Vigencia del costo', m.costValidFromColumn],
    ];
    return todos.filter(([, c]) => !!c?.trim()).map(([campo, columna]) => ({ campo, columna: columna! }));
  }

  /** Resumen de una linea para la tabla: las primeras columnas, y cuántas más hay. */
  protected resumenColumnas(m: CsvMapping): string {
    const cols = this.columnas(m);
    const primeras = cols.slice(0, 4).map((c) => `${c.campo}: ${c.columna}`).join(' · ');
    return cols.length > 4 ? `${primeras} · +${cols.length - 4} más` : primeras;
  }

  protected startRename(m: CsvMapping): void {
    this.renamingId.set(m.id);
    this.newName.set(m.name);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  protected submitRename(m: CsvMapping): void {
    const accountId = this.businessAccountId();
    const nombre = this.newName().trim();
    if (!accountId || !nombre || nombre === m.name) {
      this.renamingId.set(null);
      return;
    }
    this.saving.set(true);
    // El PUT manda el mapeo completo (mismo cuerpo que al guardarlo): acá solo cambia el nombre.
    this.csvImportService
      .updateMapping(m.id, this.cuerpo(m, accountId, { name: nombre }))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.renamingId.set(null);
          this.load();
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMessage.set(err?.error?.error ?? 'No se pudo renombrar el mapeo.');
        },
      });
  }

  // 10-oct-2026 -- "Esta planilla es mi catalogo completo": prender o apagar la opcion de un mapeo ya
  // guardado (el de MAG, por ejemplo), sin tener que armar uno nuevo.
  protected toggleCatalogo(m: CsvMapping): void {
    const accountId = this.businessAccountId();
    if (!accountId) return;
    this.saving.set(true);
    this.csvImportService
      .updateMapping(m.id, this.cuerpo(m, accountId, { catalogoCompleto: !m.catalogoCompleto }))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.load();
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMessage.set(err?.error?.error ?? 'No se pudo cambiar el mapeo.');
        },
      });
  }

  /** El mapeo completo para el PUT, con lo que cambia encima. */
  private cuerpo(m: CsvMapping, accountId: number, cambios: Partial<SaveCsvMappingRequest>): SaveCsvMappingRequest {
    return {
        businessAccountId: accountId,
        name: m.name,
        delimiter: m.delimiter,
        decimalSeparator: m.decimalSeparator,
        eanColumn: m.eanColumn,
        priceColumn: m.priceColumn,
        descriptionColumn: m.descriptionColumn,
        brandColumn: m.brandColumn,
        presentationQuantityColumn: m.presentationQuantityColumn,
        presentationUnitColumn: m.presentationUnitColumn,
        promo1UnitPriceColumn: m.promo1UnitPriceColumn,
        promo1TextColumn: m.promo1TextColumn,
        promo2UnitPriceColumn: m.promo2UnitPriceColumn,
        promo2TextColumn: m.promo2TextColumn,
        costPriceColumn: m.costPriceColumn,
        costPriceWithTaxColumn: m.costPriceWithTaxColumn,
        supplierColumn: m.supplierColumn,
        costValidFromColumn: m.costValidFromColumn,
        promoMinQtyColumn: m.promoMinQtyColumn ?? null,
        promoMaxQtyColumn: m.promoMaxQtyColumn ?? null,
        promoPercentColumn: m.promoPercentColumn ?? null,
        catalogoCompleto: m.catalogoCompleto ?? false,
        ...cambios,
    };
  }

  protected archivar(m: CsvMapping): void {
    const accountId = this.businessAccountId();
    if (!accountId) return;
    this.saving.set(true);
    const op = m.archivedAt
      ? this.csvImportService.restoreMapping(m.id, accountId)
      : this.csvImportService.archiveMapping(m.id, accountId);
    op.subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo cambiar el estado del mapeo.');
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // BP-47 (10-oct-2026) -- editar las columnas de un mapeo guardado. Pedido de Andres despues de
  // tener que mapear la columna Marca de MAG por SQL. Se edita CON UN ARCHIVO probado: los
  // desplegables ofrecen los encabezados de ese archivo (mas la columna que el mapeo ya tenia, por
  // si el archivo de prueba no la trae). El mapeo conserva su id, asi que el historial de
  // importaciones y el "ultimo usado" de la carga masiva no cambian.
  // ─────────────────────────────────────────────────────────────
  protected readonly camposEditables: { key: CampoColumna; campo: string; obligatorio?: boolean }[] = [
    { key: 'eanColumn', campo: 'EAN', obligatorio: true },
    { key: 'priceColumn', campo: 'Precio', obligatorio: true },
    { key: 'descriptionColumn', campo: 'Descripción' },
    { key: 'brandColumn', campo: 'Marca' },
    { key: 'presentationQuantityColumn', campo: 'Cantidad' },
    { key: 'presentationUnitColumn', campo: 'Unidad' },
    { key: 'promo1UnitPriceColumn', campo: 'Precio promo' },
    { key: 'promo1TextColumn', campo: 'Leyenda de promo' },
    { key: 'promoPercentColumn', campo: 'Descuento %' },
    { key: 'promoMinQtyColumn', campo: 'Llevando desde' },
    { key: 'promoMaxQtyColumn', campo: 'Llevando hasta' },
    { key: 'promo2UnitPriceColumn', campo: 'Precio promo 2' },
    { key: 'promo2TextColumn', campo: 'Leyenda adicional' },
    { key: 'costPriceColumn', campo: 'Costo sin IVA' },
    { key: 'costPriceWithTaxColumn', campo: 'Costo con IVA' },
    { key: 'supplierColumn', campo: 'Proveedor' },
    { key: 'costValidFromColumn', campo: 'Vigencia del costo' },
  ];

  protected readonly editandoId = signal<number | null>(null);
  protected readonly borrador = signal<Record<string, string>>({});
  protected readonly editError = signal<string | null>(null);

  /** Se puede editar si el archivo probado es de este mapeo (sus encabezados son las opciones). */
  protected puedeEditar(m: CsvMapping): boolean {
    return this.testResult()?.mappingId === m.id;
  }

  protected startEditColumnas(m: CsvMapping): void {
    const b: Record<string, string> = {
      delimiter: m.delimiter,
      decimalSeparator: m.decimalSeparator,
    };
    for (const c of this.camposEditables) b[c.key] = (m[c.key] as string | null | undefined) ?? '';
    this.borrador.set(b);
    this.editError.set(null);
    this.editandoId.set(m.id);
  }

  protected cancelEditColumnas(): void {
    this.editandoId.set(null);
    this.editError.set(null);
  }

  protected setBorrador(key: string, value: string): void {
    this.borrador.set({ ...this.borrador(), [key]: value });
  }

  /** Encabezados del archivo probado, mas la columna actual si el archivo no la trae. */
  protected opciones(actual: string): string[] {
    const headers = this.testResult()?.headers ?? [];
    return actual && !headers.includes(actual) ? [actual, ...headers] : headers;
  }

  protected enArchivo(col: string): boolean {
    return !col || (this.testResult()?.headers ?? []).includes(col);
  }

  protected guardarColumnas(m: CsvMapping): void {
    const accountId = this.businessAccountId();
    if (!accountId) return;
    const b = this.borrador();
    if (!b['eanColumn']?.trim() || !b['priceColumn']?.trim()) {
      this.editError.set('EAN y Precio son obligatorios.');
      return;
    }
    const cambios: Partial<SaveCsvMappingRequest> = {
      delimiter: b['delimiter'],
      decimalSeparator: b['decimalSeparator'],
    };
    for (const c of this.camposEditables) {
      const v = b[c.key]?.trim() ?? '';
      (cambios as Record<string, string | null>)[c.key] = c.obligatorio ? v : v || null;
    }
    this.saving.set(true);
    this.editError.set(null);
    this.csvImportService.updateMapping(m.id, this.cuerpo(m, accountId, cambios)).subscribe({
      next: (guardado) => {
        this.saving.set(false);
        this.editandoId.set(null);
        this.mappings.set(this.mappings().map((x) => (x.id === guardado.id ? guardado : x)));
        // Se vuelve a probar con el mismo archivo: lo que se ve abajo es el mapeo nuevo.
        if (this.testFile()) this.probar(guardado);
      },
      error: (err) => {
        this.saving.set(false);
        this.editError.set(err?.error?.error ?? 'No se pudo guardar el mapeo.');
      },
    });
  }

  protected onTestFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.testFile.set(input.files?.[0] ?? null);
    this.testResult.set(null);
  }

  protected probar(m: CsvMapping): void {
    const accountId = this.businessAccountId();
    const file = this.testFile();
    if (!accountId || !file) return;
    this.testing.set(true);
    this.testResult.set(null);
    this.csvImportService.testMapping(m.id, accountId, file).subscribe({
      next: (result) => {
        this.testing.set(false);
        this.testResult.set(result);
      },
      error: (err) => {
        this.testing.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo leer el archivo.');
      },
    });
  }
}
