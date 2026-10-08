import { Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

// 25-ago-2026 -- pedido de Andres: login, registro y recuperar-contrasena no tenian
// forma de salir con un click (solo la flecha del navegador). Este link vuelve a la
// pantalla anterior cuando se llego navegando DENTRO del panel (ej. landing -> login,
// o login -> registrarme) y, cuando no hay historial propio (la persona entro directo
// por URL o desde un mail), va a `fallback`. Asi nunca manda a una pestaña en blanco
// ni afuera del sitio.
@Component({
  selector: 'app-back-link',
  standalone: true,
  template: `
    <button type="button" class="back-link" (click)="goBack()">
      <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
      {{ label() }}
    </button>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 1rem;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0;
      background: none;
      border: none;
      color: var(--text-2);
      font-size: 0.875rem;
      cursor: pointer;
      transition: color 0.15s;
    }

    .back-link:hover {
      color: var(--primary);
      text-decoration: underline;
    }
  `,
})
export class BackLinkComponent {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Ruta a la que ir cuando no hay una pantalla anterior dentro del panel. */
  readonly fallback = input.required<string>();
  readonly label = input('Volver');

  protected goBack(): void {
    // previousNavigation solo existe si la navegacion actual vino de otra navegacion
    // del Router (o sea, hubo una pantalla anterior de ESTE panel). Si se entro
    // directo por URL, es null y el back() del navegador nos sacaria del sitio.
    const cameFromInside = this.router.lastSuccessfulNavigation?.previousNavigation != null;
    if (cameFromInside) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl(this.fallback());
  }
}
