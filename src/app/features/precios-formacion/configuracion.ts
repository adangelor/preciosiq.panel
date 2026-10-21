import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensajeDeError, numeroONull } from '../../core/articulos-form';
import { FormacionService } from '../../core/formacion';
import { ejemploDeConfiguracion } from '../../core/formacion-form';
import { BaseMargen, ConfiguracionDePrecios, RedondeoModo } from '../../core/formacion.models';
import { GestionContextoService } from '../../core/gestion-contexto';

// BP-181 (21-oct-2026) -- Precios → Formación de precios → Configuración: el margen por defecto de la cuenta (el que vale
// cuando ni el artículo ni su rubro tienen uno), si el margen es sobre el costo o sobre el precio, el redondeo y cuánto
// puede alejarse el sugerido de la competencia antes de avisar. Con un ejemplo vivo de la cuenta.
@Component({
  selector: 'app-formacion-configuracion',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="gestion card--page">
      <p><a routerLink="/precios/formacion">← Formación de precios</a></p>
      <h1>Configuración de la formación de precios</h1>
      <p class="subtitle">
        El margen de cada artículo sale de su ficha; si no tiene, del rubro (o del rubro de arriba); si tampoco, el de
        acá. Los márgenes por rubro se cargan en <a routerLink="/gestion/rubros">Rubros</a>.
      </p>

      @if (cargando()) {
        <p class="muted">Cargando…</p>
      } @else if (sinPlan()) {
        <div class="alert alert--info">
          <span>La formación de precios viene con los planes <strong>Avanzado</strong> y <strong>Cadena</strong>. <a routerLink="/plan">Ver planes →</a></span>
        </div>
      } @else if (errorCarga()) {
        <p class="alert alert--danger">{{ errorCarga() }}</p>
      } @else {
        <section class="gestion__seccion">
          <div class="gestion__grid">
            <label>
              Margen por defecto (%)
              <input type="text" inputmode="decimal" [value]="margen()" (input)="margen.set(valor($event))" />
            </label>
            <label>
              El margen es
              <select (change)="base.set($any($event.target).value)">
                <option value="sobre_costo" [selected]="base() === 'sobre_costo'">Sobre el costo (recargo)</option>
                <option value="sobre_precio" [selected]="base() === 'sobre_precio'">Sobre el precio de venta</option>
              </select>
            </label>
            <label>
              Redondear de a ($)
              <input type="text" inputmode="decimal" list="multiplos" [value]="multiplo()" (input)="multiplo.set(valor($event))" />
              <datalist id="multiplos">
                <option value="1"></option><option value="5"></option><option value="10"></option><option value="50"></option><option value="100"></option>
              </datalist>
            </label>
            <label>
              Redondeo
              <select (change)="modo.set($any($event.target).value)">
                <option value="arriba" [selected]="modo() === 'arriba'">Hacia arriba</option>
                <option value="cercano" [selected]="modo() === 'cercano'">Al más cercano</option>
              </select>
            </label>
            <label>
              Avisar si se aleja de la competencia más de (%)
              <input type="text" inputmode="decimal" [value]="aviso()" (input)="aviso.set(valor($event))" />
            </label>
            <label class="gestion__check formacion-config__en9">
              <input type="checkbox" [checked]="en9()" (change)="en9.set($any($event.target).checked)" />
              Terminar en 9 ($1.579 en vez de $1.580; de a 100, $1.590)
            </label>
          </div>
          <p class="gestion__ayuda muted">
            Sobre el costo: costo $1.000 y 30 % = $1.300 sin IVA. Sobre el precio: $1.000 / 0,70 = $1.428,57 (el 30 % del
            precio es ganancia). Si sos monotributista, el costo es con IVA y no se suma IVA otra vez.
          </p>
          <p class="formacion-config__ejemplo" aria-live="polite">{{ ejemplo() }}</p>
          @if (error()) { <p class="alert alert--danger">{{ error() }}</p> }
          @if (guardado()) { <p class="alert alert--success"><span>Guardado. Los sugeridos ya usan esta configuración.</span></p> }
          <div class="gestion__acciones">
            <button type="button" class="btn" (click)="guardar()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
            @if (!guardadaAntes()) { <span class="muted">Hoy usás los valores por defecto.</span> }
          </div>
        </section>
      }
    </div>
  `,
  styleUrls: ['../gestion/gestion.scss'],
  styles: `
    .formacion-config__ejemplo { font-weight: 600; font-size: 1.05rem; margin: 0.75rem 0 1rem; }
    .formacion-config__en9 { align-self: end; }
  `,
})
export class FormacionConfiguracionComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(FormacionService);

  protected readonly cargando = signal(true);
  protected readonly sinPlan = signal(false);
  protected readonly errorCarga = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);

  protected readonly margen = signal('30');
  protected readonly base = signal<BaseMargen>('sobre_costo');
  protected readonly multiplo = signal('10');
  protected readonly modo = signal<RedondeoModo>('arriba');
  protected readonly en9 = signal(false);
  protected readonly aviso = signal('10');
  protected readonly guardadaAntes = signal(false);

  protected readonly guardando = signal(false);
  protected readonly guardado = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Lo que hay en el formulario, o el primer error. */
  private readonly leida = computed<{ c: Omit<ConfiguracionDePrecios, 'guardada'> } | { error: string }>(() => {
    const m = numeroONull(this.margen());
    const mult = numeroONull(this.multiplo());
    const av = numeroONull(this.aviso());
    if (m == null || m < 0 || m >= 1000) return { error: 'El margen tiene que ser un número entre 0 y 999.' };
    if (this.base() === 'sobre_precio' && m >= 100) return { error: 'Con el margen sobre el precio, tiene que ser menor que 100 %.' };
    if (mult == null || mult <= 0 || mult > 10000) return { error: 'El redondeo tiene que ser un monto entre 0,01 y 10.000.' };
    if (av == null || av < 0 || av > 100) return { error: 'El aviso de competencia tiene que estar entre 0 y 100 %.' };
    return {
      c: { margenDefaultPct: m, baseMargen: this.base(), redondeoMultiplo: mult, redondeoModo: this.modo(), terminarEn9: this.en9(), avisoCompetenciaPct: av },
    };
  });

  protected readonly ejemplo = computed(() => {
    const l = this.leida();
    return 'error' in l ? l.error : ejemploDeConfiguracion(l.c);
  });

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) {
          this.cargando.set(false);
          this.errorCarga.set('Todavía no tenés un comercio dado de alta.');
          return;
        }
        if (!g.formacionPrecios) {
          this.cargando.set(false);
          this.sinPlan.set(true);
          return;
        }
        this.cuenta.set(g.businessAccountId);
        this.api.configuracion(g.businessAccountId).subscribe({
          next: (c) => {
            this.cargando.set(false);
            this.poner(c);
          },
          error: (err) => {
            this.cargando.set(false);
            this.errorCarga.set(mensajeDeError(err, 'No pudimos cargar la configuración. Probá recargar la página.'));
          },
        });
      },
      error: () => {
        this.cargando.set(false);
        this.errorCarga.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  private poner(c: ConfiguracionDePrecios): void {
    const n = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 2, useGrouping: false });
    this.margen.set(n(c.margenDefaultPct));
    this.base.set(c.baseMargen);
    this.multiplo.set(n(c.redondeoMultiplo));
    this.modo.set(c.redondeoModo);
    this.en9.set(c.terminarEn9);
    this.aviso.set(n(c.avisoCompetenciaPct));
    this.guardadaAntes.set(c.guardada);
  }

  protected valor(e: Event): string {
    this.guardado.set(false);
    return (e.target as HTMLInputElement).value;
  }

  protected guardar(): void {
    const id = this.cuenta();
    const l = this.leida();
    if (id == null || this.guardando()) return;
    if ('error' in l) {
      this.error.set(l.error);
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.api.guardarConfiguracion(id, l.c).subscribe({
      next: (c) => {
        this.guardando.set(false);
        this.guardado.set(true);
        this.poner(c);
      },
      error: (err) => {
        this.guardando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos guardar la configuración. Probá de nuevo.'));
      },
    });
  }
}
