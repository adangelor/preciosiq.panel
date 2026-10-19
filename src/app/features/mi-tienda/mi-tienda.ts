import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { switchMap, of, forkJoin, map, catchError } from 'rxjs';
import { BusinessContextService } from '../../core/business-context';
import { TiendaDeCuenta, TiendaService } from '../../core/tienda';
import { BusinessAccountService } from '../../core/business-account';
import { TiendaCuentaComponent } from './tienda-cuenta';
import { environment } from '../../../environments/environment';

/**
 * BP-71 (08-oct-2026) -- "Mi tienda": la tienda online en misuper.app/<slug>, con los precios y promos que el
 * comercio ya carga en PreciosIQ.
 * BP-167 (19-oct-2026) -- antes, una tarjeta (y una tienda) por sucursal. Ahora UNA tienda por cuenta
 * (TiendaCuentaComponent, de GET /cuenta): crearla, editarla, el QR de pago y sus sucursales, que entran solas.
 */
@Component({
  selector: 'app-mi-tienda',
  standalone: true,
  imports: [RouterLink, TiendaCuentaComponent],
  template: `
    <div class="pagina card--page">
      <h1>Mi tienda online</h1>
      <p class="subtitle">
        Tus clientes ven tus precios y tus promos en <strong>misuper.app</strong> y te hacen el pedido por WhatsApp.
        Gratis, en todos los planes. La tienda sale de los precios que ya cargás acá: no tenés que cargar nada nuevo.
      </p>

      @if (cargando()) {
        <p class="hint">Cargando tu tienda…</p>
      } @else if (sinCuenta()) {
        <p class="hint">Todavía no tenés un comercio dado de alta. <a routerLink="/alta">Dar de alta mi comercio →</a></p>
      } @else if (error()) {
        <p class="form-error">{{ error() }}</p>
      } @else if (cuenta(); as c) {
        @if (c.sucursales.length === 0) {
          <p class="hint">Todavía no tenés sucursales. <a routerLink="/sucursales/nueva">Agregar una sucursal →</a></p>
        } @else {
          <app-tienda-cuenta [cuenta]="c" [businessAccountId]="businessAccountId()!" [enApp]="enApp()" />
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
  private readonly cuentas = inject(BusinessAccountService);

  protected readonly cargando = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly businessAccountId = signal<number | null>(null);
  protected readonly cuenta = signal<TiendaDeCuenta | null>(null);
  /**
   * BP-72 (08-oct-2026) -- si cada sucursal se muestra en la app BuscaPrecios (IsPublic, el mismo
   * interruptor de "Sucursales"). Solo ahi aparece el boton "Pedíselo a…" que trae gente a la tienda.
   * Sale del listado de sucursales; si ese pedido falla, queda vacio y la tarjeta no dice nada.
   * BP-167: se muestra en la fila de cada sucursal de "Sucursales en tu tienda".
   */
  protected readonly enApp = signal<Partial<Record<string, boolean>>>({});
  protected readonly misuper = environment.misuperUrl;

  ngOnInit(): void {
    this.context
      .load()
      .pipe(
        switchMap((ctx) => {
          if (!ctx) return of(null);
          const id = ctx.account.businessAccountId;
          this.businessAccountId.set(id);
          return forkJoin([
            this.service.cuenta(id),
            this.cuentas.listBranches(id).pipe(
              map((bs) => Object.fromEntries(bs.map((b) => [b.branchId, b.isPublic]))),
              catchError(() => of({} as Partial<Record<string, boolean>>)),
            ),
          ]).pipe(map(([c, enApp]) => { this.enApp.set(enApp); return c; }));
        }),
      )
      .subscribe({
        next: (c) => {
          this.cargando.set(false);
          if (c === null) this.sinCuenta.set(true);
          else this.cuenta.set(c);
        },
        error: (err) => {
          this.cargando.set(false);
          this.error.set(err?.error?.error ?? 'No pudimos cargar tu tienda. Probá recargar la página.');
        },
      });
  }
}
