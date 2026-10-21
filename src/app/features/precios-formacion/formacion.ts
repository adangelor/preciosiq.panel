import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, firstValueFrom, of } from 'rxjs';
import { catchError, debounceTime } from 'rxjs/operators';
import { AdvisorService } from '../../core/advisor';
import { PriceZoneItem } from '../../core/advisor.models';
import { ArticulosService } from '../../core/articulos';
import { mensajeDeError, numeroONull, opcionesDeRubro } from '../../core/articulos-form';
import { Proveedor, Rubro } from '../../core/articulos.models';
import { BranchListItem } from '../../core/business-account.models';
import { FormacionService } from '../../core/formacion';
import {
  AVISOS,
  AVISOS_FILTRO,
  PrecioElegido,
  competenciaTexto,
  diferenciaTexto,
  filasExcelSugeridos,
  margenUsado,
  pesos,
  resumenDeAplicar,
  resumenTexto,
} from '../../core/formacion-form';
import {
  AjusteDeCostosResponse,
  AplicarPreciosResponse,
  Aviso,
  DestinoDePrecios,
  SugeridoItem,
  SugeridosResponse,
} from '../../core/formacion.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

type TipoDestino = 'sucursal' | 'zona' | 'todas';

// BP-181 (21-oct-2026) -- Precios → Formación de precios. Para cada artículo con costo: costo + margen (del artículo, de
// su rubro o el de la cuenta), redondeado, y al lado lo que cobra la competencia de la zona. Se tildan los que se quieren
// mover, se puede corregir el sugerido a mano y "Aplicar" los escribe como una carga masiva más (Importaciones,
// deshacer). Después, los carteles de góndola de lo que cambió. La primera consulta tarda unos segundos (la competencia
// es el mismo cálculo del Asesor); el servidor la guarda 10 minutos, así que filtrar después es rápido.
@Component({
  selector: 'app-formacion-precios',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './formacion.html',
  styleUrls: ['../gestion/gestion.scss', './formacion.scss'],
})
export class FormacionPreciosComponent implements OnInit, OnDestroy {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(FormacionService);
  private readonly articulos = inject(ArticulosService);
  private readonly advisor = inject(AdvisorService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);

  protected readonly branches = signal<BranchListItem[]>([]);
  protected readonly zonas = signal<PriceZoneItem[]>([]);
  protected readonly rubros = signal<Rubro[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly opcionesRubro = computed(() => opcionesDeRubro(this.rubros()));

  // ---- destino
  protected readonly destinoTipo = signal<TipoDestino>('todas');
  protected readonly branchId = signal<string>('');
  protected readonly zonaId = signal<number | null>(null);

  // ---- filtros
  protected readonly q = signal('');
  protected readonly rubroId = signal<number | null>(null);
  protected readonly proveedorId = signal<number | null>(null);
  protected readonly soloCambios = signal(true);
  protected readonly aviso = signal<Aviso | null>(null);
  protected readonly pagina = signal(1);
  protected readonly tamPagina = 100;

  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly datos = signal<SugeridosResponse | null>(null);
  protected readonly paginas = computed(() => {
    const d = this.datos();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });

  // ---- selección: código → fila; el precio a aplicar es el editado o el sugerido
  protected readonly elegidos = signal<Map<string, SugeridoItem>>(new Map());
  protected readonly editados = signal<Map<string, number>>(new Map());
  protected readonly cantidadElegidos = computed(() => this.elegidos().size);

  // ---- aplicar
  protected readonly confirmando = signal(false);
  protected readonly aplicando = signal(false);
  protected readonly aplicado = signal<AplicarPreciosResponse | null>(null);
  protected readonly resumen = computed(() => resumenDeAplicar(this.preciosElegidos()));

  // ---- ajuste de costos
  protected readonly ajusteAbierto = signal(false);
  protected readonly ajustePor = signal<'proveedor' | 'rubro'>('proveedor');
  protected readonly ajusteId = signal<number | null>(null);
  protected readonly ajustePct = signal<string>('');
  protected readonly ajusteDesde = signal<string>(hoyIso());
  protected readonly ajusteVista = signal<AjusteDeCostosResponse | null>(null);
  protected readonly ajusteListo = signal<AjusteDeCostosResponse | null>(null);
  protected readonly ajustando = signal(false);
  protected readonly ajusteError = signal<string | null>(null);

  protected readonly exportando = signal(false);

  protected readonly AVISOS = AVISOS;
  protected readonly AVISOS_FILTRO = AVISOS_FILTRO;
  protected readonly pesos = pesos;
  protected readonly diferenciaTexto = diferenciaTexto;
  protected readonly margenUsado = margenUsado;
  protected readonly competenciaTexto = competenciaTexto;
  protected readonly resumenTexto = resumenTexto;

  private readonly busqueda$ = new Subject<void>();
  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.busqueda$.pipe(debounceTime(350)).subscribe(() => {
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
        if (!g.formacionPrecios) {
          this.sinPlan.set(true);
          return;
        }
        this.cuenta.set(g.businessAccountId);
        this.branches.set(g.branches);
        this.restaurarDestino(g.businessAccountId, g.branches);
        this.cargar();
        this.articulos.rubros(g.businessAccountId).subscribe({ next: (r) => this.rubros.set(r), error: () => {} });
        this.articulos.proveedores(g.businessAccountId).subscribe({ next: (p) => this.proveedores.set(p), error: () => {} });
        // Las zonas tienen su propia compuerta de plan: si fallan, la opción "zona" no aparece.
        this.advisor.getPriceZones(g.businessAccountId).pipe(catchError(() => of(null))).subscribe((z) => {
          this.zonas.set(z?.tablaLista ? z.zonas.filter((x) => x.sucursales.length > 0) : []);
          if (this.destinoTipo() === 'zona' && !this.zonas().some((x) => x.id === this.zonaId())) this.elegirDestino('todas');
        });
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

  // ------------------------------------------------------------------ destino (se recuerda por cuenta)
  private claveDestino(id: number): string {
    return `preciosiq.formacion.destino.${id}`;
  }

  private restaurarDestino(id: number, branches: BranchListItem[]): void {
    this.branchId.set(branches[0]?.branchId ?? '');
    if (branches.length <= 1) this.destinoTipo.set(branches.length === 1 ? 'sucursal' : 'todas');
    try {
      const g = JSON.parse(localStorage.getItem(this.claveDestino(id)) ?? 'null') as { tipo: TipoDestino; branchId?: string; zonaId?: number } | null;
      if (!g) return;
      if (g.tipo === 'sucursal' && g.branchId && branches.some((b) => b.branchId === g.branchId)) {
        this.destinoTipo.set('sucursal');
        this.branchId.set(g.branchId);
      } else if (g.tipo === 'zona' && g.zonaId != null) {
        this.destinoTipo.set('zona');
        this.zonaId.set(g.zonaId);
      } else if (g.tipo === 'todas') this.destinoTipo.set('todas');
    } catch {
      /* sin localStorage: arranca en "todas" */
    }
  }

  private guardarDestino(): void {
    const id = this.cuenta();
    if (id == null) return;
    try {
      localStorage.setItem(this.claveDestino(id), JSON.stringify({ tipo: this.destinoTipo(), branchId: this.branchId(), zonaId: this.zonaId() }));
    } catch {
      /* no importa */
    }
  }

  protected destino(): DestinoDePrecios | null {
    switch (this.destinoTipo()) {
      case 'sucursal': return this.branchId() ? { tipo: 'sucursal', branchId: this.branchId() } : null;
      case 'zona': {
        const z = this.zonaId();
        return z == null ? null : { tipo: 'zona', priceZoneId: z };
      }
      default: return { tipo: 'todas' };
    }
  }

  protected elegirDestino(tipo: TipoDestino): void {
    this.destinoTipo.set(tipo);
    if (tipo === 'zona' && this.zonaId() == null) this.zonaId.set(this.zonas()[0]?.id ?? null);
    this.cambioDeDestino();
  }

  protected onSucursal(e: Event): void {
    this.branchId.set((e.target as HTMLSelectElement).value);
    this.cambioDeDestino();
  }

  protected onZona(e: Event): void {
    this.zonaId.set(Number((e.target as HTMLSelectElement).value));
    this.cambioDeDestino();
  }

  /** Otro destino = otros precios actuales: la selección se descarta. */
  private cambioDeDestino(): void {
    this.guardarDestino();
    this.limpiarSeleccion();
    this.aplicado.set(null);
    this.pagina.set(1);
    this.cargar();
  }

  // ------------------------------------------------------------------ carga
  protected cargar(): void {
    const id = this.cuenta();
    const d = this.destino();
    if (id == null || !d) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.sugeridos(id, d, {
      q: this.q(), rubroId: this.rubroId(), proveedorId: this.proveedorId(), soloCambios: this.soloCambios(), aviso: this.aviso(),
      page: this.pagina(), pageSize: this.tamPagina,
    }).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.datos.set(r);
      },
      error: (err) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos calcular los precios sugeridos. Probá de nuevo en un minuto.'));
      },
    });
  }

  protected onBuscar(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
    this.busqueda$.next();
  }

  protected onRubro(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.rubroId.set(v ? Number(v) : null);
    this.recargarDesdeElPrincipio();
  }

  protected onProveedor(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.proveedorId.set(v ? Number(v) : null);
    this.recargarDesdeElPrincipio();
  }

  protected onSoloCambios(e: Event): void {
    this.soloCambios.set((e.target as HTMLInputElement).checked);
    this.recargarDesdeElPrincipio();
  }

  protected elegirAviso(a: Aviso | null): void {
    this.aviso.set(this.aviso() === a ? null : a);
    this.recargarDesdeElPrincipio();
  }

  private recargarDesdeElPrincipio(): void {
    this.pagina.set(1);
    this.cargar();
  }

  protected irA(p: number): void {
    if (p < 1 || p > this.paginas()) return;
    this.pagina.set(p);
    this.cargar();
  }

  // ------------------------------------------------------------------ selección y edición
  protected precioDe(i: SugeridoItem): number | null {
    return this.editados().get(i.codigo) ?? i.sugerido;
  }

  protected editado(i: SugeridoItem): boolean {
    return this.editados().has(i.codigo);
  }

  protected elegido(i: SugeridoItem): boolean {
    return this.elegidos().has(i.codigo);
  }

  /** Se puede tildar si hay un precio (sugerido o escrito a mano) distinto del actual. */
  protected tildable(i: SugeridoItem): boolean {
    const p = this.precioDe(i);
    return p != null && p > 0 && p !== i.precioActual;
  }

  protected alternar(i: SugeridoItem, e: Event): void {
    const on = (e.target as HTMLInputElement).checked;
    const m = new Map(this.elegidos());
    if (on && this.tildable(i)) m.set(i.codigo, i);
    else m.delete(i.codigo);
    this.elegidos.set(m);
    this.confirmando.set(false);
  }

  protected tildarTodasLasQueCambian(): void {
    const m = new Map(this.elegidos());
    for (const i of this.datos()?.items ?? []) if (this.tildable(i)) m.set(i.codigo, i);
    this.elegidos.set(m);
    this.confirmando.set(false);
  }

  protected limpiarSeleccion(): void {
    this.elegidos.set(new Map());
    this.editados.set(new Map());
    this.confirmando.set(false);
  }

  /** El precio escrito a mano: vacío vuelve al sugerido. Escribir un precio tilda la fila. */
  protected onEditar(i: SugeridoItem, e: Event): void {
    const v = numeroONull((e.target as HTMLInputElement).value);
    const ed = new Map(this.editados());
    if (v == null || v <= 0 || v === i.sugerido) ed.delete(i.codigo);
    else ed.set(i.codigo, Math.round(v * 100) / 100);
    this.editados.set(ed);
    const m = new Map(this.elegidos());
    if (this.tildable(i)) m.set(i.codigo, i);
    else m.delete(i.codigo);
    this.elegidos.set(m);
    this.confirmando.set(false);
  }

  private preciosElegidos(): PrecioElegido[] {
    const out: PrecioElegido[] = [];
    for (const i of this.elegidos().values()) {
      const p = this.precioDe(i);
      if (p != null && p > 0) out.push({ item: i, precio: p });
    }
    return out;
  }

  // ------------------------------------------------------------------ aplicar
  protected pedirConfirmacion(): void {
    if (this.cantidadElegidos() === 0) return;
    this.confirmando.set(true);
  }

  protected aplicar(): void {
    const id = this.cuenta();
    const d = this.destino();
    if (id == null || !d || this.aplicando()) return;
    const filas = this.preciosElegidos().map((f) => ({ ean: f.item.codigo, precio: f.precio }));
    if (filas.length === 0) return;
    this.aplicando.set(true);
    this.error.set(null);
    this.api.aplicar(id, d, filas).subscribe({
      next: (r) => {
        this.aplicando.set(false);
        this.confirmando.set(false);
        this.aplicado.set(r);
        this.limpiarSeleccion();
        this.cargar();
      },
      error: (err) => {
        this.aplicando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos aplicar los precios. No se cambió nada; probá de nuevo.'));
      },
    });
  }

  /** Los query params de /precios/carteles para lo recién aplicado. */
  protected cartelesDeLoAplicado(r: AplicarPreciosResponse): Record<string, number> {
    return r.groupId != null ? { groupId: r.groupId } : { batchId: r.batchId };
  }

  // ------------------------------------------------------------------ ajuste de costos
  protected abrirAjuste(): void {
    this.ajusteAbierto.set(!this.ajusteAbierto());
    this.ajusteVista.set(null);
    this.ajusteListo.set(null);
    this.ajusteError.set(null);
  }

  protected onAjustePor(p: 'proveedor' | 'rubro'): void {
    this.ajustePor.set(p);
    this.ajusteId.set(null);
    this.ajusteVista.set(null);
  }

  protected onAjusteId(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.ajusteId.set(v ? Number(v) : null);
    this.ajusteVista.set(null);
  }

  protected onAjustePct(e: Event): void {
    this.ajustePct.set((e.target as HTMLInputElement).value);
    this.ajusteVista.set(null);
  }

  protected onAjusteDesde(e: Event): void {
    this.ajusteDesde.set((e.target as HTMLInputElement).value);
  }

  protected ajustar(vistaPrevia: boolean): void {
    const id = this.cuenta();
    const objetivo = this.ajusteId();
    const pct = numeroONull(this.ajustePct());
    if (id == null || this.ajustando()) return;
    if (objetivo == null) {
      this.ajusteError.set(this.ajustePor() === 'proveedor' ? 'Elegí el proveedor.' : 'Elegí el rubro.');
      return;
    }
    if (pct == null || pct === 0) {
      this.ajusteError.set('Escribí el porcentaje (por ejemplo 8, o −5 si bajó).');
      return;
    }
    this.ajustando.set(true);
    this.ajusteError.set(null);
    const zona = this.destinoTipo() === 'zona' ? this.zonaId() : null;
    this.api.ajustarCostos({
      businessAccountId: id,
      proveedorId: this.ajustePor() === 'proveedor' ? objetivo : null,
      rubroId: this.ajustePor() === 'rubro' ? objetivo : null,
      porcentaje: pct,
      vigenteDesde: this.ajusteDesde() || null,
      zonaId: zona,
    }, vistaPrevia).subscribe({
      next: (r) => {
        this.ajustando.set(false);
        if (vistaPrevia) {
          this.ajusteVista.set(r);
          return;
        }
        this.ajusteVista.set(null);
        this.ajusteListo.set(r);
        // "El proveedor aumentó 8 %" → ahora, qué precios mover.
        if (this.ajustePor() === 'proveedor') {
          this.proveedorId.set(objetivo);
          this.rubroId.set(null);
        } else {
          this.rubroId.set(objetivo);
          this.proveedorId.set(null);
        }
        this.soloCambios.set(true);
        this.limpiarSeleccion();
        this.recargarDesdeElPrincipio();
      },
      error: (err) => {
        this.ajustando.set(false);
        this.ajusteError.set(mensajeDeError(err, 'No pudimos ajustar los costos. Probá de nuevo.'));
      },
    });
  }

  protected nombreDelAjuste(): string {
    const id = this.ajusteId();
    if (this.ajustePor() === 'proveedor') return this.proveedores().find((p) => p.id === id)?.nombre ?? '';
    return this.rubros().find((r) => r.id === id)?.nombre ?? '';
  }

  // ------------------------------------------------------------------ Excel (todas las páginas con los filtros de ahora)
  protected async descargarExcel(): Promise<void> {
    const id = this.cuenta();
    const d = this.destino();
    if (id == null || !d || this.exportando()) return;
    this.exportando.set(true);
    this.error.set(null);
    try {
      const items: SugeridoItem[] = [];
      for (let page = 1; ; page++) {
        const r = await firstValueFrom(this.api.sugeridos(id, d, {
          q: this.q(), rubroId: this.rubroId(), proveedorId: this.proveedorId(), soloCambios: this.soloCambios(), aviso: this.aviso(),
          page, pageSize: 500,
        }));
        items.push(...r.items);
        if (items.length >= r.total || r.items.length === 0) break;
      }
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasExcelSugeridos(items)), 'Sugeridos');
      XLSX.writeFile(libro, `precios-sugeridos-${hoyIso()}.xlsx`);
    } catch (err) {
      this.error.set(mensajeDeError(err, 'No pudimos armar el Excel. Probá de nuevo.'));
    } finally {
      this.exportando.set(false);
    }
  }

  protected num(n: number): string {
    return n.toLocaleString('es-AR');
  }

  protected avisosDe(i: SugeridoItem): Aviso[] {
    return i.avisos.filter((a) => a !== 'sin_costo');
  }

  protected tituloDeAviso(i: SugeridoItem, a: Aviso): string {
    return a === 'dudosa' && i.motivoDudosa ? i.motivoDudosa : AVISOS[a].ayuda;
  }
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
