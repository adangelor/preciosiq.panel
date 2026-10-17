import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AvisosService } from '../../core/avisos';

/**
 * BP-149 (17-oct-2026) -- la campanita de la barra de arriba: junta las novedades (pedidos nuevos, mensajes
 * de clientes; mas adelante, cambios de precio de la competencia) y cada una lleva a su pantalla.
 */
@Component({
  selector: 'app-campanita',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  template: `
    <button type="button" class="campanita" (click)="abierta.set(!abierta())" [attr.aria-expanded]="abierta()"
            aria-haspopup="true" [attr.aria-label]="avisos.total() > 0 ? avisos.total() + ' novedades' : 'Novedades: no hay'">
      <mat-icon>{{ avisos.total() > 0 ? 'notifications_active' : 'notifications' }}</mat-icon>
      @if (avisos.total() > 0) {
        <span class="campanita__cuenta" aria-hidden="true">{{ avisos.total() > 99 ? '99+' : avisos.total() }}</span>
      }
    </button>
    @if (abierta()) {
      <div class="campanita__panel" role="menu">
        <p class="campanita__titulo">Novedades</p>
        @for (a of avisos.avisos(); track a.clave) {
          <a class="campanita__aviso" role="menuitem" [routerLink]="a.ruta" (click)="abierta.set(false)">
            <mat-icon>{{ a.icono }}</mat-icon>
            <span>{{ a.texto }}</span>
          </a>
        } @empty {
          <p class="campanita__vacio">No hay novedades. Te avisamos acá cuando entre un pedido o te escriba un cliente.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .campanita {
      position: relative; display: grid; place-items: center; width: 40px; height: 40px; padding: 0;
      border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer;
    }
    .campanita:hover { background: var(--bg-elevated); }
    .campanita:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .campanita__cuenta {
      position: absolute; top: 3px; right: 1px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px;
      background: var(--danger); color: #fff; font-size: 0.7rem; font-weight: 700; line-height: 18px; text-align: center;
    }
    .campanita__panel {
      position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; width: min(320px, calc(100vw - 24px));
      background: var(--bg-card); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm, 8px);
      box-shadow: var(--shadow); padding: 0.5rem;
    }
    .campanita__titulo { margin: 0.25rem 0.5rem 0.5rem; font-size: 0.8rem; font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
    .campanita__aviso {
      display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.5rem; border-radius: 6px;
      color: var(--text); text-decoration: none; font-size: 0.92rem;
    }
    .campanita__aviso:hover { background: var(--bg-elevated); }
    .campanita__aviso mat-icon { color: var(--primary); flex: none; }
    .campanita__vacio { margin: 0.25rem 0.5rem 0.5rem; font-size: 0.88rem; color: var(--text-2); }
  `,
})
export class CampanitaComponent {
  protected readonly avisos = inject(AvisosService);
  protected readonly abierta = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Se cierra al tocar afuera o con Escape. */
  @HostListener('document:click', ['$event'])
  protected afuera(ev: MouseEvent): void {
    if (this.abierta() && !this.host.nativeElement.contains(ev.target as Node)) this.abierta.set(false);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.abierta.set(false);
  }
}
