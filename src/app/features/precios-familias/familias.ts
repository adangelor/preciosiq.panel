import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { debounceTime, switchMap } from 'rxjs/operators';
import { GestionContextoService } from '../../core/gestion-contexto';
import { BusinessPriceService } from '../../core/business-price';
import { BusinessAccountProductItem } from '../../core/business-price.models';
import {
  CambioDeFamilia,
  Familia,
  FamiliasService,
  IgualarResponse,
  Sugerida,
  SugeridasResponse,
  TipoFamilia,
} from '../../core/familias';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

interface MiembroEnEdicion {
  ean: string;
  descripcion: string | null;
  precio: number | null;
  factor: number | null;
  ajuste: number | null;
}

// BP-221 (8-nov-2026) -- Precios -> Familias de precio. Una familia mueve a sus artículos cuando cambia el guía (por la
// carga masiva, Formación de precios o Cargar precio): "mismo precio" (todos los sabores) o "atado" (la 1,5 l = la 2,25 l
// x 0,7). Aceptar una familia NO cambia precios (decisión I): vale desde el próximo cambio del guía, o con "Igualar al
// guía", que muestra antes -> después y carga como una carga más (se deshace desde Importaciones).
@Component({
  selector: 'app-familias-precio',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './familias.html',
  styleUrls: ['../gestion/gestion.scss', './familias.scss'],
})
export class FamiliasPrecioComponent implements OnInit, OnDestroy {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(FamiliasService);
  private readonly productos = inject(BusinessPriceService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  private cuenta = 0;
  private sucursal = '';   // la búsqueda es en los productos propios de una sucursal (la primera)

  protected readonly vista = signal<'familias' | 'sugeridas'>('familias');
  protected readonly familias = signal<Familia[] | null>(null);
  protected readonly sucursalDeReferencia = signal<string | null>(null);
  protected readonly abierta = signal<number | null>(null);
  protected readonly cargando = signal(false);

  // ---------------------------------------------------------------- igualar
  protected readonly igualando = signal<{ familia: Familia; cambios: CambioDeFamilia[] } | null>(null);
  protected readonly aplicandoIgualar = signal(false);

  // ---------------------------------------------------------------- editor
  protected readonly editando = signal<{ id: number | null } | null>(null);
  protected readonly nombre = signal('');
  protected readonly tipo = signal<TipoFamilia>('mismo');
  protected readonly guia = signal<MiembroEnEdicion | null>(null);
  protected readonly miembros = signal<MiembroEnEdicion[]>([]);
  protected readonly guardando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly resultados = signal<BusinessAccountProductItem[]>([]);
  private readonly busqueda$ = new Subject<string>();
  private sub: Subscription | null = null;

  // ---------------------------------------------------------------- sugeridas
  protected readonly sugeridas = signal<SugeridasResponse | null>(null);
  protected readonly cargandoSugeridas = signal(false);
  protected readonly guiaElegido = signal<Record<string, string>>({});
  protected readonly aceptadas = signal<Set<string>>(new Set());

  protected readonly totalFuera = computed(() => (this.familias() ?? []).reduce((s, f) => s + f.fueraDeRegla, 0));

  ngOnInit(): void {
    this.sub = this.busqueda$
      .pipe(
        debounceTime(300),
        switchMap((q) => this.productos.searchOwnProducts(this.cuenta, this.sucursal, q, 12)),
      )
      .subscribe({ next: (r) => this.resultados.set(r.items), error: () => this.resultados.set([]) });
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) return this.sinCuenta.set(true);
        if (!g.formacionPrecios) return this.sinPlan.set(true);
        this.cuenta = g.businessAccountId;
        this.sucursal = g.branches[0]?.branchId ?? '';
        void this.cargar();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private mensaje(err: unknown, porDefecto: string): string {
    const e = err as { status?: number; error?: { error?: string } };
    if (e?.status === 402) {
      this.sinPlan.set(true);
      return '';
    }
    return e?.error?.error ?? porDefecto;
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.listar(this.cuenta));
      this.familias.set(r.items);
      this.sucursalDeReferencia.set(r.sucursal);
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudieron leer las familias.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected verVista(v: 'familias' | 'sugeridas'): void {
    this.vista.set(v);
    this.aviso.set(null);
    if (v === 'sugeridas' && !this.sugeridas()) void this.cargarSugeridas();
  }

  protected alternar(id: number): void {
    this.abierta.set(this.abierta() === id ? null : id);
  }

  // ================================================================== igualar al guía
  protected async verIgualar(f: Familia): Promise<void> {
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.verIgualar(f.id, this.cuenta));
      this.igualando.set({ familia: f, cambios: r.cambios });
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudo calcular qué cambia.'));
    }
  }

  protected async igualar(): Promise<void> {
    const i = this.igualando();
    if (!i) return;
    this.aplicandoIgualar.set(true);
    try {
      const r: IgualarResponse = await firstValueFrom(this.api.igualar(i.familia.id, this.cuenta));
      this.igualando.set(null);
      this.aviso.set(`Listo: ${r.aplicados} ${r.aplicados === 1 ? 'precio igualado' : 'precios igualados'} al guía. Quedó como la carga «${r.nombreDeLaCarga}»: se deshace desde Importaciones.`);
      await this.cargar();
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudo igualar.'));
    } finally {
      this.aplicandoIgualar.set(false);
    }
  }

  // ================================================================== borrar
  protected async borrar(f: Familia): Promise<void> {
    if (!confirm(`¿Borrar la familia «${f.nombre}»? Los precios no cambian: solo dejan de moverse juntos.`)) return;
    try {
      await firstValueFrom(this.api.borrar(f.id, this.cuenta));
      this.aviso.set(`Se borró la familia «${f.nombre}».`);
      await this.cargar();
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudo borrar.'));
    }
  }

  // ================================================================== editor
  protected nueva(): void {
    this.abrirEditor(null, '', 'mismo', null, []);
  }

  protected editar(f: Familia): void {
    const guia = f.miembros.find((m) => m.esGuia) ?? null;
    this.abrirEditor(
      f.id,
      f.nombre,
      f.tipo,
      guia ? { ean: guia.ean, descripcion: guia.descripcion, precio: guia.precio, factor: 1, ajuste: 0 } : null,
      f.miembros.filter((m) => !m.esGuia).map((m) => ({ ean: m.ean, descripcion: m.descripcion, precio: m.precio, factor: m.factor, ajuste: m.ajuste })),
    );
  }

  private abrirEditor(id: number | null, nombre: string, tipo: TipoFamilia, guia: MiembroEnEdicion | null, miembros: MiembroEnEdicion[]): void {
    this.editando.set({ id });
    this.nombre.set(nombre);
    this.tipo.set(tipo);
    this.guia.set(guia);
    this.miembros.set(miembros);
    this.busqueda.set('');
    this.resultados.set([]);
    this.error.set(null);
  }

  protected cerrarEditor(): void {
    this.editando.set(null);
  }

  protected onNombre(e: Event): void {
    this.nombre.set((e.target as HTMLInputElement).value);
  }

  protected onTipo(t: TipoFamilia): void {
    this.tipo.set(t);
    if (t === 'atado') this.precargarFactores();
  }

  protected onBuscar(e: Event): void {
    const q = (e.target as HTMLInputElement).value;
    this.busqueda.set(q);
    if (q.trim().length >= 3) this.busqueda$.next(q.trim());
    else this.resultados.set([]);
  }

  protected agregar(p: BusinessAccountProductItem, comoGuia: boolean): void {
    if (this.guia()?.ean === p.ean || this.miembros().some((m) => m.ean === p.ean)) return;
    const m: MiembroEnEdicion = { ean: p.ean, descripcion: p.description, precio: p.listPrice, factor: null, ajuste: 0 };
    if (comoGuia) {
      const anterior = this.guia();
      this.guia.set(m);
      if (anterior) this.miembros.update((l) => [anterior, ...l]);
    } else {
      this.miembros.update((l) => [...l, m]);
    }
    if (this.tipo() === 'atado') this.precargarFactores();
  }

  protected hacerGuia(m: MiembroEnEdicion): void {
    const anterior = this.guia();
    this.miembros.update((l) => [...l.filter((x) => x.ean !== m.ean), ...(anterior ? [anterior] : [])]);
    this.guia.set(m);
    if (this.tipo() === 'atado') this.precargarFactores(true);
  }

  protected quitar(m: MiembroEnEdicion): void {
    this.miembros.update((l) => l.filter((x) => x.ean !== m.ean));
  }

  /** Decisión E: en una atada, el factor de hoy (precio del artículo / precio del guía), si no tiene uno. */
  private precargarFactores(todos = false): void {
    const g = this.guia()?.precio;
    if (!g) return;
    this.miembros.update((l) =>
      l.map((m) => ((todos || m.factor == null) && m.precio ? { ...m, factor: Math.round((m.precio / g) * 10000) / 10000 } : m)),
    );
  }

  protected onFactor(m: MiembroEnEdicion, e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));
    this.miembros.update((l) => l.map((x) => (x.ean === m.ean ? { ...x, factor: isNaN(v) ? null : v } : x)));
  }

  protected onAjuste(m: MiembroEnEdicion, e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));
    this.miembros.update((l) => l.map((x) => (x.ean === m.ean ? { ...x, ajuste: isNaN(v) ? 0 : v } : x)));
  }

  /** Lo que daría la regla hoy, sin el redondeo (que lo hace el servidor con la configuración de la formación). */
  protected reglaHoy(m: MiembroEnEdicion): number | null {
    const g = this.guia()?.precio;
    if (!g) return null;
    if (this.tipo() === 'mismo') return g;
    if (!m.factor) return null;
    return Math.round((g * m.factor + (m.ajuste ?? 0)) * 100) / 100;
  }

  protected async guardar(): Promise<void> {
    const ed = this.editando();
    const guia = this.guia();
    if (!ed || !guia) {
      this.error.set('Elegí el artículo guía.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    const r = {
      businessAccountId: this.cuenta,
      nombre: this.nombre().trim(),
      tipo: this.tipo(),
      guiaEan: guia.ean,
      miembros: this.miembros().map((m) => ({ ean: m.ean, factor: m.factor, ajuste: m.ajuste })),
    };
    try {
      if (ed.id) await firstValueFrom(this.api.editar(ed.id, r));
      else await firstValueFrom(this.api.crear(r));
      this.editando.set(null);
      this.aviso.set(`Se guardó la familia «${r.nombre}». Los precios no cambiaron: se mueven juntos desde el próximo cambio del guía.`);
      await this.cargar();
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudo guardar la familia.'));
    } finally {
      this.guardando.set(false);
    }
  }

  // ================================================================== sugeridas
  private async cargarSugeridas(): Promise<void> {
    this.cargandoSugeridas.set(true);
    try {
      this.sugeridas.set(await firstValueFrom(this.api.sugeridas(this.cuenta)));
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudieron calcular las sugerencias.'));
    } finally {
      this.cargandoSugeridas.set(false);
    }
  }

  protected guiaDe(s: Sugerida): string {
    return this.guiaElegido()[s.nombre + '|' + s.guiaEan] ?? s.guiaEan;
  }

  protected elegirGuia(s: Sugerida, ean: string): void {
    this.guiaElegido.update((g) => ({ ...g, [s.nombre + '|' + s.guiaEan]: ean }));
  }

  protected aceptada(s: Sugerida): boolean {
    return this.aceptadas().has(s.nombre + '|' + s.guiaEan);
  }

  protected async aceptar(s: Sugerida): Promise<void> {
    const guia = this.guiaDe(s);
    try {
      await firstValueFrom(
        this.api.crear({
          businessAccountId: this.cuenta,
          nombre: s.nombre,
          tipo: 'mismo',
          guiaEan: guia,
          miembros: s.miembros.filter((m) => m.ean !== guia).map((m) => ({ ean: m.ean })),
        }),
      );
      this.aceptadas.update((a) => new Set([...a, s.nombre + '|' + s.guiaEan]));
      this.aviso.set(`Se creó la familia «${s.nombre}». Los precios no cambiaron.`);
      this.familias.set(null);
      void this.cargar();
    } catch (err) {
      this.error.set(this.mensaje(err, 'No se pudo crear la familia.'));
    }
  }

  // ------------------------------------------------------------------ formato
  protected pesos(v: number | null | undefined): string {
    return v == null ? '—' : '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected distintos(s: Sugerida): number {
    return new Set(s.miembros.map((m) => m.precio)).size;
  }
}
