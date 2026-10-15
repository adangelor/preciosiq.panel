import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TiendaDiaStats, TiendaEstadisticas, TiendaPeriodo, TiendaService } from '../../core/tienda';

const enteros = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const unidades = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const pesos = (n: number) => '$' + enteros.format(n);

/** 'YYYY-MM-DD' -> Date local a mediodia (asi ningun huso horario lo corre al dia anterior). */
const fecha = (iso: string) => new Date(`${iso}T12:00:00`);
const diaCorto = (iso: string) => fecha(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
const diaLargo = (iso: string) => fecha(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

/** Tope del eje: un numero redondo (1, 2, 3, 4, 5, 6, 8 o 10 por una potencia de 10) apenas arriba del maximo. */
function topeLimpio(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((t) => t >= max)!;
}

type Medida = 'visitas' | 'pedidos';

/**
 * BP-122 -- columnas de 30 dias de UNA medida. Una sola serie: sin leyenda (el titulo la nombra), un
 * solo eje. Cada columna es su propio objetivo de hover y de foco (Tab) y su tooltip trae el dia completo;
 * la tabla "Ver dia por dia" de abajo tiene los mismos numeros sin hover.
 */
@Component({
  selector: 'app-columnas-diarias',
  standalone: true,
  template: `
    <figure class="columnas">
      <figcaption class="columnas__titulo">{{ titulo() }}</figcaption>
      <div class="columnas__plot">
        <span class="columnas__tick columnas__tick--max">{{ tope() }}</span>
        <span class="columnas__tick columnas__tick--cero">0</span>
        <div class="columnas__grilla" aria-hidden="true"></div>
        <div class="columnas__barras">
          @for (d of dias(); track d.fecha; let i = $index) {
            <div class="columnas__col" tabindex="0" [attr.aria-label]="etiqueta(d)"
                 (mouseenter)="activa.set(i)" (mouseleave)="activa.set(null)" (focus)="activa.set(i)" (blur)="activa.set(null)">
              @if (valor(d) > 0) {
                <span class="columnas__barra" [class.columnas__barra--activa]="activa() === i"
                      [style.height.%]="(valor(d) / tope()) * 100"></span>
              }
            </div>
          }
        </div>
        @if (activa() !== null) {
          @let d = dias()[activa()!];
          <div class="columnas__tooltip" role="presentation" [style.left.%]="((activa()! + 0.5) / dias().length) * 100"
               [style.transform]="desplazo(activa()!)">
            <span><strong>{{ valor(d) }}</strong> {{ medida() === 'visitas' ? (valor(d) === 1 ? 'visita' : 'visitas') : (valor(d) === 1 ? 'pedido' : 'pedidos') }}</span>
            <span>{{ largo(d.fecha) }}</span>
            @if (medida() === 'pedidos' && d.pedidos > 0) {
              <span>{{ plata(d.monto) }} estimados</span>
            }
          </div>
        }
      </div>
      <div class="columnas__ejex" aria-hidden="true">
        <span>{{ corto(dias()[0].fecha) }}</span>
        <span>{{ corto(dias()[mitad()].fecha) }}</span>
        <span>hoy</span>
      </div>
    </figure>
  `,
  styleUrl: './tienda-estadisticas.scss',
})
export class ColumnasDiariasComponent {
  readonly dias = input.required<TiendaDiaStats[]>();
  readonly medida = input.required<Medida>();
  readonly titulo = input.required<string>();

  protected readonly activa = signal<number | null>(null);
  protected readonly tope = computed(() => topeLimpio(Math.max(0, ...this.dias().map((d) => d[this.medida()]))));
  protected readonly mitad = computed(() => Math.floor(this.dias().length / 2));
  protected readonly corto = diaCorto;
  protected readonly largo = diaLargo;
  protected readonly plata = pesos;

  /** En los bordes el tooltip se corre hacia adentro, para que no se salga de la tarjeta. */
  protected desplazo(i: number): string {
    const x = (i + 0.5) / this.dias().length;
    // En el borde, el tooltip arranca (o termina) en el centro de la columna en vez de centrarse en ella.
    return x < 0.2 ? 'translateX(-8px)' : x > 0.8 ? 'translateX(calc(-100% + 8px))' : 'translateX(-50%)';
  }

  protected valor(d: TiendaDiaStats): number {
    return d[this.medida()];
  }

  protected etiqueta(d: TiendaDiaStats): string {
    return `${diaLargo(d.fecha)}: ${d.visitas} visitas, ${d.pedidos} pedidos` + (d.pedidos > 0 ? `, ${pesos(d.monto)} estimados` : '');
  }
}

/**
 * BP-122 -- "Cómo le va a tu tienda" dentro de la tarjeta de cada sucursal en Mi tienda. Decision de
 * Andres (15-oct-2026): el resumen de 7 dias es de todo plan; el detalle (30 dias, lo mas pedido, lo mas
 * mirado) desde Pyme, con el "subi de plan" debajo. Los numeros vienen de misuper.app: una visita por
 * sesion del navegador, sin robots, y el monto es el que estimo el pedido, no lo cobrado.
 */
@Component({
  selector: 'app-tienda-estadisticas',
  standalone: true,
  imports: [RouterLink, ColumnasDiariasComponent],
  template: `
    <section class="est" [attr.aria-labelledby]="'est-titulo-' + tiendaId()">
      <h3 class="est__titulo" [id]="'est-titulo-' + tiendaId()">Cómo le va a tu tienda</h3>
      @if (error()) {
        <p class="hint">No pudimos cargar las estadísticas. Probá de nuevo en un rato.</p>
      } @else if (datos(); as e) {
        <p class="hint">Últimos 7 días, contra los 7 anteriores.</p>
        <div class="est__tiles">
          @for (t of tiles(); track t.label) {
            <div class="est__tile">
              <span class="est__label">{{ t.label }}</span>
              <span class="est__valor">{{ t.valor }}</span>
              <span class="est__delta" [class.est__delta--sube]="t.delta.dir === 'sube'" [class.est__delta--baja]="t.delta.dir === 'baja'">
                {{ t.delta.texto }}
              </span>
            </div>
          }
        </div>

        @if (sinNada()) {
          <p class="aviso">
            Todavía no hay visitas. Compartí el link de tu tienda por WhatsApp o pegá el cartel con el QR en la
            vidriera: cada persona que entre se va a contar acá.
          </p>
        } @else {
          <p class="hint">
            Una visita es una persona que entró a tu tienda (no contamos buscadores ni robots). Un pedido es cada vez que
            alguien tocó "Pedir por WhatsApp"; el monto es el total que le calculó la tienda, no lo que cobraste.
          </p>
        }

        @if (sinNada()) {
          <!-- Sin nada que mostrar, ni graficos vacios ni el "subi de plan": primero que entre gente. -->
        } @else if (e.detalle; as d) {
          <div class="est__graficos">
            <app-columnas-diarias [dias]="d.dias" medida="visitas" titulo="Visitas por día, últimos 30 días" />
            <app-columnas-diarias [dias]="d.dias" medida="pedidos" titulo="Pedidos por día, últimos 30 días" />
          </div>
          <p class="hint">
            En 30 días: {{ n(d.total.visitas) }} visitas, {{ n(d.total.pedidos) }} pedidos y {{ plata(d.total.monto) }} estimados.
          </p>

          <div class="est__listas">
            <div>
              <h4>Lo más pedido</h4>
              @if (d.masPedidos.length === 0) {
                <p class="hint">Todavía no hay pedidos en estos 30 días.</p>
              } @else {
                <table class="est__tabla">
                  <thead><tr><th scope="col">Producto</th><th scope="col" class="num">Pedidos</th><th scope="col" class="num">Unidades</th></tr></thead>
                  <tbody>
                    @for (p of d.masPedidos; track p.ean) {
                      <tr><td>{{ p.descripcion ?? p.ean }}</td><td class="num">{{ n(p.pedidos) }}</td><td class="num">{{ u(p.unidades) }}</td></tr>
                    }
                  </tbody>
                </table>
              }
            </div>
            <div>
              <h4>Lo más mirado</h4>
              @if (d.masVistos.length === 0) {
                <p class="hint">Nadie abrió todavía la ficha de un producto en estos 30 días.</p>
              } @else {
                <table class="est__tabla">
                  <thead><tr><th scope="col">Producto</th><th scope="col" class="num">Vistas</th><th scope="col" class="num">Pedidos</th></tr></thead>
                  <tbody>
                    @for (p of d.masVistos; track p.ean) {
                      <tr><td>{{ p.descripcion ?? p.ean }}</td><td class="num">{{ n(p.vistas) }}</td><td class="num">{{ n(p.pedidos) }}</td></tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          </div>

          <details class="est__dias">
            <summary>Ver día por día</summary>
            <table class="est__tabla">
              <thead><tr><th scope="col">Día</th><th scope="col" class="num">Visitas</th><th scope="col" class="num">Pedidos</th><th scope="col" class="num">Monto estimado</th></tr></thead>
              <tbody>
                @for (dia of diasAlReves(); track dia.fecha) {
                  <tr><td>{{ largo(dia.fecha) }}</td><td class="num">{{ n(dia.visitas) }}</td><td class="num">{{ n(dia.pedidos) }}</td><td class="num">{{ plata(dia.monto) }}</td></tr>
                }
              </tbody>
            </table>
          </details>
        } @else if (!e.detalleIncluido) {
          <p class="aviso aviso--plan">
            Con el plan Pyme ves tus visitas y pedidos día por día, lo más pedido y lo más mirado de tu tienda.
            <a routerLink="/plan">Ver planes →</a>
          </p>
        }
      } @else {
        <p class="hint">Cargando…</p>
      }
    </section>
  `,
  styleUrl: './tienda-estadisticas.scss',
})
export class TiendaEstadisticasComponent implements OnInit {
  private readonly service = inject(TiendaService);

  readonly tiendaId = input.required<number>();

  protected readonly datos = signal<TiendaEstadisticas | null>(null);
  protected readonly error = signal(false);

  protected readonly n = (x: number) => enteros.format(x);
  protected readonly u = (x: number) => unidades.format(x);
  protected readonly plata = pesos;
  protected readonly largo = diaLargo;

  protected readonly tiles = computed(() => {
    const e = this.datos();
    if (!e) return [];
    const { actual: a, anterior: b } = e.resumen;
    return [
      { label: 'Visitas', valor: enteros.format(a.visitas), delta: delta(a.visitas, b.visitas) },
      { label: 'Pedidos por WhatsApp', valor: enteros.format(a.pedidos), delta: delta(a.pedidos, b.pedidos) },
      { label: 'Monto estimado', valor: pesos(a.monto), delta: delta(a.monto, b.monto) },
    ];
  });

  protected readonly sinNada = computed(() => {
    const e = this.datos();
    if (!e) return false;
    const vacio = (p: TiendaPeriodo) => p.visitas === 0 && p.pedidos === 0;
    return vacio(e.resumen.actual) && vacio(e.resumen.anterior) && (!e.detalle || vacio(e.detalle.total));
  });

  protected readonly diasAlReves = computed(() => [...(this.datos()?.detalle?.dias ?? [])].reverse());

  ngOnInit(): void {
    this.service.estadisticas(this.tiendaId()).subscribe({
      next: (e) => this.datos.set(e),
      error: () => this.error.set(true),
    });
  }
}

/** "▲ 12 %" / "▼ 30 %" contra los 7 dias anteriores; la flecha dice la direccion, no solo el color. */
function delta(actual: number, anterior: number): { texto: string; dir: 'sube' | 'baja' | 'igual' } {
  if (actual === anterior) return { texto: actual === 0 ? '—' : 'igual que la semana anterior', dir: 'igual' };
  if (anterior === 0) return { texto: 'la semana anterior: 0', dir: 'sube' };
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return { texto: 'casi igual que la semana anterior', dir: 'igual' };
  return pct > 0
    ? { texto: `▲ ${pct} % vs. la semana anterior`, dir: 'sube' }
    : { texto: `▼ ${-pct} % vs. la semana anterior`, dir: 'baja' };
}
