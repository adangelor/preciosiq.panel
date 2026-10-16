import { Component, computed, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { ChatPedido, MensajeChatPedido, TiendaService } from '../../core/tienda';

/** "2026-10-16T13:10:05" (UTC, con o sin Z) -> Date. */
const fechaUtc = (utc: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : `${utc}Z`);
const hora = (utc: string) => fechaUtc(utc).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const diaHora = (utc: string) =>
  fechaUtc(utc).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * BP-131 (16-oct-2026) -- el chat de WhatsApp de un pedido (el cliente le escribio al numero central de
 * misuper.app). El almacen contesta desde aca y sale por WhatsApp. Texto libre solo dentro de las 24 h
 * desde el ULTIMO mensaje del cliente (regla de WhatsApp): el cartel dice hasta que hora. Despues solo
 * queda "Avisar que esta listo" (plantilla aprobada). Se refresca solo cada 15 s mientras esta abierto.
 */
@Component({
  selector: 'app-pedido-chat',
  standalone: true,
  template: `
    <section class="chat" aria-label="Chat de WhatsApp con el cliente">
      @if (chat(); as c) {
        <header class="chat__cab">
          <strong>{{ c.clienteNombre || 'Cliente' }}</strong>
          @if (c.clienteTelefono) { <span class="chat__tel">+{{ c.clienteTelefono }}</span> }
          <span class="chat__por">por el WhatsApp de misuper.app</span>
        </header>

        <ol class="chat__mensajes">
          @for (m of c.mensajes; track $index) {
            <li class="chat__msg" [attr.data-autor]="m.autor">
              <span class="chat__texto">{{ sinFormato(m.texto) }}</span>
              <time class="chat__hora">{{ hora(m.creadoAtUtc) }}</time>
            </li>
          }
        </ol>

        @if (c.ventanaAbierta) {
          <form class="chat__form" (submit)="mandar($event)">
            <textarea class="chat__input" rows="2" maxlength="4000" placeholder="Escribile al cliente…"
                      [value]="borrador()" (input)="borrador.set($any($event.target).value)"
                      (keydown.enter)="enterManda($event)" aria-label="Mensaje para el cliente"></textarea>
            <button type="submit" [disabled]="enviando() || !borrador().trim()">Mandar</button>
          </form>
          <p class="hint">Podés contestar por acá hasta el {{ hasta() }} (después, WhatsApp solo deja mandar el aviso de pedido listo).</p>
        } @else {
          <p class="aviso">
            Pasaron 24 horas desde el último mensaje del cliente: WhatsApp no deja mandarle texto libre. Podés avisarle que
            el pedido está listo, y si te contesta se vuelve a abrir el chat.
          </p>
        }
        <div class="chat__acciones">
          <button type="button" class="boton-secundario" (click)="listo()" [disabled]="enviando()">Avisar que está listo</button>
        </div>
        @if (error()) { <p class="aviso aviso--error" role="alert">{{ error() }}</p> }
      } @else if (errorCarga()) {
        <p class="hint">No pudimos cargar el chat. Probá de nuevo en un rato.</p>
      } @else {
        <p class="hint">Cargando el chat…</p>
      }
    </section>
  `,
  styleUrl: './pedido-chat.scss',
})
export class PedidoChatComponent implements OnInit, OnDestroy {
  private readonly tienda = inject(TiendaService);

  readonly tiendaId = input.required<number>();
  readonly codigo = input.required<string>();
  /** El pedido quedo "preparado" (se mando el aviso de listo). */
  readonly marcadoListo = output<void>();

  protected readonly chat = signal<ChatPedido | null>(null);
  protected readonly errorCarga = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly borrador = signal('');
  protected readonly enviando = signal(false);
  protected readonly hasta = computed(() => {
    const h = this.chat()?.ventanaHastaUtc;
    return h ? diaHora(h) : '';
  });
  protected readonly hora = hora;

  /** Sin los *negrita* / _cursiva_ / ~tachado~ de WhatsApp: el panel muestra texto plano. */
  protected sinFormato(t: string): string {
    return t.replace(/([*_~])([^*_~\n]+)\1/g, '$2');
  }

  private intervalo?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.cargar();
    this.intervalo = setInterval(() => this.cargar(), 15_000);
  }

  ngOnDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  private cargar(): void {
    this.tienda.chatPedido(this.tiendaId(), this.codigo()).subscribe({
      next: (c) => { this.chat.set(c); this.errorCarga.set(false); },
      error: () => { if (!this.chat()) this.errorCarga.set(true); },
    });
  }

  /** Enter manda; Shift+Enter hace un renglon nuevo. */
  protected enterManda(e: Event): void {
    const k = e as KeyboardEvent;
    if (k.shiftKey) return;
    k.preventDefault();
    this.mandar(k);
  }

  protected mandar(e: Event): void {
    e.preventDefault();
    const texto = this.borrador().trim();
    if (!texto || this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.tienda.contestarPedido(this.tiendaId(), this.codigo(), texto).subscribe({
      next: (m) => {
        this.agregar(m);
        this.borrador.set('');
        this.enviando.set(false);
      },
      error: (err) => {
        this.enviando.set(false);
        this.error.set(err?.error?.error ?? err?.error?.title ?? 'No se pudo mandar el mensaje.');
        if (err?.status === 409) this.cargar();
      },
    });
  }

  protected listo(): void {
    if (this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.tienda.avisarListo(this.tiendaId(), this.codigo()).subscribe({
      next: (m) => {
        this.agregar(m);
        this.enviando.set(false);
        this.marcadoListo.emit();
      },
      error: (err) => {
        this.enviando.set(false);
        this.error.set(err?.error?.error ?? err?.error?.title ?? 'No se pudo mandar el aviso.');
      },
    });
  }

  private agregar(m: MensajeChatPedido): void {
    this.chat.update((c) => (c ? { ...c, mensajes: [...c.mensajes, m] } : c));
  }
}
