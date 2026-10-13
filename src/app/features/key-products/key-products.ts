import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdvisorService } from '../../core/advisor';
import {
  EstadoTestigo,
  KeyProductItem,
  KeyProductSearchItem,
  KeyProductSuggestionsResponse,
  KeyProductsResponse,
} from '../../core/advisor.models';
import { BenchmarkPreferencesService } from '../../core/benchmark-preferences';
import { BranchListItem } from '../../core/business-account.models';
import { BusinessContextService } from '../../core/business-context';
import { planGateErrorMessage } from '../../core/plan-gate';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { environment } from '../../../environments/environment';

// BP-78 (13-oct-2026) -- PRODUCTOS TESTIGO.
//
// Los pocos productos por los que el cliente juzga si un comercio es caro. El comercio los marca
// aca y el Asesor pasa a tratarlos distinto: en los testigos compara contra la cadena nacional mas
// barata del radio (meta: quedar a menos del 3 %), y en el resto del surtido deja de sugerir bajar
// salvo que la diferencia pase el 10 %.
//
// La sugerencia NO se graba sola: se muestra, el comercio destilda lo que no quiere y confirma.
// La posicion de cada testigo es por sucursal y radio (la calcula el backend con el mismo codigo
// que arma el informe, asi que esta pantalla y el informe no pueden decir numeros distintos).
@Component({
  selector: 'app-key-products',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './key-products.html',
  styleUrl: './key-products.scss',
})
export class KeyProductsComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly advisor = inject(AdvisorService);
  private readonly preferences = inject(BenchmarkPreferencesService);

  protected readonly loadingContext = signal(true);
  protected readonly noAccountYet = signal(false);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly branches = signal<BranchListItem[]>([]);
  private readonly businessAccountId = signal<number | null>(null);

  protected readonly branchId = signal('');
  protected readonly radio = signal(3000);
  /** Los radios del dashboard, mas el guardado para esta sucursal si no es uno de ellos. */
  protected readonly radios = computed(() => {
    const base = environment.benchmark.radiusLadder;
    return base.includes(this.radio()) ? base : [...base, this.radio()].sort((a, b) => a - b);
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** El plan no trae el Asesor: no es un error de la pantalla, es una invitacion. */
  protected readonly planMessage = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly data = signal<KeyProductsResponse | null>(null);
  /** EAN que se esta sacando (deshabilita su boton). */
  protected readonly quitando = signal<string | null>(null);

  protected readonly sugerencia = signal<KeyProductSuggestionsResponse | null>(null);
  protected readonly cargandoSugerencia = signal(false);
  protected readonly marcados = signal<ReadonlySet<string>>(new Set());
  protected readonly guardando = signal(false);

  protected readonly texto = signal('');
  protected readonly buscando = signal(false);
  protected readonly resultados = signal<KeyProductSearchItem[] | null>(null);

  // Primero lo que hay que pelear, de mayor a menor brecha; al final lo que no se pudo comparar.
  private static readonly ORDEN: Record<EstadoTestigo, number> = {
    'a-pelear': 0,
    'en-meta': 1,
    'mas-barato': 2,
    'comparacion-dudosa': 3,
    'sin-referencia': 4,
    'sin-precio-propio': 5,
  };

  protected readonly filas = computed<KeyProductItem[]>(() => {
    const items = [...(this.data()?.items ?? [])];
    return items.sort((a, b) => {
      const oa = a.posicion ? KeyProductsComponent.ORDEN[a.posicion.estado] : 9;
      const ob = b.posicion ? KeyProductsComponent.ORDEN[b.posicion.estado] : 9;
      if (oa !== ob) return oa - ob;
      const ba = a.posicion?.brechaPct ?? -Infinity;
      const bb = b.posicion?.brechaPct ?? -Infinity;
      if (ba !== bb) return bb - ba;
      return (a.descripcion ?? a.ean).localeCompare(b.descripcion ?? b.ean);
    });
  });

  protected readonly sugeridosNuevos = computed(() => (this.sugerencia()?.items ?? []).filter((s) => !s.yaEsTestigo));
  protected readonly cantidadMarcados = computed(() => this.marcados().size);

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId.set(ctx.account.businessAccountId);
        this.branches.set(ctx.branches);
        // La posicion necesita una sucursal con coordenadas; sin ninguna, la lista sale igual, sin brechas.
        const primera = ctx.branches.find((b) => b.latitude != null && b.longitude != null) ?? ctx.branches[0];
        if (primera) this.elegirSucursal(primera.branchId, false);
        this.cargar();
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  private elegirSucursal(branchId: string, recargar: boolean): void {
    this.branchId.set(branchId);
    this.radio.set(this.preferences.getRadius(branchId) ?? 3000);
    if (recargar) this.cargar();
  }

  protected onSucursal(event: Event): void {
    this.elegirSucursal((event.target as HTMLSelectElement).value, true);
  }

  protected onRadio(event: Event): void {
    this.radio.set(Number((event.target as HTMLSelectElement).value));
    this.cargar();
  }

  protected cargar(): void {
    const accountId = this.businessAccountId();
    if (accountId == null) return;

    this.loading.set(true);
    this.errorMessage.set(null);
    this.planMessage.set(null);
    this.advisor.getKeyProducts(accountId, this.branchId() || null, this.radio()).subscribe({
      next: (r) => {
        this.loading.set(false);
        this.data.set(r);
      },
      error: (err) => {
        this.loading.set(false);
        const gate = planGateErrorMessage(err);
        if (gate) this.planMessage.set(gate);
        else this.errorMessage.set(err?.error?.error ?? 'No pudimos cargar tus productos testigo. Probá de nuevo en un momento.');
      },
    });
  }

  // ---- sugerencia ----

  protected sugerir(): void {
    const accountId = this.businessAccountId();
    if (accountId == null) return;

    this.cargandoSugerencia.set(true);
    this.errorMessage.set(null);
    this.aviso.set(null);
    this.advisor.getKeyProductSuggestions(accountId).subscribe({
      next: (r) => {
        this.cargandoSugerencia.set(false);
        this.sugerencia.set(r);
        // Arrancan todos marcados: lo comun es aceptar la sugerencia y sacar dos o tres.
        this.marcados.set(new Set(r.items.filter((s) => !s.yaEsTestigo).map((s) => s.ean)));
      },
      error: (err) => {
        this.cargandoSugerencia.set(false);
        this.errorMessage.set(planGateErrorMessage(err) ?? err?.error?.error ?? 'No pudimos armar la sugerencia.');
      },
    });
  }

  protected alternar(ean: string): void {
    const next = new Set(this.marcados());
    if (next.has(ean)) next.delete(ean);
    else next.add(ean);
    this.marcados.set(next);
  }

  protected marcarTodos(marcar: boolean): void {
    this.marcados.set(marcar ? new Set(this.sugeridosNuevos().map((s) => s.ean)) : new Set());
  }

  protected cerrarSugerencia(): void {
    this.sugerencia.set(null);
    this.marcados.set(new Set());
  }

  protected confirmarSugerencia(): void {
    this.agregar([...this.marcados()], 'sugerido', () => this.cerrarSugerencia());
  }

  // ---- agregar a mano ----

  protected onTexto(event: Event): void {
    this.texto.set((event.target as HTMLInputElement).value);
  }

  protected buscar(): void {
    const accountId = this.businessAccountId();
    const q = this.texto().trim();
    if (accountId == null || q.length < 2) return;

    this.buscando.set(true);
    this.errorMessage.set(null);
    this.advisor.searchKeyProductCandidates(accountId, q).subscribe({
      next: (r) => {
        this.buscando.set(false);
        this.resultados.set(r);
      },
      error: (err) => {
        this.buscando.set(false);
        this.errorMessage.set(planGateErrorMessage(err) ?? err?.error?.error ?? 'No pudimos buscar. Probá de nuevo.');
      },
    });
  }

  protected agregarUno(item: KeyProductSearchItem): void {
    this.agregar([item.ean], 'manual', () => {
      // El resultado queda en pantalla, marcado como ya agregado: se puede seguir sumando de la misma busqueda.
      this.resultados.set((this.resultados() ?? []).map((x) => (x.ean === item.ean ? { ...x, yaEsTestigo: true } : x)));
    });
  }

  private agregar(eans: string[], origen: 'sugerido' | 'manual', alTerminar: () => void): void {
    const accountId = this.businessAccountId();
    if (accountId == null || eans.length === 0) return;

    this.guardando.set(true);
    this.errorMessage.set(null);
    this.aviso.set(null);
    this.advisor.addKeyProducts(accountId, eans, origen).subscribe({
      next: (r) => {
        this.guardando.set(false);
        const partes = [r.agregados === 1 ? 'Se agregó 1 producto testigo.' : `Se agregaron ${r.agregados} productos testigo.`];
        if (r.fueraDeTope > 0) partes.push(`${r.fueraDeTope} no entraron: el máximo es ${this.data()?.maximo ?? 500}.`);
        if (r.noSonPropios > 0) partes.push(`${r.noSonPropios} no están en tu catálogo.`);
        this.aviso.set(partes.join(' '));
        alTerminar();
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.errorMessage.set(planGateErrorMessage(err) ?? err?.error?.error ?? 'No pudimos guardar. Probá de nuevo.');
      },
    });
  }

  protected quitar(item: KeyProductItem): void {
    const accountId = this.businessAccountId();
    if (accountId == null || this.quitando() !== null) return;

    this.quitando.set(item.ean);
    this.errorMessage.set(null);
    this.aviso.set(null);
    this.advisor.removeKeyProduct(accountId, item.ean).subscribe({
      next: () => {
        this.quitando.set(null);
        // Se saca de la lista sin volver a pedir todo: recalcular las brechas tarda unos segundos
        // y sacar uno no cambia las de los demas. Los totales se piden de nuevo con "Actualizar".
        const actual = this.data();
        if (actual) {
          this.data.set({
            ...actual,
            confirmados: actual.confirmados - 1,
            resumen: null,
            items: actual.items.filter((x) => x.ean !== item.ean),
          });
        }
        this.resultados.set((this.resultados() ?? null)?.map((x) => (x.ean === item.ean ? { ...x, yaEsTestigo: false } : x)) ?? null);
      },
      error: (err) => {
        this.quitando.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos sacar el producto. Probá de nuevo.');
      },
    });
  }

  // ---- formato (es-AR), igual que el informe del Asesor ----

  protected money(value: number): string {
    const decimals = Math.abs(value) >= 1000 ? 0 : 2;
    return '$' + value.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  /** Cantidades y porcentajes sin signo, con separador de miles de aca (el pipe number usa el de EE.UU.). */
  protected num(value: number, decimales = 1): string {
    return value.toLocaleString('es-AR', { maximumFractionDigits: decimales });
  }

  protected signed(value: number): string {
    return (value > 0 ? '+' : '') + value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  protected estadoLabel(estado: EstadoTestigo): string {
    switch (estado) {
      case 'a-pelear': return 'Para pelear';
      case 'en-meta': return 'En meta';
      case 'mas-barato': return 'Más barato';
      case 'comparacion-dudosa': return 'Revisar carga';
      case 'sin-referencia': return 'Sin referencia';
      case 'sin-precio-propio': return 'Sin precio acá';
    }
  }

  protected estadoClase(estado: EstadoTestigo): string {
    switch (estado) {
      case 'a-pelear': return 'pill pill--danger';
      case 'en-meta': return 'pill pill--success';
      case 'mas-barato': return 'pill pill--info';
      case 'comparacion-dudosa': return 'pill pill--warning';
      default: return 'pill pill--neutral';
    }
  }

  protected estadoAyuda(estado: EstadoTestigo): string {
    switch (estado) {
      case 'a-pelear': return 'Estás más arriba que la meta. Bajarlo hasta la columna Meta alcanza.';
      case 'en-meta': return 'Estás por encima de la referencia, pero dentro de la meta.';
      case 'mas-barato': return 'Estás por debajo de la referencia: acá la comparación ya la ganás.';
      case 'comparacion-dudosa': return 'La diferencia parece de unidad de venta (pack contra unidad). Revisá cómo está cargado.';
      case 'sin-referencia': return 'Ninguna cadena del radio publica este producto.';
      case 'sin-precio-propio': return 'No tiene precio cargado en esta sucursal.';
    }
  }
}
