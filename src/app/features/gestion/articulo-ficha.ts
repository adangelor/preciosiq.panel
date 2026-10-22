import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArticulosService } from '../../core/articulos';
import { avisoDeCodigo, margenDeRubro, mensajeDeError, numeroONull, opcionesDeRubro, plata, porcentaje } from '../../core/articulos-form';
import { ALICUOTAS_IVA, ArticuloFicha, ArticuloGuardarRequest, Proveedor, Rubro, TipoDeCodigo } from '../../core/articulos.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

const ORIGENES: Record<string, string> = {
  csv: 'Planilla',
  panel: 'Cargado a mano',
  ingreso: 'Recepción sin orden',
  ajuste_masivo: 'Ajuste masivo',
  // BP-180: la recepción o la factura del proveedor, y su lista de costos.
  compra: 'Compra',
  lista_proveedor: 'Lista del proveedor',
};

// BP-178 (21-oct-2026) -- la ficha de un artículo (/gestion/articulos/:id, y /gestion/articulos/nuevo para el alta).
// Los datos maestros (descripción, marca, presentación) son de la cuenta: al guardarlos se llevan a todas las
// sucursales donde el artículo tiene precio. El código no se cambia después del alta.
@Component({
  selector: 'app-articulo-ficha',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, LoadingBarComponent],
  templateUrl: './articulo-ficha.html',
  styleUrl: './gestion.scss',
})
export class ArticuloFichaComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ArticulosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);

  protected readonly id = signal<number | null>(null);
  protected readonly esNuevo = computed(() => this.id() == null);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly ficha = signal<ArticuloFicha | null>(null);
  protected readonly rubros = signal<Rubro[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly alicuotas = ALICUOTAS_IVA;

  protected readonly form = this.fb.nonNullable.group({
    codigo: [''],
    sinCodigoDeBarras: [false],
    codigoInterno: [''],
    descripcion: ['', [Validators.required, Validators.maxLength(300)]],
    marca: [''],
    presentacionCantidad: [''],
    presentacionUnidad: ['UN'],
    rubroId: [''],
    proveedorHabitualId: [''],
    ivaAlicuota: ['21'],
    impuestosInternosPct: [''],
    unidadesPorBulto: [''],
    margenObjetivoPct: [''],
  });

  // Códigos extra
  protected readonly nuevoCodigo = signal('');
  protected readonly nuevoTipo = signal<TipoDeCodigo>('alternativo');
  protected readonly nuevoFactor = signal('');
  protected readonly errorCodigo = signal<string | null>(null);

  // Costo
  protected readonly costoNeto = signal('');
  protected readonly costoConIva = signal('');
  protected readonly costoDesde = signal('');
  protected readonly errorCosto = signal<string | null>(null);

  protected readonly opcionesRubro = computed(() => {
    const f = this.ficha();
    return opcionesDeRubro(this.rubros(), f?.articulo.rubroId ?? null);
  });
  protected readonly rubroElegido = signal<number | null>(null);
  protected readonly margenDelRubro = computed(() => {
    const r = this.rubros().find((x) => x.id === this.rubroElegido());
    return r ? margenDeRubro(r) : null;
  });

  protected readonly plata = plata;
  protected readonly porcentaje = porcentaje;

  ngOnInit(): void {
    const param = this.route.snapshot.paramMap.get('id');
    this.id.set(param && param !== 'nuevo' ? Number(param) : null);
    this.form.controls.rubroId.valueChanges.subscribe((v) => this.rubroElegido.set(v ? Number(v) : null));

    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.gestionArticulos) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.api.rubros(g.businessAccountId).subscribe({ next: (r) => this.rubros.set(r), error: () => {} });
        this.api.proveedores(g.businessAccountId).subscribe({ next: (p) => this.proveedores.set(p), error: () => {} });
        if (this.id() != null) this.cargar();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  private cargar(): void {
    const cuenta = this.cuenta();
    const id = this.id();
    if (cuenta == null || id == null) return;
    this.cargando.set(true);
    this.api.ficha(cuenta, id).subscribe({
      next: (f) => {
        this.cargando.set(false);
        this.mostrar(f);
      },
      error: (err) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos cargar el artículo.'));
      },
    });
  }

  private mostrar(f: ArticuloFicha): void {
    this.ficha.set(f);
    const a = f.articulo;
    const txt = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));
    this.form.reset({
      codigo: a.codigo,
      sinCodigoDeBarras: !a.esEan,
      codigoInterno: a.codigoInterno ?? '',
      descripcion: a.descripcion,
      marca: a.marca ?? '',
      presentacionCantidad: txt(a.presentacionCantidad),
      presentacionUnidad: a.presentacionUnidad ?? '',
      rubroId: a.rubroId != null ? String(a.rubroId) : '',
      proveedorHabitualId: a.proveedorHabitualId != null ? String(a.proveedorHabitualId) : '',
      ivaAlicuota: String(a.ivaAlicuota),
      impuestosInternosPct: txt(f.impuestosInternosPct),
      unidadesPorBulto: txt(f.unidadesPorBulto),
      margenObjetivoPct: txt(f.margenPropioPct),
    });
  }

  /** Aviso del código antes de mandar (el backend dice lo mismo). */
  protected avisoCodigo(): string | null {
    return this.esNuevo() && !this.form.controls.sinCodigoDeBarras.value ? avisoDeCodigo(this.form.controls.codigo.value) : null;
  }

  private pedido(cuenta: number): ArticuloGuardarRequest {
    const v = this.form.getRawValue();
    const txt = (s: string) => (s.trim() ? s.trim() : null);
    return {
      businessAccountId: cuenta,
      codigo: this.esNuevo() ? v.codigo.trim() : null,
      codigoInterno: txt(v.codigoInterno),
      descripcion: v.descripcion.trim(),
      marca: txt(v.marca),
      presentacionCantidad: numeroONull(v.presentacionCantidad),
      presentacionUnidad: txt(v.presentacionUnidad),
      rubroId: v.rubroId ? Number(v.rubroId) : null,
      proveedorHabitualId: v.proveedorHabitualId ? Number(v.proveedorHabitualId) : null,
      ivaAlicuota: Number(v.ivaAlicuota),
      impuestosInternosPct: numeroONull(v.impuestosInternosPct),
      unidadesPorBulto: numeroONull(v.unidadesPorBulto),
      margenObjetivoPct: numeroONull(v.margenObjetivoPct),
      activo: this.ficha()?.articulo.activo ?? true,
    };
  }

  protected guardar(): void {
    const cuenta = this.cuenta();
    if (cuenta == null || this.guardando()) return;
    if (this.esNuevo() && !this.form.controls.codigo.value.trim()) {
      this.error.set('Falta el código: el de barras, o el código interno si no tiene.');
      return;
    }
    const codigo = this.form.controls.codigo.value.trim();
    if (this.esNuevo() && this.form.controls.sinCodigoDeBarras.value && /^\d+$/.test(codigo) && [8, 12, 13, 14].includes(codigo.length)) {
      this.error.set(`Un código interno no puede tener ${codigo.length} números: se confundiría con un código de barras.`);
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Falta la descripción.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    const req = this.pedido(cuenta);
    const op = this.esNuevo() ? this.api.crear(req) : this.api.editar(this.id()!, req);
    op.subscribe({
      next: (r) => {
        this.guardando.set(false);
        const enSucursales = r.sucursalesActualizadas > 0
          ? ` Se actualizó en ${r.sucursalesActualizadas} ${r.sucursalesActualizadas === 1 ? 'sucursal' : 'sucursales'}.`
          : '';
        if (this.esNuevo()) {
          this.id.set(r.ficha.articulo.id);
          this.router.navigate(['/gestion/articulos', r.ficha.articulo.id], { replaceUrl: true });
        }
        this.mostrar(r.ficha);
        this.aviso.set(`Artículo guardado.${enSucursales}`);
      },
      error: (err) => {
        this.guardando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos guardar el artículo. Probá de nuevo.'));
      },
    });
  }

  protected alternarActivo(): void {
    const cuenta = this.cuenta();
    const f = this.ficha();
    if (cuenta == null || !f) return;
    if (f.articulo.activo) {
      if (!window.confirm('¿Desactivar este artículo? No se borra nada ni cambian sus precios en las sucursales.')) return;
      this.guardando.set(true);
      this.api.desactivar(cuenta, f.articulo.id).subscribe({
        next: () => { this.guardando.set(false); this.cargar(); this.aviso.set('Artículo desactivado.'); },
        error: (err) => { this.guardando.set(false); this.error.set(mensajeDeError(err, 'No pudimos desactivarlo.')); },
      });
    } else {
      this.guardando.set(true);
      this.api.editar(f.articulo.id, { ...this.pedido(cuenta), activo: true }).subscribe({
        next: (r) => { this.guardando.set(false); this.mostrar(r.ficha); this.aviso.set('Artículo activado.'); },
        error: (err) => { this.guardando.set(false); this.error.set(mensajeDeError(err, 'No pudimos activarlo.')); },
      });
    }
  }

  // ---- códigos extra ----
  protected onNuevoCodigo(e: Event): void { this.nuevoCodigo.set((e.target as HTMLInputElement).value); }
  protected onNuevoTipo(e: Event): void { this.nuevoTipo.set((e.target as HTMLSelectElement).value as TipoDeCodigo); }
  protected onNuevoFactor(e: Event): void { this.nuevoFactor.set((e.target as HTMLInputElement).value); }

  protected agregarCodigo(): void {
    const cuenta = this.cuenta();
    const f = this.ficha();
    if (cuenta == null || !f) return;
    const codigo = this.nuevoCodigo().trim();
    if (!codigo) { this.errorCodigo.set('Escribí o escaneá el código.'); return; }
    const factor = this.nuevoTipo() === 'bulto' ? numeroONull(this.nuevoFactor()) ?? f.unidadesPorBulto : null;
    this.errorCodigo.set(null);
    this.api.agregarCodigo(cuenta, f.articulo.id, codigo, this.nuevoTipo(), factor).subscribe({
      next: () => { this.nuevoCodigo.set(''); this.nuevoFactor.set(''); this.cargar(); },
      error: (err) => this.errorCodigo.set(mensajeDeError(err, 'No pudimos agregar el código.')),
    });
  }

  protected quitarCodigo(codigoId: number): void {
    const cuenta = this.cuenta();
    const f = this.ficha();
    if (cuenta == null || !f) return;
    this.api.quitarCodigo(cuenta, f.articulo.id, codigoId).subscribe({
      next: () => this.cargar(),
      error: (err) => this.errorCodigo.set(mensajeDeError(err, 'No pudimos quitar el código.')),
    });
  }

  // ---- costo ----
  protected onCostoNeto(e: Event): void { this.costoNeto.set((e.target as HTMLInputElement).value); }
  protected onCostoConIva(e: Event): void { this.costoConIva.set((e.target as HTMLInputElement).value); }
  protected onCostoDesde(e: Event): void { this.costoDesde.set((e.target as HTMLInputElement).value); }

  protected cargarCosto(): void {
    const cuenta = this.cuenta();
    const f = this.ficha();
    if (cuenta == null || !f) return;
    const neto = numeroONull(this.costoNeto());
    if (neto == null || neto <= 0) { this.errorCosto.set('Poné el costo sin IVA (mayor a cero).'); return; }
    this.errorCosto.set(null);
    this.api.cargarCosto(f.articulo.id, {
      businessAccountId: cuenta, costoNeto: neto, costoConIva: numeroONull(this.costoConIva()),
      proveedor: null, zonaId: null, vigenteDesde: this.costoDesde() || null,
    }).subscribe({
      next: () => { this.costoNeto.set(''); this.costoConIva.set(''); this.costoDesde.set(''); this.cargar(); this.aviso.set('Costo cargado.'); },
      error: (err) => this.errorCosto.set(mensajeDeError(err, 'No pudimos cargar el costo.')),
    });
  }

  protected origen(o: string): string {
    return ORIGENES[o] ?? o;
  }

  protected volver(): void {
    this.router.navigate(['/gestion/articulos']);
  }
}
