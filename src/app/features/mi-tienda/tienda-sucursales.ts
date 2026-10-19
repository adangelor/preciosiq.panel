import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BusinessAccountService } from '../../core/business-account';
import { ErrorDeCampo, SucursalDeTienda, SucursalTiendaRequest, TiendaDeCuenta, TiendaService, formatearWhatsApp } from '../../core/tienda';

/** Lo que el comercio esta cambiando de una sucursal (todavia sin guardar). habilitada null = la regla por defecto. */
interface Borrador {
  habilitada: boolean | null;
  whatsApp: string;
}

/** Los 400 de PUT /sucursales, pegados a su campo. whatsApp va a la fila de la sucursal que nombra el mensaje. */
interface ErroresSucursales {
  sucursales?: string;
  principal?: string;
  whatsApp?: { branchId: string | null; error: string };
}

/** "9" < "10": los BranchId numericos se comparan como numeros (igual que TiendaSucursales.CompararBranchId). */
function compararBranchId(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : NaN;
  const nb = /^\d+$/.test(b) ? Number(b) : NaN;
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function armarBorrador(c: TiendaDeCuenta): Record<string, Borrador> {
  return Object.fromEntries(c.sucursales.map((s) => [s.branchId, { habilitada: s.habilitadaAMano, whatsApp: s.whatsApp ?? '' }]));
}

/**
 * BP-167 (19-oct-2026) -- "Sucursales en tu tienda": una fila por sucursal de la cuenta. Por defecto entran solas las que
 * tienen ubicacion y productos (Andres: habilitar las 10 de Aiello una por una era engorroso); el comercio saca la que no
 * quiere, suma a mano una que no entra sola, marca la principal (en la que abre la tienda) y le pone a cada una su
 * WhatsApp si no es el de la tienda. Se guarda todo junto con PUT /{tiendaId}/sucursales, mandando solo las filas que
 * cambiaron. Sin tienda todavia, muestra cuales van a entrar solas, sin dejar tocar nada.
 */
@Component({
  selector: 'app-tienda-sucursales',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="sucs" aria-labelledby="sucs-titulo">
      <h3 class="sucs__titulo" id="sucs-titulo">
        <i class="fa-solid fa-shop" aria-hidden="true"></i> Sucursales en tu tienda
      </h3>
      @if (tiendaId() === null) {
        <p class="hint">
          Cuando crees tu tienda entran solas las sucursales que tienen ubicación y productos. Después podés sacar la que
          no quieras o sumar otra.
        </p>
      } @else {
        <p class="hint">
          Entran solas las que tienen ubicación y productos cargados. Tus clientes eligen la sucursal y ven sus precios y
          sus promos. Sacá la que no quieras o marcá la principal: la tienda abre ahí.
        </p>
      }

      @if (mensaje()) {
        <p class="aviso aviso--ok" role="status">{{ mensaje() }}</p>
      }

      <ul class="sucs__lista">
        @for (s of cuenta().sucursales; track s.branchId) {
          @let b = borrador()[s.branchId];
          @let entra = habilitada(s);
          <li class="suc" [class.suc--fuera]="!entra" [attr.data-branch]="s.branchId">
            <div class="suc__cabeza">
              <div class="suc__datos">
                <strong class="suc__nombre">{{ s.nombre }}</strong>
                @if (abreEn() === s.branchId) { <span class="etiqueta etiqueta--abre">La tienda abre acá</span> }
                <span class="hint suc__domicilio">
                  {{ s.domicilio ?? 'Sin domicilio' }}{{ s.ciudad ? ', ' + s.ciudad : '' }}
                  · {{ s.productos }} {{ s.productos === 1 ? 'producto' : 'productos' }}
                </span>
              </div>
              <label class="interruptor">
                <input type="checkbox" role="switch" [checked]="entra" [disabled]="tiendaId() === null || guardando()"
                       (change)="cambiarHabilitada(s, $any($event.target).checked)"
                       [attr.aria-label]="'Habilitada: ' + s.nombre" />
                <span>Habilitada</span>
              </label>
            </div>

            <p class="suc__regla">
              @if (b.habilitada === null) {
                <span class="etiqueta etiqueta--auto">Automática</span>
                @if (s.habilitadaPorDefecto) {
                  Entra sola: tiene ubicación y productos.
                } @else if (!s.tieneUbicacion && s.productos === 0) {
                  No entra sola: no tiene ubicación ni productos cargados.
                } @else if (!s.tieneUbicacion) {
                  No entra sola: no tiene ubicación, así que tus clientes no sabrían dónde queda.
                } @else {
                  No entra sola: todavía no tiene productos (la tienda se vería vacía).
                }
              } @else {
                <span class="etiqueta">Elegida a mano</span>
                {{ b.habilitada ? 'La sumaste vos.' : 'La sacaste vos: la sucursal ' + s.nombre + ' no está habilitada.' }}
                @if (tiendaId() !== null) {
                  <button type="button" class="link-btn" (click)="cambiarBorrador(s.branchId, { habilitada: null })" [disabled]="guardando()">
                    Volver a automática
                  </button>
                }
              }
            </p>

            @if (!s.tieneUbicacion) {
              <p class="suc__falta">
                Le falta la ubicación en el mapa. <a routerLink="/sucursales">Ubicala en Sucursales →</a>
              </p>
            }
            @if (s.productos === 0) {
              <p class="suc__falta">Todavía no cargaste precios acá. <a routerLink="/precios/cargar">Cargar precios →</a></p>
            }

            @if (entra && tiendaId() !== null) {
              <div class="suc__opciones">
                <label class="check">
                  <input type="radio" name="sucursal-principal" [checked]="principal() === s.branchId"
                         (change)="principal.set(s.branchId)" [disabled]="guardando()" />
                  Principal
                </label>
                <label class="suc__whatsapp">
                  WhatsApp de esta sucursal (opcional)
                  <input type="tel" inputmode="tel" [value]="b.whatsApp" [disabled]="guardando()"
                         [placeholder]="whatsAppTienda() ? 'El de la tienda: ' + whatsAppTienda() : '266 4123456'"
                         (input)="cambiarBorrador(s.branchId, { whatsApp: $any($event.target).value })" />
                  @if (errores().whatsApp?.branchId === s.branchId) {
                    <span class="form-error">{{ errores().whatsApp!.error }}</span>
                  } @else {
                    <span class="hint">Vacío = los pedidos van al WhatsApp de la tienda.</span>
                  }
                </label>
                <a class="boton-secundario" [routerLink]="['/mi-tienda/cartel', s.branchId]">Cartel con QR</a>
              </div>
              @if (enAppLocal()[s.branchId] === false) {
                <!-- BP-72: solo las sucursales visibles en la app BuscaPrecios tienen el boton "Pedíselo a…". -->
                <p class="suc__app">
                  No aparece en la app BuscaPrecios: quien busque tus productos cerca no ve el botón para pedirte.
                  <button type="button" class="link-btn" (click)="mostrarEnApp(s.branchId)" [disabled]="cambiandoApp() === s.branchId">
                    {{ cambiandoApp() === s.branchId ? 'Guardando…' : 'Mostrarla en BuscaPrecios' }}
                  </button>
                </p>
              }
              @if (s.slugAnterior) {
                <p class="hint">Su link de antes, misuper.app/{{ s.slugAnterior }}, sigue abriendo la tienda en esta sucursal.</p>
              }
            }
          </li>
        }
      </ul>

      @if (tiendaId() !== null) {
        @if (principal()) {
          <p class="hint">
            <button type="button" class="link-btn" (click)="principal.set('')" [disabled]="guardando()">Sacar la principal</button>
            (la tienda abre en la primera sucursal habilitada)
          </p>
        }
        @if (errores().principal) { <p class="form-error">{{ errores().principal }}</p> }
        @if (errores().sucursales) { <p class="form-error">{{ errores().sucursales }}</p> }
        @if (errores().whatsApp && errores().whatsApp!.branchId === null) { <p class="form-error">{{ errores().whatsApp!.error }}</p> }
        @if (errorGeneral()) { <p class="form-error">{{ errorGeneral() }}</p> }
        @if (errorApp()) { <p class="form-error">{{ errorApp() }}</p> }
        @if (hayCambios()) {
          <div class="acciones sucs__guardar">
            <button type="button" (click)="guardar()" [disabled]="guardando()">
              {{ guardando() ? 'Guardando…' : 'Guardar sucursales' }}
            </button>
            <button type="button" class="link-btn" (click)="descartar()" [disabled]="guardando()">Descartar cambios</button>
          </div>
        }
      }
    </section>
  `,
  styleUrls: ['./mi-tienda.scss', './tienda-sucursales.scss'],
})
export class TiendaSucursalesComponent {
  private readonly service = inject(TiendaService);
  private readonly cuentas = inject(BusinessAccountService);

  readonly cuenta = input.required<TiendaDeCuenta>();
  readonly businessAccountId = input.required<number>();
  /** BP-72: IsPublic de cada sucursal (el mismo interruptor de "Sucursales"); sin dato, no se dice nada. */
  readonly enApp = input<Partial<Record<string, boolean>>>({});
  readonly guardadas = output<TiendaDeCuenta>();

  protected readonly tiendaId = computed(() => this.cuenta().tienda?.id ?? null);
  protected readonly whatsAppTienda = computed(() => {
    const wa = this.cuenta().tienda?.whatsApp;
    return wa ? formatearWhatsApp(wa) : null;
  });

  /** Se rearma cada vez que llega una cuenta nueva (al cargar y despues de guardar). */
  protected readonly borrador = linkedSignal(() => armarBorrador(this.cuenta()));
  /** '' = sin principal. */
  protected readonly principal = linkedSignal(() => this.cuenta().sucursales.find((s) => s.principal)?.branchId ?? '');
  protected readonly enAppLocal = linkedSignal(() => ({ ...this.enApp() }));

  protected readonly guardando = signal(false);
  protected readonly errores = signal<ErroresSucursales>({});
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly cambiandoApp = signal<string | null>(null);
  protected readonly errorApp = signal<string | null>(null);

  /** Las filas que cambiaron, como las espera PUT /sucursales (cada una manda su habilitada Y su WhatsApp). */
  protected readonly cambios = computed<SucursalTiendaRequest[]>(() => {
    const b = this.borrador();
    return this.cuenta()
      .sucursales.filter((s) => b[s.branchId].habilitada !== s.habilitadaAMano || b[s.branchId].whatsApp.trim() !== (s.whatsApp ?? ''))
      .map((s) => ({ branchId: s.branchId, habilitada: b[s.branchId].habilitada, whatsApp: b[s.branchId].whatsApp.trim() || null }));
  });
  private readonly principalOriginal = computed(() => this.cuenta().sucursales.find((s) => s.principal)?.branchId ?? '');
  protected readonly hayCambios = computed(() => this.cambios().length > 0 || this.principal() !== this.principalOriginal());

  /** En que sucursal abre la tienda con lo que se esta editando: la principal si esta adentro, si no la de menor BranchId. */
  protected readonly abreEn = computed(() => {
    const adentro = this.cuenta().sucursales.filter((s) => this.habilitada(s));
    if (adentro.length === 0) return null;
    const p = this.principal();
    if (p && adentro.some((s) => s.branchId === p)) return p;
    return [...adentro].sort((a, b) => compararBranchId(a.branchId, b.branchId))[0].branchId;
  });

  /** Si la sucursal queda en la tienda: lo elegido a mano o, sin eso, la regla por defecto. */
  protected habilitada(s: SucursalDeTienda): boolean {
    return this.borrador()[s.branchId]?.habilitada ?? s.habilitadaPorDefecto;
  }

  protected cambiarHabilitada(s: SucursalDeTienda, valor: boolean): void {
    this.cambiarBorrador(s.branchId, { habilitada: valor });
    // Sacar la principal la deja sin principal (si no, el servidor contesta 400 "tiene que estar en la tienda").
    if (!valor && this.principal() === s.branchId) this.principal.set('');
  }

  protected cambiarBorrador(branchId: string, cambio: Partial<Borrador>): void {
    this.borrador.update((b) => ({ ...b, [branchId]: { ...b[branchId], ...cambio } }));
    this.mensaje.set(null);
    if (cambio.whatsApp !== undefined && this.errores().whatsApp?.branchId === branchId)
      this.errores.update((e) => ({ ...e, whatsApp: undefined }));
  }

  protected descartar(): void {
    this.borrador.set(armarBorrador(this.cuenta()));
    this.principal.set(this.principalOriginal());
    this.errores.set({});
    this.errorGeneral.set(null);
  }

  protected guardar(): void {
    const tiendaId = this.tiendaId();
    if (tiendaId === null || !this.hayCambios()) return;
    const sucursales = this.cambios();
    const principal = this.principal() !== this.principalOriginal() ? this.principal() : null;
    this.guardando.set(true);
    this.errores.set({});
    this.errorGeneral.set(null);
    this.mensaje.set(null);
    this.service.guardarSucursales(tiendaId, { sucursales, principal }).subscribe({
      next: (c) => {
        this.guardando.set(false);
        this.mensaje.set('Listo, guardamos las sucursales de tu tienda.');
        this.guardadas.emit(c);
      },
      error: (err) => {
        this.guardando.set(false);
        const e = err?.error as ErrorDeCampo | undefined;
        if (e?.campo === 'whatsApp') {
          // El mensaje nombra la sucursal ("El WhatsApp de Centro no es..."): el error va debajo de su WhatsApp.
          const fila = this.cuenta().sucursales.find((s) => sucursales.some((x) => x.branchId === s.branchId && x.whatsApp) && e.error.includes(s.nombre));
          this.errores.set({ whatsApp: { branchId: fila?.branchId ?? null, error: e.error } });
        } else if (e?.campo === 'principal') this.errores.set({ principal: e.error });
        else if (e?.campo === 'sucursales') this.errores.set({ sucursales: e.error });
        else this.errorGeneral.set(e?.error ?? 'No se pudieron guardar las sucursales. Probá de nuevo en un rato.');
      },
    });
  }

  /** BP-72 -- prende "visible en la app" de la sucursal (el mismo interruptor de Sucursales). */
  protected mostrarEnApp(branchId: string): void {
    this.cambiandoApp.set(branchId);
    this.errorApp.set(null);
    this.cuentas.updateBranchVisibility(branchId, { businessAccountId: this.businessAccountId(), isPublic: true }).subscribe({
      next: (b) => {
        this.cambiandoApp.set(null);
        this.enAppLocal.update((m) => ({ ...m, [branchId]: b.isPublic }));
        this.mensaje.set('Listo: la sucursal ya se muestra en la app BuscaPrecios, con el botón para pedirte por tu tienda.');
      },
      error: (err) => {
        this.cambiandoApp.set(null);
        this.errorApp.set(err?.error?.error ?? 'No pudimos cambiarlo. Probá de nuevo o hacelo desde Sucursales.');
      },
    });
  }
}
