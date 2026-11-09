import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdvisorService } from '../../core/advisor';
import { PriceZoneItem } from '../../core/advisor.models';
import { BranchListItem } from '../../core/business-account.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { ResumenTarea, TareasService, textoVencimiento } from '../../core/tareas';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

/** "jueves 18:00" por defecto: dentro de dos días a las 18 (hora del navegador). */
function venceSugerido(): string {
  const d = new Date(Date.now() + 2 * 86400000);
  d.setHours(18, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T18:00`;
}

// BP-226 (8-nov-2026) -- Tareas a sucursales (casa central): la lista con el avance ("7 de 10", atrasadas en rojo) y el
// alta. El alta se puede abrir armada desde la hoja de carteles (?eans=&branchId=&origen=carteles): "Mandar a las
// sucursales" (decisión D). Plan Cadena; con una sola sucursal, la pantalla lo explica.
@Component({
  selector: 'app-tareas',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './tareas.html',
  styleUrls: ['../gestion/gestion.scss', './tareas.scss'],
})
export class TareasComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(TareasService);
  private readonly advisor = inject(AdvisorService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly textoVencimiento = textoVencimiento;
  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected cuenta = 0;
  protected readonly branches = signal<BranchListItem[]>([]);
  protected readonly zonas = signal<PriceZoneItem[]>([]);

  protected readonly estado = signal<'abiertas' | 'cerradas' | 'todas'>('abiertas');
  protected readonly items = signal<ResumenTarea[] | null>(null);
  protected readonly cargando = signal(false);

  // ---- el alta
  protected readonly creando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly titulo = signal('');
  protected readonly instrucciones = signal('');
  protected readonly vence = signal(venceSugerido());
  protected readonly destino = signal<'todas' | 'sucursales' | 'zona'>('todas');
  protected readonly elegidas = signal<Set<string>>(new Set());
  protected readonly zonaId = signal<number | null>(null);
  protected readonly eans = signal<string[]>([]);
  protected readonly origen = signal<'panel' | 'carteles'>('panel');
  protected readonly errorAlta = signal<string | null>(null);

  protected readonly unaSola = computed(() => this.branches().length < 2);
  protected readonly cuantasVan = computed(() => {
    switch (this.destino()) {
      case 'todas': return this.branches().length;
      case 'zona': return this.zonas().find((z) => z.id === this.zonaId())?.sucursales.length ?? 0;
      default: return this.elegidas().size;
    }
  });

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) return this.sinCuenta.set(true);
        if (!g.tareasSucursales) return this.sinPlan.set(true);
        this.cuenta = g.businessAccountId;
        this.branches.set(g.branches);
        this.advisor.getPriceZones(g.businessAccountId).subscribe({ next: (z) => this.zonas.set(z.zonas ?? []), error: () => {} });
        this.armarDesdeLaUrl();
        void this.cargar();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  /** Desde la hoja de carteles: ?eans=a,b,c&branchId=X&origen=carteles abre el alta armada. */
  private armarDesdeLaUrl(): void {
    const q = this.ruta.snapshot.queryParamMap;
    const eans = (q.get('eans') ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (eans.length === 0 && q.get('nueva') !== '1') return;
    this.nueva();
    this.eans.set(eans);
    if (q.get('origen') === 'carteles') {
      this.origen.set('carteles');
      this.titulo.set(eans.length === 1 ? 'Colgar el cartel nuevo' : `Colgar los ${eans.length} carteles nuevos`);
      this.instrucciones.set('Imprimí los carteles desde la tarea, colgalos en la góndola y sacale una foto a cada uno.');
    }
    const b = q.get('branchId');
    if (b && this.branches().some((x) => x.branchId === b) && q.get('todas') !== '1') {
      this.destino.set('sucursales');
      this.elegidas.set(new Set([b]));
    }
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.items.set((await firstValueFrom(this.api.listar(this.cuenta, this.estado()))).items);
    } catch (err) {
      const e = err as { status?: number; error?: { error?: string } };
      if (e?.status === 402) this.sinPlan.set(true);
      else this.error.set(e?.error?.error ?? 'No se pudieron traer las tareas.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected verEstado(e: 'abiertas' | 'cerradas' | 'todas'): void {
    this.estado.set(e);
    void this.cargar();
  }

  protected nueva(): void {
    this.creando.set(true);
    this.errorAlta.set(null);
    this.aviso.set(null);
  }

  protected cancelar(): void {
    this.creando.set(false);
    this.titulo.set('');
    this.instrucciones.set('');
    this.vence.set(venceSugerido());
    this.destino.set('todas');
    this.elegidas.set(new Set());
    this.eans.set([]);
    this.origen.set('panel');
    if (this.ruta.snapshot.queryParamMap.keys.length > 0) void this.router.navigate([], { queryParams: {} });
  }

  protected alternarSucursal(id: string): void {
    const s = new Set(this.elegidas());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.elegidas.set(s);
  }

  protected quitarEan(ean: string): void {
    this.eans.set(this.eans().filter((e) => e !== ean));
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async guardar(): Promise<void> {
    this.errorAlta.set(null);
    if (!this.titulo().trim()) return this.errorAlta.set('Poné un título: qué tienen que hacer.');
    const vence = new Date(this.vence());
    if (isNaN(vence.getTime())) return this.errorAlta.set('Poné hasta cuándo hay tiempo.');
    if (this.cuantasVan() === 0) return this.errorAlta.set('Elegí al menos una sucursal.');
    this.guardando.set(true);
    try {
      const r = await firstValueFrom(this.api.crear({
        businessAccountId: this.cuenta,
        titulo: this.titulo().trim(),
        instrucciones: this.instrucciones().trim() || null,
        vence: vence.toISOString(),
        destino: this.destino(),
        sucursales: this.destino() === 'sucursales' ? [...this.elegidas()] : undefined,
        priceZoneId: this.destino() === 'zona' ? this.zonaId() : undefined,
        eans: this.eans(),
        origen: this.origen(),
      }));
      this.cancelar();
      this.aviso.set(`Listo: la tarea les llegó a ${r.sucursales === 1 ? '1 sucursal' : r.sucursales + ' sucursales'}.`);
      this.estado.set('abiertas');
      await this.cargar();
    } catch (err) {
      this.errorAlta.set((err as { error?: { error?: string } })?.error?.error ?? 'No se pudo mandar la tarea.');
    } finally {
      this.guardando.set(false);
    }
  }

  protected avance(t: ResumenTarea): number {
    return t.sucursales === 0 ? 0 : Math.round((t.respondidas / t.sucursales) * 100);
  }

  protected vencida(t: ResumenTarea): boolean {
    return new Date(t.venceUtc) < new Date();
  }
}
