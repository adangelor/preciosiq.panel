import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GestionContextoService } from '../../core/gestion-contexto';
import { DetalleTarea, ESTADOS, FotoDeTarea, OCR, SucursalDeTarea, TareasService, textoVencimiento } from '../../core/tareas';
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
  protected readonly OCR = OCR;
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
  // Bloque 6: la foto que se ve grande, con su producto y la marca del control del precio.
  protected readonly fotoActual = computed<FotoDeTarea | null>(() =>
    this.sucursal()?.respuestas[0]?.fotos.find((f) => f.id === this.fotoGrande()) ?? null);

  protected nombreDe(ean: string | null): string | null {
    if (!ean) return null;
    return this.datos()?.productos.find((p) => p.ean === ean)?.descripcion ?? ean;
  }

  /** La marca de la tarjeta: 'mal' si alguna foto no coincide, 'ok' si todas las controladas coinciden, null si no hay. */
  protected ocrDe(s: SucursalDeTarea): 'ok' | 'mal' | null {
    const fotos = (s.respuestas[0]?.fotos ?? []).filter((f) => f.ocrEstado === 'coincide' || f.ocrEstado === 'nocoincide');
    if (fotos.length === 0) return null;
    return fotos.some((f) => f.ocrEstado === 'nocoincide') ? 'mal' : 'ok';
  }

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

  // Bloque 6: el precio se controla en el servidor unos segundos después de la respuesta. Si hay fotos recién llegadas
  // sin controlar, se vuelve a pedir el detalle cada 6 s, como mucho 10 veces.
  private reintentosOcr = 0;
  private timerOcr: ReturnType<typeof setTimeout> | null = null;
  private readonly alSalir = inject(DestroyRef).onDestroy(() => { if (this.timerOcr) clearTimeout(this.timerOcr); });

  private esperandoOcr(d: DetalleTarea): boolean {
    const hace10min = Date.now() - 10 * 60000;
    return d.sucursales.some((s) => s.respuestas.some((r) => new Date(r.creadaUtc).getTime() > hace10min
      && r.fotos.some((f) => !!f.ean && !f.ocrEstado && !f.borrada)));
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const d = await firstValueFrom(this.api.detalle(this.cuenta, this.id));
      this.datos.set(d);
      if (this.timerOcr) clearTimeout(this.timerOcr);
      if (this.esperandoOcr(d) && this.reintentosOcr++ < 10) this.timerOcr = setTimeout(() => void this.cargar(), 6000);
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
      this.api.avisarCambio();
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
