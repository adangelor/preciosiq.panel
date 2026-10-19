import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder } from '@angular/forms';
import { CsvImportService } from '../../core/csv-import';
import { PromoConfirmada, PromoParaConfirmar } from '../../core/csv-import.models';
import { PromoRule } from '../../core/business-price.models';
import { PromoReglaGrupo, crearGrupoPromo, plata, reglaDesdeValores, valoresDesdeRegla } from '../../core/promo-regla-form';
import { PromoReglaEditorComponent } from '../promo-regla-editor/promo-regla-editor';

// BP-169 (19-oct-2026) -- las promos de una carga masiva que quedaron "para confirmar": la leyenda (o la columna Mecánica)
// habla de cantidad y el servidor no la entendió, así que NO creó regla (antes la creaba "desde la primera unidad" y la
// caja cobraba el 2x1 llevando uno). Cada fila trae el selector precargado con la propuesta, si la hay. Confirmar
// (o "Sin promo") va a POST /batches/{id}/promos; en una carga agrupada el servidor la aplica en todas sus sucursales.
// Lo usan el resumen de la carga (features/csv-import) y el historial (features/csv-import-history).
interface Fila {
  promo: PromoParaConfirmar;
  grupo: PromoReglaGrupo;
  error: string | null;
}

@Component({
  selector: 'app-promos-para-confirmar',
  standalone: true,
  imports: [PromoReglaEditorComponent],
  templateUrl: './promos-para-confirmar.html',
  styleUrl: './promos-para-confirmar.scss',
})
export class PromosParaConfirmarComponent implements OnInit {
  readonly businessAccountId = input.required<number>();
  readonly batchId = input.required<number>();
  /** Las que vinieron en la respuesta de la carga (sin esperar al GET). */
  readonly iniciales = input<PromoParaConfirmar[] | null>(null);
  /** False = el servidor no las pudo guardar en el lote: hay que confirmarlas ahora. */
  readonly guardadas = input(true);
  /** Cuántas quedan sin confirmar, cada vez que cambia. */
  readonly quedan = output<number>();

  private readonly fb = inject(FormBuilder);
  private readonly csvImportService = inject(CsvImportService);

  protected readonly filas = signal<Fila[]>([]);
  protected readonly cargando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly conPropuesta = computed(() => this.filas().filter((f) => !!f.promo.reglaPropuesta).length);

  ngOnInit(): void {
    const iniciales = this.iniciales();
    if (iniciales?.length) this.ponerFilas(iniciales);
    if (!this.guardadas()) return;
    this.cargando.set(true);
    this.csvImportService.promosParaConfirmar(this.batchId(), this.businessAccountId()).subscribe({
      next: (r) => {
        this.cargando.set(false);
        // Sin el script del servidor no se guardan: quedan las que vinieron en la carga.
        if (r.guardadas) this.ponerFilas(r.promos);
      },
      error: () => this.cargando.set(false),
    });
  }

  protected confirmar(f: Fila): void {
    let regla: PromoRule | null;
    try {
      regla = reglaDesdeValores(f.grupo.getRawValue(), f.promo.precioLista, null);
    } catch (e) {
      this.ponerError(f.promo.ean, (e as Error).message);
      return;
    }
    if (!regla) {
      this.ponerError(f.promo.ean, 'Elegí el tipo de promo, o tocá "Sin promo".');
      return;
    }
    this.enviar([{ ean: f.promo.ean, regla }]);
  }

  protected sinPromo(f: Fila): void {
    this.enviar([{ ean: f.promo.ean, regla: null }]);
  }

  /** Las que tienen propuesta y el selector arma una regla válida (las demás quedan, con su error). */
  protected confirmarTodas(): void {
    const promos: PromoConfirmada[] = [];
    for (const f of this.filas()) {
      if (!f.promo.reglaPropuesta) continue;
      try {
        const regla = reglaDesdeValores(f.grupo.getRawValue(), f.promo.precioLista, null);
        if (regla) promos.push({ ean: f.promo.ean, regla });
      } catch (e) {
        this.ponerError(f.promo.ean, (e as Error).message);
      }
    }
    if (promos.length) this.enviar(promos);
  }

  protected plata(n: number | null | undefined): string {
    return n == null ? '—' : plata(n);
  }

  private enviar(promos: PromoConfirmada[]): void {
    this.enviando.set(true);
    this.mensaje.set(null);
    this.error.set(null);
    this.csvImportService.confirmarPromos(this.batchId(), this.businessAccountId(), promos).subscribe({
      next: (r) => {
        this.enviando.set(false);
        if (this.guardadas()) this.ponerFilas(r.pendientes);
        else {
          // Sin el lote guardado, el servidor no sabe cuáles quedan: se sacan las que se mandaron.
          const mandadas = new Set(promos.map((p) => p.ean));
          this.ponerFilas(this.filas().map((f) => f.promo).filter((p) => !mandadas.has(p.ean)));
        }
        const partes = [];
        if (r.confirmadas) partes.push(`${r.confirmadas} ${r.confirmadas === 1 ? 'promo confirmada' : 'promos confirmadas'}`);
        if (r.descartadas) partes.push(`${r.descartadas} sin promo`);
        this.mensaje.set(`Listo: ${partes.join(' y ')}.${r.confirmadas ? ' La caja ya las cobra y se publican en la red.' : ''}`);
      },
      error: (err: HttpErrorResponse) => {
        this.enviando.set(false);
        const ean = err?.error?.ean as string | undefined;
        const texto = (err?.error?.error as string | undefined) ?? 'No se pudo confirmar. Probá de nuevo.';
        if (ean && this.filas().some((f) => f.promo.ean === ean)) this.ponerError(ean, texto);
        else this.error.set(texto);
      },
    });
  }

  /** Las filas nuevas conservan el selector de las que ya estaban (lo que la persona tocó no se pierde). */
  private ponerFilas(promos: PromoParaConfirmar[]): void {
    const antes = new Map(this.filas().map((f) => [f.promo.ean, f]));
    this.filas.set(
      promos.map((p) => {
        const previa = antes.get(p.ean);
        if (previa) return { ...previa, promo: p };
        // La leyenda del cartel arranca vacía (= el texto de la regla): así misuper la calcula. La de la planilla se ve arriba.
        return { promo: p, grupo: crearGrupoPromo(this.fb, { ...valoresDesdeRegla(p.reglaPropuesta), leyenda: '' }), error: null };
      }),
    );
    this.quedan.emit(promos.length);
  }

  private ponerError(ean: string, error: string): void {
    this.filas.update((filas) => filas.map((f) => (f.promo.ean === ean ? { ...f, error } : f)));
  }
}
