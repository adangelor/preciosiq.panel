import { AfterViewInit, Component, ElementRef, OnDestroy, output, viewChild } from '@angular/core';

// 11-oct-2026 -- Calendario de turnos de Omnivox (omnivox.chat) para agendar la demo de PreciosIQ.
//
// El bundle https://omnivox.chat/js/omnivox.agenda.js se carga UNA vez en index.html, sin
// data-tenant: asi no intenta montarse solo al cargar la pagina (buscaria un #omnivox-agenda que
// en un SPA todavia no existe) y se limita a dejar el global window.OmnivoxAgenda. Este componente
// lo monta en su propio div cuando ese div ya esta en el DOM, y lo vuelve a montar cada vez que
// Angular lo crea de nuevo (el calendario se dibuja en un shadow root dentro del div y no guarda
// estado ni timers afuera, asi que al destruir el componente se va con el).
//
// Config que recibe `montar` (fuente: OmniVox/Omnivox/widget/src/agenda/index.tsx y types.ts):
//   tenantSlug  slug del negocio en Omnivox ("preciosiq"); el calendario pega a
//               {apiBaseUrl}/api/v1/public/agenda/{slug}/config, /availability y /book.
//   apiBaseUrl  origen del API de Omnivox.
//   serviceId / professionalId  (opcionales) arrancar con un servicio o profesional dado.
//   lang        es | en | pt (si falta, el idioma del tenant).
//   color       color de marca: pinta botones y seleccion (--oa-primary dentro del shadow root).
declare global {
  interface Window {
    OmnivoxAgenda?: {
      montar(config: OmnivoxAgendaConfig, destino: HTMLElement): void;
      mount(config: OmnivoxAgendaConfig, destino: HTMLElement): void;
    };
  }
}

export interface OmnivoxAgendaConfig {
  tenantSlug: string;
  apiBaseUrl: string;
  serviceId?: string;
  professionalId?: string;
  lang?: string;
  color?: string;
}

// Tenant y servicio ya configurados en Omnivox (verificado contra produccion el 11-oct-2026:
// GET https://omnivox.chat/api/v1/public/agenda/preciosiq/config devuelve el negocio "PreciosIQ"
// con el servicio "Demo de PreciosIQ", 45 min). El color es --bs-primary del tema New Age de la
// landing (public/home/css/styles.css), para que los botones del calendario sean los de la pagina.
const CONFIG_AGENDA: OmnivoxAgendaConfig = {
  tenantSlug: 'preciosiq',
  apiBaseUrl: 'https://omnivox.chat',
  lang: 'es',
  color: '#2937f0',
};

// Si el bundle no llego a estar (bloqueado, caido, sin red) no se puede esperar para siempre con
// un modal vacio: pasado este plazo se avisa `fallo` y la landing vuelve al formulario de contacto.
const ESPERA_MAXIMA_MS = 10_000;

@Component({
  selector: 'app-agenda-omnivox',
  standalone: true,
  template: `
    <div #host class="agenda-omnivox">
      <div class="text-center text-muted py-5 small">
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Cargando la agenda…
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .agenda-omnivox { min-height: 10rem; }
  `,
})
export class AgendaOmnivoxComponent implements AfterViewInit, OnDestroy {
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  /** El bundle de Omnivox no cargo (o no expone el global): quien me usa decide que mostrar. */
  readonly fallo = output<void>();

  private script: HTMLScriptElement | null = null;
  private espera: ReturnType<typeof setTimeout> | undefined;
  private montado = false;

  ngAfterViewInit(): void {
    if (this.montar()) return;

    // El <script defer> de index.html puede no haber corrido todavia (ruta inicial): se lo espera.
    this.script = document.querySelector<HTMLScriptElement>('script[src*="omnivox.agenda"]');
    this.script?.addEventListener('load', this.alCargar);
    this.script?.addEventListener('error', this.alFallar);
    // Sin la etiqueta no hay nada que esperar; con ella, un tope por si ya fallo antes de que nos
    // suscribieramos (un script que ya fallo no vuelve a disparar `error`). El aviso siempre va
    // asincrono para no cambiar estado del padre en medio de su deteccion de cambios.
    this.espera = setTimeout(this.alFallar, this.script ? ESPERA_MAXIMA_MS : 0);
  }

  ngOnDestroy(): void {
    this.limpiar();
  }

  private readonly alCargar = (): void => {
    if (!this.montar()) this.alFallar();
  };

  private readonly alFallar = (): void => {
    this.limpiar();
    if (!this.montado) this.fallo.emit();
  };

  private montar(): boolean {
    const agenda = window.OmnivoxAgenda;
    if (!agenda) return false;
    agenda.montar(CONFIG_AGENDA, this.host().nativeElement);
    this.montado = true;
    this.limpiar();
    return true;
  }

  private limpiar(): void {
    clearTimeout(this.espera);
    this.script?.removeEventListener('load', this.alCargar);
    this.script?.removeEventListener('error', this.alFallar);
  }
}
