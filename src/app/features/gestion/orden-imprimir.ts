import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { ComprasService, Orden, cantidadDeRenglon, cuitConGuiones, fechaCorta, fechaDeUtc, textoEstadoOrden } from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';

const conCentavos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesos = (n: number) => '$' + conCentavos.format(n);
const pct = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/**
 * BP-180 bloque 3 (22-oct-2026) -- la orden de compra para imprimir o guardar como PDF (el botón abre el diálogo del
 * navegador). Fuera del shell, como la hoja del pedido. ?costos=no la imprime sin costos ni total.
 */
@Component({
  selector: 'app-orden-imprimir',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="barra no-imprimir">
      <a [routerLink]="['/gestion/compras/ordenes', id]">← Volver a la orden</a>
      @if (orden()) {
        <label><input type="checkbox" [checked]="conCostos()" (change)="conCostos.set($any($event.target).checked)" /> Con los costos</label>
        <button type="button" (click)="imprimir()">Imprimir o guardar como PDF</button>
      }
    </div>

    @if (error()) {
      <p class="error no-imprimir">{{ error() }}</p>
    } @else if (orden(); as o) {
      <article class="hoja">
        <header class="hoja__cabecera">
          <div>
            <p class="hoja__comercio">{{ o.comercio }}</p>
            <h1>Orden de compra {{ o.numeroTexto }}</h1>
            <p class="hoja__datos">
              {{ fechaUtc(o.enviadaAtUtc ?? o.createdAtUtc) }}
              @if (o.estado !== 'enviada') { · {{ textoEstado(o.estado) }} }
            </p>
          </div>
        </header>

        <div class="hoja__partes">
          <div>
            <h2>Proveedor</h2>
            <p><strong>{{ o.proveedor }}</strong></p>
            @if (o.proveedorCuit) { <p>CUIT {{ cuit(o.proveedorCuit) }}</p> }
            @if (o.proveedorContacto) { <p>{{ o.proveedorContacto }}</p> }
            @if (o.proveedorTelefono || o.proveedorEmail) { <p>{{ o.proveedorTelefono }}{{ o.proveedorTelefono && o.proveedorEmail ? ' · ' : '' }}{{ o.proveedorEmail }}</p> }
          </div>
          <div>
            <h2>Entregar en</h2>
            <p><strong>{{ o.sucursal }}</strong></p>
            @if (o.sucursalDomicilio) { <p>{{ o.sucursalDomicilio }}</p> }
            @if (o.entregaEsperada) { <p>Para el <strong>{{ fecha(o.entregaEsperada) }}</strong></p> }
          </div>
        </div>

        <table class="hoja__tabla">
          <thead>
            <tr>
              <th class="num">Cantidad</th><th>Cód. prov.</th><th>Artículo</th><th>Código</th>
              @if (conCostos()) { <th class="num">Costo s/IVA</th><th class="num">Bonif.</th><th class="num">Subtotal</th> }
            </tr>
          </thead>
          <tbody>
            @for (r of o.items; track r.articuloId) {
              <tr>
                <td class="num cant">{{ cantidad(r) }}</td>
                <td class="codigo">{{ r.codigoProveedor ?? '' }}</td>
                <td><strong>{{ r.descripcion }}</strong>@if (r.marca) { <small>{{ r.marca }}</small> }</td>
                <td class="codigo">{{ r.codigo }}</td>
                @if (conCostos()) {
                  <td class="num">{{ r.costoNetoPactado != null ? pesos(r.costoNetoPactado) : '—' }}</td>
                  <td class="num">{{ r.bonificacionPct ? porcentaje(r.bonificacionPct) + ' %' : '' }}</td>
                  <td class="num">{{ r.subtotal != null ? pesos(r.subtotal) : '—' }}</td>
                }
              </tr>
            }
          </tbody>
          @if (conCostos() && o.totalEstimado > 0) {
            <tfoot>
              <tr><td colspan="6">Total estimado sin IVA</td><td class="num">{{ pesos(o.totalEstimado) }}</td></tr>
            </tfoot>
          }
        </table>

        @if (o.nota) { <p class="hoja__nota"><strong>Nota:</strong> {{ o.nota }}</p> }

        <div class="hoja__pie">
          <p>Recibió: ____________________ &nbsp; Fecha: ___/___/______</p>
        </div>
      </article>
    } @else {
      <p class="cargando no-imprimir">Cargando la orden…</p>
    }
  `,
  styles: `
    :host { display: block; background: #fff; color: #111; min-height: 100vh; font-family: system-ui, sans-serif; }
    .barra { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 0.75rem 1rem;
      border-bottom: 1px solid #ddd; background: #f6f7f8; }
    .barra a { color: #1d4ed8; }
    .barra label { display: inline-flex; gap: 0.4rem; align-items: center; margin-left: auto; }
    .barra button { padding: 0.55rem 1.2rem; border: 0; border-radius: 8px; background: #1d4ed8; color: #fff;
      font: inherit; font-weight: 600; cursor: pointer; }
    .error, .cargando { padding: 2rem 1rem; text-align: center; }
    .error { color: #b91c1c; }
    .hoja { max-width: 820px; margin: 1.5rem auto; padding: 0 1rem; }
    .hoja__cabecera { border-bottom: 3px solid #111; padding-bottom: 0.75rem; }
    .hoja__comercio { margin: 0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
    /* El tema oscuro pinta h1/h2 de blanco: la hoja es siempre blanca. */
    h1, h2 { color: #111; }
    h1 { margin: 0.15rem 0; font-size: 1.7rem; }
    .hoja__datos { margin: 0; color: #333; }
    .hoja__partes { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
    .hoja__partes h2 { margin: 0 0 0.3rem; font-size: 0.75rem; text-transform: uppercase; color: #555; letter-spacing: 0.05em; }
    .hoja__partes p { margin: 0.1rem 0; }
    .hoja__tabla { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .hoja__tabla th { text-align: left; font-size: 0.72rem; text-transform: uppercase; color: #555; padding: 0.4rem; border-bottom: 1px solid #999; }
    .hoja__tabla td { padding: 0.45rem 0.4rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    .hoja__tabla tr { break-inside: avoid; }
    .hoja__tabla small { display: block; color: #555; font-size: 0.8rem; }
    .hoja__tabla tfoot td { font-weight: 700; border-bottom: 0; border-top: 2px solid #111; }
    .num { text-align: right; white-space: nowrap; }
    .cant { font-weight: 700; }
    .codigo { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #444; white-space: nowrap; }
    .hoja__nota { margin-top: 1rem; }
    .hoja__pie { margin-top: 2rem; font-size: 0.9rem; }
    @media (max-width: 600px) { .hoja__partes { grid-template-columns: 1fr; } }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      .no-imprimir { display: none !important; }
      .hoja { margin: 0; max-width: none; padding: 0; }
    }
  `,
})
export class OrdenImprimirComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);

  protected id = 0;
  protected readonly orden = signal<Orden | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly conCostos = signal(true);
  protected readonly pesos = pesos;
  protected readonly fecha = fechaCorta;
  protected readonly fechaUtc = fechaDeUtc;
  protected readonly textoEstado = textoEstadoOrden;
  protected readonly cuit = cuitConGuiones;

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id')) || 0;
    this.conCostos.set(this.route.snapshot.queryParamMap.get('costos') !== 'no');
    this.gestion.load().pipe(
      switchMap((g) => (g ? this.api.orden(g.businessAccountId, this.id) : of(null))),
    ).subscribe({
      next: (o) => (o ? this.orden.set(o) : this.error.set('Todavía no tenés un comercio dado de alta.')),
      error: () => this.error.set('No pudimos cargar la orden. Probá de nuevo en un rato.'),
    });
  }

  protected cantidad(r: Orden['items'][number]): string { return cantidadDeRenglon(r); }
  protected porcentaje(n: number): string { return pct.format(n); }

  protected imprimir(): void {
    window.print();
  }
}
