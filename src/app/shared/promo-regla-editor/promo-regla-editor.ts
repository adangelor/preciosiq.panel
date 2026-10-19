import { Component, DestroyRef, DoCheck, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { esPesable } from '../../core/business-price.models';
import {
  ATAJOS_PROMO,
  AtajoPromo,
  PromoReglaGrupo,
  PromoReglaValores,
  filasVistaPrevia,
  hoyIso,
  plata,
  reglaDesdeValores,
  valoresAlCambiarTipo,
} from '../../core/promo-regla-form';

// BP-169 (19-oct-2026) -- el selector de la promo de UN producto, con vista previa. Lo usan "Cargar precio"
// (features/price-upsert) y las promos "para confirmar" de la carga masiva (shared/promos-para-confirmar).
// Antes era la seccion Promo de price-upsert (BP-38) con "NxM" y "N-ésima" y el minimo aparte; ahora dice
// "Llevando X pagás Y" y "La 2da con descuento", el minimo de esas dos sale solo, hay atajos (2x1, 3x2, 2da al 50 %)
// y la vista previa muestra varias cantidades con la misma calculadora que cobra la caja.
//
// No sabe de sucursales ni de "aplicar a todas" (BP-40): eso lo pone la pantalla que lo usa, alrededor.
@Component({
  selector: 'app-promo-regla-editor',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './promo-regla-editor.html',
  styleUrl: './promo-regla-editor.scss',
})
export class PromoReglaEditorComponent implements OnInit, DoCheck {
  /** El grupo del formulario (core/promo-regla-form: crearGrupoPromo, o uno con los mismos controles). */
  readonly grupo = input.required<PromoReglaGrupo>();
  readonly listPrice = input<number | null>(null);
  readonly unidad = input<string | null>(null);
  /** Leyenda: en "Cargar precio" sí; en las "para confirmar" también (el cartel). */
  readonly conLeyenda = input(true);

  private readonly destroyRef = inject(DestroyRef);
  protected readonly atajos = ATAJOS_PROMO;

  // Los valores del grupo como signal. Por DoCheck y no por valueChanges: las pantallas cargan la regla con
  // emitEvent:false (para no marcarla como tocada) y la vista previa tiene que verla igual.
  private readonly valores = signal<PromoReglaValores | null>(null);
  private ultimo = '';

  protected readonly pesable = computed(() => esPesable(this.unidad()));
  protected readonly tipo = computed(() => this.valores()?.tipo ?? '');

  private readonly armado = computed(() => {
    const v = this.valores();
    if (!v) return { regla: null, error: null as string | null };
    try {
      return { regla: reglaDesdeValores(v, this.listPrice(), this.unidad()), error: null };
    } catch (e) {
      return { regla: null, error: (e as Error).message };
    }
  });
  protected readonly error = computed(() => this.armado().error);
  protected readonly filas = computed(() => filasVistaPrevia(this.armado().regla, this.listPrice(), hoyIso()));
  /** El mínimo de un NxM / N-ésima que no es el del grupo (una regla vieja, cargada así): se avisa. */
  protected readonly minimoRaro = computed(() => {
    const v = this.valores();
    if (!v) return null;
    const n = v.tipo === 'n_x_m' ? v.grupoN : v.tipo === 'enesima_porcentaje' ? v.cadaN : null;
    return n != null && v.min != null && v.min > n ? v.min : null;
  });

  ngOnInit(): void {
    const c = this.grupo().controls;
    // Defaults al cambiar de tipo (solo cuando lo cambia la persona: las cargas van con emitEvent:false).
    c.tipo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.grupo().patchValue(valoresAlCambiarTipo(this.grupo().getRawValue()), { emitEvent: false });
    });
    // Con "llevando X pagás Y" y "la 2da con descuento" el mínimo es X / la unidad: no se pide aparte.
    c.grupoN.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      if (c.tipo.value === 'n_x_m' && n != null) c.min.setValue(n, { emitEvent: false });
    });
    c.cadaN.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      if (c.tipo.value === 'enesima_porcentaje' && n != null) c.min.setValue(Number(n), { emitEvent: false });
    });
  }

  ngDoCheck(): void {
    const v = this.grupo().getRawValue();
    const clave = JSON.stringify(v);
    if (clave !== this.ultimo) {
      this.ultimo = clave;
      this.valores.set(v);
    }
  }

  protected usarAtajo(a: AtajoPromo): void {
    if (this.pesable()) return;
    const g = this.grupo();
    g.patchValue({ precio: null, max: null, ...a.valores });
    g.markAsDirty();
  }

  protected atajoActivo(a: AtajoPromo): boolean {
    const v = this.valores();
    if (!v) return false;
    return (Object.keys(a.valores) as (keyof PromoReglaValores)[]).every((k) => String(v[k] ?? '') === String(a.valores[k] ?? ''));
  }

  protected plata(n: number): string {
    return plata(n);
  }
}
