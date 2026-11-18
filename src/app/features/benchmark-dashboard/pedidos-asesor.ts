import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdvisorService, PreferenciasDelAsesor } from '../../core/advisor';

// BP-347 (18-nov-2026) -- "¿Qué querés que mire más?", igual que BP-288 en DistribucionIQ: el comerciante le escribe al
// Asesor qué le sirvió y qué quiere que mire más (o menos). El próximo informe lo tiene en cuenta: lo que pide más va
// primero y con más detalle; lo que pide menos, en una línea al final. No cambia los números ni las tablas. El pulgar sigue.
const NOMBRE_TEMA: Record<string, string> = {
  testigos: 'los productos testigo',
  caros: 'los productos más caros',
  subir: 'dónde podés subir',
  categorias: 'las categorías',
  margen: 'margen y costos',
  pesos: 'la plata en juego',
  competencia: 'la competencia',
};

@Component({
  selector: 'app-pedidos-asesor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="pedidos">
      <label class="pedidos__label" for="pedido-asesor">¿Qué te sirvió? ¿Qué querés que mire más (o menos) la próxima vez?</label>
      <div class="pedidos__fila">
        <textarea id="pedido-asesor" rows="2" maxlength="1000" [(ngModel)]="texto" name="pedido"
                  placeholder="Por ejemplo: mirá más el margen y dónde puedo subir, menos los testigos."></textarea>
        <button type="button" class="pedidos__boton" (click)="pedir()" [disabled]="enviando() || texto.trim().length < 3">
          {{ enviando() ? 'Guardando…' : 'Pedírselo' }}
        </button>
      </div>
      @if (estado(); as e) {
        @if (e.mas.length > 0 || e.menos.length > 0) {
          <p class="pedidos__temas">
            @if (e.mas.length > 0) { Va a mirar más {{ temas(e.mas) }}. }
            @if (e.menos.length > 0) { Va a mirar menos {{ temas(e.menos) }}. }
            Pedí un informe nuevo para verlo.
          </p>
        }
        @if (e.preferencias.length > 0) {
          <ul class="pedidos__lista">
            @for (p of e.preferencias; track p.id) {
              <li>«{{ p.texto }}» <button type="button" class="pedidos__sacar" (click)="sacar(p.id)">Sacar</button></li>
            }
          </ul>
        }
      }
      @if (error()) { <p class="pedidos__error">{{ error() }}</p> }
    </div>
  `,
  styles: `
    .pedidos { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border); }
    .pedidos__label { display: block; font-size: 0.9rem; margin-bottom: 0.35rem; }
    .pedidos__fila { display: flex; gap: 0.5rem; align-items: flex-start; flex-wrap: wrap; }
    .pedidos__fila textarea { flex: 1 1 18rem; min-width: 0; font: inherit; font-size: 0.9rem; padding: 0.4rem 0.5rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-input); color: var(--text); }
    .pedidos__boton { border: 1px solid var(--primary); background: var(--primary); color: #fff; border-radius: 8px; padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
    .pedidos__boton:disabled { opacity: 0.5; cursor: default; }
    .pedidos__temas { margin: 0.5rem 0 0; font-size: 0.85rem; color: var(--text-2); }
    .pedidos__lista { margin: 0.35rem 0 0; padding-left: 1.1rem; font-size: 0.85rem; color: var(--text-2); }
    .pedidos__sacar { border: 0; background: none; padding: 0 0.25rem; color: var(--primary); text-decoration: underline; cursor: pointer; font: inherit; }
    .pedidos__error { color: var(--danger); font-size: 0.85rem; }
  `,
})
export class PedidosAsesorComponent implements OnInit {
  private readonly advisor = inject(AdvisorService);

  readonly businessAccountId = input.required<number>();
  readonly cambio = output<void>();

  protected texto = '';
  protected readonly estado = signal<PreferenciasDelAsesor | null>(null);
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // Sin la tabla en el servidor (503) la caja igual se ve; el error sale al guardar.
    this.advisor.preferencias(this.businessAccountId()).subscribe({ next: (e) => this.estado.set(e), error: () => {} });
  }

  protected temas(t: string[]): string {
    const n = t.map((x) => NOMBRE_TEMA[x] ?? x);
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
  }

  protected pedir(): void {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.advisor.pedir(this.businessAccountId(), this.texto).subscribe({
      next: (e) => {
        this.enviando.set(false);
        this.texto = '';
        this.estado.set(e);
        this.cambio.emit();
      },
      error: (err) => {
        this.enviando.set(false);
        this.error.set(err?.error?.error ?? 'No se pudo guardar el pedido.');
      },
    });
  }

  protected sacar(id: number): void {
    this.advisor.sacarPedido(this.businessAccountId(), id).subscribe({
      next: () => {
        this.advisor.preferencias(this.businessAccountId()).subscribe({ next: (e) => this.estado.set(e) });
        this.cambio.emit();
      },
      error: (err) => this.error.set(err?.error?.error ?? 'No se pudo sacar.'),
    });
  }
}
