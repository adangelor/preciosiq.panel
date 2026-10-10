import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CsvImportService } from '../../core/csv-import';
import { CsvImportBatch } from '../../core/csv-import.models';
import { BusinessContextService } from '../../core/business-context';

// E5.5 (16-ago-2026) -- pedido de Andres tras un import real con el separador decimal
// mal configurado (~900% de mas en casi todos los precios): "como elimino los precios
// que cargo el ñato" + "deberia haber una pantalla donde pueda cargar las ultimas
// importaciones para desimportar si fuera necesario, ¿no?". Lista las ultimas 20
// corridas de carga masiva (BusinessCsvImportEndpoints.ListBatches) y permite deshacer
// una entera (UndoBatch) -- restaura el precio anterior de cada producto que la corrida
// actualizo y borra los que creo de cero.
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
  protected readonly batches = signal<CsvImportBatch[]>([]);

  // Id del lote que se esta deshaciendo ahora mismo -- deshabilita SOLO su boton, no
  // toda la pantalla (podrian ser lotes de sucursales distintas).
  protected readonly undoingId = signal<number | null>(null);
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

    this.csvImportService.listBatches(this.businessAccountId).subscribe({
      next: (batches) => {
        this.loading.set(false);
        this.batches.set(batches);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo cargar el historial de importaciones.');
      },
    });
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

    this.undoingId.set(batch.id);
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
}
