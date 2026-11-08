import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GestionContextoService } from '../../core/gestion-contexto';
import { BranchListItem } from '../../core/business-account.models';
import { ArticuloMargen, MargenResponse, MargenService } from '../../core/margen';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

const FILTROS = [
  { valor: 'marcados', texto: 'Para mirar' },
  { valor: 'con_ventas', texto: 'Con ventas' },
  { valor: 'teorico', texto: 'Solo con promo (sin ventas)' },
  { valor: 'sin_costo', texto: 'Sin costo' },
  { valor: 'todos', texto: 'Todos' },
] as const;

const FUENTES: Record<string, string> = {
  caja: 'caja',
  planilla: 'ventas cargadas',
  teorico: 'teórico, con la promo',
  sin_ventas: 'sin ventas',
};

// BP-219 (8-nov-2026) -- Precios -> Margen: la cascada de margen. Del costo al precio de góndola, a lo que de verdad se
// cobró (los tickets de la caja o las ventas cargadas) y al margen real; por rubro y artículo, con las promos que se comen
// el margen. Sin costos o sin ventas, la pantalla dice qué falta y cómo cargarlo (decisión F): hoy es lo más importante.
@Component({
  selector: 'app-margen',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './margen.html',
  styleUrls: ['../gestion/gestion.scss', './margen.scss'],
})
export class MargenComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(MargenService);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly FILTROS = FILTROS;
  protected readonly FUENTES = FUENTES;

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly error = signal<string | null>(null);
  private cuenta = 0;
  protected readonly branches = signal<BranchListItem[]>([]);

  protected readonly branchId = signal<string | null>(null);
  protected readonly dias = signal(30);
  protected readonly filtro = signal('marcados');
  protected readonly rubro = signal<string | null>(null);
  protected readonly q = signal('');
  protected readonly page = signal(1);
  protected readonly datos = signal<MargenResponse | null>(null);
  protected readonly cargando = signal(false);
  protected readonly abierto = signal<string | null>(null);
  protected readonly umbralEditado = signal<number | null>(null);
  protected readonly guardandoUmbral = signal(false);
  private buscarTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly paginas = computed(() => {
    const d = this.datos();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });
  protected readonly faltaAlgo = computed(() => {
    const d = this.datos();
    return !!d && (!d.tieneCostos || !d.tieneVentas);
  });

  ngOnInit(): void {
    const q = this.ruta.snapshot.queryParamMap.get('q');
    if (q) {
      this.q.set(q);
      this.filtro.set('todos');
    }
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) return this.sinCuenta.set(true);
        if (!g.formacionPrecios) return this.sinPlan.set(true);
        this.cuenta = g.businessAccountId;
        this.branches.set(g.branches);
        void this.cargar();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.datos.set(
        await firstValueFrom(
          this.api.leer(this.cuenta, {
            branchId: this.branchId(),
            dias: this.dias(),
            filtro: this.filtro(),
            rubro: this.rubro(),
            q: this.q(),
            page: this.page(),
            pageSize: 50,
          }),
        ),
      );
    } catch (err) {
      const e = err as { status?: number; error?: { error?: string } };
      if (e?.status === 402) this.sinPlan.set(true);
      else this.error.set(e?.error?.error ?? 'No se pudo calcular el margen.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected onSucursal(e: Event): void {
    this.branchId.set((e.target as HTMLSelectElement).value || null);
    this.page.set(1);
    void this.cargar();
  }

  protected elegirDias(d: number): void {
    this.dias.set(d);
    this.page.set(1);
    void this.cargar();
  }

  protected elegirFiltro(f: string): void {
    this.filtro.set(f);
    this.page.set(1);
    void this.cargar();
  }

  protected elegirRubro(r: string | null): void {
    this.rubro.set(this.rubro() === r ? null : r);
    this.page.set(1);
    void this.cargar();
  }

  protected onBuscar(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
    if (this.buscarTimer) clearTimeout(this.buscarTimer);
    this.buscarTimer = setTimeout(() => {
      this.page.set(1);
      void this.cargar();
    }, 350);
  }

  protected irA(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.paginas()));
    void this.cargar();
  }

  protected alternar(i: ArticuloMargen): void {
    const k = this.clave(i);
    this.abierto.set(this.abierto() === k ? null : k);
  }

  protected sucursal(id: string): string {
    return this.branches().find((b) => b.branchId === id)?.branchName ?? id;
  }

  protected clave(i: ArticuloMargen): string {
    return `${i.branchId ?? ''}|${i.ean}`;
  }

  // ------------------------------------------------------------------ umbral
  protected onUmbral(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));
    this.umbralEditado.set(isNaN(v) ? null : v);
  }

  protected async guardarUmbral(): Promise<void> {
    const v = this.umbralEditado();
    if (v == null) return;
    this.guardandoUmbral.set(true);
    try {
      await firstValueFrom(this.api.guardarUmbral(this.cuenta, v));
      this.umbralEditado.set(null);
      await this.cargar();
    } catch (err) {
      this.error.set((err as { error?: { error?: string } })?.error?.error ?? 'No se pudo guardar el umbral.');
    } finally {
      this.guardandoUmbral.set(false);
    }
  }

  // ------------------------------------------------------------------ la cascada dibujada
  /** Los escalones de un artículo, en pesos sin IVA (o con IVA si es monotributo), con el ancho de cada barra. */
  protected escalones(i: ArticuloMargen): { texto: string; monto: number; ancho: number; tono: string }[] {
    const max = Math.max(i.precioGondolaSinIva, i.cobradoSinIva ?? 0, i.costoEnGondolaSinIva ?? 0) || 1;
    const l: { texto: string; monto: number; ancho: number; tono: string }[] = [];
    l.push({ texto: 'Precio de góndola', monto: i.precioGondolaSinIva, ancho: (i.precioGondolaSinIva / max) * 100, tono: 'gondola' });
    if (i.cobradoSinIva != null) {
      l.push({
        texto: i.fuente === 'teorico' ? 'Con la promo (teórico)' : 'Lo cobrado de verdad',
        monto: i.cobradoSinIva,
        ancho: (i.cobradoSinIva / max) * 100,
        tono: 'cobrado',
      });
    }
    if (i.costoEnGondolaSinIva != null) {
      l.push({ texto: 'Costo', monto: i.costoEnGondolaSinIva, ancho: (i.costoEnGondolaSinIva / max) * 100, tono: 'costo' });
      const base = i.cobradoSinIva ?? i.precioGondolaSinIva;
      const queda = base - i.costoEnGondolaSinIva;
      l.push({ texto: queda >= 0 ? 'Te queda' : 'Perdés', monto: queda, ancho: (Math.abs(queda) / max) * 100, tono: queda >= 0 ? 'queda' : 'pierde' });
    }
    return l;
  }

  // ------------------------------------------------------------------ Excel y planillas de ejemplo
  protected async exportar(): Promise<void> {
    const d = this.datos();
    if (!d) return;
    const todos: ArticuloMargen[] = [];
    for (let p = 1; p <= 100; p++) {
      const r = await firstValueFrom(
        this.api.leer(this.cuenta, { branchId: this.branchId(), dias: this.dias(), filtro: this.filtro(), rubro: this.rubro(), q: this.q(), page: p, pageSize: 500 }),
      );
      todos.push(...r.items);
      if (p * r.pageSize >= r.total) break;
    }
    const XLSX = await import('xlsx');
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      libro,
      XLSX.utils.json_to_sheet(
        todos.map((i) => ({
          EAN: i.ean,
          Producto: i.descripcion,
          Rubro: i.rubro,
          Sucursal: i.branchId,
          Precio_gondola: i.precioGondola,
          Costo_neto: i.costoNeto,
          Cobrado: i.cobrado,
          De_donde: FUENTES[i.fuente] ?? i.fuente,
          Unidades: i.unidades,
          'Margen_gondola_%': i.margenGondola,
          'Margen_real_%': i.margenReal,
          Plata_en_promos: i.plataEnPromos,
          Para_mirar: i.marcado ? 'sí' : '',
          Por_que: i.frase,
        })),
      ),
      'Margen',
    );
    XLSX.writeFile(libro, `margen-${d.desde}-a-${d.hasta}.xlsx`);
  }

  /** Planillas de ejemplo con los códigos del comercio (decisión F): lo mínimo para cargar costos y ventas. */
  protected bajarEjemplo(tipo: 'costos' | 'ventas'): void {
    const eans = (this.datos()?.items ?? []).slice(0, 5).map((i) => i.ean);
    const filas = eans.length > 0 ? eans : ['7790000000001', '7790000000002'];
    const csv =
      tipo === 'costos'
        ? 'ean;descripcion;precio;costo\n' + filas.map((e) => `${e};(nombre);(precio de góndola);(costo sin IVA)`).join('\n')
        : 'ean;unidades;importe\n' + filas.map((e) => `${e};(unidades vendidas);(importe con IVA)`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = tipo === 'costos' ? 'ejemplo-costos.csv' : 'ejemplo-ventas.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------------ formato
  protected pesos(v: number | null | undefined): string {
    return v == null ? '—' : '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected pct(v: number | null | undefined): string {
    return v == null ? '—' : v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  }

  protected num(v: number): string {
    return v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  }
}
