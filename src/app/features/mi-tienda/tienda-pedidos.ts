import { Component, computed, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvisosService } from '../../core/avisos';
import { EstadoPedido, PedidoTienda, TiendaService } from '../../core/tienda';
import { PedidoChatComponent } from './pedido-chat';

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
  imports: [PedidoChatComponent, RouterLink],
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
                  <span class="ped__cuando">
                    {{ cuando(p.creadoAtUtc) }}
                    @if (p.clienteNombre) { · {{ p.clienteNombre }} }
                    @if (p.mensajesSinLeer) { <span class="ped__sinleer" [attr.aria-label]="p.mensajesSinLeer + ' mensajes sin leer'">{{ p.mensajesSinLeer }}</span> }
                  </span>
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
                    @if (p.tieneChat) {
                      <app-pedido-chat [tiendaId]="tiendaId()" [codigo]="p.codigo" (marcadoListo)="marcarLocal(p.codigo, 'preparado')" />
                    } @else {
                      <p class="hint">El cliente mandó este pedido al WhatsApp de tu almacén: contestale desde ahí.</p>
                    }
                    <div class="ped__acciones">
                      @if (p.estado !== 'preparado' && p.estado !== 'entregado' && p.estado !== 'cancelado') {
                        <!-- BP-151: con el WhatsApp central, el aviso le sale solo; si no, se abre WhatsApp con el mensaje escrito. -->
                        <button type="button" (click)="listo(p)" [disabled]="guardando()">Está listo</button>
                      }
                      @if (p.estado !== 'entregado' && p.estado !== 'cancelado') {
                        <button type="button" class="boton-secundario" (click)="marcar(p, 'entregado')" [disabled]="guardando()">Entregado</button>
                      }
                      <!-- BP-150: la hoja para armar el pedido (se imprime o se guarda como PDF). -->
                      <a class="boton-secundario" [routerLink]="['/pedidos/imprimir', tiendaId(), p.codigo]" target="_blank">Imprimir</a>
                      @if (p.estado === 'preparado' && !p.tieneChat) {
                        <a class="boton-secundario" [href]="whatsappListo(p)" target="_blank" rel="noopener">Avisarle por WhatsApp</a>
                      }
                      <a class="boton-secundario" [href]="link(p.codigo)" target="_blank" rel="noopener">Ver como el cliente ↗</a>
                      @if (p.estado !== 'entregado' && p.estado !== 'cancelado') {
                        <button type="button" class="boton-secundario boton-peligro" (click)="marcar(p, 'cancelado')" [disabled]="guardando()">Cancelar</button>
                      }
                    </div>
                    @if (avisoListo()?.codigo === p.codigo) { <p class="hint ped__avisado">{{ avisoListo()!.texto }}</p> }
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
export class TiendaPedidosComponent implements OnInit, OnDestroy {
  private readonly tienda = inject(TiendaService);

  readonly tiendaId = input.required<number>();
  readonly slug = input.required<string>();
  /** BP-151: el nombre de la tienda, para el mensaje de "tu pedido esta listo". */
  readonly nombre = input<string>('');

  protected readonly pedidos = signal<PedidoTienda[] | null>(null);
  protected readonly error = signal(false);
  protected readonly abierto = signal<string | null>(null);
  protected readonly guardando = signal(false);
  protected readonly avisoListo = signal<{ codigo: string; texto: string } | null>(null);
  private readonly avisos = inject(AvisosService);
  protected readonly nuevos = computed(() => (this.pedidos() ?? []).filter((p) => p.estado === 'nuevo').length);

  protected readonly etiqueta = ETIQUETA;
  protected readonly pesos = pesos;
  protected readonly cuando = cuando;
  protected readonly cant = (n: number) => unidades.format(n);

  private intervalo?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.cargar();
    // BP-131: pedidos y mensajes nuevos sin recargar la pagina.
    this.intervalo = setInterval(() => this.cargar(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  private cargar(): void {
    this.tienda.pedidos(this.tiendaId()).subscribe({
      next: (lista) => { this.pedidos.set(lista); this.error.set(false); },
      error: () => { if (!this.pedidos()) this.error.set(true); },
    });
  }

  /** Cambia el estado en la lista sin volver a pedirla (lo que el servidor ya hizo). */
  protected marcarLocal(codigo: string, estado: EstadoPedido): void {
    this.pedidos.update((lista) => (lista ?? []).map((x) => (x.codigo === codigo ? { ...x, estado } : x)));
  }

  protected link(codigo: string): string {
    return this.tienda.urlPedido(this.slug(), codigo);
  }

  /** Abrir un pedido lo marca "visto" (si era nuevo): quien pidio lo ve en su link. */
  protected abrir(p: PedidoTienda): void {
    this.abierto.set(this.abierto() === p.codigo ? null : p.codigo);
    // El chat se marca leido al abrirse (lo hace el servidor al traerlo).
    if (this.abierto() === p.codigo && p.mensajesSinLeer)
      this.pedidos.update((lista) => (lista ?? []).map((x) => (x.codigo === p.codigo ? { ...x, mensajesSinLeer: 0 } : x)));
    if (this.abierto() === p.codigo && p.estado === 'nuevo') this.marcar(p, 'visto');
    // BP-149: la campanita y el numerito del menu bajan al toque (el servidor ya lo marco visto o leido).
    if (this.abierto() === p.codigo && (p.estado === 'nuevo' || p.mensajesSinLeer)) setTimeout(() => this.avisos.refrescar(), 1500);
  }

  /**
   * BP-151 -- "Esta listo". Si el cliente escribio por el WhatsApp central (hay chat), le sale la plantilla
   * aprobada "tu pedido esta listo" (y queda preparado). Si mando el pedido al WhatsApp del almacen, no
   * tenemos su numero: se abre WhatsApp con el mensaje escrito y el almacenero elige el chat. La ventana se
   * abre en el mismo toque (despues de esperar al servidor, el navegador la bloquearia).
   */
  protected listo(p: PedidoTienda): void {
    if (p.tieneChat) {
      this.guardando.set(true);
      this.tienda.avisarListo(this.tiendaId(), p.codigo).subscribe({
        next: () => {
          this.marcarLocal(p.codigo, 'preparado');
          this.guardando.set(false);
          this.avisoListo.set({ codigo: p.codigo, texto: 'Listo. Le avisamos por WhatsApp que puede pasar a buscarlo.' });
        },
        error: () => {
          // Sin el aviso (OmniVox caido, plantilla sin aprobar...) igual queda listo: lo ve en su link.
          this.marcar(p, 'preparado');
          this.avisoListo.set({ codigo: p.codigo, texto: 'Quedó listo, pero no pudimos mandarle el WhatsApp. Escribile desde el chat.' });
        },
      });
      return;
    }
    window.open(this.whatsappListo(p), '_blank', 'noopener');
    this.marcar(p, 'preparado');
    this.avisoListo.set({ codigo: p.codigo, texto: 'Se abrió WhatsApp con el aviso escrito: elegí el chat del cliente y mandalo.' });
  }

  /** wa.me sin numero: WhatsApp abre con el texto y el almacenero elige a quien. */
  protected whatsappListo(p: PedidoTienda): string {
    const de = this.nombre() ? ` de ${this.nombre()}` : '';
    const texto =
      `¡Hola! Tu pedido ${p.codigo}${de} ya está listo. ` +
      (p.entrega === 'retiro' ? 'Podés pasar a buscarlo cuando quieras.' : 'En un rato sale para tu casa.') +
      ` Lo ves acá: ${this.link(p.codigo)}`;
    return `https://wa.me/?text=${encodeURIComponent(texto)}`;
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
