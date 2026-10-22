import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { BranchListItem } from '../../core/business-account.models';
import { mensajeDeError } from '../../core/articulos-form';
import {
  ComprasService, Orden, OrdenRequest, ProveedorFicha, Sugerida, cantidadDeRenglon, fechaCorta, fechaDeUtc, importeAr, linkMail, linkWhatsApp,
  mensajeDeOrden, textoEstadoOrden,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { ArticuloBuscadorComponent, ArticuloElegido } from '../gestion-stock/articulo-buscador';
import { PILL_DE_ESTADO } from './ordenes';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

/** Un renglón mientras se edita. costo/bonif vacíos = los de la lista del proveedor (los pone el servidor al guardar). */
export interface FilaOrden {
  articuloId: number | null;
  codigo: string;
  descripcion: string;
  codigoProveedor: string | null;
  unidadesPorBulto: number | null;
  enBultos: boolean;
  cantidad: string;
  costo: string;
  bonif: string;
  /** El costo final (bonificado) de la lista, para estimar mientras costo está vacío. */
  costoLista: number | null;
}

/** Un renglón de la compra sugerida, con lo que el comprador cambia. */
interface FilaSugerida {
  articuloId: number;
  codigo: string;
  descripcion: string;
  codigoProveedor: string | null;
  vendido: number;
  stock: number;
  minimo: number | null;
  maximo: number | null;
  unidadesPorBulto: number | null;
  motivo: string;
  costoFinal: number | null;
  /** En bultos si el artículo tiene bulto. */
  cantidad: string;
  incluir: boolean;
}

const decimalAr = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

/** Las unidades de un renglón (en bultos, por las unidades del bulto), o null si la cantidad no es un número mayor a cero. */
export function unidadesDeFila(f: FilaOrden): number | null {
  const c = importeAr(f.cantidad);
  if (c == null || c <= 0) return null;
  return f.enBultos && f.unidadesPorBulto ? c * f.unidadesPorBulto : c;
}

/** Por unidad, bonificado: el que tipeó el comprador o, vacío, el de la lista. */
export function costoDeFila(f: FilaOrden): number | null {
  const c = f.costo.trim() ? importeAr(f.costo) : null;
  if (c == null) return f.costoLista;
  const b = f.bonif.trim() ? importeAr(f.bonif) ?? 0 : 0;
  return Math.round(c * (1 - b / 100) * 10000) / 10000;
}

// BP-180 (22-oct-2026) -- una orden de compra (PROMPT_BP180_Compras_22oct.md, bloque 3). En borrador se arma: proveedor,
// sucursal, entrega, y los renglones (a mano con el buscador, o con "Sugerir compra": lo vendido, el stock, el mínimo y el
// máximo, redondeado al bulto). Guardada, se imprime o se manda por WhatsApp o mail (lo manda el comprador) y se marca como
// enviada; ahí queda fija hasta que llega la mercadería (la recepción, bloque 4).
@Component({
  selector: 'app-orden',
  standalone: true,
  imports: [RouterLink, ArticuloBuscadorComponent],
  templateUrl: './orden.html',
  styleUrl: './gestion.scss',
})
export class OrdenComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<BranchListItem[]>([]);
  protected readonly proveedores = signal<ProveedorFicha[]>([]);

  // ---- la orden
  protected readonly orden = signal<Orden | null>(null);
  protected readonly proveedorId = signal<number>(0);
  protected readonly sucursal = signal<string>('');
  protected readonly entrega = signal<string>('');
  protected readonly nota = signal<string>('');
  protected readonly filas = signal<FilaOrden[]>([]);
  protected readonly sucio = signal(false);
  protected readonly trabajando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly confirmando = signal<'enviar' | 'cancelar' | null>(null);

  protected readonly editable = computed(() => (this.orden()?.estado ?? 'borrador') === 'borrador');
  protected readonly proveedor = computed(() => this.proveedores().find((p) => p.id === this.proveedorId()) ?? null);
  protected readonly proveedoresActivos = computed(() => this.proveedores().filter((p) => p.activo || p.id === this.proveedorId()));
  protected readonly total = computed(() =>
    this.filas().reduce((t, f) => t + (unidadesDeFila(f) ?? 0) * (costoDeFila(f) ?? 0), 0),
  );
  protected readonly sinCosto = computed(() => this.filas().filter((f) => costoDeFila(f) == null).length);

  // ---- compra sugerida
  protected readonly dias = signal('30');
  protected readonly cubrir = signal('15');
  protected readonly sugerida = signal<Sugerida | null>(null);
  protected readonly filasSugeridas = signal<FilaSugerida[]>([]);
  protected readonly sugiriendo = signal(false);
  protected readonly errorSugerida = signal<string | null>(null);
  protected readonly incluidas = computed(() => this.filasSugeridas().filter((f) => f.incluir).length);

  // ---- mandar
  protected readonly conCostos = signal(true);
  protected readonly texto = computed(() => {
    const o = this.orden();
    return o ? mensajeDeOrden(o, this.conCostos()) : '';
  });
  protected readonly whatsapp = computed(() => (this.orden() ? linkWhatsApp(this.orden()!.proveedorTelefono, this.texto()) : ''));
  protected readonly mail = computed(() => (this.orden() ? linkMail(this.orden()!.proveedorEmail, this.orden()!, this.texto()) : ''));
  protected readonly copiado = signal(false);

  protected readonly textoEstado = textoEstadoOrden;
  protected readonly cantidadDeRenglon = cantidadDeRenglon;
  protected readonly fecha = fechaCorta;
  protected readonly fechaUtc = fechaDeUtc;
  protected readonly pill = PILL_DE_ESTADO;
  protected readonly unidadesDeFila = unidadesDeFila;
  protected readonly costoDeFila = costoDeFila;

  ngOnInit(): void {
    const idRuta = Number(this.route.snapshot.paramMap.get('id')) || null;
    const qp = this.route.snapshot.queryParamMap;
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) { this.cargandoCuenta.set(false); this.sinCuenta.set(true); return; }
        if (!g.compras) { this.cargandoCuenta.set(false); this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.sucursales.set(g.branches);
        this.api.proveedores(g.businessAccountId).pipe(
          switchMap((ps): Observable<Orden | null> => {
            this.proveedores.set(ps);
            return idRuta ? this.api.orden(g.businessAccountId, idRuta) : of(null);
          }),
        ).subscribe({
          next: (o) => {
            this.cargandoCuenta.set(false);
            if (o) {
              this.mostrar(o);
              const aviso = (history.state as { aviso?: string } | null)?.aviso;
              if (aviso) this.aviso.set(aviso);
              return;
            }
            const prov = Number(qp.get('proveedor')) || 0;
            if (prov && this.proveedores().some((p) => p.id === prov && p.activo)) this.proveedorId.set(prov);
            const suc = qp.get('sucursal') ?? '';
            this.sucursal.set(g.branches.some((b) => b.branchId === suc) ? suc : g.branches.length === 1 ? g.branches[0].branchId : '');
          },
          error: (err) => {
            this.cargandoCuenta.set(false);
            this.errorCuenta.set(err instanceof HttpErrorResponse && err.status === 404
              ? 'Esa orden no existe en tu cuenta.'
              : mensajeDeError(err, 'No pudimos cargar la orden.'));
          },
        });
      },
      error: () => { this.cargandoCuenta.set(false); this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  /** Lo que vino del servidor pasa a la pantalla. */
  private mostrar(o: Orden): void {
    this.orden.set(o);
    this.proveedorId.set(o.supplierId);
    this.sucursal.set(o.branchId);
    this.entrega.set(o.entregaEsperada ?? '');
    this.nota.set(o.nota ?? '');
    this.filas.set(o.items.map((r) => ({
      articuloId: r.articuloId,
      codigo: r.codigo,
      descripcion: r.descripcion,
      codigoProveedor: r.codigoProveedor,
      unidadesPorBulto: r.unidadesPorBulto,
      enBultos: r.bultos != null && !!r.unidadesPorBulto,
      cantidad: decimalAr(r.bultos != null && r.unidadesPorBulto ? r.bultos : r.unidades),
      costo: decimalAr(r.costoNetoPactado),
      bonif: decimalAr(r.bonificacionPct),
      costoLista: null,
    })));
    this.sucio.set(false);
  }

  // ------------------------------------------------------------------ cabecera

  protected elegirProveedor(e: Event): void {
    this.proveedorId.set(Number((e.target as HTMLSelectElement).value) || 0);
    this.sugerida.set(null);
    this.filasSugeridas.set([]);
    this.sucio.set(true);
  }

  protected campo(nombre: 'sucursal' | 'entrega' | 'nota', e: Event): void {
    this[nombre].set((e.target as HTMLInputElement).value);
    if (nombre === 'sucursal') { this.sugerida.set(null); this.filasSugeridas.set([]); }
    this.sucio.set(true);
  }

  // ------------------------------------------------------------------ renglones

  protected agregar(a: ArticuloElegido): void {
    const id = this.cuenta();
    if (id == null) return;
    this.aviso.set(null);
    if (this.filas().some((f) => f.codigo === a.codigo)) {
      this.aviso.set(`«${a.descripcion ?? a.codigo}» ya está en la orden: cambiale la cantidad.`);
      return;
    }
    const fila: FilaOrden = {
      articuloId: null, codigo: a.codigo, descripcion: a.descripcion ?? a.codigo, codigoProveedor: null, unidadesPorBulto: null,
      enBultos: false, cantidad: '1', costo: '', bonif: '', costoLista: null,
    };
    this.filas.update((fs) => [...fs, fila]);
    this.sucio.set(true);
    // El bulto, el código y el costo de la lista del proveedor, si lo tiene.
    if (this.proveedorId()) {
      this.api.lista(id, this.proveedorId(), a.codigo, 1, 5).subscribe({
        next: (l) => {
          const x = l.items.find((i) => i.codigo === a.codigo);
          if (!x) return;
          this.filas.update((fs) => fs.map((f) => (f.codigo === a.codigo
            ? { ...f, articuloId: x.articuloId, descripcion: x.descripcion, codigoProveedor: x.codigoProveedor,
                unidadesPorBulto: x.unidadesPorBulto, enBultos: !!x.unidadesPorBulto, costoLista: x.costoFinal }
            : f)));
        },
      });
    }
  }

  protected cambiarFila(i: number, campo: 'cantidad' | 'costo' | 'bonif', e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.filas.update((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: v } : f)));
    this.sucio.set(true);
  }

  protected cambiarUnidad(i: number, e: Event): void {
    const enBultos = (e.target as HTMLSelectElement).value === 'bultos';
    this.filas.update((fs) => fs.map((f, j) => (j === i ? { ...f, enBultos } : f)));
    this.sucio.set(true);
  }

  protected quitarFila(i: number): void {
    this.filas.update((fs) => fs.filter((_, j) => j !== i));
    this.sucio.set(true);
  }

  // ------------------------------------------------------------------ compra sugerida

  protected campoSugerida(nombre: 'dias' | 'cubrir', e: Event): void {
    this[nombre].set((e.target as HTMLInputElement).value);
  }

  protected sugerir(): void {
    const id = this.cuenta();
    if (id == null) return;
    if (!this.proveedorId() || !this.sucursal()) { this.errorSugerida.set('Elegí el proveedor y la sucursal.'); return; }
    const dias = Number(this.dias());
    const cubrir = Number(this.cubrir());
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) { this.errorSugerida.set('Los días de venta a mirar van de 1 a 365.'); return; }
    if (!Number.isInteger(cubrir) || cubrir < 1 || cubrir > 180) { this.errorSugerida.set('Los días a cubrir van de 1 a 180.'); return; }
    this.sugiriendo.set(true);
    this.errorSugerida.set(null);
    this.api.sugerida(id, this.proveedorId(), this.sucursal(), dias, cubrir).subscribe({
      next: (s) => {
        this.sugiriendo.set(false);
        this.sugerida.set(s);
        this.filasSugeridas.set(s.items.map((x) => ({
          articuloId: x.articuloId, codigo: x.codigo, descripcion: x.descripcion, codigoProveedor: x.codigoProveedor,
          vendido: x.vendido, stock: x.stock, minimo: x.minimo, maximo: x.maximo, unidadesPorBulto: x.unidadesPorBulto,
          motivo: x.motivo, costoFinal: x.costoFinal,
          cantidad: decimalAr(x.bultos != null && x.unidadesPorBulto ? x.bultos : x.sugerido),
          incluir: true,
        })));
      },
      error: (err) => { this.sugiriendo.set(false); this.errorSugerida.set(mensajeDeError(err, 'No pudimos calcular la compra sugerida.')); },
    });
  }

  protected cambiarSugerida(i: number, campo: 'cantidad' | 'incluir', e: Event): void {
    const el = e.target as HTMLInputElement;
    this.filasSugeridas.update((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: campo === 'incluir' ? el.checked : el.value } : f)));
  }

  protected incluirTodas(si: boolean): void {
    this.filasSugeridas.update((fs) => fs.map((f) => ({ ...f, incluir: si })));
  }

  /** Las tildadas pasan a la orden: las que ya estaban toman la cantidad sugerida. */
  protected agregarSugeridas(): void {
    const elegidas = this.filasSugeridas().filter((f) => f.incluir && (importeAr(f.cantidad) ?? 0) > 0);
    if (elegidas.length === 0) { this.errorSugerida.set('No hay nada tildado con cantidad.'); return; }
    let nuevas = 0, cambiadas = 0;
    this.filas.update((fs) => {
      const lista = [...fs];
      for (const s of elegidas) {
        const enBultos = !!s.unidadesPorBulto;
        const i = lista.findIndex((f) => f.codigo === s.codigo);
        if (i >= 0) { lista[i] = { ...lista[i], cantidad: s.cantidad, enBultos, unidadesPorBulto: s.unidadesPorBulto }; cambiadas++; }
        else {
          lista.push({
            articuloId: s.articuloId, codigo: s.codigo, descripcion: s.descripcion, codigoProveedor: s.codigoProveedor,
            unidadesPorBulto: s.unidadesPorBulto, enBultos, cantidad: s.cantidad, costo: '', bonif: '', costoLista: s.costoFinal,
          });
          nuevas++;
        }
      }
      return lista;
    });
    this.sucio.set(true);
    this.sugerida.set(null);
    this.filasSugeridas.set([]);
    this.aviso.set(`${nuevas} ${nuevas === 1 ? 'artículo agregado' : 'artículos agregados'}`
      + (cambiadas > 0 ? ` y ${cambiadas} con la cantidad sugerida` : '') + '. Revisá y guardá la orden.');
  }

  // ------------------------------------------------------------------ guardar, enviar, cancelar

  /** El pedido para la API, o un error para mostrar. */
  pedido(): OrdenRequest | string {
    const id = this.cuenta();
    if (id == null) return 'No pudimos cargar tu cuenta.';
    if (!this.proveedorId()) return 'Elegí el proveedor.';
    if (!this.sucursal()) return 'Elegí la sucursal donde llega la mercadería.';
    const renglones: OrdenRequest['renglones'] = [];
    for (const f of this.filas()) {
      const c = importeAr(f.cantidad);
      if (c == null || c <= 0) return `Poné la cantidad de «${f.descripcion}».`;
      const costo = f.costo.trim() ? importeAr(f.costo) : null;
      if (f.costo.trim() && (costo == null || costo < 0)) return `El costo de «${f.descripcion}» no es un número.`;
      const bonif = f.bonif.trim() ? importeAr(f.bonif) : null;
      if (f.bonif.trim() && (bonif == null || bonif < 0 || bonif >= 100)) return `La bonificación de «${f.descripcion}» va de 0 a 99,99 %.`;
      const enBultos = f.enBultos && !!f.unidadesPorBulto;
      renglones.push({
        articuloId: f.articuloId, codigo: f.articuloId ? null : f.codigo,
        unidades: enBultos ? null : c, bultos: enBultos ? c : null, costoNetoPactado: costo, bonificacionPct: bonif,
      });
    }
    return {
      businessAccountId: id, supplierId: this.proveedorId(), branchId: this.sucursal(),
      entregaEsperada: this.entrega() || null, nota: this.nota().trim() || null, renglones,
    };
  }

  protected guardar(despues?: (o: Orden) => void): void {
    if (this.trabajando()) return;
    const req = this.pedido();
    if (typeof req === 'string') { this.error.set(req); return; }
    this.trabajando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    const o = this.orden();
    (o ? this.api.editarOrden(o.id, req) : this.api.crearOrden(req)).subscribe({
      next: (r) => {
        this.trabajando.set(false);
        const nueva = !o;
        this.mostrar(r);
        const aviso = `${r.numeroTexto} guardada.`;
        if (despues) despues(r);
        else this.aviso.set(aviso);
        // nueva -> /:id es otra ruta (otro componente): el aviso viaja en el estado de la navegación.
        if (nueva) void this.router.navigate(['/gestion/compras/ordenes', r.id], { replaceUrl: true, state: despues ? {} : { aviso } });
      },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos guardar la orden.')); },
    });
  }

  protected enviar(): void {
    const id = this.cuenta();
    const o = this.orden();
    if (id == null || !o || this.trabajando()) return;
    this.confirmando.set(null);
    const mandar = (orden: Orden) => {
      this.trabajando.set(true);
      this.api.enviarOrden(id, orden.id).subscribe({
        next: (r) => { this.trabajando.set(false); this.mostrar(r); this.aviso.set(`${r.numeroTexto} quedó como enviada.`); },
        error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos marcarla como enviada.')); },
      });
    };
    if (this.sucio()) this.guardar(mandar);
    else mandar(o);
  }

  protected cancelar(): void {
    const id = this.cuenta();
    const o = this.orden();
    if (id == null || !o || this.trabajando()) return;
    this.confirmando.set(null);
    this.trabajando.set(true);
    this.api.cancelarOrden(id, o.id).subscribe({
      next: (r) => { this.trabajando.set(false); this.mostrar(r); this.aviso.set(`${r.numeroTexto} cancelada.`); },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cancelar la orden.')); },
    });
  }

  protected opcionCostos(e: Event): void {
    this.conCostos.set((e.target as HTMLInputElement).checked);
  }

  protected copiar(): void {
    navigator.clipboard?.writeText(this.texto()).then(
      () => { this.copiado.set(true); setTimeout(() => this.copiado.set(false), 2500); },
      () => this.error.set('No pudimos copiar: seleccioná el texto y copialo a mano.'),
    );
  }

  /** "2 bultos (24 u.)" o "6 u.", para la orden que ya no se edita. */
  protected cantidadTexto(f: FilaOrden): string {
    const u = unidadesDeFila(f) ?? 0;
    return cantidadDeRenglon({ unidades: u, bultos: f.enBultos && f.unidadesPorBulto ? u / f.unidadesPorBulto : null });
  }

  /** El costo pactado tal como se tipeó, para mostrarlo con formato. */
  protected costoPactado(f: FilaOrden): number | null { return f.costo.trim() ? importeAr(f.costo) : null; }

  protected plata(n: number | null): string { return n == null ? '—' : plata.format(n); }
  protected cant(n: number | null): string { return n == null ? '—' : num.format(n); }
}
