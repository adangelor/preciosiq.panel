import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { mensajeDeError, numeroONull, plata } from '../../core/articulos-form';
import { GestionContextoService } from '../../core/gestion-contexto';
import { StockService } from '../../core/stock';
import { MOTIVOS_DE_MERMA, cantidad, filasExcelMermas, motivoTexto } from '../../core/stock-form';
import { MotivoDeMerma, StockMermasResponse, StockMovimientosAplicados, StockRenglonError, StockSucursal } from '../../core/stock.models';
import { ArticuloBuscadorComponent, ArticuloElegido } from './articulo-buscador';

type Tipo = 'ingreso' | 'merma';

interface Renglon {
  codigo: string;
  descripcion: string | null;
  cantidad: string;
  unidad: 'unidad' | 'bulto';
  costo: string;
  motivo: MotivoDeMerma;
}

// BP-179 bloque 7 (21-oct-2026) -- Gestión → Stock → Recepción sin orden (antes "Ingreso de mercadería") / Mermas. Una lista de renglones (escanear o
// buscar el artículo, cantidad y, en el ingreso, unidad o bulto y el costo; en la merma, el motivo) que se registra de
// una vez: todos o ninguno. El ingreso es SIN orden de compra: desde BP-180 se llama "Recepción sin orden" (decisión 9 del
// PROMPT_BP180) y por debajo es una recepción sin orden confirmada en el acto. Mermas también
// muestra el informe por motivo y por rubro, en cantidad y en plata.
@Component({
  selector: 'app-stock-movimiento',
  standalone: true,
  imports: [RouterLink, ArticuloBuscadorComponent],
  templateUrl: './stock-movimiento.html',
  styleUrls: ['../gestion/gestion.scss', './stock.scss'],
})
export class StockMovimientoComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(StockService);
  private readonly route = inject(ActivatedRoute);

  protected readonly tipo = signal<Tipo>((this.route.snapshot.data['tipo'] as Tipo) ?? 'ingreso');
  protected readonly cargandoCuenta = signal(true);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<StockSucursal[]>([]);
  protected readonly branchId = signal('');

  protected readonly renglones = signal<Renglon[]>([]);
  protected readonly nota = signal('');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly erroresRenglon = signal<StockRenglonError[]>([]);
  protected readonly resultado = signal<StockMovimientosAplicados | null>(null);

  // ---- informe de mermas
  protected readonly desde = signal(haceDias(29));
  protected readonly hasta = signal(haceDias(0));
  protected readonly informeSucursal = signal('');
  protected readonly informe = signal<StockMermasResponse | null>(null);
  protected readonly cargandoInforme = signal(false);

  protected readonly MOTIVOS = MOTIVOS_DE_MERMA;
  protected readonly plata = plata;
  protected readonly cantidad = cantidad;
  protected readonly motivoTexto = motivoTexto;
  protected readonly titulo = computed(() => (this.tipo() === 'ingreso' ? 'Recepción sin orden' : 'Mermas'));

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) {
          this.errorCuenta.set('Todavía no tenés un comercio dado de alta.');
          return;
        }
        if (!g.gestionStock) {
          this.sinPlan.set(true);
          return;
        }
        this.cuenta.set(g.businessAccountId);
        this.sucursales.set(g.branches.map((b) => ({ branchId: b.branchId, nombre: b.branchName })));
        this.branchId.set(g.branches[0]?.branchId ?? '');
        if (this.tipo() === 'merma') this.cargarInforme();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  // ---- renglones
  protected agregar(a: ArticuloElegido): void {
    this.resultado.set(null);
    const ya = this.renglones().findIndex((r) => r.codigo === a.codigo);
    if (ya >= 0) {
      // El mismo artículo otra vez (un escaneo más): suma uno.
      this.renglones.update((l) => l.map((r, i) => (i === ya ? { ...r, cantidad: String((numeroONull(r.cantidad) ?? 0) + 1) } : r)));
      return;
    }
    this.renglones.update((l) => [...l, { codigo: a.codigo, descripcion: a.descripcion, cantidad: '1', unidad: 'unidad', costo: '', motivo: 'rotura' }]);
  }

  protected cambiar(i: number, campo: keyof Renglon, e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    this.renglones.update((l) => l.map((r, j) => (j === i ? { ...r, [campo]: v } : r)));
  }

  protected quitar(i: number): void {
    this.renglones.update((l) => l.filter((_, j) => j !== i));
  }

  protected registrar(): void {
    const id = this.cuenta();
    const b = this.branchId();
    if (id == null || !b || this.guardando()) return;
    const l = this.renglones();
    if (l.length === 0) return;
    const malos = l.filter((r) => (numeroONull(r.cantidad) ?? 0) <= 0);
    if (malos.length > 0) {
      this.error.set(`Revisá la cantidad de ${malos[0].descripcion ?? malos[0].codigo}: tiene que ser mayor a cero.`);
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.erroresRenglon.set([]);
    const nota = this.nota().trim() || null;
    const pedido = this.tipo() === 'ingreso'
      ? this.api.ingreso(id, b, l.map((r) => ({ codigo: r.codigo, cantidad: numeroONull(r.cantidad)!, unidad: r.unidad, costoNeto: numeroONull(r.costo) })), nota)
      : this.api.merma(id, b, l.map((r) => ({ codigo: r.codigo, cantidad: numeroONull(r.cantidad)!, motivo: r.motivo })), nota);
    pedido.subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.resultado.set(r);
        this.renglones.set([]);
        this.nota.set('');
        if (this.tipo() === 'merma') this.cargarInforme();
      },
      error: (err) => {
        this.guardando.set(false);
        this.erroresRenglon.set((err?.error?.renglones ?? []) as StockRenglonError[]);
        this.error.set(mensajeDeError(err, 'No pudimos registrarlo. No se cambió nada; probá de nuevo.'));
      },
    });
  }

  /** "22/09/2026" de "2026-09-22". */
  protected fecha(iso: string): string {
    return iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
  }

  protected nombreSucursal(id: string): string {
    return this.sucursales().find((s) => s.branchId === id)?.nombre ?? id;
  }

  // ---- informe de mermas
  protected cargarInforme(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargandoInforme.set(true);
    this.api.mermas(id, this.desde() || null, this.hasta() || null, this.informeSucursal() || null).subscribe({
      next: (r) => {
        this.cargandoInforme.set(false);
        this.informe.set(r);
      },
      error: (err) => {
        this.cargandoInforme.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos cargar el informe de mermas.'));
      },
    });
  }

  protected onFiltroInforme(campo: 'desde' | 'hasta' | 'sucursal', e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    if (campo === 'desde') this.desde.set(v);
    else if (campo === 'hasta') this.hasta.set(v);
    else this.informeSucursal.set(v);
    this.cargarInforme();
  }

  protected async excelMermas(): Promise<void> {
    const r = this.informe();
    if (!r) return;
    const XLSX = await import('xlsx');
    const libro = XLSX.utils.book_new();
    const f = filasExcelMermas(r);
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(f.porMotivo), 'Por motivo');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(f.porRubro), 'Por rubro');
    XLSX.writeFile(libro, `mermas-${r.desde}-a-${r.hasta}.xlsx`);
  }
}

function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
