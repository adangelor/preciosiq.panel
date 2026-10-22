import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensajeDeError } from '../../core/articulos-form';
import {
  ComprasService, ComprobanteLista, ProveedorFicha, TIPOS_COMPROBANTE, TipoComprobante, fechaCorta, textoTipoComprobante,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-10" del mes de hoy (hora de Argentina, la del navegador). */
export function mesActual(hoy = new Date()): string {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

// BP-180 (22-oct-2026) -- Gestión -> Comprobantes (PROMPT_BP180_Compras_22oct.md, bloque 5): las facturas y notas de los
// proveedores por mes, proveedor, tipo y estado, con el neto del filtro (facturas + notas de débito − notas de crédito).
@Component({
  selector: 'app-comprobantes',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './comprobantes.html',
  styleUrl: './gestion.scss',
})
export class ComprobantesComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly proveedores = signal<ProveedorFicha[]>([]);

  protected readonly tipos = TIPOS_COMPROBANTE;
  protected readonly mes = signal(mesActual());
  protected readonly proveedorId = signal(0);
  protected readonly tipo = signal('');
  protected readonly estado = signal('');
  protected readonly pagina = signal(1);
  protected readonly cargando = signal(false);
  protected readonly lista = signal<ComprobanteLista | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly paginas = computed(() => {
    const l = this.lista();
    return l ? Math.max(1, Math.ceil(l.total / l.pageSize)) : 1;
  });

  protected readonly textoTipo = textoTipoComprobante;
  protected readonly fecha = fechaCorta;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.compras) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.api.proveedores(g.businessAccountId).subscribe({ next: (ps) => this.proveedores.set(ps), error: () => undefined });
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
    this.api.comprobantes(id, { mes: this.mes(), proveedorId: this.proveedorId() || undefined, tipo: this.tipo(), estado: this.estado(), page: this.pagina() }).subscribe({
      next: (l) => { this.cargando.set(false); this.lista.set(l); },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar los comprobantes.')); },
    });
  }

  protected filtrar(campo: 'mes' | 'proveedorId' | 'tipo' | 'estado', e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    if (campo === 'proveedorId') this.proveedorId.set(Number(v) || 0);
    else this[campo].set(v);
    this.pagina.set(1);
    this.cargar();
  }

  protected irA(p: number): void {
    this.pagina.set(p);
    this.cargar();
  }

  /** Las notas de crédito restan: se muestran en negativo. */
  protected importe(t: TipoComprobante, n: number): string {
    return t === 'nota_credito' ? `−${plata.format(n)}` : plata.format(n);
  }

  protected plata(n: number): string { return n < 0 ? `−${plata.format(-n)}` : plata.format(n); }
}
