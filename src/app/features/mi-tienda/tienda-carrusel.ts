import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import {
  CartelConfig, CartelRequest, CategoriaTienda, EstadoCartel, NumerosCartel, ProductoDeTienda, TiendaCarrusel, TiendaService,
  TipoCartel, achicarImagen,
} from '../../core/tienda';

/** Un cartel mientras se edita. clave = para el track (los nuevos no tienen id). */
interface Borrador {
  clave: number;
  id: number | null;
  tipo: TipoCartel;
  destino: string | null;
  destinoNombre: string | null;
  titulo: string;
  bajada: string;
  imagenUrl: string | null;
  /** BP-153 -- 'yyyy-MM-dd' o '' (sin limite). */
  vigenteDesde: string;
  vigenteHasta: string;
  /** BP-153 -- lo que dijo el servidor al leer (los cambios sin guardar se ven al guardar). */
  estado: EstadoCartel;
  numeros: NumerosCartel | null;
}

const TIPOS: { valor: TipoCartel; texto: string }[] = [
  { valor: 'producto', texto: 'Un producto' },
  { valor: 'categoria', texto: 'Una categoría' },
  { valor: 'ofertas', texto: 'Tus ofertas' },
  { valor: 'enlace', texto: 'Un link (WhatsApp, Instagram…)' },
  { valor: 'imagen', texto: 'Ningún lado: solo la imagen' },
];

/** Un banner propio hasta este peso se sube tal cual (sin pasarlo a JPEG). Los GIF, siempre tal cual. */
const TAL_CUAL_BYTES = 1024 * 1024;

/**
 * BP-146 (17-oct-2026) -- el carrusel de inicio de la tienda de misuper.app: carteles arriba de todo, que pasan
 * solos. Sin imagen propia el sitio arma el cartel con la foto, el precio y la promo; con imagen propia muestra la
 * imagen (que diseño el comercio) tal cual. La imagen se sube cuando el cartel ya esta guardado (necesita su numero).
 *
 * BP-153 (17-oct-2026) -- pedido de Andres: las cadenas suben sus banners (1080 x 500, GIF animados) tal cual; un
 * cartel puede llevar a un link (canal de WhatsApp) o a ningun lado; cada uno tiene vigencia (desde / hasta, y se da
 * de baja solo) y sus numeros de los ultimos 30 dias: vistas, clics, pedidos y monto.
 */
@Component({
  selector: 'app-tienda-carrusel',
  standalone: true,
  template: `
    <details class="vid">
      <summary class="vid__titulo">
        Carrusel de inicio
        @if (guardados() > 0) { <span class="vid__cuenta">{{ guardados() }}</span> }
      </summary>
      <p class="hint">
        Carteles que se ven arriba de todo en tu tienda y pasan solos. Subí tus banners (los mismos de tus redes, GIF
        animados incluidos) o dejá que lo armemos con la foto, el precio y la promo. Cada cartel puede tener fecha de
        inicio y de fin: cuando vence, deja de verse solo. Hasta {{ max() }} carteles.
      </p>

      @if (faltaScript()) {
        <p class="aviso">Esta función todavía no está activada en el servidor. Avisanos y la activamos.</p>
      } @else if (cargando()) {
        <p class="hint">Cargando…</p>
      } @else {
        @if (carteles().length === 0) {
          <p class="hint vid__vacio">Tu tienda arranca directo en los productos. Agregá un cartel para mostrar algo primero.</p>
        }
        <ol class="car__lista">
          @for (c of carteles(); track c.clave; let i = $index, ultimo = $last) {
            <li class="car__cartel" [class.car__cartel--apagado]="c.id && c.estado !== 'vigente'">
              <div class="car__cabecera">
                <strong>Cartel {{ i + 1 }}</strong>
                @if (c.id) {
                  <span class="car__estado" [class]="'car__estado car__estado--' + c.estado">{{ textoEstado(c) }}</span>
                }
                <span class="vid__botones">
                  <button type="button" class="icono-btn" (click)="mover(i, -1)" [disabled]="i === 0" aria-label="Subir el cartel">↑</button>
                  <button type="button" class="icono-btn" (click)="mover(i, 1)" [disabled]="ultimo" aria-label="Bajar el cartel">↓</button>
                  <button type="button" class="icono-btn icono-btn--quitar" (click)="quitar(i)" aria-label="Sacar el cartel">✕</button>
                </span>
              </div>

              <!-- BP-153: lo que hizo este cartel en los ultimos 30 dias. -->
              @if (c.numeros; as n) {
                <p class="car__numeros">
                  Últimos {{ dias() }} días:
                  <strong>{{ n.vistas }}</strong> {{ n.vistas === 1 ? 'vista' : 'vistas' }} ·
                  <strong>{{ n.clics }}</strong> {{ n.clics === 1 ? 'clic' : 'clics' }}@if (n.vistas > 0 && c.tipo !== 'imagen') { ({{ porcentaje(n.clics, n.vistas) }}) } ·
                  <strong>{{ n.pedidos }}</strong> {{ n.pedidos === 1 ? 'pedido' : 'pedidos' }}@if (n.pedidos > 0) { por <strong>{{ pesos(n.monto) }}</strong> }
                </p>
              }

              <div class="car__campos">
                <label>
                  <span>Lleva a</span>
                  <!-- [selected] en cada opcion: [value] en el select llega antes que las opciones del @for. -->
                  <select (change)="cambiarTipo(i, $any($event.target).value)">
                    @for (t of tipos; track t.valor) { <option [value]="t.valor" [selected]="t.valor === c.tipo">{{ t.texto }}</option> }
                  </select>
                </label>

                @switch (c.tipo) {
                  @case ('producto') {
                    <div class="car__destino">
                      <span>Producto</span>
                      @if (c.destino && buscandoEn() !== i) {
                        <div class="car__elegido">
                          <span>{{ c.destinoNombre ?? c.destino }}</span>
                          <button type="button" class="link-btn" (click)="abrirBusqueda(i)">Cambiar</button>
                        </div>
                      } @else {
                        <input type="search" placeholder="Buscá por nombre, marca o código" (input)="buscar(i, $any($event.target).value)" />
                        @if (buscando()) { <small class="hint">Buscando…</small> }
                        @if (resultados().length > 0) {
                          <ul class="vid__resultados">
                            @for (p of resultados(); track p.ean) {
                              <li class="vid__item">
                                <span class="vid__foto">@if (p.fotoUrl) { <img [src]="p.fotoUrl" alt="" width="40" height="40" loading="lazy" /> }</span>
                                <span class="vid__texto"><strong>{{ p.descripcion }}</strong><small>{{ p.marca ?? '' }} {{ p.ean }}</small></span>
                                <button type="button" class="boton-secundario" (click)="elegirProducto(i, p)">Elegir</button>
                              </li>
                            }
                          </ul>
                        }
                      }
                    </div>
                  }
                  @case ('categoria') {
                    <label>
                      <span>Categoría</span>
                      <select (change)="elegirCategoria(i, $any($event.target).value)">
                        <option value="" disabled [selected]="!c.destino">Elegí una categoría</option>
                        @for (cat of categorias(); track cat.id) {
                          <option [value]="cat.id" [selected]="cat.id === c.destino">{{ cat.nombre }} ({{ cat.productos }})</option>
                        }
                      </select>
                    </label>
                  }
                  @case ('enlace') {
                    <label>
                      <span>Link</span>
                      <input type="url" maxlength="300" [value]="c.destino ?? ''" placeholder="https://whatsapp.com/channel/…"
                             (input)="cambiarDestino(i, $any($event.target).value)" />
                    </label>
                  }
                }

                <label>
                  <span>Título <small>(opcional)</small></span>
                  <input type="text" maxlength="60" [value]="c.titulo" [placeholder]="tituloSugerido(c)"
                         (input)="cambiar(i, 'titulo', $any($event.target).value)" />
                </label>
                <label>
                  <span>Texto <small>(opcional)</small></span>
                  <input type="text" maxlength="120" [value]="c.bajada" placeholder="Ej.: Solo este fin de semana"
                         (input)="cambiar(i, 'bajada', $any($event.target).value)" />
                </label>
                <!-- BP-153: vigencia, en su propia fila. Vacio = sin limite. -->
                <div class="car__fechas">
                  <label>
                    <span>Se ve desde <small>(opcional)</small></span>
                    <input type="date" [value]="c.vigenteDesde" (change)="cambiar(i, 'vigenteDesde', $any($event.target).value)" />
                  </label>
                  <label>
                    <span>Hasta <small>(opcional: el día que vence, inclusive)</small></span>
                    <input type="date" [value]="c.vigenteHasta" [min]="c.vigenteDesde || null"
                           (change)="cambiar(i, 'vigenteHasta', $any($event.target).value)" />
                  </label>
                </div>
              </div>

              <div class="car__imagen">
                @if (c.imagenUrl) {
                  <img class="car__miniatura" [src]="c.imagenUrl" alt="Imagen del cartel" width="216" height="100" />
                }
                @if (c.id) {
                  <label class="boton-secundario boton-archivo">
                    {{ subiendo() === c.id ? 'Subiendo…' : c.imagenUrl ? 'Cambiar imagen' : (c.tipo === 'imagen' ? 'Subir el banner' : 'Subir imagen propia') }}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" (change)="elegirImagen(c, $event)" [disabled]="subiendo() !== null" />
                  </label>
                  @if (c.imagenUrl) {
                    <button type="button" class="link-btn" (click)="quitarImagen(c)">Sacar la imagen</button>
                  }
                  <small class="hint">
                    {{ c.tipo === 'imagen' || c.tipo === 'enlace' ? '' : 'Opcional. ' }}Medida ideal 1080 × 500 (la de los banners). PNG, JPG,
                    WebP o GIF animado hasta {{ maxMb() }} MB: se muestra tal cual.
                  </small>
                  @if (c.tipo === 'imagen' && !c.imagenUrl) {
                    <p class="aviso aviso--chico">Subí el banner: sin imagen, este cartel no se muestra.</p>
                  }
                } @else {
                  <small class="hint">Guardá el carrusel para poder subirle {{ c.tipo === 'imagen' ? 'el banner' : 'una imagen propia' }}.</small>
                }
              </div>
            </li>
          }
        </ol>

        <div class="acciones">
          <button type="button" class="boton-secundario" (click)="agregar()" [disabled]="carteles().length >= max()">+ Agregar cartel</button>
          <button type="button" (click)="guardar()" [disabled]="!cambios() || guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar carrusel' }}
          </button>
          @if (vencidos() > 0) {
            <button type="button" class="link-btn" (click)="sacarVencidos()">Sacar {{ vencidos() === 1 ? 'el vencido' : 'los ' + vencidos() + ' vencidos' }}</button>
          }
          @if (cambios()) { <button type="button" class="link-btn" (click)="deshacer()">Deshacer cambios</button> }
          @if (mensaje()) { <span class="ok">{{ mensaje() }}</span> }
        </div>
        @if (error()) { <p class="form-error">{{ error() }}</p> }
        <p class="hint car__pie">
          Una <strong>vista</strong> es alguien que vio el cartel; un <strong>clic</strong>, alguien que lo tocó (una vez por visita
          cada uno). Un <strong>pedido</strong> se le cuenta al último cartel que tocó esa persona antes de mandarte el pedido.
        </p>
      }
    </details>
  `,
  styleUrl: './tienda-vidriera.scss',
})
export class TiendaCarruselComponent implements OnInit {
  private readonly service = inject(TiendaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tiendaId = input.required<number>();

  protected readonly tipos = TIPOS;
  protected readonly carteles = signal<Borrador[]>([]);
  protected readonly categorias = signal<CategoriaTienda[]>([]);
  private readonly original = signal('[]');
  protected readonly max = signal(5);
  private readonly imagenMaxBytes = signal(5 * 1024 * 1024);
  protected readonly dias = signal(30);
  protected readonly maxMb = computed(() => Math.round(this.imagenMaxBytes() / (1024 * 1024)));
  protected readonly cargando = signal(true);
  protected readonly faltaScript = signal(false);
  protected readonly guardando = signal(false);
  protected readonly subiendo = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly buscandoEn = signal<number | null>(null);
  protected readonly buscando = signal(false);
  protected readonly resultados = signal<ProductoDeTienda[]>([]);
  protected readonly guardados = signal(0);
  protected readonly cambios = computed(() => JSON.stringify(this.carteles().map(aRequest)) !== this.original());
  protected readonly vencidos = computed(() => this.carteles().filter((c) => c.id && c.estado === 'vencido').length);

  private claves = 0;
  private readonly q$ = new Subject<string>();

  ngOnInit(): void {
    this.cargar();
    this.q$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 2) return of([] as ProductoDeTienda[]);
          this.buscando.set(true);
          return this.service.buscarProductos(this.tiendaId(), q).pipe(catchError(() => of([] as ProductoDeTienda[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.buscando.set(false);
        this.resultados.set(r);
      });
  }

  private cargar(): void {
    this.service.carrusel(this.tiendaId()).subscribe({
      next: (c) => this.aplicar(c),
      error: (err) => {
        this.cargando.set(false);
        if (err?.error?.faltaScript) this.faltaScript.set(true);
        else this.error.set('No pudimos cargar el carrusel. Probá de nuevo en un rato.');
      },
    });
  }

  private aplicar(c: TiendaCarrusel): void {
    this.cargando.set(false);
    this.max.set(c.max);
    if (c.imagenMaxBytes) this.imagenMaxBytes.set(c.imagenMaxBytes);
    if (c.diasNumeros) this.dias.set(c.diasNumeros);
    this.categorias.set(c.categorias);
    const lista = c.carteles.map((x) => this.aBorrador(x));
    this.carteles.set(lista);
    this.original.set(JSON.stringify(lista.map(aRequest)));
    this.guardados.set(lista.length);
    this.cerrarBusqueda();
  }

  private aBorrador(c: CartelConfig): Borrador {
    return {
      clave: ++this.claves, id: c.id, tipo: c.tipo, destino: c.destino, destinoNombre: c.destinoNombre,
      titulo: c.titulo ?? '', bajada: c.bajada ?? '', imagenUrl: c.imagenUrl,
      vigenteDesde: c.vigenteDesde ?? '', vigenteHasta: c.vigenteHasta ?? '',
      estado: c.estado ?? 'vigente', numeros: c.numeros ?? null,
    };
  }

  protected tituloSugerido(c: Borrador): string {
    if (c.tipo === 'ofertas') return 'Ofertas destacadas';
    if (c.tipo === 'categoria') return this.categorias().find((x) => x.id === c.destino)?.nombre ?? 'El nombre de la categoría';
    if (c.tipo === 'enlace') return 'Ver más';
    if (c.tipo === 'imagen') return 'Para quien no ve la imagen (lectores de pantalla)';
    return c.destinoNombre ?? 'El nombre del producto';
  }

  protected textoEstado(c: Borrador): string {
    if (c.estado === 'programado') return `Programado: desde el ${fecha(c.vigenteDesde)}`;
    if (c.estado === 'vencido') return `Vencido el ${fecha(c.vigenteHasta)}: ya no se ve`;
    return c.vigenteHasta ? `Se ve hasta el ${fecha(c.vigenteHasta)}` : 'Se ve en tu tienda';
  }

  protected porcentaje(parte: number, total: number): string {
    return `${((parte / total) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
  }

  protected pesos(n: number): string {
    return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  }

  private actualizar(i: number, cambio: Partial<Borrador>): void {
    this.carteles.update((l) => l.map((c, j) => (j === i ? { ...c, ...cambio } : c)));
    this.mensaje.set(null);
  }

  protected cambiar(i: number, campo: 'titulo' | 'bajada' | 'vigenteDesde' | 'vigenteHasta', valor: string): void {
    this.actualizar(i, { [campo]: valor });
  }

  protected cambiarDestino(i: number, valor: string): void {
    this.actualizar(i, { destino: valor.trim() || null, destinoNombre: null });
  }

  protected cambiarTipo(i: number, tipo: TipoCartel): void {
    this.actualizar(i, { tipo, destino: null, destinoNombre: null });
    if (tipo === 'producto') this.abrirBusqueda(i);
    else this.cerrarBusqueda();
  }

  protected elegirCategoria(i: number, id: string): void {
    this.actualizar(i, { destino: id, destinoNombre: this.categorias().find((x) => x.id === id)?.nombre ?? null });
  }

  protected abrirBusqueda(i: number): void {
    this.buscandoEn.set(i);
    this.resultados.set([]);
  }

  private cerrarBusqueda(): void {
    this.buscandoEn.set(null);
    this.resultados.set([]);
  }

  protected buscar(i: number, q: string): void {
    this.buscandoEn.set(i);
    this.q$.next(q.trim());
  }

  protected elegirProducto(i: number, p: ProductoDeTienda): void {
    this.actualizar(i, { destino: p.ean, destinoNombre: p.descripcion });
    this.cerrarBusqueda();
  }

  protected agregar(): void {
    if (this.carteles().length >= this.max()) return;
    const nuevo: Borrador = {
      clave: ++this.claves, id: null, tipo: 'producto', destino: null, destinoNombre: null, titulo: '', bajada: '', imagenUrl: null,
      vigenteDesde: '', vigenteHasta: '', estado: 'vigente', numeros: null,
    };
    this.carteles.update((l) => [...l, nuevo]);
    this.abrirBusqueda(this.carteles().length - 1);
    this.mensaje.set(null);
  }

  protected quitar(i: number): void {
    this.carteles.update((l) => l.filter((_, j) => j !== i));
    this.cerrarBusqueda();
    this.mensaje.set(null);
  }

  /** BP-153 -- saca de la lista los vencidos (se borran al guardar, con su imagen). */
  protected sacarVencidos(): void {
    this.carteles.update((l) => l.filter((c) => !(c.id && c.estado === 'vencido')));
    this.cerrarBusqueda();
    this.mensaje.set('Sacamos los vencidos de la lista. Tocá "Guardar carrusel" para confirmar.');
  }

  protected mover(i: number, delta: -1 | 1): void {
    this.carteles.update((l) => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const copia = [...l];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
    this.cerrarBusqueda();
    this.mensaje.set(null);
  }

  protected deshacer(): void {
    this.cargando.set(true);
    this.cargar();
  }

  protected guardar(): void {
    const lista = this.carteles();
    const sinDestino = lista.findIndex((c) => (c.tipo === 'producto' || c.tipo === 'categoria' || c.tipo === 'enlace') && !c.destino);
    if (sinDestino >= 0) {
      const que = { producto: 'el producto', categoria: 'la categoría', enlace: 'el link' }[lista[sinDestino].tipo as 'producto'];
      this.error.set(`Elegí ${que} del cartel ${sinDestino + 1}.`);
      return;
    }
    const linkMalo = lista.findIndex((c) => c.tipo === 'enlace' && !/^https:\/\/\S+\.\S+/i.test(c.destino ?? ''));
    if (linkMalo >= 0) {
      this.error.set(`El link del cartel ${linkMalo + 1} tiene que empezar con https:// (copialo entero desde el navegador).`);
      return;
    }
    const fechasAlReves = lista.findIndex((c) => c.vigenteDesde && c.vigenteHasta && c.vigenteHasta < c.vigenteDesde);
    if (fechasAlReves >= 0) {
      this.error.set(`En el cartel ${fechasAlReves + 1}, la fecha "hasta" es anterior a la fecha "desde".`);
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    this.service.guardarCarrusel(this.tiendaId(), lista.map(aRequest)).subscribe({
      next: (c) => {
        this.guardando.set(false);
        this.aplicar(c);
        this.mensaje.set('Guardado. Ya se ve en tu tienda.');
      },
      error: (err) => {
        this.guardando.set(false);
        if (err?.error?.faltaScript) this.faltaScript.set(true);
        else this.error.set(err?.error?.error ?? 'No se pudo guardar. Probá de nuevo en un rato.');
      },
    });
  }

  protected async elegirImagen(c: Borrador, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo || !c.id) return;
    const id = c.id;
    this.error.set(null);
    // BP-153 -- un GIF (animado) o un banner liviano va tal cual: pasarlo por el canvas lo deja quieto y le borronea
    // el texto. Lo pesado se achica a 1200 px en JPEG, como antes.
    const esGif = archivo.type === 'image/gif';
    if (esGif && archivo.size > this.imagenMaxBytes()) {
      this.error.set(`El GIF pesa ${(archivo.size / (1024 * 1024)).toFixed(1)} MB y el máximo es ${this.maxMb()} MB. Achicalo y probá de nuevo.`);
      return;
    }
    this.subiendo.set(id);
    try {
      const talCual = esGif || archivo.size <= TAL_CUAL_BYTES;
      const imagen = talCual ? archivo : await achicarImagen(archivo, 1200, 'image/jpeg');
      this.service.subirImagenCartel(this.tiendaId(), id, imagen, talCual ? archivo.name : 'cartel.jpg').subscribe({
        next: (r) => {
          this.subiendo.set(null);
          this.carteles.update((l) => l.map((x) => (x.id === id ? { ...x, imagenUrl: r.imagenUrl } : x)));
          this.mensaje.set('Imagen guardada.');
        },
        error: (err) => {
          this.subiendo.set(null);
          this.error.set(err?.error?.error ?? 'No se pudo subir la imagen.');
        },
      });
    } catch (e) {
      this.subiendo.set(null);
      this.error.set((e as Error).message);
    }
  }

  protected quitarImagen(c: Borrador): void {
    if (!c.id) return;
    const id = c.id;
    this.service.quitarImagenCartel(this.tiendaId(), id).subscribe({
      next: () => {
        this.carteles.update((l) => l.map((x) => (x.id === id ? { ...x, imagenUrl: null } : x)));
        this.mensaje.set(c.tipo === 'imagen' ? 'Sacamos la imagen: hasta que subas otra, este cartel no se muestra.' : 'Sacamos la imagen: el cartel se arma con la foto y el precio.');
      },
      error: () => this.error.set('No se pudo sacar la imagen.'),
    });
  }
}

function aRequest(c: Borrador): CartelRequest {
  return {
    id: c.id, tipo: c.tipo, destino: c.tipo === 'ofertas' || c.tipo === 'imagen' ? null : c.destino,
    titulo: c.titulo.trim() || null, bajada: c.bajada.trim() || null,
    vigenteDesde: c.vigenteDesde || null, vigenteHasta: c.vigenteHasta || null,
  };
}

/** 'yyyy-MM-dd' -> 'dd/MM/yyyy'. */
function fecha(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}
