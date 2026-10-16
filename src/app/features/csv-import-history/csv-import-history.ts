import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CsvImportService } from '../../core/csv-import';
import { CsvImportBatch, CsvImportGroup } from '../../core/csv-import.models';
import { BusinessContextService } from '../../core/business-context';

// BP-132 (16-oct-2026) -- una fila del historial: un lote suelto (carga a una sucursal, como siempre) o una carga
// agrupada (zona / todas las sucursales) que se despliega con el lote de cada sucursal.
type FilaHistorial =
  | { tipo: 'lote'; importedAt: string; lote: CsvImportBatch }
  | { tipo: 'grupo'; importedAt: string; grupo: CsvImportGroup };

// E5.5 (16-ago-2026) -- pedido de Andres tras un import real con el separador decimal
// mal configurado (~900% de mas en casi todos los precios): "como elimino los precios
// que cargo el ñato" + "deberia haber una pantalla donde pueda cargar las ultimas
// importaciones para desimportar si fuera necesario, ¿no?". Lista las ultimas 20
// corridas de carga masiva (BusinessCsvImportEndpoints.ListBatches) y permite deshacer
// una entera (UndoBatch) -- restaura el precio anterior de cada producto que la corrida
// actualizo y borra los que creo de cero.
//
// BP-132 (16-oct-2026) -- una carga a una zona o a todas las sucursales es UNA fila ("Zona Córdoba Capital · 3
// sucursales"), con Deshacer de la carga entera; desplegada, el lote de cada sucursal con su propio Deshacer.
// Con algun lote deshecho suelto, la carga dice "deshecha en parte".
@Component({
  selector: 'app-csv-import-history',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './csv-import-history.html',
  styleUrl: './csv-import-history.scss',
})
export class CsvImportHistoryComponent implements OnInit {
  private readonly csvImportService = inject(CsvImportService);
  private readonly context = inject(BusinessContextService);

  private businessAccountId: number | null = null;

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly filas = signal<FilaHistorial[]>([]);
  /** Cargas agrupadas desplegadas (por id de grupo). */
  protected readonly abiertos = signal<Record<number, boolean>>({});

  // Id del lote (o 'g' + id del grupo) que se esta deshaciendo ahora mismo -- deshabilita SOLO su boton, no
  // toda la pantalla (podrian ser lotes de sucursales distintas).
  protected readonly undoingId = signal<string | null>(null);
  protected readonly undoMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId = ctx.account.businessAccountId;
        this.loadBatches();
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected loadBatches(): void {
    if (!this.businessAccountId) return;
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      batches: this.csvImportService.listBatches(this.businessAccountId),
      // Un backend sin BP-132 no tiene /groups: el historial sigue con los lotes, como antes.
      groups: this.csvImportService.listGroups(this.businessAccountId).pipe(catchError(() => of([] as CsvImportGroup[]))),
    }).subscribe({
      next: ({ batches, groups }) => {
        this.loading.set(false);
        const enGrupos = new Set(groups.map((g) => g.id));
        const filas: FilaHistorial[] = [
          ...groups.map((g) => ({ tipo: 'grupo' as const, importedAt: g.importedAt, grupo: g })),
          ...batches
            .filter((b) => !(b.groupId != null && enGrupos.has(b.groupId)))
            .map((b) => ({ tipo: 'lote' as const, importedAt: b.importedAt, lote: b })),
        ];
        filas.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
        this.filas.set(filas);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo cargar el historial de importaciones.');
      },
    });
  }

  protected destinoDeLaCarga(g: CsvImportGroup): string {
    const n = `${g.sucursales} sucursal${g.sucursales === 1 ? '' : 'es'}`;
    return g.destino === 'zona' ? `Zona ${g.zonaNombre ?? ''} · ${n}` : `Todas las sucursales · ${g.sucursales}`;
  }

  protected alternar(g: CsvImportGroup): void {
    this.abiertos.set({ ...this.abiertos(), [g.id]: !this.abiertos()[g.id] });
  }

  protected undo(batch: CsvImportBatch): void {
    const businessAccountId = this.businessAccountId;
    if (!businessAccountId || batch.revertedAt || this.undoingId()) return;

    const confirmed = confirm(
      `¿Deshacer esta importación (${batch.totalRows} filas, ${batch.branchName})? ` +
        `Se les va a restaurar el precio anterior a los productos actualizados, y se van a borrar ` +
        `los productos que esta importación creó de cero. Esto no se puede deshacer.`,
    );
    if (!confirmed) return;

    this.undoingId.set(String(batch.id));
    this.errorMessage.set(null);
    this.undoMessage.set(null);

    this.csvImportService.undoBatch(batch.id, businessAccountId).subscribe({
      next: (result) => {
        this.undoingId.set(null);
        this.undoMessage.set(
          `Listo: se restauraron ${result.restoredCount} precio${result.restoredCount === 1 ? '' : 's'} ` +
            `y se eliminaron ${result.deletedCount} producto${result.deletedCount === 1 ? '' : 's'} nuevo${result.deletedCount === 1 ? '' : 's'}.` +
            // 10-oct-2026 -- catalogo completo: lo que esta carga habia pasado a "sin stock".
            (result.reactivadosCount
              ? ` Volvieron a publicarse ${result.reactivadosCount} que esta carga había pasado a sin stock.`
              : '') +
            // BP-44 (10-oct-2026) -- las promos de la carga también se deshacen.
            (result.promosDesactivadas || result.promosReactivadas
              ? ` Promos: se quitaron ${result.promosDesactivadas ?? 0} que había cargado y volvieron ${result.promosReactivadas ?? 0} que había reemplazado.`
              : ''),
        );
        this.loadBatches();
      },
      error: (err) => {
        this.undoingId.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo deshacer la importación.');
      },
    });
  }

  // BP-132 -- deshacer la carga entera: cada sucursal que siga vigente (las ya deshechas sueltas no se tocan).
  protected undoGrupo(g: CsvImportGroup): void {
    const businessAccountId = this.businessAccountId;
    if (!businessAccountId || g.revertedAt || this.undoingId()) return;

    const vigentes = g.lotes.filter((l) => !l.revertedAt).map((l) => l.branchName);
    const confirmed = confirm(
      `¿Deshacer esta carga (${g.totalRows} filas) en ${vigentes.join(', ')}? ` +
        `En cada una se les va a restaurar el precio anterior a los productos actualizados, y se van a borrar ` +
        `los productos que la carga creó de cero. Esto no se puede deshacer.`,
    );
    if (!confirmed) return;

    this.undoingId.set(`g${g.id}`);
    this.errorMessage.set(null);
    this.undoMessage.set(null);

    this.csvImportService.undoGroup(g.id, businessAccountId).subscribe({
      next: (r) => {
        this.undoingId.set(null);
        this.undoMessage.set(
          `${r.mensaje} Se restauraron ${r.restoredCount} precio${r.restoredCount === 1 ? '' : 's'} ` +
            `y se eliminaron ${r.deletedCount} producto${r.deletedCount === 1 ? '' : 's'} nuevo${r.deletedCount === 1 ? '' : 's'}.` +
            (r.reactivadosCount ? ` Volvieron a publicarse ${r.reactivadosCount} que la carga había pasado a sin stock.` : '') +
            (r.promosDesactivadas || r.promosReactivadas
              ? ` Promos: se quitaron ${r.promosDesactivadas} y volvieron ${r.promosReactivadas}.`
              : ''),
        );
        this.loadBatches();
      },
      error: (err) => {
        this.undoingId.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo deshacer la carga.');
      },
    });
  }
}
