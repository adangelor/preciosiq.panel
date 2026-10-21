import { Component, OnDestroy, input, output, signal, inject } from '@angular/core';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';
import { ArticulosService } from '../../core/articulos';
import { ArticuloListaItem } from '../../core/articulos.models';

export interface ArticuloElegido {
  codigo: string;
  /** null = se tipeó un código que no apareció en la búsqueda (un código de bulto, por ejemplo): lo valida el servidor. */
  descripcion: string | null;
}

/**
 * BP-179 bloque 7 (21-oct-2026) -- buscar un artículo por código o nombre para cargar un renglón (ingreso, merma,
 * transferencia). Un lector de código de barras USB tipea el código y Enter: entra directo. Un código que no aparece
 * (un código de bulto) entra igual y lo resuelve el servidor al registrar.
 */
@Component({
  selector: 'app-articulo-buscador',
  standalone: true,
  template: `
    <div class="buscador">
      <input
        type="search"
        [placeholder]="placeholder()"
        [value]="texto()"
        (input)="onInput($event)"
        (keydown.enter)="onEnter($event)"
        aria-label="Código o nombre del artículo"
        autocomplete="off"
      />
      @if (sugerencias().length > 0) {
        <ul class="buscador__lista" role="listbox">
          @for (a of sugerencias(); track a.id) {
            <li role="option" (mousedown)="elegir(a)">
              <strong>{{ a.descripcion }}</strong>
              <span class="muted">{{ a.codigo }}{{ a.codigoInterno && a.codigoInterno !== a.codigo ? ' · ' + a.codigoInterno : '' }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .buscador { position: relative; flex: 1 1 18rem; min-width: 12rem; }
    .buscador input { width: 100%; }
    .buscador__lista {
      position: absolute; z-index: 20; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 0; list-style: none;
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.12);
      max-height: 18rem; overflow: auto;
    }
    .buscador__lista li { padding: .45rem .7rem; cursor: pointer; display: flex; flex-direction: column; gap: .1rem; font-size: .875rem; }
    .buscador__lista li:hover { background: var(--bg-muted, rgba(0,0,0,.04)); }
    .muted { color: var(--text-2); font-size: .8rem; }
  `,
})
export class ArticuloBuscadorComponent implements OnDestroy {
  private readonly api = inject(ArticulosService);

  readonly cuenta = input.required<number>();
  readonly placeholder = input('Código o nombre (o escaneá)');
  readonly elegido = output<ArticuloElegido>();

  protected readonly texto = signal('');
  protected readonly sugerencias = signal<ArticuloListaItem[]>([]);
  private readonly busqueda$ = new Subject<string>();
  private readonly sub: Subscription;

  constructor() {
    this.sub = this.busqueda$.pipe(
      debounceTime(250),
      switchMap((q) => (q.trim().length < 2 ? of(null) : this.api.listar(this.cuenta(), { q, pageSize: 8 }).pipe(catchError(() => of(null))))),
    ).subscribe((r) => this.sugerencias.set(r?.items ?? []));
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  protected onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.texto.set(v);
    this.busqueda$.next(v);
  }

  protected onEnter(e: Event): void {
    e.preventDefault();
    const t = this.texto().trim();
    if (!t) return;
    const exacto = this.sugerencias().find((a) => a.codigo === t || a.codigoInterno === t);
    if (exacto) this.elegir(exacto);
    else if (this.sugerencias().length === 1 && !/^\d{8,14}$/.test(t)) this.elegir(this.sugerencias()[0]);
    else this.emitir({ codigo: t, descripcion: null });
  }

  protected elegir(a: ArticuloListaItem): void {
    this.emitir({ codigo: a.codigo, descripcion: a.descripcion });
  }

  private emitir(x: ArticuloElegido): void {
    this.elegido.emit(x);
    this.texto.set('');
    this.sugerencias.set([]);
  }
}
