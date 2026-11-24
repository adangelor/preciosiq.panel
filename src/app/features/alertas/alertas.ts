import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  AVISOS,
  AVISO_POR_TIPO,
  AlertaEnBandeja,
  AlertasService,
  BandejaDeAlertas,
  ConfigAlertas,
  ConfigDeAlertasRespuesta,
  MOTIVO_DE_CIERRE,
  TipoAlerta,
  VistaPreviaAlertas,
  cifra,
  distancia,
  explicacion,
} from '../../core/alertas';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

type Vista = 'nuevas' | 'base' | 'cerradas' | 'config';

// BP-352 (24-nov-2026, bloque 5) -- Alertas: lo que cambió cerca y pide revisar un precio. Solo productos testigo, contra
// las cadenas del SEPA a un radio de cada sucursal. Cuatro vistas: lo nuevo, lo que ya pasaba cuando se prendieron (la
// línea de base, que no cuenta como sin leer), lo cerrado y la configuración (casa central). Desde el plan Pyme.
@Component({
  selector: 'app-alertas',
  standalone: true,
  imports: [RouterLink, MatIconModule, LoadingBarComponent],
  templateUrl: './alertas.html',
  styleUrls: ['../gestion/gestion.scss', './alertas.scss'],
})
export class AlertasComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly alertas = inject(AlertasService);

  protected readonly avisos = AVISOS;
  protected readonly cifra = cifra;
  protected readonly explicacion = explicacion;
  protected readonly distancia = distancia;
  protected readonly motivos = MOTIVO_DE_CIERRE;

  private cuenta = 0;
  protected readonly cargando = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly sinScript = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly vista = signal<Vista>('nuevas');
  protected readonly tipo = signal<TipoAlerta | null>(null);
  protected readonly datos = signal<BandejaDeAlertas | null>(null);

  // ---- configuración
  protected readonly cfgResp = signal<ConfigDeAlertasRespuesta | null>(null);
  protected readonly cfg = signal<ConfigAlertas | null>(null);
  protected readonly previa = signal<VistaPreviaAlertas | null>(null);
  protected readonly calculando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly todasLasCadenas = computed(() => (this.cfg()?.cadenas.length ?? 0) === 0);
  protected readonly radios = [500, 1000, 2000, 3000, 5000, 10000];

  /** Las tarjetas agrupadas por aviso, en el orden de siempre; «para revisar» va en su propio grupo, al final. */
  protected readonly grupos = computed(() => {
    const items = this.datos()?.items ?? [];
    const grupos = AVISOS.map((a) => ({
      aviso: a,
      titulo: a.titulo,
      nota: null as string | null,
      items: items.filter((i) => i.tipo === a.tipo && !i.paraRevisar),
    }));
    const revisar = items.filter((i) => i.paraRevisar);
    if (revisar.length > 0)
      grupos.push({
        aviso: { ...AVISO_POR_TIPO['te_pasaron'], tono: 'ambar', icono: 'help_outline' },
        titulo: 'Diferencia para revisar',
        nota: 'La cadena lo tiene a menos de la mitad de tu precio. Suele ser otro tamaño con el mismo código o un precio mal cargado, de ellos o tuyo.',
        items: revisar,
      });
    return grupos.filter((g) => g.items.length > 0);
  });

  protected readonly conteo = computed(() => {
    const d = this.datos();
    const porTipo: Partial<Record<TipoAlerta, { abiertas: number; nuevas: number }>> = {};
    for (const c of d?.conteos ?? []) porTipo[c.tipo] = { abiertas: c.abiertas, nuevas: c.nuevas };
    return porTipo;
  });

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) {
          this.cargando.set(false);
          this.sinCuenta.set(true);
          return;
        }
        this.cuenta = g.businessAccountId;
        this.cargar(true);
      },
      error: () => {
        this.cargando.set(false);
        this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  /** Lee la vista actual. La primera vez, si no hay nada nuevo y sí línea de base, arranca mostrando eso. */
  private cargar(primera = false): void {
    const v = this.vista();
    if (v === 'config') return;
    this.cargando.set(true);
    this.error.set(null);
    this.alertas
      .bandeja(this.cuenta, { tipo: this.tipo(), cerradas: v === 'cerradas', lineaDeBase: v === 'cerradas' ? null : v === 'base', porPagina: 200 })
      .subscribe({
        next: (d) => {
          this.cargando.set(false);
          this.datos.set(d);
          if (primera && d.nuevas === 0 && d.abiertas > 0) {
            this.vista.set('base');
            this.cargar();
          }
        },
        error: (e: HttpErrorResponse) => this.fallo(e, 'No pudimos leer las alertas. Probá recargar la página.'),
      });
  }

  private fallo(e: HttpErrorResponse, texto: string): void {
    this.cargando.set(false);
    this.calculando.set(false);
    this.guardando.set(false);
    if (e.status === 402) this.sinPlan.set(true);
    else if (e.status === 503) this.sinScript.set(true);
    else this.error.set((e.error as { error?: string } | null)?.error ?? texto);
  }

  protected irA(v: Vista): void {
    if (this.vista() === v) return;
    this.vista.set(v);
    this.tipo.set(null);
    this.aviso.set(null);
    if (v === 'config') this.cargarConfig();
    else this.cargar();
  }

  protected filtrar(t: TipoAlerta | null): void {
    this.tipo.set(this.tipo() === t ? null : t);
    this.cargar();
  }

  protected marcarTodo(): void {
    this.alertas.marcarLeidas(this.cuenta, this.tipo()).subscribe({
      next: () => this.cargar(),
      error: (e: HttpErrorResponse) => this.fallo(e, 'No pudimos marcarlas como leídas.'),
    });
  }

  protected marcar(a: AlertaEnBandeja): void {
    if (a.leida || a.lineaDeBase || a.cerradaAt) return;
    this.alertas.marcarLeidas(this.cuenta, null, [a.id]).subscribe({
      next: () => this.datos.update((d) => (d ? { ...d, sinLeer: Math.max(0, d.sinLeer - 1), items: d.items.map((i) => (i.id === a.id ? { ...i, leida: true } : i)) } : d)),
      error: () => {},
    });
  }

  protected nombreDeAviso(t: TipoAlerta): string {
    return AVISO_POR_TIPO[t].titulo;
  }

  protected fecha(iso: string | null | undefined): string {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  // ------------------------------------------------------------------------------------------------ configuración

  private cargarConfig(): void {
    this.cargando.set(true);
    this.previa.set(null);
    this.alertas.config(this.cuenta).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.cfgResp.set(r);
        this.cfg.set({ ...r.config, cadenas: [...r.config.cadenas] });
      },
      error: (e: HttpErrorResponse) => this.fallo(e, 'No pudimos leer la configuración.'),
    });
  }

  protected tieneElPlan(t: TipoAlerta): boolean {
    return this.cfgResp()?.tiposDelPlan.includes(t) ?? true;
  }

  protected prendido(t: TipoAlerta): boolean {
    const c = this.cfg();
    if (!c) return false;
    return { te_pasaron: c.tePasaron, se_acercan: c.seAcercan, oferta: c.oferta, caro: c.caro, regalado: c.regalado, mayorista: c.mayorista }[t];
  }

  protected alternar(t: TipoAlerta): void {
    const clave = ({ te_pasaron: 'tePasaron', se_acercan: 'seAcercan', oferta: 'oferta', caro: 'caro', regalado: 'regalado', mayorista: 'mayorista' } as const)[t];
    this.cambiar({ [clave]: !this.prendido(t) } as Partial<ConfigAlertas>);
  }

  /** El umbral de un aviso (los que tienen): su clave, valor y la frase con el número adentro. */
  protected umbral(t: TipoAlerta): { clave: keyof ConfigAlertas; valor: number; antes: string; despues: string; min: number; max: number; paso: number } | null {
    const c = this.cfg();
    if (!c) return null;
    switch (t) {
      case 'se_acercan':
        return { clave: 'seAcercanPct', valor: c.seAcercanPct, antes: 'Avisarme cuando quede a menos de', despues: '% por encima de mi precio', min: 0.5, max: 20, paso: 0.5 };
      case 'oferta':
        return { clave: 'ofertaPct', valor: c.ofertaPct, antes: 'Avisarme cuando el descuento sea de', despues: '% o más', min: 5, max: 90, paso: 5 };
      case 'caro':
        return { clave: 'caroPct', valor: c.caroPct, antes: 'Avisarme cuando supere la mediana por más de', despues: '%', min: 3, max: 100, paso: 1 };
      case 'regalado':
        return { clave: 'regaladoPct', valor: c.regaladoPct, antes: 'Avisarme cuando esté más de', despues: '% por debajo de la más barata', min: 3, max: 90, paso: 1 };
      default:
        return null;
    }
  }

  protected onUmbral(clave: keyof ConfigAlertas, ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value.replace(',', '.'));
    if (Number.isFinite(v)) this.cambiar({ [clave]: v } as Partial<ConfigAlertas>);
  }

  protected onRadio(ev: Event): void {
    this.cambiar({ radioMetros: Number((ev.target as HTMLSelectElement).value) });
  }

  protected usarTodas(todas: boolean): void {
    // Al pasar a "elegir", arrancan tildadas las que hoy entran en el radio.
    const enRadio = (this.cfgResp()?.cadenas ?? []).filter((b) => b.metros <= (this.cfg()?.radioMetros ?? 0)).map((b) => b.clave);
    this.cambiar({ cadenas: todas ? [] : enRadio });
  }

  protected elegida(clave: string): boolean {
    return this.cfg()?.cadenas.includes(clave) ?? false;
  }

  protected alternarCadena(clave: string): void {
    const actuales = this.cfg()?.cadenas ?? [];
    this.cambiar({ cadenas: actuales.includes(clave) ? actuales.filter((c) => c !== clave) : [...actuales, clave] });
  }

  private cambiar(parcial: Partial<ConfigAlertas>): void {
    this.cfg.update((c) => (c ? { ...c, ...parcial } : c));
    this.previa.set(null);
    this.aviso.set(null);
  }

  protected restaurar(): void {
    const d = this.cfgResp()?.defecto;
    if (d) this.cambiar({ ...d, cadenas: [] });
  }

  protected verVistaPrevia(): void {
    const c = this.cfg();
    if (!c) return;
    this.calculando.set(true);
    this.error.set(null);
    this.alertas.vistaPrevia(this.cuenta, c).subscribe({
      next: (p) => {
        this.calculando.set(false);
        this.previa.set(p);
      },
      error: (e: HttpErrorResponse) => this.fallo(e, 'No pudimos calcular la vista previa.'),
    });
  }

  protected totalPrevia(): number {
    return Object.values(this.previa()?.porTipo ?? {}).reduce((a, b) => a + b, 0);
  }

  protected guardar(): void {
    const c = this.cfg();
    if (!c) return;
    this.guardando.set(true);
    this.error.set(null);
    this.alertas.guardarConfig(this.cuenta, c).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.cfg.set({ ...r.config, cadenas: [...r.config.cadenas] });
        this.aviso.set('Guardado. Los cambios se ven en la próxima revisión de la madrugada.');
      },
      error: (e: HttpErrorResponse) => this.fallo(e, 'No pudimos guardar la configuración.'),
    });
  }
}
