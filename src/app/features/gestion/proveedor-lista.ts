import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { mensajeDeError } from '../../core/articulos-form';
import {
  ArticuloDeProveedor, COLUMNAS_LISTA, ColumnaLista, ComprasService, ImportarListaResponse, ListaDeProveedor, MapeoLista,
  ProveedorFicha, RenglonListaProveedor, adivinarColumnas, cuitConGuiones, importeAr, leerListaDeProveedor, textoCondicion,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';
import { ArticuloBuscadorComponent, ArticuloElegido } from '../gestion-stock/articulo-buscador';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

const ORIGENES: Record<string, string> = {
  lista_proveedor: 'lista del proveedor', compra: 'compra', csv: 'planilla', panel: 'a mano', ingreso: 'ingreso', ajuste_masivo: 'ajuste masivo',
};

/** Lo que se tipea en "Agregar o cambiar un artículo". */
interface Suelto {
  codigo: string;
  descripcion: string | null;
  codigoProveedor: string;
  unidadesPorBulto: string;
  costo: string;
  bonificacion: string;
  porBulto: boolean;
  aplicar: boolean;
}

const SUELTO_VACIO: Suelto = {
  codigo: '', descripcion: null, codigoProveedor: '', unidadesPorBulto: '', costo: '', bonificacion: '', porBulto: false, aplicar: true,
};

// BP-180 (22-oct-2026) -- la lista de un proveedor (PROMPT_BP180_Compras_22oct.md, bloque 2): por artículo, el código
// que usa el proveedor, cuántas unidades trae el bulto, el costo sin IVA y la bonificación, con el costo vigente de la
// cuenta al lado. Se carga de a uno o importando la planilla que manda el proveedor (columnas adivinadas por el
// encabezado, que el comercio puede corregir), primero con "Ver qué cambia" y después "Importar". Si el comercio lo
// pide, los costos que cambian pasan a ser el costo vigente (origen "lista del proveedor") y el proveedor pasa a ser el
// habitual de los artículos que todavía no tienen uno.
@Component({
  selector: 'app-proveedor-lista',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent, ArticuloBuscadorComponent],
  templateUrl: './proveedor-lista.html',
  styleUrl: './gestion.scss',
})
export class ProveedorListaComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly proveedorId = signal<number>(0);
  protected readonly proveedor = signal<ProveedorFicha | null>(null);

  // ---- la lista
  protected readonly cargando = signal(false);
  protected readonly lista = signal<ListaDeProveedor | null>(null);
  protected readonly q = signal('');
  protected readonly pagina = signal(1);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly trabajando = signal(false);
  private readonly busqueda = new Subject<void>();
  protected readonly paginas = computed(() => {
    const l = this.lista();
    return l ? Math.max(1, Math.ceil(l.total / l.pageSize)) : 1;
  });

  // ---- un artículo suelto
  protected readonly suelto = signal<Suelto>({ ...SUELTO_VACIO });
  protected readonly errorSuelto = signal<string | null>(null);

  // ---- importar la planilla
  protected readonly columnas = COLUMNAS_LISTA;
  protected readonly archivo = signal<string | null>(null);
  private readonly filas = signal<unknown[][]>([]);
  protected readonly encabezados = computed(() => (this.filas()[0] ?? []).map((c, i) => String(c ?? '').trim() || `Columna ${i + 1}`));
  protected readonly mapeo = signal<MapeoLista>({ codigo: null, codigoProveedor: null, descripcion: null, costo: null, bonificacionPct: null, unidadesPorBulto: null });
  protected readonly renglones = computed<RenglonListaProveedor[]>(() => (this.filas().length > 1 ? leerListaDeProveedor(this.filas(), this.mapeo()) : []));
  protected readonly costoPorBulto = signal(false);
  protected readonly aplicarCostos = signal(true);
  protected readonly marcarHabitual = signal(true);
  protected readonly previa = signal<ImportarListaResponse | null>(null);
  protected readonly errorPlanilla = signal<string | null>(null);

  protected readonly cuitConGuiones = cuitConGuiones;
  protected readonly textoCondicion = textoCondicion;

  ngOnInit(): void {
    this.proveedorId.set(Number(this.route.snapshot.paramMap.get('id')) || 0);
    this.busqueda.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.pagina.set(1); this.cargarLista(); });
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.compras) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.api.proveedor(g.businessAccountId, this.proveedorId()).subscribe({
          next: (p) => { this.proveedor.set(p); this.cargarLista(); },
          error: (err) => this.errorCuenta.set(err instanceof HttpErrorResponse && err.status === 404
            ? 'Ese proveedor no existe en tu cuenta.'
            : mensajeDeError(err, 'No pudimos cargar el proveedor.')),
        });
      },
      error: () => { this.cargandoCuenta.set(false); this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  protected cargarLista(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargando.set(true);
    this.api.lista(id, this.proveedorId(), this.q(), this.pagina()).subscribe({
      next: (l) => { this.cargando.set(false); this.lista.set(l); },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar la lista del proveedor.')); },
    });
  }

  protected buscar(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
    this.busqueda.next();
  }

  protected irA(p: number): void {
    this.pagina.set(p);
    this.cargarLista();
  }

  protected plata(n: number | null): string { return n == null ? '—' : plata.format(n); }
  protected cant(n: number | null): string { return n == null ? '—' : num.format(n); }
  /** "+12,5 %" o "-3 %". */
  protected pct(n: number): string { return `${n > 0 ? '+' : ''}${num.format(n)} %`; }
  protected origen(o: string | null): string { return o ? ORIGENES[o] ?? o : ''; }
  protected fecha(iso: string | null): string {
    if (!iso) return '';
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  /** Cuánto cambia el costo de la lista contra el vigente de la cuenta (en %), o null. */
  protected variacion(a: ArticuloDeProveedor): number | null {
    if (a.costoFinal == null || a.costoVigente == null || a.costoVigente === 0) return null;
    const v = ((a.costoFinal - a.costoVigente) / a.costoVigente) * 100;
    return Math.abs(v) < 0.05 ? 0 : Math.round(v * 10) / 10;
  }

  protected quitar(a: ArticuloDeProveedor): void {
    const id = this.cuenta();
    if (id == null || this.trabajando()) return;
    this.trabajando.set(true);
    this.api.quitarArticulo(id, this.proveedorId(), a.articuloId).subscribe({
      next: () => { this.trabajando.set(false); this.aviso.set(`«${a.descripcion}» salió de la lista.`); this.cargarLista(); },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos sacar el artículo.')); },
    });
  }

  // ------------------------------------------------------------------ un artículo suelto

  protected elegido(a: ArticuloElegido): void {
    this.errorSuelto.set(null);
    const enLista = this.lista()?.items.find((x) => x.codigo === a.codigo);
    this.suelto.set({
      ...SUELTO_VACIO,
      codigo: a.codigo,
      descripcion: a.descripcion,
      codigoProveedor: enLista?.codigoProveedor ?? '',
      unidadesPorBulto: enLista?.unidadesPorBulto != null ? String(enLista.unidadesPorBulto) : '',
      costo: enLista?.costoNeto != null ? String(enLista.costoNeto).replace('.', ',') : '',
      bonificacion: enLista?.bonificacionPct != null ? String(enLista.bonificacionPct).replace('.', ',') : '',
    });
  }

  protected editar(a: ArticuloDeProveedor): void {
    this.elegido({ codigo: a.codigo, descripcion: a.descripcion });
  }

  protected campoSuelto(nombre: keyof Suelto, e: Event): void {
    const el = e.target as HTMLInputElement;
    this.suelto.update((s) => ({ ...s, [nombre]: el.type === 'checkbox' ? el.checked : el.value }));
  }

  protected guardarSuelto(): void {
    const id = this.cuenta();
    const s = this.suelto();
    if (id == null || !s.codigo) return;
    const costo = importeAr(s.costo);
    if (costo == null || costo <= 0) { this.errorSuelto.set('Poné el costo sin IVA (mayor a cero).'); return; }
    const bulto = s.unidadesPorBulto.trim() ? importeAr(s.unidadesPorBulto) : null;
    if (s.unidadesPorBulto.trim() && (bulto == null || bulto <= 0)) { this.errorSuelto.set('Las unidades por bulto tienen que ser un número mayor a cero.'); return; }
    const bonif = s.bonificacion.trim() ? importeAr(s.bonificacion) : null;
    if (s.bonificacion.trim() && (bonif == null || bonif < 0 || bonif >= 100)) { this.errorSuelto.set('La bonificación va de 0 a 99,99 %.'); return; }
    this.trabajando.set(true);
    this.errorSuelto.set(null);
    this.api.guardarArticulo(this.proveedorId(), {
      businessAccountId: id, codigo: s.codigo, codigoProveedor: s.codigoProveedor.trim() || null, unidadesPorBulto: bulto,
      costoNeto: costo, bonificacionPct: bonif, costoPorBulto: s.porBulto, aplicarCosto: s.aplicar,
    }).subscribe({
      next: (r) => {
        this.trabajando.set(false);
        this.aviso.set(`«${s.descripcion ?? s.codigo}» guardado en la lista${r.costosCargados > 0 ? ' y como costo vigente' : ''}.`);
        this.suelto.set({ ...SUELTO_VACIO });
        this.cargarLista();
      },
      error: (err) => { this.trabajando.set(false); this.errorSuelto.set(mensajeDeError(err, 'No pudimos guardar el artículo.')); },
    });
  }

  // ------------------------------------------------------------------ importar la planilla

  protected async leerArchivo(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.errorPlanilla.set(null);
    this.previa.set(null);
    try {
      const XLSX = await import('xlsx');
      // Un CSV se lee como texto: si no, "0000000000017" se vuelve el número 17 (como el recuento de stock).
      const libro = /\.csv$/i.test(archivo.name)
        ? XLSX.read(await archivo.text(), { type: 'string', raw: true })
        : XLSX.read(await archivo.arrayBuffer());
      const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: null });
      this.cargarFilas(archivo.name, filas);
    } catch {
      this.errorPlanilla.set('No pudimos leer la planilla. Guardala como Excel (.xlsx) o CSV.');
    }
  }

  /** Separado de leerArchivo para poder probarlo sin un archivo. */
  cargarFilas(nombre: string, filas: unknown[][]): void {
    if (filas.length < 2) {
      this.errorPlanilla.set('La planilla no tiene filas (la primera tiene que ser la de los títulos).');
      return;
    }
    this.archivo.set(nombre);
    this.filas.set(filas);
    this.mapeo.set(adivinarColumnas((filas[0] ?? []).map((c) => String(c ?? ''))));
    this.previa.set(null);
  }

  protected elegirColumna(campo: ColumnaLista, e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.mapeo.update((m) => ({ ...m, [campo]: v === '' ? null : Number(v) }));
    this.previa.set(null);
  }

  protected opcion(nombre: 'costoPorBulto' | 'aplicarCostos' | 'marcarHabitual', e: Event): void {
    this[nombre].set((e.target as HTMLInputElement).checked);
    if (nombre === 'costoPorBulto') this.previa.set(null);
  }

  protected descartarPlanilla(): void {
    this.archivo.set(null);
    this.filas.set([]);
    this.previa.set(null);
    this.errorPlanilla.set(null);
  }

  protected verQueCambia(): void { this.importar(true); }
  protected importarDeVerdad(): void { this.importar(false); }

  private importar(vistaPrevia: boolean): void {
    const id = this.cuenta();
    if (id == null || this.trabajando()) return;
    const m = this.mapeo();
    if (m.costo == null) { this.errorPlanilla.set('Elegí la columna del costo.'); return; }
    if (m.codigo == null && m.codigoProveedor == null) { this.errorPlanilla.set('Elegí la columna del código (de barras, interno o del proveedor).'); return; }
    const renglones = this.renglones();
    if (renglones.length === 0) { this.errorPlanilla.set('No hay filas con código.'); return; }
    this.trabajando.set(true);
    this.errorPlanilla.set(null);
    this.api.importar(this.proveedorId(), {
      businessAccountId: id, renglones, costoPorBulto: this.costoPorBulto(), vistaPrevia,
      aplicarCostos: this.aplicarCostos(), marcarHabitual: this.marcarHabitual(),
    }).subscribe({
      next: (r) => {
        this.trabajando.set(false);
        if (vistaPrevia) { this.previa.set(r); return; }
        this.aviso.set(`Lista importada: ${r.nuevos} nuevos y ${r.actualizados} actualizados`
          + (r.costosCargados > 0 ? `, ${r.costosCargados} costos vigentes cambiados` : '')
          + (r.habitualesMarcados > 0 ? `, y es el proveedor habitual de ${r.habitualesMarcados} artículos más` : '') + '.');
        this.descartarPlanilla();
        this.api.proveedor(id, this.proveedorId()).subscribe((p) => this.proveedor.set(p));
        this.cargarLista();
      },
      error: (err) => { this.trabajando.set(false); this.errorPlanilla.set(mensajeDeError(err, 'No pudimos importar la planilla.')); },
    });
  }
}
