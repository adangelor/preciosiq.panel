import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { EstadoPedido, PedidoTienda, TiendaService } from '../../core/tienda';

const enteros = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const unidades = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const pesos = (n: number) => '$' + enteros.format(n);

/** "2026-10-16T13:10:05" (UTC sin Z) -> "16 oct, 10:10". */
function cuando(utc: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : `${utc}Z`);
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ETIQUETA: Record<EstadoPedido, string> = {
  nuevo: 'Nuevo',
  visto: 'Visto',
  preparado: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/**
 * BP-130 (16-oct-2026) -- los pedidos que entraron por misuper.app, guardados con su codigo. Al abrir uno
 * se marca "visto" (la persona lo ve en su link); despues, "Listo", "Entregado" o "Cancelar". Sin datos
 * de quien pidio: el nombre y la direccion vienen en su WhatsApp, buscando el codigo.
 */
@Component({
  selector: 'app-tienda-pedidos',
  standalone: true,
  template: `
    <section class="ped" [attr.aria-labelledby]="'ped-titulo-' + tiendaId()">
      <h3 class="ped__titulo" [id]="'ped-titulo-' + tiendaId()">
        Pedidos de tu tienda
        @if (nuevos() > 0) { <span class="ped__nuevos">{{ nuevos() }} {{ nuevos() === 1 ? 'nuevo' : 'nuevos' }}</span> }
      </h3>
      @if (error()) {
        <p class="hint">No pudimos cargar los pedidos. Probá de nuevo en un rato.</p>
      } @else if (pedidos(); as lista) {
        @if (lista.length === 0) {
          <p class="hint">
            Todavía no entró ningún pedido en los últimos 30 días. Cuando alguien toque "Pedir por WhatsApp" en tu
            tienda, te llega el WhatsApp con el código y el pedido aparece acá.
          </p>
        } @else {
          <p class="hint">
            Los últimos 30 días. El código es el mismo que viene en el WhatsApp del cliente: ahí están su nombre y,
            si es para enviar, la dirección.
          </p>
          <ul class="ped__lista">
            @for (p of lista; track p.codigo) {
              <li class="ped__item" [class.ped__item--nuevo]="p.estado === 'nuevo'">
                <button type="button" class="ped__fila" (click)="abrir(p)" [attr.aria-expanded]="abierto() === p.codigo">
                  <span class="ped__codigo">{{ p.codigo }}</span>
                  <span class="ped__cuando">{{ cuando(p.creadoAtUtc) }}</span>
                  <span class="ped__entrega">{{ p.entrega === 'retiro' ? 'Retira' : 'Envío' }}</span>
                  <span class="ped__total">{{ pesos(p.total) }}</span>
                  <span class="ped__estado" [attr.data-estado]="p.estado">{{ etiqueta[p.estado] }}</span>
                </button>
                @if (abierto() === p.codigo) {
                  <div class="ped__detalle">
                    <table class="ped__tabla">
                      <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Total</th></tr></thead>
                      <tbody>
                        @for (r of p.productos; track r.ean) {
                          <tr>
                            <td>
                              {{ r.descripcion }}
                              <small>{{ r.presentacion ? r.presentacion + ' · ' : '' }}{{ pesos(r.precioLista) }} c/u · {{ r.ean }}</small>
                              @if (r.promoTexto) { <small class="ped__promo">{{ r.promoTexto }}</small> }
                            </td>
                            <td class="num">{{ cant(r.cantidad) }}</td>
                            <td class="num">{{ pesos(r.total) }}</td>
                          </tr>
                        }
                      </tbody>
                      <tfoot><tr><td colspan="2">Total estimado</td><td class="num">{{ pesos(p.total) }}</td></tr></tfoot>
                    </table>
                    <div class="ped__acciones">
                      @if (p.estado !== 'preparado' && p.estado !== 'entregado' && p.estado !== 'cancelado') {
                        <button type="button" (click)="marcar(p, 'preparado')" [disabled]="guardando()">Está listo</button>
                      }
                      @if (p.estado !== 'entregado' && p.estado !== 'cancelado') {
                        <button type="button" class="boton-secundario" (click)="marcar(p, 'entregado')" [disabled]="guardando()">Entregado</button>
                        <button type="button" class="boton-secundario" (click)="marcar(p, 'cancelado')" [disabled]="guardando()">Cancelar</button>
                      }
                      <a class="boton-secundario" [href]="link(p.codigo)" target="_blank" rel="noopener">Ver como el cliente ↗</a>
                    </div>
                  </div>
                }
              </li>
            }
          </ul>
        }
      } @else {
        <p class="hint">Cargando pedidos…</p>
      }
    </section>
  `,
  styleUrl: './tienda-pedidos.scss',
})
export class TiendaPedidosComponent implements OnInit {
  private readonly tienda = inject(TiendaService);

  readonly tiendaId = input.required<number>();
  readonly slug = input.required<string>();

  protected readonly pedidos = signal<PedidoTienda[] | null>(null);
  protected readonly error = signal(false);
  protected readonly abierto = signal<string | null>(null);
  protected readonly guardando = signal(false);
  protected readonly nuevos = computed(() => (this.pedidos() ?? []).filter((p) => p.estado === 'nuevo').length);

  protected readonly etiqueta = ETIQUETA;
  protected readonly pesos = pesos;
  protected readonly cuando = cuando;
  protected readonly cant = (n: number) => unidades.format(n);

  ngOnInit(): void {
    this.tienda.pedidos(this.tiendaId()).subscribe({
      next: (lista) => this.pedidos.set(lista),
      error: () => this.error.set(true),
    });
  }

  protected link(codigo: string): string {
    return this.tienda.urlPedido(this.slug(), codigo);
  }

  /** Abrir un pedido lo marca "visto" (si era nuevo): quien pidio lo ve en su link. */
  protected abrir(p: PedidoTienda): void {
    this.abierto.set(this.abierto() === p.codigo ? null : p.codigo);
    if (this.abierto() === p.codigo && p.estado === 'nuevo') this.marcar(p, 'visto');
  }

  protected marcar(p: PedidoTienda, estado: Exclude<EstadoPedido, 'nuevo'>): void {
    this.guardando.set(true);
    this.tienda.cambiarEstadoPedido(this.tiendaId(), p.codigo, estado).subscribe({
      next: (r) => {
        this.pedidos.update((lista) => (lista ?? []).map((x) => (x.codigo === p.codigo ? { ...x, estado: r.estado } : x)));
        this.guardando.set(false);
      },
      error: () => this.guardando.set(false),
    });
  }
}
