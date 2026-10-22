import { Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import type * as LeafletNS from 'leaflet';
import {
  CoberturaSucursal, CondicionesEnvio, EnvioDeSucursal, EnvioSucursalRequest, EnviosDeLaTienda, ErrorDeEnvio, PruebaDePunto,
  ResumenDeEnvios, TiendaEnviosService, fraseDeEnvio, kmEnvio, pesosEnvio,
} from '../../core/tienda-envios';

/** Lo que el comercio esta tipeando de una sucursal (texto, como esta en los campos). */
interface Borrador {
  haceEnvio: boolean;
  radioKm: string;
  pedidoMinimo: string;
  costo: string;
  gratisDesde: string;
  nota: string;
  /** true = sin configurar (envio sin condiciones, como antes de BP-193). Tocar cualquier campo lo configura. */
  sinConfigurar: boolean;
}

type Campo = 'radioKm' | 'pedidoMinimo' | 'costo' | 'gratisDesde' | 'nota';

/** Un color por sucursal en el mapa (y en su tarjeta). */
const COLORES = ['#0d9488', '#7c3aed', '#ea580c', '#2563eb', '#db2777', '#65a30d', '#ca8a04', '#0891b2'];

const textoDe = (n: number | null): string => (n == null ? '' : String(n).replace('.', ','));

function borradorDe(c: CondicionesEnvio): Borrador {
  return {
    haceEnvio: c.haceEnvio, radioKm: textoDe(c.radioKm), pedidoMinimo: textoDe(c.pedidoMinimo), costo: textoDe(c.costo),
    gratisDesde: textoDe(c.gratisDesde), nota: c.nota ?? '', sinConfigurar: !c.configurado,
  };
}

/** "60.000" o "60000" -> 60000; "2,5" -> 2.5. Vacio -> null; lo que no es numero -> NaN. */
export function numeroEnvio(texto: string, decimalConPunto = false): number | null {
  const t = texto.trim().replace(/\$/g, '').replace(/\s/g, '');
  if (t === '') return null;
  const normal = decimalConPunto ? t.replace(',', '.') : t.replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN;
}

function condicionesDe(b: Borrador): CondicionesEnvio {
  const n = (x: number | null) => (x != null && !isNaN(x) ? x : null);
  return {
    configurado: !b.sinConfigurar, haceEnvio: b.haceEnvio, radioKm: n(numeroEnvio(b.radioKm, true)),
    pedidoMinimo: n(numeroEnvio(b.pedidoMinimo)), costo: n(numeroEnvio(b.costo)), gratisDesde: n(numeroEnvio(b.gratisDesde)),
    nota: b.nota.trim() || null,
  };
}

/**
 * BP-193 (22-oct-2026) -- Mi tienda -> Envios (PROMPT_BP193_Envio_a_domicilio_22oct.md, bloque 5). Por sucursal: si envia,
 * hasta cuantos km, desde que monto, cuanto cuesta y desde cuanto es gratis, con la frase que ve el comprador en vivo.
 * "Donde": el mapa con el circulo de cada sucursal, "probar un punto" (tocar el mapa o escribir una direccion) y las
 * localidades que caen adentro. "Que": la frase y los numeros de los ultimos 30 dias. Fuera del radio el comprador puede
 * pedir igual: lo arreglan por WhatsApp (decision de Andres). Se guarda todo junto, solo las sucursales que cambiaron.
 */
@Component({
  selector: 'app-tienda-envios',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="sucs envios" aria-labelledby="envios-titulo">
      <h3 class="sucs__titulo" id="envios-titulo">
        <i class="fa-solid fa-truck" aria-hidden="true"></i> Envíos a domicilio
      </h3>
      <p class="hint">
        Decí desde qué sucursales enviás, hasta dónde y desde qué monto. El mínimo se respeta: por debajo, tu cliente no puede
        elegir envío. El radio es una guía: si alguien está más lejos puede pedir igual, y lo arreglan por WhatsApp.
      </p>

      @if (cargando()) {
        <p class="hint">Cargando los envíos…</p>
      } @else if (errorCarga()) {
        <p class="form-error">{{ errorCarga() }}</p>
      } @else if (datos(); as d) {
        @if (d.ningunaConfigurada) {
          <p class="aviso envios__aviso" role="note">
            Todavía no configuraste el envío: hoy tus sucursales ofrecen envío sin condiciones, "a coordinar por WhatsApp".
          </p>
        }
        @for (a of d.avisos; track a) { <p class="aviso envios__aviso" role="note">{{ a }}</p> }
        @if (mensaje()) { <p class="aviso aviso--ok" role="status">{{ mensaje() }}</p> }
        @if (errorGeneral()) { <p class="form-error" role="alert">{{ errorGeneral() }}</p> }

        <ul class="sucs__lista">
          @for (s of enLaTienda(); track s.branchId) {
            @let b = borrador()[s.branchId];
            @let err = errores()[s.branchId] ?? {};
            <li class="suc envio" [attr.data-branch]="s.branchId" [style.--color-sucursal]="color(s.branchId)">
              <div class="suc__cabeza">
                <div class="suc__datos">
                  <span class="envio__punto" aria-hidden="true"></span>
                  <strong class="suc__nombre">{{ s.nombre }}</strong>
                  @if (b.sinConfigurar) { <span class="etiqueta etiqueta--auto">Sin configurar</span> }
                  <span class="hint suc__domicilio">{{ s.calle ?? 'Sin domicilio' }}{{ s.ciudad ? ', ' + s.ciudad : '' }}</span>
                </div>
                <label class="interruptor">
                  <input type="checkbox" role="switch" [checked]="b.haceEnvio" [disabled]="guardando() || !d.disponible"
                         (change)="cambiar(s.branchId, { haceEnvio: $any($event.target).checked })"
                         [attr.aria-label]="'Hace envíos: ' + s.nombre" />
                  <span>Hace envíos</span>
                </label>
              </div>

              @if (b.haceEnvio) {
                <div class="envio__campos">
                  <label>
                    Hasta (km)
                    <input type="text" inputmode="decimal" [value]="b.radioKm" placeholder="Sin límite" [disabled]="guardando() || !d.disponible"
                           (input)="cambiar(s.branchId, { radioKm: $any($event.target).value })" aria-describedby="ayuda-radio" />
                    @if (err.radioKm) { <span class="form-error">{{ err.radioKm }}</span> }
                  </label>
                  <label>
                    Pedido mínimo ($)
                    <input type="text" inputmode="numeric" [value]="b.pedidoMinimo" placeholder="Sin mínimo" [disabled]="guardando() || !d.disponible"
                           (input)="cambiar(s.branchId, { pedidoMinimo: $any($event.target).value })" />
                    @if (err.pedidoMinimo) { <span class="form-error">{{ err.pedidoMinimo }}</span> }
                  </label>
                  <label>
                    Costo del envío ($)
                    <input type="text" inputmode="numeric" [value]="b.costo" placeholder="A coordinar" [disabled]="guardando() || !d.disponible"
                           (input)="cambiar(s.branchId, { costo: $any($event.target).value })" />
                    @if (err.costo) { <span class="form-error">{{ err.costo }}</span> }
                  </label>
                  <label>
                    Gratis desde ($)
                    <input type="text" inputmode="numeric" [value]="b.gratisDesde" placeholder="Nunca" [disabled]="guardando() || !d.disponible"
                           (input)="cambiar(s.branchId, { gratisDesde: $any($event.target).value })" />
                    @if (err.gratisDesde) { <span class="form-error">{{ err.gratisDesde }}</span> }
                  </label>
                  <label class="envio__nota">
                    Nota para tu cliente (opcional)
                    <input type="text" maxlength="120" [value]="b.nota" placeholder="Martes y jueves a la tarde" [disabled]="guardando() || !d.disponible"
                           (input)="cambiar(s.branchId, { nota: $any($event.target).value })" />
                    @if (err.nota) { <span class="form-error">{{ err.nota }}</span> }
                  </label>
                </div>
              }

              <p class="envio__frase">
                <span class="hint">Así lo ve tu cliente:</span>
                <strong>{{ frase(b) }}</strong>
                @if (!b.sinConfigurar && b.haceEnvio && b.nota.trim()) { <span class="hint">· {{ b.nota.trim() }}</span> }
              </p>
              @if (!s.tieneUbicacion && b.haceEnvio && b.radioKm.trim()) {
                <p class="suc__falta">Sin ubicación no se puede medir el radio. <a routerLink="/sucursales">Ubicala en Sucursales →</a></p>
              }
              @if (d.disponible) {
                <div class="envio__acciones">
                  @if (enLaTienda().length > 1) {
                    <button type="button" class="link-btn" (click)="copiarATodas(s.branchId)" [disabled]="guardando()">Copiar a todas las sucursales</button>
                  }
                  @if (!b.sinConfigurar) {
                    <button type="button" class="link-btn" (click)="volverASinConfigurar(s.branchId)" [disabled]="guardando()">Volver a sin configurar</button>
                  }
                </div>
              }
            </li>
          }
        </ul>
        @if (fueraDeLaTienda() > 0) {
          <p class="hint">{{ fueraDeLaTienda() === 1 ? 'Una sucursal no está' : fueraDeLaTienda() + ' sucursales no están' }} en la tienda: no ofrecen envíos.</p>
        }
        <p class="hint" id="ayuda-radio">El radio se mide en línea recta desde la sucursal.</p>

        @if (d.disponible) {
          <div class="acciones">
            <button type="button" (click)="guardar()" [disabled]="guardando() || cambiadas().length === 0">
              {{ guardando() ? 'Guardando…' : 'Guardar envíos' }}
            </button>
            @if (cambiadas().length > 0 && !guardando()) {
              <span class="hint">{{ cambiadas().length === 1 ? 'Una sucursal con cambios' : cambiadas().length + ' sucursales con cambios' }} sin guardar.</span>
            }
          </div>
        }

        <!-- Donde: el mapa con los circulos (en vivo, con lo que se esta tipeando) y probar un punto. -->
        <div class="envios__bloque">
          <h4>Dónde llegás</h4>
          @if (conUbicacion().length === 0) {
            <p class="hint">Ninguna sucursal de la tienda tiene ubicación: cargala en Sucursales para ver el mapa.</p>
          } @else {
            <p class="hint">Tocá el mapa (o escribí una dirección) para ver qué sucursal lo atiende y qué ve tu cliente.</p>
            <form class="envios__buscar" (submit)="$event.preventDefault(); probarDireccion()">
              <input type="text" [value]="direccion()" (input)="direccion.set($any($event.target).value)" placeholder="Pringles 1000"
                     aria-label="Dirección para probar" maxlength="150" />
              <button type="submit" class="boton-secundario" [disabled]="probando() || !direccion().trim()">Probar</button>
            </form>
            @if (conMapa()) { <div class="envios__mapa" #mapa></div> }
            @if (probando()) { <p class="hint">Midiendo…</p> }
            @if (errorPrueba()) { <p class="form-error" role="alert">{{ errorPrueba() }}</p> }
            @if (prueba(); as p) {
              <div class="envios__prueba" role="status">
                <p class="envios__prueba-texto" [class.envios__prueba-texto--fuera]="!p.atiende"><strong>{{ p.texto }}</strong></p>
                @if (p.direccionBuscada) { <p class="hint">Buscamos «{{ p.direccionBuscada }}».</p> }
                <ul>
                  @for (x of p.sucursales; track x.branchId) {
                    <li>
                      {{ x.nombre }}: {{ x.km != null ? kmTxt(x.km) + ' km' : 'sin ubicación' }} ·
                      <span [class]="'llega llega--' + x.llega">{{ textoLlega(x.llega) }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          }
        </div>

        <!-- Donde, en palabras: las localidades dentro del radio. -->
        @if (conUbicacion().length > 0) {
          <div class="envios__bloque">
            <h4>Localidades dentro del radio</h4>
            <label class="envios__elegir">
              Sucursal
              <select [value]="sucursalCobertura() ?? ''" (change)="sucursalCobertura.set($any($event.target).value)">
                @for (s of conUbicacion(); track s.branchId) { <option [value]="s.branchId">{{ s.nombre }}</option> }
              </select>
            </label>
            @if (cobertura(); as c) {
              @if (c.radioDeReferencia) {
                <p class="hint">{{ c.nombre }} no tiene radio: te mostramos lo que hay a {{ kmTxt(c.radioKm) }} km como referencia.</p>
              } @else {
                <p class="hint">Hasta {{ kmTxt(c.radioKm) }} km de {{ c.nombre }}: {{ c.totalLocalidades }} {{ c.totalLocalidades === 1 ? 'localidad' : 'localidades' }}.</p>
              }
              @if (c.localidades.length > 0) {
                <table class="tabla envios__tabla">
                  <thead><tr><th>Localidad</th><th>Provincia</th><th class="num">Distancia</th></tr></thead>
                  <tbody>
                    @for (l of c.localidades; track l.nombre + l.provincia) {
                      <tr><td>{{ l.nombre }}</td><td>{{ l.provincia }}</td><td class="num">{{ kmTxt(l.km) }} km</td></tr>
                    }
                  </tbody>
                </table>
              } @else {
                <p class="hint">Ninguna localidad tiene su centro dentro del radio.</p>
              }
              <p class="hint">{{ c.aclaracion }}</p>
            } @else if (errorCobertura()) {
              <p class="form-error">{{ errorCobertura() }}</p>
            }
          </div>
        }

        <!-- Que: los numeros. -->
        @if (resumen(); as r) {
          <div class="envios__bloque">
            <h4>Últimos {{ r.dias }} días</h4>
            @if (r.total.pedidos === 0) {
              <p class="hint">Todavía no hay pedidos en estos días.</p>
            } @else {
              <table class="tabla envios__tabla">
                <thead>
                  <tr><th>Sucursal</th><th class="num">Envíos</th><th class="num">Fuera de la zona</th><th class="num">Ticket envío</th>
                    <th class="num">Retiros</th><th class="num">Ticket retiro</th><th class="num">Envíos cobrados</th></tr>
                </thead>
                <tbody>
                  @for (s of r.porSucursal; track s.branchId) {
                    <tr>
                      <td>{{ s.nombre }}</td><td class="num">{{ s.numeros.envios }}</td><td class="num">{{ s.numeros.fueraDelRadio }}</td>
                      <td class="num">{{ plata(s.numeros.ticketEnvio) }}</td><td class="num">{{ s.numeros.retiros }}</td>
                      <td class="num">{{ plata(s.numeros.ticketRetiro) }}</td><td class="num">{{ plata(s.numeros.costoDeEnvios) }}</td>
                    </tr>
                  }
                </tbody>
                @if (r.porSucursal.length > 1) {
                  <tfoot>
                    <tr>
                      <th>Total</th><th class="num">{{ r.total.envios }}</th><th class="num">{{ r.total.fueraDelRadio }}</th>
                      <th class="num">{{ plata(r.total.ticketEnvio) }}</th><th class="num">{{ r.total.retiros }}</th>
                      <th class="num">{{ plata(r.total.ticketRetiro) }}</th><th class="num">{{ plata(r.total.costoDeEnvios) }}</th>
                    </tr>
                  </tfoot>
                }
              </table>
              <p class="hint">Sin los pedidos cancelados. "Fuera de la zona": el cliente midió su ubicación y quedó más lejos que el radio.</p>
            }
          </div>
        }
      }
    </section>
  `,
  styleUrls: ['./mi-tienda.scss', './tienda-sucursales.scss', './tienda-envios.scss'],
})
export class TiendaEnviosComponent implements OnInit {
  private readonly service = inject(TiendaEnviosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tiendaId = input.required<number>();
  /** false en los specs: sin Leaflet ni tiles. */
  readonly conMapa = input(true);

  protected readonly cargando = signal(true);
  protected readonly errorCarga = signal<string | null>(null);
  protected readonly datos = signal<EnviosDeLaTienda | null>(null);
  protected readonly borrador = signal<Record<string, Borrador>>({});
  private readonly original = signal<Record<string, Borrador>>({});
  protected readonly errores = signal<Record<string, Partial<Record<Campo, string>> | undefined>>({});
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly guardando = signal(false);

  protected readonly enLaTienda = computed(() => (this.datos()?.sucursales ?? []).filter((s) => s.enLaTienda));
  protected readonly fueraDeLaTienda = computed(() => (this.datos()?.sucursales ?? []).filter((s) => !s.enLaTienda).length);
  protected readonly conUbicacion = computed(() => this.enLaTienda().filter((s) => s.tieneUbicacion));
  protected readonly cambiadas = computed(() => {
    const b = this.borrador();
    const o = this.original();
    return Object.keys(b).filter((id) => JSON.stringify(b[id]) !== JSON.stringify(o[id]));
  });

  // ---- probar un punto
  protected readonly direccion = signal('');
  protected readonly probando = signal(false);
  protected readonly prueba = signal<PruebaDePunto | null>(null);
  protected readonly errorPrueba = signal<string | null>(null);

  // ---- localidades
  protected readonly sucursalCobertura = signal<string | null>(null);
  protected readonly cobertura = signal<CoberturaSucursal | null>(null);
  protected readonly errorCobertura = signal<string | null>(null);

  protected readonly resumen = signal<ResumenDeEnvios | null>(null);

  // ---- mapa
  private readonly contenedor = viewChild<ElementRef<HTMLDivElement>>('mapa');
  private L: typeof LeafletNS | null = null;
  private mapa: LeafletNS.Map | null = null;
  private capa: LeafletNS.LayerGroup | null = null;
  private pin: LeafletNS.Marker | null = null;
  private encuadrado = false;
  private encuadradoConRadio = false;

  protected readonly kmTxt = kmEnvio;

  constructor() {
    // El mapa sigue lo que se tipea: radio y "hace envios" en vivo, sin guardar.
    effect(() => {
      const el = this.contenedor()?.nativeElement;
      const circulos = this.circulos();
      if (!el || !this.conMapa()) return;
      untracked(() => void this.dibujar(el, circulos));
    });
    this.destroyRef.onDestroy(() => this.mapa?.remove());

    // Las localidades: de la sucursal elegida, con el radio que se esta tipeando (esperando a que termine de tipear).
    toObservable(computed(() => {
      const id = this.sucursalCobertura();
      if (!id) return null;
      const b = this.borrador()[id];
      const radio = b && !b.sinConfigurar && b.haceEnvio ? numeroEnvio(b.radioKm, true) : null;
      return { id, radio: radio != null && !isNaN(radio) && radio >= 0.5 && radio <= 50 ? radio : null };
    }))
      .pipe(
        debounceTime(400),
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.radio === b?.radio),
        switchMap((p) => {
          if (!p) return of(null);
          return this.service.cobertura(this.tiendaId(), p.id, p.radio).pipe(
            catchError((e) => {
              this.errorCobertura.set(e?.error?.error ?? 'No pudimos calcular las localidades.');
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((c) => {
        this.cobertura.set(c);
        if (c) this.errorCobertura.set(null);
      });
  }

  ngOnInit(): void {
    this.service.listar(this.tiendaId()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => {
        this.cargando.set(false);
        this.aplicar(d);
        this.sucursalCobertura.set(this.conUbicacion()[0]?.branchId ?? null);
      },
      error: (e) => {
        this.cargando.set(false);
        this.errorCarga.set(e?.error?.error ?? 'No pudimos cargar los envíos. Probá recargar la página.');
      },
    });
    this.service.resumen(this.tiendaId()).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.resumen.set(r));
  }

  private aplicar(d: EnviosDeLaTienda): void {
    this.datos.set(d);
    const b = Object.fromEntries(d.sucursales.map((s) => [s.branchId, borradorDe(s.condiciones)]));
    this.borrador.set(b);
    this.original.set(structuredClone(b));
    this.errores.set({});
  }

  protected frase(b: Borrador): string {
    return fraseDeEnvio(condicionesDe(b));
  }

  protected color(branchId: string): string {
    const i = (this.datos()?.sucursales ?? []).findIndex((s) => s.branchId === branchId);
    return COLORES[Math.max(0, i) % COLORES.length];
  }

  protected plata(n: number | null): string {
    return n == null ? '—' : pesosEnvio(Math.round(n));
  }

  protected textoLlega(l: string): string {
    return l === 'llega' ? 'llega' : l === 'no-llega' ? 'no llega' : l === 'no-envia' ? 'no hace envíos' : 'sin dato';
  }

  /** Tocar un campo configura la sucursal (deja de estar "sin configurar") y borra su error. */
  protected cambiar(branchId: string, cambio: Partial<Borrador>): void {
    this.mensaje.set(null);
    this.borrador.update((b) => ({ ...b, [branchId]: { ...b[branchId], ...cambio, sinConfigurar: false } }));
    this.errores.update((e) => ({ ...e, [branchId]: {} }));
  }

  protected copiarATodas(desde: string): void {
    const fuente = this.borrador()[desde];
    this.mensaje.set(null);
    this.borrador.update((b) => {
      const nuevo = { ...b };
      for (const s of this.enLaTienda()) if (s.branchId !== desde) nuevo[s.branchId] = { ...fuente, sinConfigurar: fuente.sinConfigurar };
      return nuevo;
    });
    this.mensaje.set('Copiado a todas las sucursales de la tienda. Revisalo y tocá "Guardar envíos".');
  }

  protected volverASinConfigurar(branchId: string): void {
    this.mensaje.set(null);
    this.borrador.update((b) => ({
      ...b, [branchId]: { haceEnvio: true, radioKm: '', pedidoMinimo: '', costo: '', gratisDesde: '', nota: '', sinConfigurar: true },
    }));
  }

  protected guardar(): void {
    const ids = this.cambiadas();
    if (ids.length === 0) return;
    this.errorGeneral.set(null);
    this.mensaje.set(null);

    // Antes de mandar: lo que no es un numero, pegado a su campo.
    const locales: Record<string, Partial<Record<Campo, string>>> = {};
    const pedido: EnvioSucursalRequest[] = [];
    for (const id of ids) {
      const b = this.borrador()[id];
      if (b.sinConfigurar) {
        if (!this.original()[id].sinConfigurar) {
          pedido.push({ branchId: id, haceEnvio: true, radioKm: null, pedidoMinimo: null, costo: null, gratisDesde: null, nota: null, sinConfigurar: true });
        }
        continue;
      }
      const campos: [Campo, number | null][] = [
        ['radioKm', numeroEnvio(b.radioKm, true)], ['pedidoMinimo', numeroEnvio(b.pedidoMinimo)],
        ['costo', numeroEnvio(b.costo)], ['gratisDesde', numeroEnvio(b.gratisDesde)],
      ];
      for (const [campo, valor] of campos) {
        if (valor != null && isNaN(valor)) (locales[id] ??= {})[campo] = 'Escribí solo el número (por ejemplo 60.000).';
      }
      const c = condicionesDe(b);
      pedido.push({
        branchId: id, haceEnvio: c.haceEnvio, radioKm: c.radioKm, pedidoMinimo: c.pedidoMinimo, costo: c.costo,
        gratisDesde: c.gratisDesde, nota: c.nota,
      });
    }
    if (Object.keys(locales).length > 0) {
      this.errores.set(locales);
      this.errorGeneral.set('Revisá los campos marcados.');
      return;
    }
    if (pedido.length === 0) {
      this.original.set(structuredClone(this.borrador()));
      return;
    }

    this.guardando.set(true);
    this.service.guardar(this.tiendaId(), pedido).subscribe({
      next: (d) => {
        this.guardando.set(false);
        this.aplicar(d);
        this.mensaje.set('Listo: tus clientes ya ven las condiciones de envío en la tienda.');
        this.service.resumen(this.tiendaId()).pipe(catchError(() => of(null))).subscribe((r) => this.resumen.set(r));
      },
      error: (e) => {
        this.guardando.set(false);
        const err = e?.error as ErrorDeEnvio | undefined;
        if (e?.status === 400 && err?.branchId && (err.errores?.length ?? 0) > 0) {
          const porCampo: Partial<Record<Campo, string>> = {};
          for (const x of err.errores!) porCampo[x.campo as Campo] = x.mensaje;
          this.errores.set({ [err.branchId]: porCampo });
          this.errorGeneral.set(err.error);
        } else {
          this.errorGeneral.set(err?.error ?? (e?.status === 503 ? 'Los envíos todavía no se pueden configurar.' : 'No pudimos guardar. Probá de nuevo.'));
        }
      },
    });
  }

  // ------------------------------------------------------------------ probar un punto

  protected probarDireccion(): void {
    const d = this.direccion().trim();
    if (!d) return;
    this.medir(this.service.probarDireccion(this.tiendaId(), d));
  }

  private probarPunto(lat: number, lon: number): void {
    this.medir(this.service.probarPunto(this.tiendaId(), Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5));
  }

  private medir(pedido: ReturnType<TiendaEnviosService['probarPunto']>): void {
    this.probando.set(true);
    this.errorPrueba.set(null);
    pedido.subscribe({
      next: (p) => {
        this.probando.set(false);
        this.prueba.set(p);
        this.ponerPin(p.lat, p.lon);
      },
      error: (e) => {
        this.probando.set(false);
        this.prueba.set(null);
        this.errorPrueba.set(e?.error?.error ?? 'No pudimos medir ese punto. Probá de nuevo.');
      },
    });
  }

  // ------------------------------------------------------------------ el mapa

  /** Lo que se dibuja: cada sucursal con ubicacion, con el radio que se esta tipeando si envia. */
  protected readonly circulos = computed(() =>
    this.conUbicacion().map((s: EnvioDeSucursal) => {
      const b = this.borrador()[s.branchId];
      const radio = b && !b.sinConfigurar && b.haceEnvio ? numeroEnvio(b.radioKm, true) : null;
      return {
        branchId: s.branchId, nombre: s.nombre, lat: s.lat!, lon: s.lon!, color: this.color(s.branchId),
        radioKm: radio != null && !isNaN(radio) && radio >= 0.5 && radio <= 50 ? radio : null,
        frase: b ? this.frase(b) : s.frase, envia: b?.haceEnvio ?? true,
      };
    }),
  );

  private async dibujar(el: HTMLElement, circulos: ReturnType<TiendaEnviosComponent['circulos']>): Promise<void> {
    if (!this.L) {
      // Mismo truco que branches-list.ts: bajo esbuild el import dinamico viene envuelto en .default.
      const m = await import('leaflet');
      this.L = ((m as unknown as { default?: typeof LeafletNS }).default ?? m) as typeof LeafletNS;
    }
    const L = this.L;
    if (!this.mapa) {
      this.mapa = L.map(el, { scrollWheelZoom: false }).setView([circulos[0]?.lat ?? -34.6, circulos[0]?.lon ?? -58.4], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(this.mapa);
      this.capa = L.layerGroup().addTo(this.mapa);
      this.mapa.on('click', (e: LeafletNS.LeafletMouseEvent) => this.probarPunto(e.latlng.lat, e.latlng.lng));
    }
    this.capa!.clearLayers();
    const limites: LeafletNS.LatLngBounds[] = [];
    let conRadio = false;
    for (const c of circulos) {
      if (c.envia && c.radioKm != null) {
        const circulo = L.circle([c.lat, c.lon], { radius: c.radioKm * 1000, color: c.color, weight: 2, fillOpacity: 0.12 })
          .bindTooltip(`${c.nombre}: ${c.frase}`, { sticky: true });
        // Tocar adentro del circulo tambien prueba ese punto.
        circulo.on('click', (e: LeafletNS.LeafletMouseEvent) => this.probarPunto(e.latlng.lat, e.latlng.lng));
        circulo.addTo(this.capa!);
        limites.push(circulo.getBounds());
        conRadio = true;
      }
      L.circleMarker([c.lat, c.lon], { radius: 7, color: '#fff', weight: 2, fillColor: c.color, fillOpacity: 1 })
        .bindTooltip(c.envia ? c.nombre : `${c.nombre} (solo retiro)`, { direction: 'top' })
        .addTo(this.capa!);
      limites.push(L.latLngBounds([c.lat, c.lon], [c.lat, c.lon]));
    }
    // Encuadrar al abrir y la primera vez que aparece un circulo; despues no, para que el mapa no salte mientras se tipea.
    if ((!this.encuadrado || (conRadio && !this.encuadradoConRadio)) && limites.length > 0) {
      const todo = limites.reduce((a, b) => a.extend(b), L.latLngBounds(limites[0].getSouthWest(), limites[0].getNorthEast()));
      this.mapa.fitBounds(todo.pad(0.1), { maxZoom: 14 });
      this.encuadrado = true;
      this.encuadradoConRadio = conRadio;
    }
  }

  private ponerPin(lat: number, lon: number): void {
    if (!this.L || !this.mapa) return;
    const icono = this.L.divIcon({
      className: 'envios__pin',
      html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#111827;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 18],
    });
    if (this.pin) this.pin.setLatLng([lat, lon]);
    else this.pin = this.L.marker([lat, lon], { icon: icono }).addTo(this.mapa);
    if (!this.mapa.getBounds().contains([lat, lon])) this.mapa.panTo([lat, lon]);
  }
}
