import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ArticulosService } from '../../core/articulos';
import { mensajeDeError, numeroONull, opcionesDeRubro, plata } from '../../core/articulos-form';
import { Rubro } from '../../core/articulos.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { StockService } from '../../core/stock';
import { cantidad, fechaHora, filasExcelStock, leerPlanillaDeLimites, origenTexto, tipoTexto } from '../../core/stock-form';
import { StockItem, StockLimiteFila, StockListaResponse, StockMovimientosResponse, StockSucursal } from '../../core/stock.models';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

type Rapido = 'todos' | 'bajoMinimo' | 'negativo';

// BP-179 bloque 7 (21-oct-2026) -- Gestión → Stock. El stock de cada artículo por sucursal (o todas en columnas),
// valorizado al costo vigente; tocar un artículo muestra su historial con el saldo corrido y de dónde vino cada
// movimiento. Con una sucursal elegida, el mínimo y el máximo se editan en la tabla; también por planilla.
@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './stock.html',
  styleUrls: ['../gestion/gestion.scss', './stock.scss'],
})
export class StockComponent implements OnInit, OnDestroy {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(StockService);
  private readonly articulos = inject(ArticulosService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<StockSucursal[]>([]);
  protected readonly rubros = signal<Rubro[]>([]);
  protected readonly opcionesRubro = computed(() => opcionesDeRubro(this.rubros()));

  protected readonly branchId = signal<string>('');   // '' = todas
  protected readonly q = signal('');
  protected readonly rubroId = signal<number | null>(null);
  protected readonly rapido = signal<Rapido>('todos');
  protected readonly pagina = signal(1);
  protected readonly tamPagina = 100;

  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly datos = signal<StockListaResponse | null>(null);
  protected readonly paginas = computed(() => {
    const d = this.datos();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });
  protected readonly unaSucursal = computed(() => this.branchId() !== '');
  protected readonly verRubros = signal(false);

  // ---- historial
  protected readonly abierto = signal<StockItem | null>(null);
  protected readonly historialSucursal = signal<string>('');
  protected readonly historial = signal<StockMovimientosResponse | null>(null);
  protected readonly cargandoHistorial = signal(false);
  protected readonly errorHistorial = signal<string | null>(null);

  // ---- minimos y maximos (con una sucursal): codigo -> lo editado
  protected readonly limitesEditados = signal<Map<string, { minimo: number | null; maximo: number | null }>>(new Map());
  protected readonly guardandoLimites = signal(false);
  protected readonly avisoLimites = signal<string | null>(null);
  protected readonly erroresPlanilla = signal<{ fila: number; motivo: string }[]>([]);

  protected readonly exportando = signal(false);

  protected readonly plata = plata;
  protected readonly cantidad = cantidad;
  protected readonly origenTexto = origenTexto;
  protected readonly tipoTexto = tipoTexto;
  protected readonly fechaHora = fechaHora;

  private readonly busqueda$ = new Subject<void>();
  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.busqueda$.pipe(debounceTime(300)).subscribe(() => {
      this.pagina.set(1);
      this.cargar();
    });
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) {
          this.sinCuenta.set(true);
          return;
        }
        if (!g.gestionStock) {
          this.sinPlan.set(true);
          return;
        }
        this.cuenta.set(g.businessAccountId);
        this.sucursales.set(g.branches.map((b) => ({ branchId: b.branchId, nombre: b.branchName })));
        if (g.branches.length === 1) this.branchId.set(g.branches[0].branchId);
        this.cargar();
        this.articulos.rubros(g.businessAccountId).subscribe({ next: (r) => this.rubros.set(r), error: () => {} });
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  protected id(): number | null {
    return this.cuenta();
  }

  protected cargar(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.listar(id, {
      branchId: this.branchId() || null, q: this.q(), rubroId: this.rubroId(),
      bajoMinimo: this.rapido() === 'bajoMinimo', negativo: this.rapido() === 'negativo', page: this.pagina(), pageSize: this.tamPagina,
    }).subscribe({
      next: (d) => {
        this.cargando.set(false);
        this.datos.set(d);
      },
      error: (err) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos cargar el stock. Probá recargar la página.'));
      },
    });
  }

  // ---- filtros
  protected onSucursal(e: Event): void {
    this.branchId.set((e.target as HTMLSelectElement).value);
    this.limitesEditados.set(new Map());
    this.avisoLimites.set(null);
    this.recargar();
  }

  protected onBuscar(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
    this.busqueda$.next();
  }

  protected onRubro(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.rubroId.set(v ? Number(v) : null);
    this.recargar();
  }

  protected elegirRapido(r: Rapido): void {
    this.rapido.set(r);
    this.recargar();
  }

  private recargar(): void {
    this.pagina.set(1);
    this.cargar();
  }

  protected irA(p: number): void {
    if (p < 1 || p > this.paginas()) return;
    this.pagina.set(p);
    this.cargar();
  }

  protected celda(i: StockItem, branchId: string): number {
    return i.porSucursal[branchId]?.cantidad ?? 0;
  }

  protected bajo(i: StockItem, branchId: string): boolean {
    const c = i.porSucursal[branchId];
    return !!c && c.minimo != null && c.cantidad < c.minimo;
  }

  // ---- historial
  protected abrir(i: StockItem): void {
    if (this.abierto()?.codigo === i.codigo) {
      this.abierto.set(null);
      return;
    }
    this.abierto.set(i);
    this.historialSucursal.set(this.branchId() || this.sucursales()[0]?.branchId || '');
    this.cargarHistorial();
  }

  protected onHistorialSucursal(e: Event): void {
    this.historialSucursal.set((e.target as HTMLSelectElement).value);
    this.cargarHistorial();
  }

  private cargarHistorial(): void {
    const id = this.cuenta();
    const i = this.abierto();
    const b = this.historialSucursal();
    if (id == null || !i || !b) return;
    this.cargandoHistorial.set(true);
    this.errorHistorial.set(null);
    this.historial.set(null);
    this.api.movimientos(id, b, i.codigo).subscribe({
      next: (h) => {
        this.cargandoHistorial.set(false);
        this.historial.set(h);
      },
      error: (err) => {
        this.cargandoHistorial.set(false);
        this.errorHistorial.set(mensajeDeError(err, 'No pudimos cargar el historial.'));
      },
    });
  }

  protected nombreSucursal(branchId: string): string {
    return this.sucursales().find((s) => s.branchId === branchId)?.nombre ?? branchId;
  }

  // ---- minimos y maximos en la tabla (una sucursal)
  protected limite(i: StockItem, campo: 'minimo' | 'maximo'): number | null {
    const ed = this.limitesEditados().get(i.codigo);
    if (ed) return ed[campo];
    return i.porSucursal[this.branchId()]?.[campo] ?? null;
  }

  protected onLimite(i: StockItem, campo: 'minimo' | 'maximo', e: Event): void {
    const v = numeroONull((e.target as HTMLInputElement).value);
    const m = new Map(this.limitesEditados());
    const actual = m.get(i.codigo) ?? { minimo: this.limite(i, 'minimo'), maximo: this.limite(i, 'maximo') };
    m.set(i.codigo, { ...actual, [campo]: v });
    this.limitesEditados.set(m);
    this.avisoLimites.set(null);
  }

  protected guardarLimites(): void {
    const id = this.cuenta();
    const b = this.branchId();
    if (id == null || !b || this.limitesEditados().size === 0) return;
    const filas: StockLimiteFila[] = [...this.limitesEditados()].map(([codigo, l]) => ({ branchId: b, codigo, minimo: l.minimo, maximo: l.maximo }));
    this.enviarLimites(id, filas);
  }

  private enviarLimites(id: number, filas: StockLimiteFila[]): void {
    this.guardandoLimites.set(true);
    this.avisoLimites.set(null);
    this.api.guardarLimites(id, filas).subscribe({
      next: (r) => {
        this.guardandoLimites.set(false);
        this.limitesEditados.set(new Map());
        this.avisoLimites.set(`Listo: ${r.guardados} ${r.guardados === 1 ? 'mínimo/máximo guardado' : 'mínimos y máximos guardados'}.`);
        this.cargar();
      },
      error: (err) => {
        this.guardandoLimites.set(false);
        const renglones = (err?.error?.renglones ?? []) as { fila: number; codigo: string | null; motivo: string }[];
        this.erroresPlanilla.set(renglones.map((x) => ({ fila: x.fila, motivo: `${x.codigo ?? ''}: ${x.motivo}` })));
        this.error.set(mensajeDeError(err, 'No pudimos guardar los mínimos y máximos.'));
      },
    });
  }

  /** Mínimos y máximos por planilla: código, mínimo, máximo y (opcional) sucursal. */
  protected async limitesPorPlanilla(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    const id = this.cuenta();
    if (!archivo || id == null) return;
    this.erroresPlanilla.set([]);
    this.error.set(null);
    try {
      const XLSX = await import('xlsx');
      const libro = /\.csv$/i.test(archivo.name)
        ? XLSX.read(await archivo.text(), { type: 'string', raw: true })
        : XLSX.read(await archivo.arrayBuffer());
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true });
      const leida = leerPlanillaDeLimites(filas, this.sucursales(), this.branchId() || null);
      this.erroresPlanilla.set(leida.errores);
      if (leida.filas.length === 0) {
        this.error.set(leida.errores[0]?.motivo ?? 'La planilla no tiene filas para cargar.');
        return;
      }
      this.enviarLimites(id, leida.filas);
    } catch {
      this.error.set('No pudimos leer la planilla. Guardala como Excel (.xlsx) o CSV.');
    }
  }

  // ---- Excel (todas las paginas con los filtros de ahora)
  protected async descargarExcel(): Promise<void> {
    const id = this.cuenta();
    if (id == null || this.exportando()) return;
    this.exportando.set(true);
    try {
      const items: StockItem[] = [];
      let sucursales: StockSucursal[] = [];
      for (let page = 1; ; page++) {
        const r = await firstValueFrom(this.api.listar(id, {
          branchId: this.branchId() || null, q: this.q(), rubroId: this.rubroId(),
          bajoMinimo: this.rapido() === 'bajoMinimo', negativo: this.rapido() === 'negativo', page, pageSize: 500,
        }));
        sucursales = r.sucursales;
        items.push(...r.items);
        if (items.length >= r.total || r.items.length === 0) break;
      }
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasExcelStock(items, sucursales)), 'Stock');
      XLSX.writeFile(libro, `stock-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      this.error.set(mensajeDeError(err, 'No pudimos armar el Excel. Probá de nuevo.'));
    } finally {
      this.exportando.set(false);
    }
  }

  protected num(n: number): string {
    return n.toLocaleString('es-AR');
  }
}
