import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { switchMap, of } from 'rxjs';
import { BusinessContextService } from '../../core/business-context';
import { TiendaDeSucursal, TiendaService } from '../../core/tienda';
import { TiendaSucursalComponent } from './tienda-sucursal';
import { environment } from '../../../environments/environment';

/**
 * BP-71 (08-oct-2026) -- "Mi tienda": la tienda online de cada sucursal en misuper.app/<slug>, con los
 * precios y promos que el comercio ya carga en PreciosIQ. Una tarjeta por sucursal
 * (TiendaSucursalComponent): crearla, editarla, el QR de pago y el cartel para la vidriera.
 */
@Component({
  selector: 'app-mi-tienda',
  standalone: true,
  imports: [RouterLink, TiendaSucursalComponent],
  template: `
    <div class="pagina card--page">
      <h1>Mi tienda online</h1>
      <p class="subtitle">
        Tus clientes ven tus precios y tus promos en <strong>misuper.app</strong> y te hacen el pedido por WhatsApp.
        Gratis, en todos los planes. La tienda sale de los precios que ya cargás acá: no tenés que cargar nada nuevo.
      </p>

      @if (cargando()) {
        <p class="hint">Cargando tus sucursales…</p>
      } @else if (sinCuenta()) {
        <p class="hint">Todavía no tenés un comercio dado de alta. <a routerLink="/alta">Dar de alta mi comercio →</a></p>
      } @else if (error()) {
        <p class="form-error">{{ error() }}</p>
      } @else if (sucursales().length === 0) {
        <p class="hint">Todavía no tenés sucursales. <a routerLink="/sucursales/nueva">Agregar una sucursal →</a></p>
      } @else {
        @for (s of sucursales(); track s.branchId) {
          <app-tienda-sucursal [sucursal]="s" [businessAccountId]="businessAccountId()!" />
        }
        <p class="hint pie">
          ¿Querés ver cómo queda? <a [href]="misuper" target="_blank" rel="noopener">misuper.app ↗</a>
        </p>
      }
    </div>
  `,
  styleUrl: './mi-tienda.scss',
})
export class MiTiendaComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly service = inject(TiendaService);

  protected readonly cargando = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly businessAccountId = signal<number | null>(null);
  protected readonly sucursales = signal<TiendaDeSucursal[]>([]);
  protected readonly misuper = environment.misuperUrl;

  ngOnInit(): void {
    this.context
      .load()
      .pipe(
        switchMap((ctx) => {
          if (!ctx) return of(null);
          this.businessAccountId.set(ctx.account.businessAccountId);
          return this.service.listar(ctx.account.businessAccountId);
        }),
      )
      .subscribe({
        next: (lista) => {
          this.cargando.set(false);
          if (lista === null) this.sinCuenta.set(true);
          else this.sucursales.set(lista);
        },
        error: (err) => {
          this.cargando.set(false);
          this.error.set(err?.error?.error ?? 'No pudimos cargar tus sucursales. Probá recargar la página.');
        },
      });
  }
}
