import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, of } from 'rxjs';
import { mensajeDeError } from '../../core/articulos-form';
import {
  CodigoLeido, ComprasService, MOTIVOS_DIFERENCIA, MotivoDiferencia, Recepcion, RecepcionRequest, fechaHoraLocal, fechaDeUtc,
  importeAr, motivoAutomatico, textoEstadoOrden, textoEstadoRecepcion, textoMotivo,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { PILL_DE_RECEPCION } from './recepciones';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const decimalAr = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

/** Un renglón mientras se recibe. motivo null = el automático (faltante / sobrante). */
export interface FilaRecepcion {
  articuloId: number;
  codigo: string;
  descripcion: string;
  codigoProveedor: string | null;
  unidadesPorBulto: number | null;
  pedidas: number | null;
  recibidas: string;
  costo: string;
  motivo: MotivoDiferencia | null;
}

export function recibidasDe(f: FilaRecepcion): number {
  const n = importeAr(f.recibidas);
  return n == null || n < 0 ? 0 : n;
}

/** Lo que el lector suma a la fila (bulto = sus unidades), o la fila nueva si no estaba. */
export function sumarLectura(filas: FilaRecepcion[], leido: CodigoLeido): FilaRecepcion[] {
  const i = filas.findIndex((f) => f.articuloId === leido.articuloId);
  if (i >= 0) {
    const f = filas[i];
    return filas.map((x, j) => (j === i ? { ...f, recibidas: decimalAr(recibidasDe(f) + leido.factor) } : x));
  }
  return [...filas, {
    articuloId: leido.articuloId, codigo: leido.codigo, descripcion: leido.descripcion, codigoProveedor: leido.codigoProveedor,
    unidadesPorBulto: leido.unidadesPorBulto, pedidas: null, recibidas: decimalAr(leido.factor),
    costo: decimalAr(leido.costoFinal), motivo: null,
  }];
}

// BP-180 (22-oct-2026) -- una recepción (PROMPT_BP180_Compras_22oct.md, bloque 4). En borrador: el lector de código de
// barras (USB: tipea el código y Enter) suma a lo recibido — un código de bulto suma sus unidades —, lo pedido contra lo
// recibido en vivo, costo y motivo por renglón, y el resumen de diferencias antes de confirmar. Confirmar suma el stock
// (o lo resta, en una devolución), actualiza la orden y el costo. Una confirmada se puede anular (movimientos inversos).
@Component({
  selector: 'app-recepcion',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './recepcion.html',
  styleUrl: './gestion.scss',
})
export class RecepcionComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lector = viewChild<ElementRef<HTMLInputElement>>('lector');

  protected readonly cargando = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);

  protected readonly recepcion = signal<Recepcion | null>(null);
  protected readonly filas = signal<FilaRecepcion[]>([]);
  protected readonly remito = signal('');
  protected readonly fechaLocal = signal('');
  protected readonly nota = signal('');
  protected readonly sucio = signal(false);
  protected readonly trabajando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly confirmando = signal<'confirmar' | 'anular' | null>(null);

  // ---- el lector
  protected readonly lectura = signal<{ texto: string; ok: boolean } | null>(null);
  private readonly cache = new Map<string, CodigoLeido>();

  protected readonly motivos = MOTIVOS_DIFERENCIA;
  protected readonly editable = computed(() => this.recepcion()?.estado === 'borrador');
  protected readonly conOrden = computed(() => this.recepcion()?.ordenId != null);
  protected readonly total = computed(() =>
    this.filas().reduce((t, f) => t + recibidasDe(f) * (f.costo.trim() ? importeAr(f.costo) ?? 0 : 0), 0));
  protected readonly unidades = computed(() => this.filas().reduce((t, f) => t + recibidasDe(f), 0));
  /** El resumen antes de confirmar: qué falta, qué sobra y qué tiene otro motivo. */
  protected readonly diferencias = computed(() => {
    const d: { fila: FilaRecepcion; motivo: MotivoDiferencia; diferencia: number | null }[] = [];
    for (const f of this.filas()) {
      const m = this.motivoDe(f);
      if (m) d.push({ fila: f, motivo: m, diferencia: f.pedidas != null ? recibidasDe(f) - f.pedidas : null });
    }
    return d;
  });

  protected readonly textoEstado = textoEstadoRecepcion;
  protected readonly textoEstadoOrden = textoEstadoOrden;
  protected readonly textoMotivo = textoMotivo;
  protected readonly fechaHora = fechaHoraLocal;
  protected readonly fechaUtc = fechaDeUtc;
  protected readonly pill = PILL_DE_RECEPCION;
  protected readonly recibidasDe = recibidasDe;

  ngOnInit(): void {
    const idRuta = Number(this.route.snapshot.paramMap.get('id')) || null;
    const qp = this.route.snapshot.queryParamMap;
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) { this.cargando.set(false); this.sinCuenta.set(true); return; }
        if (!g.compras) { this.cargando.set(false); this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        let pedido: Observable<Recepcion>;
        if (idRuta) pedido = this.api.recepcion(g.businessAccountId, idRuta);
        else {
          // nueva: contra una orden (?orden=) o sin orden / devolución (?tipo=&sucursal=&proveedor=). Se crea en borrador ya.
          const orden = Number(qp.get('orden')) || null;
          const tipo = qp.get('tipo');
          pedido = this.api.crearRecepcion({
            businessAccountId: g.businessAccountId, ordenId: orden, supplierId: orden ? null : Number(qp.get('proveedor')) || null,
            branchId: orden ? null : qp.get('sucursal'), esDevolucion: !orden && tipo === 'devolucion', remitoNumero: null,
            recibidaAtLocal: null, nota: null, renglones: null,
          });
        }
        pedido.subscribe({
          next: (r) => {
            this.cargando.set(false);
            this.mostrar(r);
            if (!idRuta) void this.router.navigate(['/gestion/compras/recepciones', r.id], { replaceUrl: true });
            const aviso = (history.state as { aviso?: string } | null)?.aviso;
            if (aviso) this.aviso.set(aviso);
            setTimeout(() => this.lector()?.nativeElement.focus());
          },
          error: (err) => {
            this.cargando.set(false);
            this.errorCuenta.set(err instanceof HttpErrorResponse && err.status === 404 && idRuta
              ? 'Esa recepción no existe en tu cuenta.'
              : mensajeDeError(err, idRuta ? 'No pudimos cargar la recepción.' : 'No pudimos empezar la recepción.'));
          },
        });
      },
      error: () => { this.cargando.set(false); this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  private mostrar(r: Recepcion): void {
    this.recepcion.set(r);
    this.remito.set(r.remitoNumero ?? '');
    this.fechaLocal.set(r.recibidaAtLocal.slice(0, 16));
    this.nota.set(r.nota ?? '');
    const auto = (p: number | null, rec: number) => motivoAutomatico(p, rec, r.ordenId != null);
    this.filas.set(r.items.map((i) => ({
      articuloId: i.articuloId, codigo: i.codigo, descripcion: i.descripcion, codigoProveedor: i.codigoProveedor,
      unidadesPorBulto: i.unidadesPorBulto, pedidas: i.unidadesPedidas, recibidas: decimalAr(i.unidadesRecibidas),
      costo: decimalAr(i.costoNeto),
      // El que puso el servidor por su cuenta (faltante/sobrante) se vuelve a calcular en vivo; uno elegido queda.
      motivo: i.motivoDiferencia && i.motivoDiferencia !== auto(i.unidadesPedidas, i.unidadesRecibidas) ? i.motivoDiferencia : null,
    })));
    this.sucio.set(false);
  }

  /** El motivo que va: el elegido o el automático. */
  protected motivoDe(f: FilaRecepcion): MotivoDiferencia | null {
    return f.motivo ?? motivoAutomatico(f.pedidas, recibidasDe(f), this.conOrden());
  }

  // ------------------------------------------------------------------ el lector

  protected leer(e: Event): void {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const codigo = input.value.trim();
    input.value = '';
    const id = this.cuenta();
    if (!codigo || id == null || !this.editable()) return;
    const conocido = this.cache.get(codigo)
      ?? (() => {
        const f = this.filas().find((x) => x.codigo === codigo);
        return f ? { articuloId: f.articuloId, codigo: f.codigo, descripcion: f.descripcion, factor: 1, por: 'codigo',
          unidadesPorBulto: f.unidadesPorBulto, codigoProveedor: f.codigoProveedor, costoFinal: null, activo: true } as CodigoLeido : null;
      })();
    const pedido: Observable<CodigoLeido> = conocido ? of(conocido) : this.api.leerCodigo(id, codigo, this.recepcion()?.supplierId ?? null);
    pedido.subscribe({
      next: (l) => {
        this.cache.set(codigo, l);
        this.filas.update((fs) => sumarLectura(fs, l));
        this.sucio.set(true);
        const f = this.filas().find((x) => x.articuloId === l.articuloId)!;
        this.lectura.set({
          ok: true,
          texto: `+${num.format(l.factor)} ${l.descripcion}${l.factor > 1 ? ' (un bulto)' : ''} · van ${num.format(recibidasDe(f))}`
            + (f.pedidas != null ? ` de ${num.format(f.pedidas)}` : this.conOrden() ? ' (no estaba en la orden)' : ''),
        });
      },
      error: (err) => this.lectura.set({ ok: false, texto: mensajeDeError(err, `No encontramos el código ${codigo}.`) }),
    });
  }

  // ------------------------------------------------------------------ renglones

  protected cambiar(i: number, campo: 'recibidas' | 'costo', e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.filas.update((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: v } : f)));
    this.sucio.set(true);
  }

  protected elegirMotivo(i: number, e: Event): void {
    const v = (e.target as HTMLSelectElement).value as MotivoDiferencia | '';
    this.filas.update((fs) => fs.map((f, j) => (j === i ? { ...f, motivo: v || null } : f)));
    this.sucio.set(true);
  }

  protected quitar(i: number): void {
    this.filas.update((fs) => fs.filter((_, j) => j !== i));
    this.sucio.set(true);
  }

  /** Todo lo pedido llegó: lo recibido = lo pedido en cada renglón de la orden. */
  protected recibirTodo(): void {
    this.filas.update((fs) => fs.map((f) => (f.pedidas != null ? { ...f, recibidas: decimalAr(f.pedidas) } : f)));
    this.sucio.set(true);
  }

  protected campo(nombre: 'remito' | 'fechaLocal' | 'nota', e: Event): void {
    this[nombre].set((e.target as HTMLInputElement).value);
    this.sucio.set(true);
  }

  // ------------------------------------------------------------------ guardar, confirmar, anular

  pedido(): RecepcionRequest | string {
    const id = this.cuenta();
    const r = this.recepcion();
    if (id == null || !r) return 'No pudimos cargar la recepción.';
    const renglones: RecepcionRequest['renglones'] = [];
    for (const f of this.filas()) {
      const u = importeAr(f.recibidas);
      if (f.recibidas.trim() && (u == null || u < 0)) return `La cantidad de «${f.descripcion}» no es un número.`;
      const c = f.costo.trim() ? importeAr(f.costo) : null;
      if (f.costo.trim() && (c == null || c < 0)) return `El costo de «${f.descripcion}» no es un número.`;
      renglones.push({ articuloId: f.articuloId, codigo: null, unidades: u ?? 0, bultos: null, costoNeto: c, motivo: f.motivo });
    }
    return {
      businessAccountId: id, supplierId: r.supplierId, branchId: r.branchId, ordenId: r.ordenId, esDevolucion: r.esDevolucion,
      remitoNumero: this.remito().trim() || null, recibidaAtLocal: this.fechaLocal() ? `${this.fechaLocal()}:00` : null,
      nota: this.nota().trim() || null, renglones,
    };
  }

  protected guardar(despues?: (r: Recepcion) => void): void {
    const r = this.recepcion();
    if (!r || this.trabajando()) return;
    const req = this.pedido();
    if (typeof req === 'string') { this.error.set(req); return; }
    this.trabajando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    this.api.editarRecepcion(r.id, req).subscribe({
      next: (x) => {
        this.trabajando.set(false);
        this.mostrar(x);
        if (despues) despues(x);
        else this.aviso.set(`${x.numeroTexto} guardada.`);
      },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos guardar la recepción.')); },
    });
  }

  protected confirmar(): void {
    const id = this.cuenta();
    if (id == null || !this.recepcion() || this.trabajando()) return;
    this.confirmando.set(null);
    const hacer = (r: Recepcion) => {
      this.trabajando.set(true);
      this.api.confirmarRecepcion(id, r.id).subscribe({
        next: (x) => {
          this.trabajando.set(false);
          this.mostrar(x.recepcion);
          const orden = x.estadoOrden && x.recepcion.ordenNumeroTexto
            ? ` La orden ${x.recepcion.ordenNumeroTexto} quedó ${textoEstadoOrden(x.estadoOrden).toLowerCase()}.` : '';
          this.aviso.set(`${x.recepcion.numeroTexto} confirmada: ${x.movimientos} ${x.movimientos === 1 ? 'artículo' : 'artículos'} `
            + (x.recepcion.esDevolucion ? (x.movimientos === 1 ? 'salió del' : 'salieron del') : (x.movimientos === 1 ? 'entró al' : 'entraron al'))
            + ' stock'
            + (x.costosCargados > 0 ? ` y ${x.costosCargados} ${x.costosCargados === 1 ? 'costo cambió' : 'costos cambiaron'}` : '') + `.${orden}`);
        },
        error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos confirmar la recepción.')); },
      });
    };
    if (this.sucio()) this.guardar(hacer);
    else hacer(this.recepcion()!);
  }

  protected anular(): void {
    const id = this.cuenta();
    const r = this.recepcion();
    if (id == null || !r || this.trabajando()) return;
    this.confirmando.set(null);
    this.trabajando.set(true);
    const confirmada = r.estado === 'confirmada';
    this.api.anularRecepcion(id, r.id).subscribe({
      next: (x) => {
        this.trabajando.set(false);
        this.mostrar(x);
        this.aviso.set(`${x.numeroTexto} anulada${confirmada ? `: el stock volvió atrás${x.ordenNumeroTexto ? ` y la orden ${x.ordenNumeroTexto} quedó ${textoEstadoOrden(x.ordenEstado ?? 'enviada').toLowerCase()}` : ''}` : ''}.`);
      },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos anular la recepción.')); },
    });
  }

  protected plata(n: number | null): string { return n == null ? '—' : plata.format(n); }
  protected cant(n: number | null): string { return n == null ? '—' : num.format(n); }
  protected dif(n: number): string { return n === 0 ? '0' : `${n > 0 ? '+' : '−'}${num.format(Math.abs(n))}`; }
  protected costoDe(f: FilaRecepcion): number | null { return f.costo.trim() ? importeAr(f.costo) : null; }
  protected subtotal(f: FilaRecepcion): number | null {
    const c = f.costo.trim() ? importeAr(f.costo) : null;
    return c == null ? null : c * recibidasDe(f);
  }
}
