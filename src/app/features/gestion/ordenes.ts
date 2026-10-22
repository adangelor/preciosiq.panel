import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BranchListItem } from '../../core/business-account.models';
import { mensajeDeError } from '../../core/articulos-form';
import { ComprasService, ESTADOS_ORDEN, EstadoOrden, OrdenLista, fechaCorta, fechaDeUtc, textoEstadoOrden } from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** El color del estado: lo que espera algo del comprador resalta. */
export const PILL_DE_ESTADO: Record<EstadoOrden, string> = {
  borrador: 'pill--warning',
  enviada: 'pill--info',
  recibida_parcial: 'pill--primary',
  recibida: 'pill--success',
  cancelada: 'pill--neutral',
};

// BP-180 (22-oct-2026) -- Gestión -> Compras -> Órdenes (PROMPT_BP180_Compras_22oct.md, bloque 3): las órdenes de compra
// por estado y sucursal. Por defecto las abiertas (en borrador, enviadas o recibidas en parte), que son las que esperan algo.
@Component({
  selector: 'app-ordenes',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './ordenes.html',
  styleUrl: './gestion.scss',
})
export class OrdenesComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<BranchListItem[]>([]);

  protected readonly estados = ESTADOS_ORDEN;
  protected readonly estado = signal<string>('abiertas');
  protected readonly sucursal = signal<string>('');
  protected readonly pagina = signal(1);
  protected readonly cargando = signal(false);
  protected readonly lista = signal<OrdenLista | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly paginas = computed(() => {
    const l = this.lista();
    return l ? Math.max(1, Math.ceil(l.total / l.pageSize)) : 1;
  });

  protected readonly textoEstado = textoEstadoOrden;
  protected readonly fecha = fechaCorta;
  protected readonly pill = PILL_DE_ESTADO;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.compras) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.sucursales.set(g.branches);
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
    this.api.ordenes(id, { estado: this.estado(), sucursal: this.sucursal(), page: this.pagina() }).subscribe({
      next: (l) => { this.cargando.set(false); this.lista.set(l); },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar las órdenes de compra.')); },
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

  protected plata(n: number): string { return n > 0 ? plata.format(n) : '—'; }

  protected readonly cuando = fechaDeUtc;
}
