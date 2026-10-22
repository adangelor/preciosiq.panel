import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';
import { BusinessContextService } from '../../core/business-context';
import { PedidoTienda, TiendaService, detalleEnvio } from '../../core/tienda';

const enteros = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const conCentavos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesos = (n: number) => '$' + (Number.isInteger(n) ? enteros : conCentavos).format(n);
const cantidad = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(n);

/**
 * BP-150 (17-oct-2026) -- la hoja para armar un pedido (pedido de Andres: "que los repositores armen el
 * pedido"). Fuera del shell, como el cartel de la vidriera, para que se imprima limpia; el boton abre el
 * dialogo de imprimir del navegador, que tambien deja "Guardar como PDF". Productos en orden alfabetico,
 * con un casillero para tildar, la cantidad bien grande y el codigo de barras para no confundir variedades.
 */
@Component({
  selector: 'app-pedido-imprimir',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="barra no-imprimir">
      <a routerLink="/pedidos">← Volver a Pedidos</a>
      @if (pedido()) {
        <button type="button" (click)="imprimir()">Imprimir o guardar como PDF</button>
      }
    </div>

    @if (error()) {
      <p class="error no-imprimir">{{ error() }}</p>
    } @else if (pedido(); as p) {
      <article class="hoja">
        <header class="hoja__cabecera">
          <div>
            <p class="hoja__tienda">{{ tienda() }}</p>
            <h1>Pedido {{ p.codigo }}</h1>
            <p class="hoja__datos">
              {{ cuando(p.creadoAtUtc) }} · {{ p.entrega === 'retiro' ? 'Lo pasa a retirar' : 'Para enviar' }}
              <!-- BP-167: de que sucursal es (una tienda por cuenta: el repositor tiene que saber donde armarlo). -->
              @if (p.sucursalNombre) { · Sucursal {{ p.sucursalNombre }} }
              @if (p.clienteNombre) { · {{ p.clienteNombre }} }
              <!-- BP-193: costo y distancia del envio, y si quedo fuera del radio (el repartidor lo tiene que saber). -->
              @if (detalleEnvio(p); as envio) { · {{ envio }} }
              @if (p.envioFueraDelRadio) { · <strong>FUERA DE LA ZONA</strong> }
            </p>
          </div>
          <div class="hoja__resumen">
            <strong>{{ unidades() }}</strong>
            <span>{{ p.productos.length === 1 ? 'producto' : 'productos' }}</span>
          </div>
        </header>

        <table class="hoja__tabla">
          <thead>
            <tr><th class="tilde" aria-label="Armado"></th><th class="num">Cant.</th><th>Producto</th><th>Código</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            @for (r of renglones(); track r.ean) {
              <tr>
                <td class="tilde"><span class="casillero"></span></td>
                <td class="num cant">{{ cantidad(r.cantidad) }}</td>
                <td>
                  <strong>{{ r.descripcion }}</strong>
                  @if (r.presentacion) { <small>{{ r.presentacion }}</small> }
                  @if (r.promoTexto) { <small class="promo">Promo: {{ r.promoTexto }}</small> }
                </td>
                <td class="ean">{{ r.ean }}</td>
                <td class="num">{{ pesos(r.total) }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            @if (p.entrega === 'envio' && p.costoEnvio) {
              <tr><td colspan="4">Envío</td><td class="num">{{ pesos(p.costoEnvio) }}</td></tr>
            }
            <tr><td colspan="4">Total estimado</td><td class="num">{{ pesos(p.total + (p.entrega === 'envio' ? (p.costoEnvio ?? 0) : 0)) }}</td></tr>
          </tfoot>
        </table>

        <div class="hoja__pie">
          <p>Armó: ____________________</p>
          <p>Faltantes / cambios:</p>
          <div class="hoja__notas"></div>
        </div>
      </article>
    } @else {
      <p class="cargando no-imprimir">Cargando el pedido…</p>
    }
  `,
  styles: `
    :host { display: block; background: #fff; color: #111; min-height: 100vh; font-family: system-ui, sans-serif; }
    .barra { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.75rem 1rem;
      border-bottom: 1px solid #ddd; background: #f6f7f8; }
    .barra a { color: #1d4ed8; }
    .barra button { padding: 0.55rem 1.2rem; border: 0; border-radius: 8px; background: #1d4ed8; color: #fff;
      font: inherit; font-weight: 600; cursor: pointer; }
    .error, .cargando { padding: 2rem 1rem; text-align: center; }
    .error { color: #b91c1c; }
    .hoja { max-width: 760px; margin: 1.5rem auto; padding: 0 1rem; }
    .hoja__cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
      border-bottom: 3px solid #111; padding-bottom: 0.75rem; }
    .hoja__tienda { margin: 0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
    h1 { margin: 0.15rem 0; font-size: 1.8rem; letter-spacing: 0.02em; color: #111; } /* el tema oscuro lo pintaba de blanco */
    .hoja__datos { margin: 0; color: #333; }
    .hoja__resumen { text-align: center; border: 2px solid #111; border-radius: 8px; padding: 0.35rem 0.9rem; }
    .hoja__resumen strong { display: block; font-size: 1.6rem; line-height: 1.1; }
    .hoja__resumen span { font-size: 0.8rem; }
    .hoja__tabla { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.95rem; }
    .hoja__tabla th { text-align: left; font-size: 0.75rem; text-transform: uppercase; color: #555; padding: 0.4rem 0.4rem;
      border-bottom: 1px solid #999; }
    .hoja__tabla td { padding: 0.55rem 0.4rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    .hoja__tabla tr { break-inside: avoid; }
    .hoja__tabla small { display: block; color: #555; font-size: 0.8rem; }
    .hoja__tabla .promo { color: #111; font-style: italic; }
    .hoja__tabla tfoot td { font-weight: 700; border-bottom: 0; border-top: 2px solid #111; }
    .num { text-align: right; white-space: nowrap; }
    .cant { font-size: 1.25rem; font-weight: 800; }
    .ean { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #444; white-space: nowrap; }
    .tilde { width: 2rem; }
    .casillero { display: inline-block; width: 1.1rem; height: 1.1rem; border: 2px solid #111; border-radius: 3px; margin-top: 0.15rem; }
    .hoja__pie { margin-top: 1.5rem; font-size: 0.9rem; }
    .hoja__pie p { margin: 0.5rem 0; }
    .hoja__notas { height: 4.5rem; border: 1px solid #999; border-radius: 6px; }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      .no-imprimir { display: none !important; }
      .hoja { margin: 0; max-width: none; padding: 0; }
    }
  `,
})
export class PedidoImprimirComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly context = inject(BusinessContextService);
  private readonly service = inject(TiendaService);

  protected readonly pedido = signal<PedidoTienda | null>(null);
  protected readonly tienda = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly pesos = pesos;
  protected readonly detalleEnvio = detalleEnvio;
  protected readonly cantidad = cantidad;

  /** Alfabetico: el repositor recorre la lista de arriba abajo sin saltar. */
  protected readonly renglones = computed(() =>
    [...(this.pedido()?.productos ?? [])].sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es')),
  );
  protected readonly unidades = computed(() => this.pedido()?.productos.length ?? 0);

  ngOnInit(): void {
    const tiendaId = Number(this.route.snapshot.paramMap.get('tiendaId'));
    const codigo = (this.route.snapshot.paramMap.get('codigo') ?? '').toUpperCase();
    this.context
      .load()
      .pipe(
        switchMap((ctx) =>
          forkJoin([
            this.service.pedidos(tiendaId, 90),
            ctx ? this.service.cuenta(ctx.account.businessAccountId) : of(null),
          ]),
        ),
      )
      .subscribe({
        next: ([pedidos, cuenta]) => {
          const p = pedidos.find((x) => x.codigo === codigo);
          if (!p) {
            this.error.set(`No encontramos el pedido ${codigo} entre los de los últimos 90 días.`);
            return;
          }
          this.tienda.set(cuenta?.tienda?.id === tiendaId ? cuenta.tienda.nombreVisible : '');
          this.pedido.set(p);
        },
        error: () => this.error.set('No pudimos cargar el pedido. Probá de nuevo en un rato.'),
      });
  }

  protected cuando(utc: string): string {
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : `${utc}Z`);
    return d.toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected imprimir(): void {
    window.print();
  }
}
