import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { ErrorDeCampo, SlugDisponibilidad, TiendaConfig, TiendaDeSucursal, TiendaService, achicarImagen } from '../../core/tienda';

type Campo = 'slug' | 'nombreVisible' | 'presentacion' | 'whatsApp' | 'alias' | 'cvu' | 'qr';

/**
 * BP-71 -- la tienda de UNA sucursal: ver como esta, crearla o editarla, y el QR de pago.
 * La direccion se chequea en vivo contra el servidor (formato, reservados, ocupada) mientras se tipea.
 */
@Component({
  selector: 'app-tienda-sucursal',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './tienda-sucursal.html',
  styleUrl: './mi-tienda.scss',
})
export class TiendaSucursalComponent implements OnInit {
  private readonly service = inject(TiendaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly sucursal = input.required<TiendaDeSucursal>();
  readonly businessAccountId = input.required<number>();
  readonly guardada = output<TiendaConfig>();

  protected readonly tienda = signal<TiendaConfig | null>(null);
  protected readonly editando = signal(false);

  // ---- formulario
  protected readonly slug = signal('');
  protected readonly nombre = signal('');
  protected readonly presentacion = signal('');
  protected readonly whatsApp = signal('');
  protected readonly alias = signal('');
  protected readonly cvu = signal('');
  protected readonly mostrarDomicilio = signal(true);
  protected readonly activa = signal(true);

  protected readonly slugEstado = signal<SlugDisponibilidad | null>(null);
  protected readonly chequeandoSlug = signal(false);
  protected readonly guardando = signal(false);
  protected readonly errores = signal<Partial<Record<Campo, string>>>({});
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly subiendoQr = signal(false);

  protected readonly urlPublica = computed(() => {
    const t = this.tienda();
    return t ? this.service.urlPublica(t.slug) : null;
  });
  protected readonly urlPrevia = computed(() => this.service.urlPublica(this.slug() || '…'));
  protected readonly faltaWhatsApp = computed(() => !!this.tienda() && !this.tienda()!.whatsApp);

  private readonly slug$ = new Subject<string>();

  ngOnInit(): void {
    this.tienda.set(this.sucursal().tienda);

    // Primero se suscribe y DESPUES se abre el editor: abrirEditor() manda el slug sugerido por slug$,
    // y si nadie escucha todavia el chequeo inicial se pierde (el campo quedaba sin "Disponible").
    this.slug$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((s) => {
          this.chequeandoSlug.set(true);
          return this.service.chequearSlug(this.businessAccountId(), this.sucursal().branchId, s).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.chequeandoSlug.set(false);
        this.slugEstado.set(r);
      });

    // Sin tienda todavia: el formulario arranca abierto con lo sugerido; con tienda, cerrado.
    if (!this.tienda()) this.abrirEditor();
  }

  protected abrirEditor(): void {
    const t = this.tienda();
    const s = this.sucursal();
    this.slug.set(t?.slug ?? s.slugSugerido);
    this.nombre.set(t?.nombreVisible ?? s.nombreSugerido);
    this.presentacion.set(t?.presentacion ?? '');
    this.whatsApp.set(t?.whatsApp ?? '');
    this.alias.set(t?.alias ?? '');
    this.cvu.set(t?.cvu ?? '');
    this.mostrarDomicilio.set(t?.mostrarDomicilio ?? true);
    this.activa.set(t?.activa ?? true);
    this.errores.set({});
    this.errorGeneral.set(null);
    this.mensaje.set(null);
    this.editando.set(true);
    this.cambiarSlug(this.slug());
  }

  protected cancelar(): void {
    this.editando.set(false);
    this.errores.set({});
  }

  /** Lo que se tipea se normaliza como lo va a guardar el servidor: minusculas, sin tildes, sin espacios. */
  protected cambiarSlug(valor: string): void {
    const s = valor
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // "almacén" -> "almacen", "ñandú" -> "nandu"
      .replace(/\s+/g, '-');
    this.slug.set(s);
    this.errores.update((e) => ({ ...e, slug: undefined }));
    this.slug$.next(s);
  }

  protected guardar(): void {
    this.guardando.set(true);
    this.errores.set({});
    this.errorGeneral.set(null);
    this.mensaje.set(null);
    this.service
      .guardar({
        businessAccountId: this.businessAccountId(),
        branchId: this.sucursal().branchId,
        slug: this.slug(),
        activa: this.activa(),
        nombreVisible: this.nombre(),
        presentacion: this.presentacion() || null,
        whatsApp: this.whatsApp() || null,
        alias: this.alias() || null,
        cvu: this.cvu() || null,
        mostrarDomicilio: this.mostrarDomicilio(),
      })
      .subscribe({
        next: (t) => {
          this.guardando.set(false);
          const primeraVez = !this.tienda();
          this.tienda.set(t);
          this.editando.set(false);
          this.mensaje.set(
            primeraVez && t.activa
              ? '¡Listo! Tu tienda ya está publicada.'
              : t.activa ? 'Cambios guardados. Ya se ven en tu tienda.' : 'Cambios guardados. La tienda no está publicada.',
          );
          this.guardada.emit(t);
        },
        error: (err) => {
          this.guardando.set(false);
          const e = err?.error as ErrorDeCampo | undefined;
          if (e?.campo) this.errores.set({ [e.campo as Campo]: e.error });
          else this.errorGeneral.set(e?.error ?? 'No se pudo guardar. Probá de nuevo en un rato.');
        },
      });
  }

  // ------------------------------------------------------------------ QR de pago
  protected async elegirQr(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    const t = this.tienda();
    if (!archivo || !t) return;

    this.errores.update((e) => ({ ...e, qr: undefined }));
    this.subiendoQr.set(true);
    try {
      const imagen = await achicarImagen(archivo);
      this.service.subirQr(t.id, imagen).subscribe({
        next: (r) => {
          this.subiendoQr.set(false);
          this.tienda.set({ ...t, qrPagoUrl: r.qrPagoUrl });
          this.mensaje.set('QR de pago guardado.');
        },
        error: (err) => {
          this.subiendoQr.set(false);
          this.errores.update((e) => ({ ...e, qr: err?.error?.error ?? 'No se pudo subir la imagen.' }));
        },
      });
    } catch (e) {
      this.subiendoQr.set(false);
      this.errores.update((x) => ({ ...x, qr: (e as Error).message }));
    }
  }

  protected quitarQr(): void {
    const t = this.tienda();
    if (!t) return;
    this.service.quitarQr(t.id).subscribe({
      next: () => {
        this.tienda.set({ ...t, qrPagoUrl: null });
        this.mensaje.set('Sacamos el QR de pago.');
      },
      error: () => this.errores.update((e) => ({ ...e, qr: 'No se pudo sacar el QR.' })),
    });
  }

  protected valor(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
  }
}
