import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

// 25-ago-2026 -- pedido de Andres: "un spinner, o mejor una barra de progreso, cuando
// cargamos los benchmarks". El benchmark es UN request al backend que no informa avance
// (hace una sola consulta geoespacial grande), asi que una barra con porcentaje seria
// inventada. Lo honesto: barra indeterminada animada + el segundero, y un mensaje que
// cambia con el tiempo transcurrido para que se note que no se colgo. Si algun dia el
// backend devuelve avance real, este mismo componente puede recibir un `percent`.
@Component({
  selector: 'app-loading-bar',
  standalone: true,
  template: `
    <div class="loading-bar" role="status" aria-live="polite">
      <div class="loading-bar__track">
        <div class="loading-bar__fill" [class.loading-bar__fill--indeterminate]="percent() === null" [style.width.%]="percent() ?? 100"></div>
      </div>
      <p class="loading-bar__text">
        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
        {{ message() }}
        <span class="loading-bar__elapsed">{{ elapsed() }} s</span>
      </p>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin: 1rem 0;
    }

    .loading-bar__track {
      height: 0.5rem;
      border-radius: 999px;
      background: var(--bg-elevated);
      overflow: hidden;
      position: relative;
    }

    .loading-bar__fill {
      height: 100%;
      background: var(--primary);
      border-radius: inherit;
      transition: width 0.3s ease;
    }

    .loading-bar__fill--indeterminate {
      position: absolute;
      left: 0;
      width: 35% !important;
      animation: loading-bar-slide 1.4s ease-in-out infinite;
    }

    @keyframes loading-bar-slide {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(300%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-bar__fill--indeterminate {
        animation: none;
        width: 100% !important;
        opacity: 0.5;
      }
    }

    .loading-bar__text {
      margin: 0.5rem 0 0;
      font-size: 0.9rem;
      color: var(--text-2);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .loading-bar__elapsed {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      color: var(--text-3);
      font-size: 0.8rem;
    }
  `,
})
export class LoadingBarComponent {
  /** Mensaje base ("Calculando el benchmark…"). */
  readonly label = input.required<string>();
  /** Porcentaje real si se conoce; null = indeterminada (default). */
  readonly percent = input<number | null>(null);
  /** A partir de cuantos segundos avisar que esta tardando mas de lo normal. */
  readonly slowAfterSeconds = input(12);

  protected readonly elapsed = signal(0);

  protected readonly message = computed(() => {
    const s = this.elapsed();
    if (s >= this.slowAfterSeconds() * 3) {
      return `${this.label()} Sigue tardando bastante; si se corta, probá con un radio más chico.`;
    }
    if (s >= this.slowAfterSeconds()) {
      return `${this.label()} Está tardando más de lo normal, pero sigue en marcha.`;
    }
    return this.label();
  });

  constructor() {
    const startedAt = Date.now();
    const timer = setInterval(() => this.elapsed.set(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
