import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BranchListItem } from '../../core/business-account.models';
import { mensajeDeError } from '../../core/articulos-form';
import {
  ComprasService, ESTADOS_RECEPCION, EstadoRecepcion, OrdenResumen, ProveedorFicha, RecepcionLista, fechaCorta, fechaHoraLocal,
  textoEstadoOrden, textoEstadoRecepcion,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { PILL_DE_ESTADO } from './ordenes';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

export const PILL_DE_RECEPCION: Record<EstadoRecepcion, string> = {
  borrador: 'pill--warning',
  confirmada: 'pill--success',
  anulada: 'pill--neutral',
};

// BP-180 (22-oct-2026) -- Gestión -> Recepciones (PROMPT_BP180_Compras_22oct.md, bloque 4): las órdenes que esperan
// mercadería (para recibirlas), empezar una recepción sin orden o una devolución al proveedor, y las recepciones hechas.
@Component({
  selector: 'app-recepciones',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './recepciones.html',
  styleUrl: './gestion.scss',
})
export class RecepcionesComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** ?orden=: solo las recepciones de esa orden (desde la orden, "Ver sus recepciones"). */
  protected readonly ordenId = signal<number | null>(null);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<BranchListItem[]>([]);
  protected readonly proveedores = signal<ProveedorFicha[]>([]);
  protected readonly activos = computed(() => this.proveedores().filter((p) => p.activo));

  protected readonly porRecibir = signal<OrdenResumen[]>([]);
  protected readonly estados = ESTADOS_RECEPCION;
  protected readonly estado = signal('');
  protected readonly sucursal = signal('');
  protected readonly pagina = signal(1);
  protected readonly cargando = signal(false);
  protected readonly lista = signal<RecepcionLista | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly paginas = computed(() => {
    const l = this.lista();
    return l ? Math.max(1, Math.ceil(l.total / l.pageSize)) : 1;
  });

  // ---- empezar sin orden / devolución
  protected readonly empezando = signal<'sin_orden' | 'devolucion' | null>(null);
  protected readonly nuevaSucursal = signal('');
  protected readonly nuevoProveedor = signal(0);
  protected readonly errorNueva = signal<string | null>(null);

  protected readonly textoEstado = textoEstadoRecepcion;
  protected readonly textoEstadoOrden = textoEstadoOrden;
  protected readonly fecha = fechaCorta;
  protected readonly fechaHora = fechaHoraLocal;
  protected readonly pill = PILL_DE_RECEPCION;
  protected readonly pillOrden = PILL_DE_ESTADO;

  ngOnInit(): void {
    this.ordenId.set(Number(this.route.snapshot.queryParamMap.get('orden')) || null);
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.compras) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.sucursales.set(g.branches);
        if (g.branches.length === 1) this.nuevaSucursal.set(g.branches[0].branchId);
        this.api.proveedores(g.businessAccountId).subscribe({ next: (ps) => this.proveedores.set(ps), error: () => undefined });
        this.api.ordenes(g.businessAccountId, { estado: 'abiertas', pageSize: 100 }).subscribe({
          next: (l) => this.porRecibir.set(l.items.filter((o) => o.estado === 'enviada' || o.estado === 'recibida_parcial')),
          error: () => undefined,
        });
        this.cargar();
      },
      error: () => { this.cargandoCuenta.set(false); this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  protected cargar(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.recepciones(id, { estado: this.estado(), sucursal: this.sucursal(), ordenId: this.ordenId() ?? undefined, page: this.pagina() }).subscribe({
      next: (l) => { this.cargando.set(false); this.lista.set(l); },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar las recepciones.')); },
    });
  }

  protected filtrar(campo: 'estado' | 'sucursal', e: Event): void {
    this[campo].set((e.target as HTMLSelectElement).value);
    this.pagina.set(1);
    this.cargar();
  }

  protected irA(p: number): void {
    this.pagina.set(p);
    this.cargar();
  }

  protected empezar(tipo: 'sin_orden' | 'devolucion'): void {
    this.empezando.set(tipo);
    this.errorNueva.set(null);
    this.nuevoProveedor.set(0);
  }

  protected elegirNueva(campo: 'nuevaSucursal' | 'nuevoProveedor', e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (campo === 'nuevaSucursal') this.nuevaSucursal.set(v);
    else this.nuevoProveedor.set(Number(v) || 0);
  }

  protected seguir(): void {
    const tipo = this.empezando();
    if (!tipo) return;
    if (!this.nuevaSucursal()) { this.errorNueva.set('Elegí la sucursal.'); return; }
    if (tipo === 'devolucion' && !this.nuevoProveedor()) { this.errorNueva.set('Elegí a qué proveedor le devolvés.'); return; }
    const queryParams: Record<string, string | number> = { tipo, sucursal: this.nuevaSucursal() };
    if (this.nuevoProveedor()) queryParams['proveedor'] = this.nuevoProveedor();
    void this.router.navigate(['/gestion/compras/recepciones/nueva'], { queryParams });
  }

  protected plata(n: number): string { return n > 0 ? plata.format(n) : '—'; }
  protected cant(n: number): string { return num.format(n); }
}
