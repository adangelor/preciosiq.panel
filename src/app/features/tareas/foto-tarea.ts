import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { TareasService } from '../../core/tareas';

// BP-226 (8-nov-2026) -- una foto de una respuesta. No es pública: se baja con la sesión (blob) y se muestra con una URL
// local que se libera al salir.
@Component({
  selector: 'app-foto-tarea',
  standalone: true,
  template: `
    @if (url(); as u) {
      <img [src]="u" [alt]="alt()" [class]="clase()" loading="lazy" />
    } @else if (fallo()) {
      <span class="foto-tarea__falta" [class]="clase()">Sin foto</span>
    } @else {
      <span class="foto-tarea__cargando" [class]="clase()"></span>
    }
  `,
  styles: `
    :host { display: contents; }
    .foto-tarea__falta, .foto-tarea__cargando {
      display: grid; place-items: center; background: var(--bg-elevated, #eee); color: var(--text-3); font-size: 0.8rem;
    }
    .foto-tarea__cargando { animation: pulso 1.2s ease-in-out infinite; }
    @keyframes pulso { 50% { opacity: 0.5; } }
  `,
})
export class FotoTareaComponent {
  private readonly api = inject(TareasService);
  readonly cuenta = input.required<number>();
  readonly fotoId = input.required<number>();
  readonly miniatura = input(true);
  readonly alt = input('Foto de la respuesta');
  readonly clase = input('');
  protected readonly url = signal<string | null>(null);
  protected readonly fallo = signal(false);

  constructor() {
    effect((onCleanup) => {
      const sub = this.api.foto(this.cuenta(), this.fotoId(), this.miniatura()).subscribe({
        next: (b) => this.url.set(URL.createObjectURL(b)),
        error: () => this.fallo.set(true),
      });
      onCleanup(() => sub.unsubscribe());
    });
    inject(DestroyRef).onDestroy(() => {
      const u = this.url();
      if (u) URL.revokeObjectURL(u);
    });
  }
}
