import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvisosCuentaService } from '../../core/avisos-cuenta';
import { BusinessSubscriptionService } from '../../core/business-subscription';
import { accionDeCobro, diasDeGracia, textoDeGracia } from '../../core/cobro';
import { ProfileService } from '../../core/profile';

const CLAVE_MAIL_OCULTO = 'avisos.mailSinConfirmar.ocultoHasta';

/** El dia de hoy en hora local, AAAA-MM-DD: "hasta mañana" es hasta que cambia la fecha en la compu de la persona. */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function leerMailOculto(): { email: string; dia: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_MAIL_OCULTO) ?? 'null');
    return v && typeof v.email === 'string' && typeof v.dia === 'string' ? v : null;
  } catch {
    return null;
  }
}

// BP-196 (22-oct-2026) -- carteles fijos arriba de todas las pantallas del panel (van en el shell, panel-header):
//   - en gracia (vencio el plan sin pagar): "No pudimos cobrar tu plan. Te quedan N dias..." + [Pagar];
//   - mail sin confirmar: "Confirma tu mail para que te lleguen los avisos de tu cuenta" + [Mandarme el mail].
// Si el backend no los informa (o falla), no se muestra nada.
@Component({
  selector: 'app-avisos-cuenta',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (gracia(); as g) {
      <div class="aviso aviso--peligro" role="alert">
        <span class="aviso__texto">{{ g }}</span>
        <button type="button" class="aviso__boton" [disabled]="pagando()" (click)="pagar()">
          {{ pagando() ? 'Abriendo…' : 'Pagar' }}
        </button>
        <a routerLink="/plan" class="aviso__link">Ver mi plan</a>
      </div>
    }
    @if (mailParaAvisar(); as email) {
      <div class="aviso aviso--atencion">
        @if (mailEnviado()) {
          <span class="aviso__texto">Te mandamos un mail a <strong>{{ email }}</strong> con el link para confirmarlo.</span>
        } @else {
          <span class="aviso__texto">Confirmá tu mail (<strong>{{ email }}</strong>) para que te lleguen los avisos de tu cuenta.</span>
          <button type="button" class="aviso__boton aviso__boton--secundario" [disabled]="enviando()" (click)="enviarMail()">
            {{ enviando() ? 'Enviando…' : 'Mandarme el mail' }}
          </button>
        }
        <button type="button" class="aviso__cerrar" (click)="ocultarMailHastaManana(email)"
                aria-label="Cerrar este aviso hasta mañana" title="Cerrar hasta mañana">✕</button>
      </div>
    }
    @if (error(); as e) {
      <div class="aviso aviso--peligro"><span class="aviso__texto">{{ e }}</span></div>
    }
  `,
  styles: `
    :host { display: block; }
    .aviso {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1rem;
      padding: 0.75rem 1rem; margin: 0 0 1rem 0; border-radius: var(--radius, 0.5rem);
      font-size: 0.92rem; line-height: 1.45; border: 1px solid;
    }
    .aviso--peligro { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }
    .aviso--atencion { background: var(--warning-soft); border-color: var(--warning); color: var(--warning); }
    .aviso__texto { flex: 1 1 18rem; }
    .aviso__boton {
      border: 0; border-radius: var(--radius-sm, 0.375rem); padding: 0.45rem 1rem; font-weight: 700; cursor: pointer;
      background: var(--danger); color: var(--text-inverse);
    }
    .aviso__boton--secundario { background: transparent; color: var(--warning); border: 1px solid var(--warning); }
    .aviso__boton:disabled { opacity: 0.6; cursor: default; }
    .aviso__link { color: inherit; font-weight: 600; }
    .aviso__cerrar {
      border: 0; background: transparent; color: inherit; cursor: pointer;
      font-size: 1.1rem; line-height: 1; padding: 0.25rem 0.4rem; border-radius: var(--radius-sm, 0.375rem); opacity: 0.8;
    }
    .aviso__cerrar:hover, .aviso__cerrar:focus-visible { opacity: 1; background: rgba(255, 255, 255, 0.08); }
  `,
})
export class AvisosCuentaComponent implements OnInit {
  protected readonly avisos = inject(AvisosCuentaService);
  private readonly subscriptions = inject(BusinessSubscriptionService);
  private readonly profile = inject(ProfileService);

  protected readonly pagando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly mailEnviado = signal(false);
  protected readonly error = signal<string | null>(null);

  // El aviso de mail sin confirmar se puede cerrar con la cruz: queda escondido el resto del dia (en este navegador
  // y para ese mail) y vuelve al dia siguiente. El de gracia del plan no se cierra.
  private readonly ocultoMail = signal<{ email: string; dia: string } | null>(leerMailOculto());

  protected readonly mailParaAvisar = computed(() => {
    const email = this.avisos.emailSinConfirmar();
    if (!email) return null;
    const oculto = this.ocultoMail();
    return oculto && oculto.email === email && oculto.dia === hoyLocal() ? null : email;
  });

  protected ocultarMailHastaManana(email: string): void {
    const valor = { email, dia: hoyLocal() };
    this.ocultoMail.set(valor);
    try { localStorage.setItem(CLAVE_MAIL_OCULTO, JSON.stringify(valor)); } catch { /* sin storage: dura hasta recargar */ }
  }

  protected readonly gracia = computed(() => {
    const cobro = this.avisos.estado()?.cobro;
    const dias = diasDeGracia(cobro);
    return dias === null ? null : textoDeGracia(dias, cobro?.ultimoRechazo ?? null);
  });

  ngOnInit(): void {
    this.avisos.cargar();
  }

  protected pagar(): void {
    const id = this.avisos.businessAccountId();
    if (!id) return;
    this.pagando.set(true);
    this.error.set(null);
    this.subscriptions.pagar(id).subscribe({
      next: (r) => {
        const accion = accionDeCobro(r);
        if (accion.tipo === 'pagar') {
          window.location.href = accion.url;
          return;
        }
        this.pagando.set(false);
        this.error.set(accion.texto);
      },
      error: (err) => {
        this.pagando.set(false);
        this.error.set(err?.error?.error ?? 'No pudimos abrir el pago. Probá de nuevo en un rato.');
      },
    });
  }

  protected enviarMail(): void {
    this.enviando.set(true);
    this.error.set(null);
    this.profile.enviarConfirmacionEmail().subscribe({
      next: (r) => {
        this.enviando.set(false);
        if (r.yaConfirmado) this.avisos.emailSinConfirmar.set(null);
        else this.mailEnviado.set(true);
      },
      error: (err) => {
        this.enviando.set(false);
        this.error.set(err?.status === 429
          ? 'Pediste el mail varias veces seguidas. Esperá unos minutos y probá de nuevo.'
          : err?.error?.error ?? 'No pudimos mandar el mail. Probá de nuevo en un rato.');
      },
    });
  }
}
