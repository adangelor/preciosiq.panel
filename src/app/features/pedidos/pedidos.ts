import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { BusinessContextService } from '../../core/business-context';
import { TiendaDeSucursal, TiendaService } from '../../core/tienda';
import { TiendaPedidosComponent } from '../mi-tienda/tienda-pedidos';

/**
 * BP-148 (17-oct-2026) -- "Pedidos", en el menu "Tienda online" (pedido de Andres): los pedidos de
 * misuper.app de todas las tiendas de la cuenta, que antes vivian adentro de la tarjeta de cada tienda.
 * Cada tienda reusa TiendaPedidosComponent (lista, detalle, chat, estados, imprimir).
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
      } @else if (tiendas().length === 0) {
        <p class="hint">Todavía no tenés tu tienda online. <a routerLink="/mi-tienda">Creala en Mi tienda →</a></p>
      } @else {
        @for (s of tiendas(); track s.branchId) {
          <section class="tarjeta">
            @if (tiendas().length > 1) {
              <h2 class="tarjeta__titulo">{{ s.tienda!.nombreVisible }} <small>{{ s.branchName }}</small></h2>
            }
            <app-tienda-pedidos [tiendaId]="s.tienda!.id" [slug]="s.tienda!.slug" [nombre]="s.tienda!.nombreVisible" />
          </section>
        }
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
    .tarjeta__titulo { margin: 1rem 0 0; font-size: 1.1rem; }
    .tarjeta__titulo small { font-weight: 400; color: var(--text-3); font-size: 0.85rem; margin-left: 0.4rem; }
    /* La lista de pedidos trae su propio separador de arriba (va adentro de la tarjeta de Mi tienda). */
    app-tienda-pedidos ::ng-deep .ped:first-child { border-top: 0; margin-top: 0.5rem; }
  `,
})
export class PedidosComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly service = inject(TiendaService);

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly tiendas = signal<TiendaDeSucursal[]>([]);

  ngOnInit(): void {
    this.context
      .load()
      .pipe(switchMap((ctx) => (ctx ? this.service.listar(ctx.account.businessAccountId) : of([] as TiendaDeSucursal[]))))
      .subscribe({
        next: (lista) => {
          this.cargando.set(false);
          this.tiendas.set(lista.filter((s) => !!s.tienda));
        },
        error: (err) => {
          this.cargando.set(false);
          this.error.set(err?.error?.error ?? 'No pudimos cargar tus tiendas. Probá recargar la página.');
        },
      });
  }
}
