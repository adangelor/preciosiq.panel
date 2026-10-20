import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { AsistenteTienda, ErrorDeCampo, SlugDisponibilidad, TiendaConfig, TiendaDeCuenta, TiendaService, achicarImagen } from '../../core/tienda';
import { TiendaEstadisticasComponent } from './tienda-estadisticas';
import { TiendaDestacadosComponent } from './tienda-destacados';
import { TiendaCarruselComponent } from './tienda-carrusel';
import { TiendaSucursalesComponent } from './tienda-sucursales';

type Campo = 'slug' | 'nombreVisible' | 'presentacion' | 'whatsApp' | 'alias' | 'cvu' | 'qr' | 'activa';

/**
 * BP-71 -- la tienda: ver como esta, crearla o editarla, y el QR de pago. La direccion se chequea en vivo contra el
 * servidor (formato, reservados, ocupada) mientras se tipea.
 * BP-167 (19-oct-2026) -- antes era la tienda de UNA sucursal (una tarjeta por sucursal). Ahora es LA tienda de la
 * cuenta (decision de Andres: habilitar las 10 sucursales de Aiello una por una era engorroso). Las sucursales entran
 * solas y se sacan o se suman en "Sucursales en tu tienda" (TiendaSucursalesComponent), adentro de esta tarjeta.
 */
@Component({
  selector: 'app-tienda-cuenta',
  standalone: true,
  imports: [RouterLink, TiendaEstadisticasComponent, TiendaDestacadosComponent, TiendaCarruselComponent, TiendaSucursalesComponent],
  templateUrl: './tienda-cuenta.html',
  styleUrl: './mi-tienda.scss',
})
export class TiendaCuentaComponent implements OnInit {
  private readonly service = inject(TiendaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cuenta = input.required<TiendaDeCuenta>();
  readonly businessAccountId = input.required<number>();
  /** BP-72: si cada sucursal se muestra en la app BuscaPrecios (IsPublic); sin dato, no se dice nada. */
  readonly enApp = input<Partial<Record<string, boolean>>>({});

  /** Lo de GET /cuenta, actualizado con cada guardado (de la tienda o de sus sucursales). */
  protected readonly datos = signal<TiendaDeCuenta | null>(null);
  protected readonly tienda = computed(() => this.datos()?.tienda ?? null);
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

  /** BP-167 -- las sucursales que estan en la tienda (o, sin tienda todavia, las que van a entrar solas). */
  protected readonly habilitadas = computed(() => (this.datos()?.sucursales ?? []).filter((s) => s.habilitada));
  /** La sucursal en la que abre la tienda: su cartel es el de "Cartel para la vidriera". */
  protected readonly porDefecto = computed(() => {
    const d = this.datos();
    return d?.sucursales.find((s) => s.branchId === d.sucursalPorDefecto) ?? null;
  });
  /**
   * BP-167 -- una cuenta de UNA sucursal sin ubicacion (o sin productos) no entraria sola: como antes de BP-167, el alta
   * la mete a mano (manda su branchId). Con varias, el comercio elige despues cuales suma.
   */
  protected readonly sucursalDelAlta = computed(() => {
    const d = this.datos();
    if (!d || d.tienda || this.habilitadas().length > 0 || d.sucursales.length !== 1) return null;
    return d.sucursales[0].branchId;
  });
  /** Sin tienda, con varias sucursales y ninguna que entre sola: no se puede publicar todavia. */
  protected readonly sinSucursalesParaPublicar = computed(
    () => !this.tienda() && this.habilitadas().length === 0 && !this.sucursalDelAlta(),
  );

  private readonly slug$ = new Subject<string>();

  // ---- BP-175 (20-oct-2026): el asistente de compra con IA
  protected readonly asistente = signal<AsistenteTienda | null>(null);
  protected readonly asistenteGuardando = signal(false);
  protected readonly asistenteError = signal<string | null>(null);

  private cargarAsistente(): void {
    const t = this.tienda();
    if (!t) return;
    this.service.asistente(t.id).subscribe({ next: (a) => this.asistente.set(a), error: () => this.asistente.set(null) });
  }

  protected cambiarAsistente(activo: boolean): void {
    const t = this.tienda();
    const a = this.asistente();
    if (!t || !a) return;
    this.asistenteGuardando.set(true);
    this.asistenteError.set(null);
    this.service.guardarAsistente(t.id, activo).subscribe({
      next: (r) => {
        this.asistenteGuardando.set(false);
        this.asistente.set({ ...a, activo: r.activo });
        this.mensaje.set(r.activo ? 'Asistente prendido. Ya aparece en tu tienda.' : 'Asistente apagado.');
      },
      error: (err) => {
        this.asistenteGuardando.set(false);
        this.asistenteError.set(
          err?.status === 402
            ? 'El asistente está disponible desde el plan Avanzado.'
            : (err?.error?.error ?? 'No se pudo guardar. Probá de nuevo en un rato.'),
        );
      },
    });
  }

  ngOnInit(): void {
    this.datos.set(this.cuenta());
    this.cargarAsistente();

    // Primero se suscribe y DESPUES se abre el editor: abrirEditor() manda el slug sugerido por slug$,
    // y si nadie escucha todavia el chequeo inicial se pierde (el campo quedaba sin "Disponible").
    this.slug$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((s) => {
          this.chequeandoSlug.set(true);
          return this.service.chequearSlug(this.businessAccountId(), s).pipe(catchError(() => of(null)));
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
    const d = this.datos()!;
    this.slug.set(t?.slug ?? d.slugSugerido);
    this.nombre.set(t?.nombreVisible ?? d.nombreSugerido);
    this.presentacion.set(t?.presentacion ?? '');
    this.whatsApp.set(t?.whatsApp ?? '');
    this.alias.set(t?.alias ?? '');
    this.cvu.set(t?.cvu ?? '');
    this.mostrarDomicilio.set(t?.mostrarDomicilio ?? true);
    // BP-167: sin ninguna sucursal para abrir, el alta arranca sin publicar (si no, el servidor contesta 400 en "activa").
    this.activa.set(t?.activa ?? !this.sinSucursalesParaPublicar());
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
    const primeraVez = !this.tienda();
    this.service
      .guardar({
        businessAccountId: this.businessAccountId(),
        ...(primeraVez && this.sucursalDelAlta() ? { branchId: this.sucursalDelAlta() } : {}),
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
          this.datos.update((d) => (d ? { ...d, tienda: t } : d));
          this.editando.set(false);
          this.mensaje.set(
            primeraVez && t.activa
              ? '¡Listo! Tu tienda ya está publicada.'
              : t.activa ? 'Cambios guardados. Ya se ven en tu tienda.' : 'Cambios guardados. La tienda no está publicada.',
          );
          // En el alta, las sucursales quedan como las armo el servidor (la principal, la que abre): se vuelven a pedir.
          if (primeraVez) {
            this.refrescar();
            this.cargarAsistente();
          }
        },
        error: (err) => {
          this.guardando.set(false);
          const e = err?.error as ErrorDeCampo | undefined;
          if (e?.campo) this.errores.set({ [e.campo as Campo]: e.error });
          else this.errorGeneral.set(e?.error ?? 'No se pudo guardar. Probá de nuevo en un rato.');
        },
      });
  }

  private refrescar(): void {
    this.service.cuenta(this.businessAccountId()).subscribe({ next: (d) => this.datos.set(d), error: () => {} });
  }

  /** BP-167 -- lo que devolvio PUT /sucursales. */
  protected sucursalesGuardadas(d: TiendaDeCuenta): void {
    this.datos.set(d);
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
          this.cambiarTienda({ qrPagoUrl: r.qrPagoUrl });
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
        this.cambiarTienda({ qrPagoUrl: null });
        this.mensaje.set('Sacamos el QR de pago.');
      },
      error: () => this.errores.update((e) => ({ ...e, qr: 'No se pudo sacar el QR.' })),
    });
  }

  private cambiarTienda(cambio: Partial<TiendaConfig>): void {
    this.datos.update((d) => (d?.tienda ? { ...d, tienda: { ...d.tienda, ...cambio } } : d));
  }

  protected valor(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
  }
}
