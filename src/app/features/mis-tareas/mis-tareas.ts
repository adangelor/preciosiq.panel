import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { BusinessContextService } from '../../core/business-context';
import { ESTADOS, MiTarea, TareasService, achicarFoto, textoVencimiento } from '../../core/tareas';

const MAX_FOTOS = 3;

interface Borrador {
  fotos: { blob: Blob; url: string }[];
  comentario: string;
  modo: 'foto' | 'nosepudo';
  motivo: string;
  achicando: boolean;
  enviando: boolean;
  progreso: number;
  error: string | null;
}

const vacio = (): Borrador => ({ fotos: [], comentario: '', modo: 'foto', motivo: '', achicando: false, enviando: false, progreso: 0, error: null });

// BP-226 bloque 5 (8-nov-2026) -- "Mis tareas": la primera pantalla del panel pensada para el teléfono. El encargado ve
// las tareas de su sucursal (primero las que le pidieron de nuevo, después de la más urgente a la menos) y responde con
// un botón grande "Sacar foto": <input type="file" accept="image/*" capture="environment"> abre la cámara en Android y
// en iPhone sin plugins. Las fotos se achican en el teléfono (1600 px, JPEG 80) antes de subir, con barra de progreso y
// reintento si se corta la señal. "No se pudo" pide el motivo. También la ve la casa central (todas las sucursales).
@Component({
  selector: 'app-mis-tareas',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './mis-tareas.html',
  styleUrl: './mis-tareas.scss',
})
export class MisTareasComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly api = inject(TareasService);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly ESTADOS = ESTADOS;
  protected readonly MAX_FOTOS = MAX_FOTOS;
  protected readonly textoVencimiento = textoVencimiento;
  protected readonly fuera = signal(false);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly sinPlan = signal(false);
  protected readonly aviso = signal<string | null>(null);
  private cuenta = 0;
  protected readonly razonSocial = signal('');
  protected readonly encargado = signal(false);
  protected readonly sucursales = signal(0);
  protected readonly items = signal<MiTarea[]>([]);
  protected readonly borradores = signal<Record<string, Borrador>>({});
  protected readonly abiertas = signal<Set<string>>(new Set());

  protected readonly pendientes = computed(() => this.items().filter((i) => i.estado === 'pendiente' || i.estado === 'pedida'));
  protected readonly hechas = computed(() => this.items().filter((i) => i.estado !== 'pendiente' && i.estado !== 'pedida'));
  protected readonly variasSucursales = computed(() => this.sucursales() > 1);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const b of Object.values(this.borradores())) b.fotos.forEach((f) => URL.revokeObjectURL(f.url));
    });
  }

  ngOnInit(): void {
    this.fuera.set(this.ruta.snapshot.queryParamMap.get('fuera') === '1');
    this.context.load().subscribe({
      next: (ctx) => {
        if (!ctx) { this.cargando.set(false); this.error.set('Tu usuario todavía no está en ningún comercio.'); return; }
        this.cuenta = ctx.account.businessAccountId;
        this.razonSocial.set(ctx.account.razonSocial);
        void this.cargar();
      },
      error: () => { this.cargando.set(false); this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.mias(this.cuenta));
      this.encargado.set(r.encargado);
      this.sucursales.set(r.sucursales);
      this.items.set(r.items);
    } catch (err) {
      const e = err as { status?: number; error?: { error?: string } };
      if (e?.status === 402) this.sinPlan.set(true);
      else this.error.set(e?.error?.error ?? 'No se pudieron traer tus tareas. Revisá la señal y probá de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected clave(t: MiTarea): string {
    return `${t.tareaId}|${t.branchId}`;
  }

  protected b(t: MiTarea): Borrador {
    return this.borradores()[this.clave(t)] ?? vacio();
  }

  private cambiar(t: MiTarea, f: (b: Borrador) => Partial<Borrador>): void {
    const k = this.clave(t);
    const actual = this.borradores()[k] ?? vacio();
    this.borradores.set({ ...this.borradores(), [k]: { ...actual, ...f(actual) } });
  }

  protected alternarInstrucciones(t: MiTarea): void {
    const s = new Set(this.abiertas());
    const k = this.clave(t);
    if (s.has(k)) s.delete(k); else s.add(k);
    this.abiertas.set(s);
  }

  protected paramsCarteles(t: MiTarea): Record<string, string> {
    return { eans: t.productos.map((p) => p.ean).join(','), branchId: t.branchId };
  }

  // ------------------------------------------------------------------ las fotos
  protected async elegirFotos(t: MiTarea, e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';   // para poder sacar otra foto igual
    if (archivos.length === 0) return;
    const lugar = MAX_FOTOS - this.b(t).fotos.length;
    if (lugar <= 0) return;
    this.cambiar(t, () => ({ achicando: true, error: null }));
    const nuevas: { blob: Blob; url: string }[] = [];
    for (const a of archivos.slice(0, lugar)) {
      const blob = await achicarFoto(a);
      nuevas.push({ blob, url: URL.createObjectURL(blob) });
    }
    this.cambiar(t, (b) => ({ fotos: [...b.fotos, ...nuevas], achicando: false, modo: 'foto' }));
  }

  protected quitarFoto(t: MiTarea, i: number): void {
    this.cambiar(t, (b) => {
      URL.revokeObjectURL(b.fotos[i].url);
      return { fotos: b.fotos.filter((_, j) => j !== i) };
    });
  }

  protected val(e: Event): string {
    return (e.target as HTMLTextAreaElement).value;
  }

  protected setComentario(t: MiTarea, e: Event): void {
    const v = this.val(e);
    this.cambiar(t, () => ({ comentario: v }));
  }

  protected setMotivo(t: MiTarea, e: Event): void {
    const v = this.val(e);
    this.cambiar(t, () => ({ motivo: v }));
  }

  protected modo(t: MiTarea, m: 'foto' | 'nosepudo'): void {
    this.cambiar(t, () => ({ modo: m, error: null }));
  }

  // ------------------------------------------------------------------ enviar
  protected async enviar(t: MiTarea): Promise<void> {
    const b = this.b(t);
    const noSePudo = b.modo === 'nosepudo';
    if (noSePudo && !b.motivo.trim()) return this.cambiar(t, () => ({ error: 'Contanos por qué no se pudo.' }));
    if (!noSePudo && b.fotos.length === 0) return this.cambiar(t, () => ({ error: 'Sacá al menos una foto.' }));
    this.cambiar(t, () => ({ enviando: true, progreso: 0, error: null }));
    const ubicacion = await this.ubicacion();

    // Reintenta solo cuando se cortó la conexión (status 0), dos veces; un error de la API se muestra tal cual.
    for (let intento = 1; ; intento++) {
      try {
        await lastValueFrom(this.api.responder(this.cuenta, t.tareaId, t.branchId, {
          fotos: noSePudo ? [] : b.fotos.map((f) => f.blob),
          comentario: noSePudo ? null : b.comentario.trim() || null,
          noSePudo,
          motivo: noSePudo ? b.motivo.trim() : null,
          latitud: ubicacion?.latitude ?? null,
          longitud: ubicacion?.longitude ?? null,
        }).pipe(tap((ev) => {
          if (ev.type === HttpEventType.UploadProgress && ev.total) {
            const p = Math.round((ev.loaded / ev.total) * 100);
            this.cambiar(t, () => ({ progreso: p }));
          }
        })));
        break;
      } catch (err) {
        const e = err as { status?: number; error?: { error?: string } };
        if (e?.status === 0 && intento < 3) {
          this.cambiar(t, () => ({ progreso: 0, error: `Se cortó la señal. Reintentando (${intento + 1} de 3)…` }));
          await new Promise((ok) => setTimeout(ok, 2000 * intento));
          continue;
        }
        this.cambiar(t, () => ({
          enviando: false,
          error: e?.status === 0
            ? 'No hay señal. Tus fotos quedan acá: tocá Enviar cuando vuelva.'
            : e?.error?.error ?? 'No se pudo enviar. Probá de nuevo.',
        }));
        return;
      }
    }
    b.fotos.forEach((f) => URL.revokeObjectURL(f.url));
    const { [this.clave(t)]: _, ...resto } = this.borradores();
    this.borradores.set(resto);
    this.aviso.set(noSePudo ? 'Listo: la casa central ya sabe que no se pudo.' : '¡Listo! La casa central ya tiene tus fotos.');
    await this.cargar();
  }

  /** La ubicación si el teléfono la da en 5 segundos (decisión H: solo informa, nunca frena). */
  private ubicacion(): Promise<GeolocationCoordinates | null> {
    if (!('geolocation' in navigator)) return Promise.resolve(null);
    return new Promise((ok) => navigator.geolocation.getCurrentPosition(
      (p) => ok(p.coords), () => ok(null), { timeout: 5000, maximumAge: 120000, enableHighAccuracy: true }));
  }
}
