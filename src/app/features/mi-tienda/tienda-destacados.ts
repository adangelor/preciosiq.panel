import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ProductoDeTienda, TiendaService } from '../../core/tienda';

const pesos = (n: number | null) => (n == null ? '' : '$' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n));

/**
 * BP-145 (17-oct-2026) -- los productos que el comercio destaca en su tienda de misuper.app: salen primeros
 * en su categoria y en "Todo" y, si tienen promo, primeros en "Ofertas destacadas". Se buscan entre los
 * productos de la sucursal, se ordenan con las flechas y se guardan todos juntos.
 */
@Component({
  selector: 'app-tienda-destacados',
  standalone: true,
  template: `
    <details class="vid">
      <summary class="vid__titulo">
        Productos destacados
        @if (guardados() > 0) { <span class="vid__cuenta">{{ guardados() }}</span> }
      </summary>
      <p class="hint">
        Salen primeros en su categoría y en "Todo" de tu tienda, con la etiqueta "Destacado". Si tienen promo,
        también van primeros en "Ofertas". Hasta {{ max() }} productos.
      </p>

      @if (faltaScript()) {
        <p class="aviso">Esta función todavía no está activada en el servidor. Avisanos y la activamos.</p>
      } @else if (cargando()) {
        <p class="hint">Cargando…</p>
      } @else {
        @if (lista().length === 0) {
          <p class="hint vid__vacio">Todavía no destacaste ningún producto. Buscalos acá abajo.</p>
        } @else {
          <ol class="vid__lista">
            @for (p of lista(); track p.ean; let i = $index, ultimo = $last) {
              <li class="vid__item">
                <span class="vid__foto">
                  @if (p.fotoUrl) { <img [src]="p.fotoUrl" alt="" width="40" height="40" loading="lazy" /> }
                </span>
                <span class="vid__texto">
                  <strong>{{ p.descripcion }}</strong>
                  <small>{{ p.marca ? p.marca + ' · ' : '' }}{{ pesos(p.precioLista) }}{{ p.fotoUrl ? '' : ' · sin foto' }}</small>
                </span>
                <span class="vid__botones">
                  <button type="button" class="icono-btn" (click)="mover(i, -1)" [disabled]="i === 0" [attr.aria-label]="'Subir ' + p.descripcion">↑</button>
                  <button type="button" class="icono-btn" (click)="mover(i, 1)" [disabled]="ultimo" [attr.aria-label]="'Bajar ' + p.descripcion">↓</button>
                  <button type="button" class="icono-btn icono-btn--quitar" (click)="quitar(p.ean)" [attr.aria-label]="'Sacar ' + p.descripcion">✕</button>
                </span>
              </li>
            }
          </ol>
        }

        <label class="vid__buscar">
          <span>Agregar un producto</span>
          <input type="search" placeholder="Nombre, marca o código de barras" [value]="q()" (input)="buscar($any($event.target).value)"
                 [disabled]="lista().length >= max()" />
        </label>
        @if (lista().length >= max()) {
          <p class="hint">Llegaste al máximo de {{ max() }}. Sacá alguno para agregar otro.</p>
        }
        @if (buscando()) {
          <p class="hint">Buscando…</p>
        } @else if (q().length >= 2 && resultados().length === 0) {
          <p class="hint">No encontramos productos de esta sucursal con "{{ q() }}".</p>
        }
        @if (resultados().length > 0) {
          <ul class="vid__resultados">
            @for (p of resultados(); track p.ean) {
              <li class="vid__item">
                <span class="vid__foto">
                  @if (p.fotoUrl) { <img [src]="p.fotoUrl" alt="" width="40" height="40" loading="lazy" /> }
                </span>
                <span class="vid__texto">
                  <strong>{{ p.descripcion }}</strong>
                  <small>{{ p.marca ? p.marca + ' · ' : '' }}{{ pesos(p.precioLista) }} · {{ p.ean }}</small>
                </span>
                @if (esta(p.ean)) {
                  <span class="hint">Destacado ✓</span>
                } @else {
                  <button type="button" class="boton-secundario" (click)="agregar(p)" [disabled]="lista().length >= max()">Destacar</button>
                }
              </li>
            }
          </ul>
        }

        <div class="acciones">
          <button type="button" (click)="guardar()" [disabled]="!cambios() || guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar destacados' }}
          </button>
          @if (cambios()) {
            <button type="button" class="link-btn" (click)="deshacer()">Deshacer cambios</button>
          }
          @if (mensaje()) { <span class="ok">{{ mensaje() }}</span> }
        </div>
        @if (error()) { <p class="form-error">{{ error() }}</p> }
      }
    </details>
  `,
  styleUrl: './tienda-vidriera.scss',
})
export class TiendaDestacadosComponent implements OnInit {
  private readonly service = inject(TiendaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tiendaId = input.required<number>();

  protected readonly lista = signal<ProductoDeTienda[]>([]);
  private readonly original = signal<string[]>([]);
  protected readonly max = signal(24);
  protected readonly cargando = signal(true);
  protected readonly faltaScript = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly q = signal('');
  protected readonly buscando = signal(false);
  protected readonly resultados = signal<ProductoDeTienda[]>([]);
  protected readonly guardados = computed(() => this.original().length);
  protected readonly cambios = computed(() => this.lista().map((p) => p.ean).join(',') !== this.original().join(','));
  protected readonly pesos = pesos;

  private readonly q$ = new Subject<string>();

  ngOnInit(): void {
    // El numero del titulo se ve con la seccion cerrada: se cargan los destacados de entrada.
    this.cargar();
    this.q$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 2) return of([] as ProductoDeTienda[]);
          this.buscando.set(true);
          return this.service.buscarProductos(this.tiendaId(), q).pipe(catchError(() => of([] as ProductoDeTienda[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.buscando.set(false);
        this.resultados.set(r);
      });
  }

  private cargar(): void {
    this.service.destacados(this.tiendaId()).subscribe({
      next: (d) => {
        this.cargando.set(false);
        this.max.set(d.max);
        this.lista.set(d.productos);
        this.original.set(d.productos.map((p) => p.ean));
      },
      error: (err) => {
        this.cargando.set(false);
        if (err?.error?.faltaScript) this.faltaScript.set(true);
        else this.error.set('No pudimos cargar los destacados. Probá de nuevo en un rato.');
      },
    });
  }

  protected buscar(q: string): void {
    this.q.set(q.trim());
    this.q$.next(q.trim());
  }

  protected esta(ean: string): boolean {
    return this.lista().some((p) => p.ean === ean);
  }

  protected agregar(p: ProductoDeTienda): void {
    if (this.esta(p.ean) || this.lista().length >= this.max()) return;
    this.lista.update((l) => [...l, p]);
    this.mensaje.set(null);
  }

  protected quitar(ean: string): void {
    this.lista.update((l) => l.filter((p) => p.ean !== ean));
    this.mensaje.set(null);
  }

  protected mover(i: number, delta: -1 | 1): void {
    this.lista.update((l) => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const copia = [...l];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
    this.mensaje.set(null);
  }

  protected deshacer(): void {
    this.cargando.set(true);
    this.cargar();
  }

  protected guardar(): void {
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.service.guardarDestacados(this.tiendaId(), this.lista().map((p) => p.ean)).subscribe({
      next: (d) => {
        this.guardando.set(false);
        this.lista.set(d.productos);
        this.original.set(d.productos.map((p) => p.ean));
        this.mensaje.set('Guardado. Ya se ven en tu tienda.');
      },
      error: (err) => {
        this.guardando.set(false);
        if (err?.error?.faltaScript) this.faltaScript.set(true);
        else this.error.set(err?.error?.error ?? 'No se pudo guardar. Probá de nuevo en un rato.');
      },
    });
  }
}
