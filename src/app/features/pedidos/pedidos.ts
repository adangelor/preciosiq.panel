import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { BusinessContextService } from '../../core/business-context';
import { TiendaDeCuenta, TiendaService } from '../../core/tienda';
import { TiendaPedidosComponent } from '../mi-tienda/tienda-pedidos';

/**
 * BP-148 (17-oct-2026) -- "Pedidos", en el menu "Tienda online" (pedido de Andres): los pedidos de
 * misuper.app, que antes vivian adentro de la tarjeta de cada tienda. Reusa TiendaPedidosComponent
 * (lista, detalle, chat, estados, imprimir).
 * BP-167 (19-oct-2026) -- una tienda por cuenta: una sola lista, con el filtro "Todas" / cada sucursal
 * (?sucursal=) y el nombre de la sucursal en cada pedido.
 */
@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [RouterLink, TiendaPedidosComponent],
  template: `
    <div class="pagina card--page">
      <h1>Pedidos</h1>
      <p class="subtitle">
        Los pedidos que te hicieron por tu tienda online. Al abrir uno, el cliente ve en su link que ya lo viste;
        cuando lo tengas armado, tocá "Está listo" y le avisamos.
      </p>

      @if (cargando()) {
        <p class="hint">Cargando…</p>
      } @else if (error()) {
        <p class="form-error">{{ error() }}</p>
      } @else if (cuenta()?.tienda; as t) {
        <section class="tarjeta">
          @if (opciones().length > 1) {
            <label class="filtro">
              Sucursal
              <select [value]="sucursal() ?? ''" (change)="elegir($any($event.target).value)">
                <option value="">Todas</option>
                @for (s of opciones(); track s.branchId) {
                  <option [value]="s.branchId">{{ s.nombre }}</option>
                }
              </select>
            </label>
          }
          <app-tienda-pedidos [tiendaId]="t.id" [slug]="t.slug" [nombre]="t.nombreVisible"
                              [sucursal]="sucursal()" [mostrarSucursal]="opciones().length > 1" />
        </section>
      } @else {
        <p class="hint">Todavía no tenés tu tienda online. <a routerLink="/mi-tienda">Creala en Mi tienda →</a></p>
      }
    </div>
  `,
  styles: `
    .pagina { max-width: 860px; margin: 2rem auto; }
    .subtitle { color: var(--text-2); margin-bottom: 1.5rem; }
    .hint { font-size: 0.9rem; color: var(--text-3); }
    .form-error { color: var(--danger); font-size: 0.9rem; }
    .tarjeta {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius, 12px);
      padding: 0.25rem 1.5rem 1.25rem; margin-bottom: 1.25rem; box-shadow: var(--shadow);
    }
    .filtro { display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 1rem; font-size: 0.9rem; font-weight: 600; }
    .filtro select {
      padding: 0.4rem 0.6rem; border: 1px solid var(--border-strong); border-radius: 6px;
      font: inherit; font-weight: 400; background: var(--bg-input); color: var(--text);
    }
    /* La lista de pedidos trae su propio separador de arriba (va adentro de la tarjeta de Mi tienda). */
    app-tienda-pedidos ::ng-deep .ped:first-child { border-top: 0; margin-top: 0.5rem; }
  `,
})
export class PedidosComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly service = inject(TiendaService);

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly cuenta = signal<TiendaDeCuenta | null>(null);
  /** null = todas las sucursales. */
  protected readonly sucursal = signal<string | null>(null);

  /**
   * Las sucursales del filtro: las que estan en la tienda (los pedidos de una que se saco siguen saliendo en "Todas").
   * Con una sola, el filtro no se muestra.
   */
  protected readonly opciones = computed(() => (this.cuenta()?.sucursales ?? []).filter((s) => s.habilitada));

  ngOnInit(): void {
    this.context
      .load()
      .pipe(switchMap((ctx) => (ctx ? this.service.cuenta(ctx.account.businessAccountId) : of(null))))
      .subscribe({
        next: (c) => {
          this.cargando.set(false);
          this.cuenta.set(c);
        },
        error: (err) => {
          this.cargando.set(false);
          this.error.set(err?.error?.error ?? 'No pudimos cargar tu tienda. Probá recargar la página.');
        },
      });
  }

  protected elegir(valor: string): void {
    this.sucursal.set(valor || null);
  }
}
