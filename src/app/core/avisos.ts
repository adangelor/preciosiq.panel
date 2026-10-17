import { Injectable, computed, inject, signal } from '@angular/core';
import { TiendaService } from './tienda';

/** Una novedad de la campanita. ruta = la pantalla donde se atiende. */
export interface Aviso {
  clave: string;
  icono: string;
  texto: string;
  cantidad: number;
  ruta: string;
}

/**
 * BP-149 (17-oct-2026) -- lo que alimenta la campanita de la barra y el numerito de "Pedidos" en el menu.
 * Hoy: pedidos nuevos de misuper.app y mensajes de clientes sin leer (BP-131, GET .../tienda/pendientes),
 * mirados al entrar y cada minuto. Para sumar otra fuente (p. ej. cambios fuertes de precio de la
 * competencia) se agrega su senal y su renglon en `avisos`: la campanita no cambia.
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  private readonly tienda = inject(TiendaService);

  private readonly pedidosNuevos = signal(0);
  private readonly mensajesSinLeer = signal(0);
  private intervalo?: ReturnType<typeof setInterval>;
  private cuenta: number | null = null;

  readonly avisos = computed<Aviso[]>(() =>
    [
      {
        clave: 'pedidos', icono: 'receipt_long', cantidad: this.pedidosNuevos(), ruta: '/pedidos',
        texto: this.pedidosNuevos() === 1 ? 'Entró un pedido nuevo por tu tienda' : `Entraron ${this.pedidosNuevos()} pedidos nuevos por tu tienda`,
      },
      {
        clave: 'mensajes', icono: 'chat', cantidad: this.mensajesSinLeer(), ruta: '/pedidos',
        texto: this.mensajesSinLeer() === 1 ? 'Un cliente te escribió por WhatsApp' : `Tenés ${this.mensajesSinLeer()} mensajes de clientes sin leer`,
      },
    ].filter((a) => a.cantidad > 0),
  );

  /** Lo de la tienda (pedidos + mensajes): el numerito de "Pedidos" en el menu. */
  readonly deLaTienda = computed(() => this.pedidosNuevos() + this.mensajesSinLeer());
  readonly total = computed(() => this.avisos().reduce((a, x) => a + x.cantidad, 0));

  /** Empieza a mirar la cuenta (una vez; si cambia la cuenta, vuelve a empezar). */
  vigilar(businessAccountId: number): void {
    if (this.cuenta === businessAccountId && this.intervalo) return;
    this.cuenta = businessAccountId;
    if (this.intervalo) clearInterval(this.intervalo);
    this.refrescar();
    this.intervalo = setInterval(() => this.refrescar(), 60_000);
  }

  /** Despues de abrir un pedido o leer un chat: el numero baja sin esperar el minuto. */
  refrescar(): void {
    if (this.cuenta === null) return;
    this.tienda.pendientes(this.cuenta).subscribe({
      next: (p) => {
        this.pedidosNuevos.set(p.pedidosNuevos);
        this.mensajesSinLeer.set(p.mensajesSinLeer);
      },
      error: () => {
        // Si falla no se muestra nada (ni se borra lo que habia: puede ser un corte de un momento).
      },
    });
  }
}
