import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { AdvisorService } from '../../core/advisor';
import { PriceZoneBranch, PriceZoneItem, PriceZonesResponse } from '../../core/advisor.models';
import { BusinessContextService } from '../../core/business-context';
import { planGateErrorMessage } from '../../core/plan-gate';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { AdvisorReportDialogComponent, AdvisorReportDialogData } from '../benchmark-dashboard/advisor-report-dialog';
import { environment } from '../../../environments/environment';

// BP-77 (14-oct-2026) -- ZONAS DE PRECIO.
//
// Una zona es un grupo de sucursales que comparten lista: Cordoba Capital una, Rufino otra. El Asesor da un
// informe por zona: la competencia es la de los radios de todas sus sucursales juntas, el precio propio es
// el mas repetido, y los productos con precios distintos entre sucursales salen arriba ("tu lista no es
// una sola"). Una sucursal que no esta en ninguna zona es su propia zona: nada cambia para quien no las usa.
//
// Una sucursal esta en una sola zona: si se la agrega a otra, se mueve.
@Component({
  selector: 'app-price-zones',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './price-zones.html',
  styleUrl: './price-zones.scss',
})
export class PriceZonesComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly advisor = inject(AdvisorService);
  private readonly dialog = inject(MatDialog);

  protected readonly loadingContext = signal(true);
  protected readonly noAccountYet = signal(false);
  protected readonly contextErrorMessage = signal<string | null>(null);
  private readonly businessAccountId = signal<number | null>(null);

  protected readonly loading = signal(false);
  protected readonly guardando = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** El plan no trae el Asesor: no es un error de la pantalla, es una invitacion. */
  protected readonly planMessage = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly data = signal<PriceZonesResponse | null>(null);

  /** El formulario: null = cerrado; id null = zona nueva. */
  protected readonly editando = signal<{ id: number | null } | null>(null);
  protected readonly nombre = signal('');
  protected readonly marcadas = signal<ReadonlySet<string>>(new Set());

  protected readonly radio = signal(3000);
  protected readonly radios = environment.benchmark.radiusLadder;

  protected readonly sueltas = computed(() => (this.data()?.sucursales ?? []).filter((s) => s.zonaId == null));
  protected readonly nombreDeZona = computed(() => {
    const map = new Map<number, string>();
    for (const z of this.data()?.zonas ?? []) map.set(z.id, z.nombre);
    return map;
  });

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId.set(ctx.account.businessAccountId);
        this.cargar();
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  private cargar(): void {
    const id = this.businessAccountId();
    if (id == null) return;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.advisor.getPriceZones(id).subscribe({
      next: (d) => {
        this.loading.set(false);
        this.data.set(d);
      },
      error: (err) => {
        this.loading.set(false);
        const gate = planGateErrorMessage(err);
        if (gate) this.planMessage.set(gate);
        else this.errorMessage.set(err?.error?.error ?? 'No pudimos cargar tus zonas. Probá recargar la página.');
      },
    });
  }

  // ---- Formulario (alta y edición) ----

  protected nueva(): void {
    this.aviso.set(null);
    this.errorMessage.set(null);
    this.nombre.set('');
    this.marcadas.set(new Set());
    this.editando.set({ id: null });
  }

  protected editar(z: PriceZoneItem): void {
    this.aviso.set(null);
    this.errorMessage.set(null);
    this.nombre.set(z.nombre);
    this.marcadas.set(new Set(z.sucursales.map((s) => s.branchId)));
    this.editando.set({ id: z.id });
  }

  protected cancelar(): void {
    this.editando.set(null);
  }

  protected onNombre(e: Event): void {
    this.nombre.set((e.target as HTMLInputElement).value);
  }

  protected alternar(branchId: string): void {
    const s = new Set(this.marcadas());
    if (s.has(branchId)) s.delete(branchId);
    else s.add(branchId);
    this.marcadas.set(s);
  }

  /** "Ahora en Rufino": la sucursal esta en otra zona y guardar la mueve. */
  protected otraZona(s: PriceZoneBranch): string | null {
    const ed = this.editando();
    if (s.zonaId == null || s.zonaId === ed?.id) return null;
    return this.nombreDeZona().get(s.zonaId) ?? null;
  }

  protected guardar(): void {
    const id = this.businessAccountId();
    const ed = this.editando();
    const nombre = this.nombre().trim();
    if (id == null || !ed) return;
    if (!nombre) {
      this.errorMessage.set('Poné un nombre a la zona (por ejemplo, la ciudad).');
      return;
    }
    const sucursales = [...this.marcadas()];
    this.guardando.set(true);
    this.errorMessage.set(null);
    const pedido = ed.id == null
      ? this.advisor.createPriceZone(id, nombre, sucursales)
      : this.advisor.updatePriceZone(id, ed.id, nombre, sucursales);
    pedido.subscribe({
      next: (d) => {
        this.guardando.set(false);
        this.data.set(d);
        this.editando.set(null);
        this.aviso.set(ed.id == null ? `Zona "${nombre}" creada.` : `Zona "${nombre}" guardada.`);
      },
      error: (err) => {
        this.guardando.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos guardar la zona. Probá de nuevo.');
      },
    });
  }

  protected borrar(z: PriceZoneItem): void {
    const id = this.businessAccountId();
    if (id == null) return;
    const costos = z.costosPropios > 0
      ? `\n\nTambién se borran los costos que cargaste para esta zona (${z.costosPropios} productos): esas sucursales vuelven a usar los costos de toda la cuenta.`
      : '';
    if (!window.confirm(`¿Borrar la zona "${z.nombre}"? Sus sucursales quedan sueltas: cada una vuelve a tener su propio informe.${costos}`)) return;
    this.guardando.set(true);
    this.advisor.deletePriceZone(id, z.id).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.data.set(r.zonas);
        this.aviso.set(`Zona "${z.nombre}" borrada${r.costosBorrados > 0 ? ` (y ${r.costosBorrados} costos de la zona)` : ''}.`);
      },
      error: (err) => {
        this.guardando.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos borrar la zona. Probá de nuevo.');
      },
    });
  }

  // ---- Informe del Asesor de la zona ----

  protected onRadio(e: Event): void {
    this.radio.set(Number((e.target as HTMLSelectElement).value));
  }

  protected informe(z: PriceZoneItem): void {
    const id = this.businessAccountId();
    if (id == null) return;
    this.dialog.open<AdvisorReportDialogComponent, AdvisorReportDialogData>(AdvisorReportDialogComponent, {
      data: { businessAccountId: id, priceZoneId: z.id, maxDistanceMeters: this.radio() },
      width: '90vw',
      maxWidth: '820px',
      maxHeight: '90vh',
      autoFocus: false,
    });
  }

  protected conCoordenadas(z: PriceZoneItem): number {
    return z.sucursales.filter((s) => s.tieneCoordenadas).length;
  }

  protected num(n: number): string {
    return n.toLocaleString('es-AR');
  }
}
