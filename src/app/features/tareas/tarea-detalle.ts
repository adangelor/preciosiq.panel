import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GestionContextoService } from '../../core/gestion-contexto';
import { DetalleTarea, ESTADOS, SucursalDeTarea, TareasService, textoVencimiento } from '../../core/tareas';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { FotoTareaComponent } from './foto-tarea';

// BP-226 (8-nov-2026) -- una tarea, sucursal por sucursal: la grilla con la miniatura y el estado; al tocar una sucursal,
// las fotos grandes con Aprobar o Pedir de nuevo (decisión C).
@Component({
  selector: 'app-tarea-detalle',
  standalone: true,
  imports: [RouterLink, DatePipe, LoadingBarComponent, FotoTareaComponent],
  templateUrl: './tarea-detalle.html',
  styleUrls: ['../gestion/gestion.scss', './tarea-detalle.scss'],
})
export class TareaDetalleComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(TareasService);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly ESTADOS = ESTADOS;
  protected readonly textoVencimiento = textoVencimiento;
  protected cuenta = 0;
  private id = 0;
  protected readonly datos = signal<DetalleTarea | null>(null);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly abierta = signal<string | null>(null);
  protected readonly fotoGrande = signal<number | null>(null);
  protected readonly comentario = signal('');
  protected readonly trabajando = signal(false);
  protected readonly errorRevision = signal<string | null>(null);

  protected readonly sucursal = computed(() => this.datos()?.sucursales.find((s) => s.branchId === this.abierta()) ?? null);
  protected readonly conteo = computed(() => {
    const d = this.datos();
    if (!d) return null;
    const c = { respondidas: 0, aprobadas: 0, pendientes: 0, atrasadas: 0 };
    for (const s of d.sucursales) {
      if (s.estado === 'aprobada') c.aprobadas++;
      if (s.estado === 'respondida' || s.estado === 'nosepudo' || s.estado === 'aprobada') c.respondidas++;
      if (s.estado === 'pendiente' || s.estado === 'pedida') c.pendientes++;
      if (s.atrasada) c.atrasadas++;
    }
    return c;
  });
  protected readonly paramsCarteles = computed(() => ({ eans: (this.datos()?.productos ?? []).map((p) => p.ean).join(',') }));

  ngOnInit(): void {
    this.id = Number(this.ruta.snapshot.paramMap.get('id'));
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) { this.cargando.set(false); this.error.set('No encontramos tu comercio.'); return; }
        this.cuenta = g.businessAccountId;
        void this.cargar();
      },
      error: () => { this.cargando.set(false); this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.datos.set(await firstValueFrom(this.api.detalle(this.cuenta, this.id)));
    } catch (err) {
      this.error.set((err as { error?: { error?: string } })?.error?.error ?? 'No se pudo traer la tarea.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected abrir(s: SucursalDeTarea): void {
    this.abierta.set(this.abierta() === s.branchId ? null : s.branchId);
    this.fotoGrande.set(s.respuestas[0]?.fotos[0]?.id ?? null);
    this.comentario.set('');
    this.errorRevision.set(null);
  }

  protected val(e: Event): string {
    return (e.target as HTMLTextAreaElement).value;
  }

  protected async revisar(aprobar: boolean): Promise<void> {
    const s = this.sucursal();
    if (!s) return;
    if (!aprobar && !this.comentario().trim()) {
      this.errorRevision.set('Contale a la sucursal qué tiene que rehacer.');
      return;
    }
    this.trabajando.set(true);
    this.errorRevision.set(null);
    try {
      await firstValueFrom(aprobar
        ? this.api.aprobar(this.cuenta, this.id, s.branchId, this.comentario().trim() || null)
        : this.api.pedir(this.cuenta, this.id, s.branchId, this.comentario().trim()));
      await this.cargar();
      this.siguiente(s.branchId);
    } catch (err) {
      this.errorRevision.set((err as { error?: { error?: string } })?.error?.error ?? 'No se pudo guardar.');
    } finally {
      this.trabajando.set(false);
    }
  }

  /** Después de revisar, abre la próxima sucursal para revisar (si hay). */
  private siguiente(despuesDe: string): void {
    const l = this.datos()?.sucursales ?? [];
    const i = l.findIndex((x) => x.branchId === despuesDe);
    const prox = [...l.slice(i + 1), ...l.slice(0, i)].find((x) => x.estado === 'respondida' || x.estado === 'nosepudo');
    if (prox) this.abrir(prox);
    else { this.abierta.set(null); this.fotoGrande.set(null); }
  }

  protected async cerrar(cerrar: boolean): Promise<void> {
    this.trabajando.set(true);
    try {
      await firstValueFrom(this.api.cerrar(this.cuenta, this.id, cerrar));
      await this.cargar();
    } catch (err) {
      this.error.set((err as { error?: { error?: string } })?.error?.error ?? 'No se pudo.');
    } finally {
      this.trabajando.set(false);
    }
  }

  protected distancia(m: number | null): string | null {
    if (m == null) return null;
    return m < 1000 ? `a ${m} m de la sucursal` : `a ${(m / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km de la sucursal`;
  }
}
