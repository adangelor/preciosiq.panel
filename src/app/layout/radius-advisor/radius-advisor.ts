import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NearbyBranch, NearbyBranchesService } from '../../core/nearby-branches';
import { environment } from '../../../environments/environment';

// 25-ago-2026 -- idea de Andres: sugerir el radio del benchmark segun cuantas sucursales
// hay a la redonda. No es lo mismo un barrio de Resistencia que Balvanera: en CABA 3 km
// son cientos de sucursales (y un benchmark lento), en el interior 3 km pueden no llegar
// a las 3 cadenas que pide el calculo. Usa el mismo GET /branches/nearby de la app de
// consumidores: se trae UNA vez todo lo que hay hasta nearbyScanMeters (ordenado por
// distancia) y de ahi se cuenta en memoria para cualquier radio que la persona tipee --
// sin volver a pegarle al backend cada vez que cambia el numero.
//
// Umbrales en environment.ts (benchmark.*): comfortableBranches = a partir de cuantas
// sucursales el radio ya "alcanza"; tooManyBranches = a partir de cuantas conviene
// achicar. radiusLadder = radios candidatos para la sugerencia.
interface RadiusStats {
  branches: number;
  chains: number;
  chainNames: string[];
  /** true = el conteo es un piso: el endpoint devolvio el tope y este radio va mas alla. */
  capped: boolean;
}

@Component({
  selector: 'app-radius-advisor',
  standalone: true,
  template: `
    @if (state() === 'loading') {
      <p class="radius-advisor radius-advisor--muted">
        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
        Contando sucursales a la redonda…
      </p>
    } @else if (state() === 'ready' && current(); as c) {
      <div class="radius-advisor" [class.radius-advisor--warn]="verdict() !== 'ok'">
        <p class="radius-advisor__count">
          <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
          A <strong>{{ radius() }} m</strong> tenés
          <strong>{{ c.branches }}{{ c.capped ? '+' : '' }} sucursal{{ c.branches === 1 ? '' : 'es' }}</strong>
          de <strong>{{ c.chains }} cadena{{ c.chains === 1 ? '' : 's' }}</strong>
          @if (c.chainNames.length > 0) {
            <span class="radius-advisor__chains">&nbsp;({{ chainSummary() }})</span>
          }
        </p>
        @if (verdict() === 'too-many' && suggestion(); as s) {
          <p class="radius-advisor__tip">
            Son muchas: el benchmark va a tardar y el promedio se diluye con zonas que no compiten con vos.
            Con <strong>{{ s.radius }} m</strong> tenés {{ s.stats.branches }} sucursales de {{ s.stats.chains }} cadenas, de sobra.
            <button type="button" class="radius-advisor__apply" (click)="apply(s.radius)">Usar {{ s.radius }} m</button>
          </p>
        } @else if (verdict() === 'too-few' && suggestion(); as s) {
          <p class="radius-advisor__tip">
            @if (c.chains === 0) {
              Sin cadenas a {{ radius() }} m el benchmark no tiene con qué comparar.
            } @else {
              Con {{ c.chains }} cadena{{ c.chains === 1 ? '' : 's' }} el informe compara solo contra {{ chainSummary() }}.
            }
            Con <strong>{{ s.radius }} m</strong> llegás a {{ s.stats.branches }} sucursales de {{ s.stats.chains }} cadenas ({{ resumen(s.stats.chainNames) }}).
            <button type="button" class="radius-advisor__apply" (click)="apply(s.radius)">Usar {{ s.radius }} m</button>
          </p>
        } @else if (verdict() === 'too-few' && scanStats(); as todo) {
          <p class="radius-advisor__tip">
            <!-- BP-75: si hasta el maximo no aparece ninguna cadena nueva, ampliar no sirve; se dice con nombres. -->
            @if (todo.chains === 0) {
              Hasta {{ scanKm }} km no hay ninguna cadena con datos: todavía no hay competencia relevada cerca tuyo.
            } @else {
              Ampliar el radio no suma competencia: hasta {{ scanKm }} km solo está{{ todo.chains === 1 ? '' : 'n' }} {{ resumen(todo.chainNames) }}.
              El informe compara contra {{ todo.chains === 1 ? 'esa cadena y la nombra' : 'esas cadenas y las nombra' }}.
            }
          </p>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .radius-advisor {
      margin: 0 0 1rem;
      padding: 0.6rem 0.85rem;
      border-radius: var(--radius-sm);
      background: var(--primary-soft);
      color: var(--text);
      font-size: 0.875rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .radius-advisor--muted {
      background: none;
      color: var(--text-3);
      padding-left: 0;
    }

    .radius-advisor--warn {
      background: var(--warning-soft);
    }

    .radius-advisor p {
      margin: 0;
    }

    .radius-advisor__count i {
      color: var(--primary);
      margin-right: 0.3rem;
    }

    .radius-advisor__chains {
      color: var(--text-2);
    }

    .radius-advisor__tip {
      color: var(--text-2);
    }

    .radius-advisor__apply {
      margin-left: 0.5rem;
      padding: 0.2rem 0.7rem;
      border: 1px solid var(--primary);
      border-radius: 999px;
      background: var(--bg-card);
      color: var(--primary);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      vertical-align: middle;

      &:hover {
        background: var(--primary);
        color: var(--on-primary);
      }
    }
  `,
})
export class RadiusAdvisorComponent {
  private readonly nearbyService = inject(NearbyBranchesService);

  readonly latitude = input.required<number | null | undefined>();
  readonly longitude = input.required<number | null | undefined>();
  /** Radio que la persona tiene tipeado ahora mismo. */
  readonly radius = input.required<number>();
  /** Para no contarse a uno mismo como competencia. */
  readonly ownCommerceId = input<string | null>(null);
  /** Mismo minimo que usa el backend (InstantBenchmarkResponse.minCompetitors). */
  readonly minChains = environment.benchmark.minChains;

  /** true = si al cargar hay una sugerencia, se aplica sola (cuando no hay radio guardado). */
  readonly autoApply = input(false);

  readonly radiusChange = output<number>();

  protected readonly scanMeters = environment.benchmark.nearbyScanMeters;
  protected readonly scanKm = Math.round(environment.benchmark.nearbyScanMeters / 1000);
  private readonly maxResults = environment.benchmark.nearbyMaxResults;

  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  private readonly nearby = signal<NearbyBranch[]>([]);
  // Si el endpoint devolvio el tope (nearbyMaxResults), el conteo es exacto solo hasta la
  // distancia de la ultima sucursal recibida; mas alla, es un piso (se muestra con "+").
  private readonly exactUpToMeters = signal<number | null>(null);

  constructor() {
    // Una consulta por sucursal (lat/lng): cambia la sucursal elegida, se vuelve a contar.
    effect(() => {
      const lat = this.latitude();
      const lng = this.longitude();
      untracked(() => this.load(lat, lng));
    });
  }

  private load(lat: number | null | undefined, lng: number | null | undefined): void {
    if (lat == null || lng == null) {
      this.state.set('idle');
      this.nearby.set([]);
      return;
    }
    this.state.set('loading');
    this.nearbyService.getNearby(lat, lng, this.scanMeters, this.maxResults).subscribe({
      next: (list) => {
        this.nearby.set(list);
        this.exactUpToMeters.set(
          list.length >= this.maxResults ? (list[list.length - 1]?.distanceMeters ?? 0) : null,
        );
        this.state.set('ready');
        // Primera vez en esta sucursal (sin radio guardado): arrancar con el radio
        // sugerido en vez del default, para no correr un benchmark condenado al timeout.
        if (this.autoApply()) {
          const s = untracked(() => this.suggestion());
          if (s && untracked(() => this.verdict()) !== 'ok') this.radiusChange.emit(s.radius);
        }
      },
      // Silencioso a proposito: es una ayuda, no una condicion para correr el benchmark.
      error: () => this.state.set('error'),
    });
  }

  private statsFor(radiusMeters: number): RadiusStats {
    const own = this.ownCommerceId();
    const chains = new Map<string, string>();
    let branches = 0;
    for (const b of this.nearby()) {
      if (b.distanceMeters > radiusMeters) break; // viene ordenado por distancia
      if (own && b.commerceId === own) continue;
      branches++;
      if (!chains.has(b.commerceId)) chains.set(b.commerceId, b.commerceName?.trim() || b.commerceId);
    }
    const exactUpTo = this.exactUpToMeters();
    return {
      branches,
      chains: chains.size,
      chainNames: [...chains.values()],
      capped: exactUpTo !== null && radiusMeters > exactUpTo,
    };
  }

  protected readonly current = computed<RadiusStats | null>(() =>
    this.state() === 'ready' ? this.statsFor(this.radius()) : null,
  );

  protected readonly chainSummary = computed(() => this.resumen(this.current()?.chainNames ?? []));

  /** Todo lo que hay hasta el maximo que se escanea (BP-75: decide si ampliar suma algo). */
  protected readonly scanStats = computed<RadiusStats | null>(() =>
    this.state() === 'ready' ? this.statsFor(this.scanMeters) : null,
  );

  protected resumen(names: string[]): string {
    const shown = names.slice(0, 4);
    const rest = names.length - shown.length;
    if (rest > 0) return shown.join(', ') + ` y ${rest} más`;
    return shown.length <= 1 ? (shown[0] ?? '') : shown.slice(0, -1).join(', ') + ' y ' + shown[shown.length - 1];
  }

  protected readonly verdict = computed<'ok' | 'too-many' | 'too-few'>(() => {
    const c = this.current();
    if (!c) return 'ok';
    if (c.chains < this.minChains) return 'too-few';
    if (c.branches > environment.benchmark.tooManyBranches) return 'too-many';
    return 'ok';
  });

  // Radio sugerido: el mas chico de la escalera que ya es "comodo" (>= comfortableBranches
  // sucursales y >= minChains cadenas). Si hay demasiadas incluso con el radio mas chico,
  // se sugiere ese. Si ninguno alcanza, el mas grande que sume algo (o null: no hay datos).
  protected readonly suggestion = computed<{ radius: number; stats: RadiusStats } | null>(() => {
    if (this.state() !== 'ready') return null;
    const ladder = environment.benchmark.radiusLadder.filter((r) => r !== this.radius());
    const comfortable = ladder
      .map((r) => ({ radius: r, stats: this.statsFor(r) }))
      .filter((x) => x.stats.chains >= this.minChains);
    if (comfortable.length === 0) {
      // BP-75 -- ninguno llega a minChains. Si mas lejos aparecen cadenas nuevas, se sugiere el radio mas
      // chico que ya las tiene a todas (aunque no lleguen a minChains: el informe las nombra). Si no aparece
      // ninguna nueva, null: el template dice que ampliar no suma competencia.
      if (this.verdict() !== 'too-few') return null;
      const actual = this.current()?.chains ?? 0;
      const todo = this.statsFor(this.scanMeters).chains;
      if (todo <= actual) return null;
      return ladder
        .filter((r) => r > this.radius())
        .map((r) => ({ radius: r, stats: this.statsFor(r) }))
        .find((x) => x.stats.chains === todo) ?? null;
    }
    const enough = comfortable.find((x) => x.stats.branches >= environment.benchmark.comfortableBranches);
    if (this.verdict() === 'too-many') {
      // Achicar: el primero que ya alcanza (la escalera va de menor a mayor).
      return enough ?? comfortable[0];
    }
    // Ampliar: el primero que supere el radio actual y tenga las cadenas minimas.
    return comfortable.find((x) => x.radius > this.radius()) ?? null;
  });

  protected apply(radius: number): void {
    this.radiusChange.emit(radius);
  }
}
