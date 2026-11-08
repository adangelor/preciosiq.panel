import { Component, OnInit, computed, inject, input, model, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CsvImportService } from '../../../core/csv-import';
import {
  SimulacionCompetenciaResumen,
  SimulacionFila,
  SimulacionFilasResponse,
  SimulacionResumen,
  VerificarSimulacionResponse,
} from '../../../core/csv-import.models';
import { LoadingBarComponent } from '../../../layout/loading-bar/loading-bar';

/** Cómo se muestra cada alerta de un renglón (las de la simulación y las de la competencia). */
export const ALERTAS: Record<string, { texto: string; tono: 'danger' | 'warning' | 'info' | 'neutral'; ayuda: string }> = {
  debajo_costo: { texto: 'debajo del costo', tono: 'danger', ayuda: 'El precio nuevo es menor que lo que te cuesta el producto puesto en la góndola.' },
  x3: { texto: '×3 o más', tono: 'danger', ayuda: 'El precio nuevo es 3 veces el anterior o un tercio: casi siempre es un separador decimal mal configurado.' },
  sube_mucho: { texto: 'sube mucho', tono: 'warning', ayuda: 'Sube más que el aviso configurado (20 % por defecto).' },
  baja_mucho: { texto: 'baja mucho', tono: 'warning', ayuda: 'Baja más que el aviso configurado (20 % por defecto).' },
  testigo: { texto: 'testigo', tono: 'info', ayuda: 'Es uno de tus productos testigo: el cliente lo compara.' },
  caro: { texto: 'caro vs. la zona', tono: 'warning', ayuda: 'Queda más caro que la cadena más cara de la zona (con la tolerancia de Formación de precios).' },
  dejas_margen: { texto: 'dejás margen', tono: 'info', ayuda: 'Queda más barato que la cadena más barata de la zona: podrías cobrar más.' },
  deja_de_ser_mas_barato: { texto: 'deja de ser el más barato', tono: 'warning', ayuda: 'Hoy sos el más barato de la zona y con el precio nuevo dejás de serlo.' },
  dudosa: { texto: 'comparación dudosa', tono: 'neutral', ayuda: 'El nombre o la categoría no cierran con el resto de la zona: no se compara.' },
  rompe_familia: { texto: 'rompe la familia', tono: 'warning', ayuda: 'La planilla trae este artículo con un precio distinto al de la regla de su familia: gana la planilla, salvo que pidas aplicar la regla.' },
};

const FILTROS = [
  { valor: 'cambian', texto: 'Los que cambian' },
  { valor: 'sube', texto: 'Suben' },
  { valor: 'baja', texto: 'Bajan' },
  { valor: 'nuevo', texto: 'Nuevos' },
  { valor: 'igual', texto: 'Quedan igual' },
  { valor: 'error', texto: 'Con error' },
  { valor: 'familia', texto: 'Por familias de precio' },
  { valor: 'alertas', texto: 'Con algún aviso' },
  { valor: 'todas', texto: 'Todos' },
] as const;

const TAM_PAGINA = 50;

// BP-220 (8-nov-2026) -- la pantalla de la simulación de una carga por planilla: el resumen, la competencia de cerca
// (llega después, tarda unos segundos) y la tabla filtrable. No cambia nada: "Confirmar" lo hace el componente padre
// (CsvImportComponent), que corre la carga de siempre con el mismo archivo.
@Component({
  selector: 'app-simulacion-carga',
  standalone: true,
  imports: [LoadingBarComponent],
  templateUrl: './simulacion-carga.html',
  styleUrls: ['../../gestion/gestion.scss', './simulacion-carga.scss'],
})
export class SimulacionCargaComponent implements OnInit {
  private readonly api = inject(CsvImportService);

  readonly businessAccountId = input.required<number>();
  readonly resumen = input.required<SimulacionResumen>();
  readonly sucursales = input<{ branchId: string; nombre: string }[]>([]);
  /** Mientras el padre verifica o carga: los botones quedan apagados. */
  readonly ocupado = input(false);
  /** Lo que el padre encontró al verificar (precios que cambiaron por otro camino). */
  readonly verificacion = input<VerificarSimulacionResponse | null>(null);

  readonly confirmar = output<boolean>();   // true = "cargar igual" aunque algo haya cambiado entretanto
  readonly volver = output<void>();
  readonly resimular = output<void>();
  /** BP-221 -- "aplicar la regla" a los que la planilla saca de su familia (decisión C). */
  readonly aplicarRegla = model(false);

  protected readonly ALERTAS = ALERTAS;
  protected readonly FILTROS = FILTROS;

  protected readonly filtro = signal<string>('cambian');
  protected readonly sucursal = signal<string | null>(null);
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly datos = signal<SimulacionFilasResponse | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly competencia = signal<SimulacionCompetenciaResumen | null>(null);
  protected readonly cargandoCompetencia = signal(false);
  protected readonly exportando = signal(false);
  private buscarTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly cambian = computed(() => this.resumen().suben + this.resumen().bajan);
  protected readonly paginas = computed(() => {
    const d = this.datos();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });
  protected readonly varias = computed(() => this.resumen().sucursales > 1);

  ngOnInit(): void {
    void this.cargar();
    void this.cargarCompetencia();
  }

  private async cargarCompetencia(): Promise<void> {
    this.cargandoCompetencia.set(true);
    try {
      this.competencia.set(await firstValueFrom(this.api.simulacionCompetencia(this.resumen().simulacionId, this.businessAccountId())));
      // Con la competencia lista, la tabla se vuelve a pedir con sus columnas.
      await this.cargar();
    } catch {
      this.competencia.set(null);
    } finally {
      this.cargandoCompetencia.set(false);
    }
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.datos.set(
        await firstValueFrom(
          this.api.simulacionFilas(this.resumen().simulacionId, this.businessAccountId(), {
            filtro: this.filtro(),
            sucursal: this.sucursal(),
            q: this.q(),
            page: this.page(),
            pageSize: TAM_PAGINA,
            conCompetencia: this.competencia()?.disponible === true,
          }),
        ),
      );
    } catch (err: unknown) {
      this.error.set((err as { error?: { error?: string } })?.error?.error ?? 'No se pudo leer la simulación.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected elegirFiltro(valor: string): void {
    this.filtro.set(valor);
    this.page.set(1);
    void this.cargar();
  }

  protected onFiltro(e: Event): void {
    this.elegirFiltro((e.target as HTMLSelectElement).value);
  }

  protected onSucursal(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.sucursal.set(v || null);
    this.page.set(1);
    void this.cargar();
  }

  protected onBuscar(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    this.buscarTimer = setTimeout(() => {
      this.page.set(1);
      void this.cargar();
    }, 300);
  }

  protected irA(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.paginas()));
    void this.cargar();
  }

  /** Toda la tabla del filtro actual a Excel (de a 500 renglones). */
  protected async exportar(): Promise<void> {
    this.exportando.set(true);
    try {
      const filas: SimulacionFila[] = [];
      for (let p = 1; p <= 200; p++) {
        const r = await firstValueFrom(
          this.api.simulacionFilas(this.resumen().simulacionId, this.businessAccountId(), {
            filtro: this.filtro(),
            sucursal: this.sucursal(),
            q: this.q(),
            page: p,
            pageSize: 500,
            conCompetencia: this.competencia()?.disponible === true,
          }),
        );
        filas.push(...r.items);
        if (p * r.pageSize >= r.total) break;
      }
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasExcelSimulacion(filas)), 'Simulación');
      XLSX.writeFile(libro, `simulacion-carga-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      this.exportando.set(false);
    }
  }

  // ------------------------------------------------------------------ formato
  protected pesos(v: number | null): string {
    return v == null ? '—' : '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected num(v: number): string {
    return v.toLocaleString('es-AR');
  }

  protected pct(v: number | null, signo = true): string {
    if (v == null) return '—';
    const t = v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
    return signo && v > 0 ? '+' + t : t;
  }

  protected tipoTexto(t: string): string {
    return { sube: 'sube', baja: 'baja', igual: 'igual', nuevo: 'nuevo', error: 'error' }[t] ?? t;
  }

  protected avisos(f: SimulacionFila): string[] {
    return [...f.alertas, ...(f.competencia?.avisos ?? [])];
  }

  protected competenciaTexto(f: SimulacionFila): string {
    const c = f.competencia;
    if (!c || c.cadenas === 0) return '';
    return `${this.pesos(c.minimo)} – ${this.pesos(c.referencia)} – ${this.pesos(c.maximo)}`;
  }

  protected venceTexto(): string {
    const d = new Date(this.resumen().venceAtUtc);
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}

/** Las columnas del Excel de la simulación (exportada para el spec). */
export function filasExcelSimulacion(filas: SimulacionFila[]): Record<string, string | number | null>[] {
  return filas.map((f) => ({
    Fila: f.rowNumber,
    Sucursal: f.sucursal ?? f.branchId,
    EAN: f.ean,
    Producto: f.descripcion,
    Qué_pasa: f.tipo,
    Precio_antes: f.precioAntes,
    Precio_nuevo: f.precioNuevo,
    'Diferencia_%': f.difPct,
    Costo_en_góndola: f.costoGondola,
    'Margen_antes_%': f.margenAntes,
    'Margen_después_%': f.margenDespues,
    Competencia_mínimo: f.competencia?.minimo ?? null,
    Competencia_referencia: f.competencia?.referencia ?? null,
    Competencia_máximo: f.competencia?.maximo ?? null,
    Más_barata: f.competencia?.cadenaMasBarata ?? null,
    Avisos: [...f.alertas, ...(f.competencia?.avisos ?? [])].map((a) => ALERTAS[a]?.texto ?? a).join(', '),
    Promo: f.promo,
    Error: f.error,
  }));
}
