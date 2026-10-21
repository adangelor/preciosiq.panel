import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ArticulosService } from '../../core/articulos';
import { filasExcel, margenTexto, mensajeDeError, opcionesDeRubro, plata, porcentaje } from '../../core/articulos-form';
import { ArmarArticulosResponse, ArticuloFiltros, ArticuloListaResponse, Proveedor, Rubro } from '../../core/articulos.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

/** Los filtros rápidos, de a uno (son excluyentes en la práctica). */
type Rapido = 'todos' | 'sinRubro' | 'sinCosto' | 'ivaParaRevisar';

// BP-178 (21-oct-2026) -- Gestión → Artículos. La ficha de artículo de la cuenta (no de la sucursal): código interno,
// rubro, proveedor, IVA, costo y margen. Para una cadena con miles de productos, "Armar mis artículos" crea las fichas
// desde lo que ya está cargado (POST /articles/armar; Rufino tarda ~8 s).
@Component({
  selector: 'app-articulos',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './articulos.html',
  styleUrl: './gestion.scss',
})
export class ArticulosComponent implements OnInit, OnDestroy {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ArticulosService);
  private readonly router = inject(Router);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);

  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly datos = signal<ArticuloListaResponse | null>(null);
  protected readonly rubros = signal<Rubro[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);

  protected readonly q = signal('');
  protected readonly rubroId = signal<number | null>(null);
  protected readonly proveedorId = signal<number | null>(null);
  protected readonly rapido = signal<Rapido>('todos');
  protected readonly inactivos = signal(false);
  protected readonly pagina = signal(1);
  protected readonly tamPagina = 50;

  protected readonly armando = signal(false);
  protected readonly armado = signal<ArmarArticulosResponse | null>(null);
  protected readonly exportando = signal(false);

  protected readonly opcionesRubro = computed(() => opcionesDeRubro(this.rubros()));
  protected readonly paginas = computed(() => {
    const d = this.datos();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });
  /** Sin filtros y sin ningún artículo: la cuenta todavía no armó su ficha. */
  protected readonly vacia = computed(() => {
    const d = this.datos();
    return !!d && d.total === 0 && !this.q().trim() && this.rubroId() == null && this.proveedorId() == null
      && this.rapido() === 'todos' && !this.inactivos();
  });

  protected readonly margenTexto = margenTexto;
  protected readonly plata = plata;
  protected readonly porcentaje = porcentaje;

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
        if (!g.gestionArticulos) {
          this.sinPlan.set(true);
          return;
        }
        this.cuenta.set(g.businessAccountId);
        this.cargar();
        this.api.rubros(g.businessAccountId).subscribe({ next: (r) => this.rubros.set(r), error: () => {} });
        this.api.proveedores(g.businessAccountId).subscribe({ next: (p) => this.proveedores.set(p), error: () => {} });
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

  private filtros(): ArticuloFiltros {
    const r = this.rapido();
    return {
      q: this.q(),
      rubroId: this.rubroId(),
      proveedorId: this.proveedorId(),
      sinRubro: r === 'sinRubro',
      sinCosto: r === 'sinCosto',
      ivaParaRevisar: r === 'ivaParaRevisar',
      incluirInactivos: this.inactivos(),
      page: this.pagina(),
      pageSize: this.tamPagina,
    };
  }

  protected cargar(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.listar(id, this.filtros()).subscribe({
      next: (d) => {
        this.cargando.set(false);
        this.datos.set(d);
      },
      error: (err) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos cargar tus artículos. Probá recargar la página.'));
      },
    });
  }

  // ---- filtros ----
  protected onBuscar(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
    this.busqueda$.next();
  }

  protected onRubro(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.rubroId.set(v ? Number(v) : null);
    this.pagina.set(1);
    this.cargar();
  }

  protected onProveedor(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.proveedorId.set(v ? Number(v) : null);
    this.pagina.set(1);
    this.cargar();
  }

  protected elegirRapido(r: Rapido): void {
    this.rapido.set(r);
    this.pagina.set(1);
    this.cargar();
  }

  protected onInactivos(e: Event): void {
    this.inactivos.set((e.target as HTMLInputElement).checked);
    this.pagina.set(1);
    this.cargar();
  }

  protected irA(p: number): void {
    if (p < 1 || p > this.paginas()) return;
    this.pagina.set(p);
    this.cargar();
  }

  protected abrir(id: number): void {
    this.router.navigate(['/gestion/articulos', id]);
  }

  // ---- armar ----
  protected armar(): void {
    const id = this.cuenta();
    if (id == null || this.armando()) return;
    this.armando.set(true);
    this.error.set(null);
    this.api.armar(id).subscribe({
      next: (r) => {
        this.armando.set(false);
        this.armado.set(r);
        this.cargar();
        this.api.rubros(id).subscribe({ next: (x) => this.rubros.set(x), error: () => {} });
        this.api.proveedores(id).subscribe({ next: (x) => this.proveedores.set(x), error: () => {} });
      },
      error: (err) => {
        this.armando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos armar tus artículos. Probá de nuevo en un minuto.'));
      },
    });
  }

  protected verParaRevisar(): void {
    this.armado.set(null);
    this.elegirRapido('ivaParaRevisar');
  }

  // ---- Excel ----
  protected descargarExcel(): void {
    const id = this.cuenta();
    if (id == null || this.exportando()) return;
    this.exportando.set(true);
    this.api.exportar(id).subscribe({
      next: async (items) => {
        try {
          // SheetJS dinámico, como el dashboard: no engorda el bundle de entrada.
          const XLSX = await import('xlsx');
          const libro = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasExcel(items)), 'Artículos');
          const hoy = new Date().toISOString().slice(0, 10);
          XLSX.writeFile(libro, `articulos-${hoy}.xlsx`);
        } finally {
          this.exportando.set(false);
        }
      },
      error: (err) => {
        this.exportando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos armar el Excel. Probá de nuevo.'));
      },
    });
  }

  protected num(n: number): string {
    return n.toLocaleString('es-AR');
  }
}
