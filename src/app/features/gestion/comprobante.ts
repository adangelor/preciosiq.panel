import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { mensajeDeError } from '../../core/articulos-form';
import {
  ALICUOTAS_IVA, AvisoComprobante, Comprobante, ComprobanteGuardarResponse, ComprobanteRequest, ComprasService, LETRAS,
  LetraComprobante, PROVINCIAS, ProblemaComprobante, ProveedorFicha, RecepcionDeComprobante, TIPOS_COMPROBANTE, TIPOS_PERCEPCION,
  TipoComprobante, TipoPercepcion, cuitConGuiones, discriminaIva, fechaCorta, fechaHoraLocal, importeAr, ivaDe, letraSugerida,
  sumaComprobante, textoCondicion, textoTipoComprobante,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { ArticuloBuscadorComponent, ArticuloElegido } from '../gestion-stock/articulo-buscador';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimalAr = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
const num = (t: string) => (t.trim() ? importeAr(t) ?? NaN : 0);

/** Un renglón del IVA mientras se tipea. ivaTocado: el comprador cambió el IVA a mano (si no, se calcula del neto). */
export interface FilaAlicuota { alicuota: number; neto: string; iva: string; ivaTocado: boolean }
export interface FilaPercepcion { tipo: TipoPercepcion; jurisdiccion: string; importe: string }
export interface FilaRenglon {
  articuloId: number | null; codigo: string | null; descripcion: string; unidades: string; costo: string; bonif: string; alicuota: number;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// BP-180 (22-oct-2026) -- cargar (o corregir) una factura, nota de crédito o de débito de un proveedor
// (PROMPT_BP180_Compras_22oct.md, bloque 5). Carga rápida: neto e IVA por alícuota (en una B o C, el importe con IVA),
// percepciones y total, con la suma en vivo. "Desde las recepciones" arma alícuotas y renglones con lo recibido. "Revisar"
// pregunta al servidor sin guardar: lo que no cuadra o está repetido bloquea; la letra y las diferencias solo avisan.
@Component({
  selector: 'app-comprobante',
  standalone: true,
  imports: [RouterLink, ArticuloBuscadorComponent],
  templateUrl: './comprobante.html',
  styleUrl: './gestion.scss',
})
export class ComprobanteComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly cargando = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly proveedores = signal<ProveedorFicha[]>([]);
  protected readonly comprobante = signal<Comprobante | null>(null);

  // ---- el formulario
  protected readonly proveedorId = signal(0);
  protected readonly tipo = signal<TipoComprobante>('factura');
  protected readonly letra = signal<LetraComprobante>('A');
  private letraTocada = false;
  protected readonly puntoVenta = signal('');
  protected readonly numero = signal('');
  protected readonly fecha = signal(hoyLocal());
  protected readonly cae = signal('');
  protected readonly caeVencimiento = signal('');
  protected readonly noGravado = signal('');
  protected readonly exento = signal('');
  protected readonly internos = signal('');
  protected readonly otros = signal('');
  protected readonly total = signal('');
  protected readonly nota = signal('');
  protected readonly alicuotas = signal<FilaAlicuota[]>([{ alicuota: 21, neto: '', iva: '', ivaTocado: false }]);
  protected readonly percepciones = signal<FilaPercepcion[]>([]);
  protected readonly disponibles = signal<RecepcionDeComprobante[]>([]);
  protected readonly elegidas = signal<number[]>([]);
  protected readonly conRenglones = signal(false);
  protected readonly renglones = signal<FilaRenglon[]>([]);
  protected readonly aplicarCostos = signal(true);

  // ---- resultado
  protected readonly trabajando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly problemas = signal<ProblemaComprobante[]>([]);
  protected readonly avisos = signal<AvisoComprobante[]>([]);
  protected readonly revisado = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly confirmandoAnular = signal(false);

  protected readonly tipos = TIPOS_COMPROBANTE;
  protected readonly letras = LETRAS;
  protected readonly alicuotasIva = ALICUOTAS_IVA;
  protected readonly tiposPercepcion = TIPOS_PERCEPCION;
  protected readonly provincias = PROVINCIAS;
  protected readonly textoTipo = textoTipoComprobante;
  protected readonly textoCondicion = textoCondicion;
  protected readonly cuit = cuitConGuiones;
  protected readonly fechaCorta = fechaCorta;
  protected readonly fechaHora = fechaHoraLocal;

  protected readonly discrimina = computed(() => discriminaIva(this.letra()));
  protected readonly proveedor = computed(() => this.proveedores().find((p) => p.id === this.proveedorId()) ?? null);
  protected readonly activos = computed(() => this.proveedores().filter((p) => p.activo || p.id === this.proveedorId()));
  protected readonly suma = computed(() => {
    const r = this.armar(true);
    return typeof r === 'string' ? null : sumaComprobante(r);
  });
  protected readonly diferencia = computed(() => {
    const s = this.suma();
    const t = num(this.total());
    return s == null || Number.isNaN(t) || !this.total().trim() ? null : Math.round((t - s) * 100) / 100;
  });
  protected readonly sumaRenglones = computed(() =>
    this.renglones().reduce((t, r) => t + this.subtotal(r), 0));

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id')) || null;
    const qp = this.route.snapshot.queryParamMap;
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) { this.cargando.set(false); this.sinCuenta.set(true); return; }
        if (!g.compras) { this.cargando.set(false); this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.api.proveedores(g.businessAccountId).subscribe({
          next: (ps) => {
            this.proveedores.set(ps);
            if (id) {
              this.api.comprobante(g.businessAccountId, id).subscribe({
                next: (c) => {
                  this.cargando.set(false);
                  this.mostrar(c);
                  const aviso = (history.state as { aviso?: string } | null)?.aviso;
                  if (aviso) this.aviso.set(aviso);
                  this.avisos.set(c.avisos);
                },
                error: (err) => {
                  this.cargando.set(false);
                  this.errorCuenta.set(err instanceof HttpErrorResponse && err.status === 404 ? 'Ese comprobante no existe en tu cuenta.' : mensajeDeError(err, 'No pudimos cargar el comprobante.'));
                },
              });
              return;
            }
            this.cargando.set(false);
            // nueva: ?proveedor=&recepcion=&tipo= (desde una recepción o devolución)
            if (qp.get('tipo') === 'nota_credito') this.tipo.set('nota_credito');
            const prov = Number(qp.get('proveedor')) || 0;
            if (prov && ps.some((p) => p.id === prov)) this.elegirProveedorId(prov, Number(qp.get('recepcion')) || null);
          },
          error: (err) => { this.cargando.set(false); this.errorCuenta.set(mensajeDeError(err, 'No pudimos cargar tus proveedores.')); },
        });
      },
      error: () => { this.cargando.set(false); this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  private mostrar(c: Comprobante): void {
    this.comprobante.set(c);
    this.proveedorId.set(c.supplierId);
    this.tipo.set(c.tipo);
    this.letra.set(c.letra);
    this.letraTocada = true;
    this.puntoVenta.set(String(c.puntoVenta));
    this.numero.set(String(c.numero));
    this.fecha.set(c.fecha);
    this.cae.set(c.cae ?? '');
    this.caeVencimiento.set(c.caeVencimiento ?? '');
    this.noGravado.set(c.noGravado ? decimalAr(c.noGravado) : '');
    this.exento.set(c.exento ? decimalAr(c.exento) : '');
    this.internos.set(c.impuestosInternos ? decimalAr(c.impuestosInternos) : '');
    this.otros.set(c.otrosTributos ? decimalAr(c.otrosTributos) : '');
    this.total.set(decimalAr(c.total));
    this.nota.set(c.nota ?? '');
    this.alicuotas.set(c.alicuotas.length
      ? c.alicuotas.map((a) => ({ alicuota: a.alicuota, neto: decimalAr(a.neto), iva: decimalAr(a.iva), ivaTocado: true }))
      : [{ alicuota: 21, neto: '', iva: '', ivaTocado: false }]);
    this.percepciones.set(c.percepciones.map((p) => ({ tipo: p.tipo, jurisdiccion: p.jurisdiccion ?? '', importe: decimalAr(p.importe) })));
    this.renglones.set(c.renglones.map((r) => ({
      articuloId: r.articuloId, codigo: r.codigo, descripcion: r.descripcion, unidades: decimalAr(r.unidades), costo: decimalAr(r.costoNeto),
      bonif: decimalAr(r.bonificacionPct), alicuota: r.alicuota,
    })));
    this.conRenglones.set(c.renglones.length > 0);
    this.elegidas.set(c.recepciones.map((r) => r.id));
    this.cargarDisponibles(c.recepciones);
  }

  // ------------------------------------------------------------------ proveedor, tipo, recepciones

  protected elegirProveedor(e: Event): void {
    this.elegirProveedorId(Number((e.target as HTMLSelectElement).value) || 0, null);
  }

  private elegirProveedorId(id: number, recepcion: number | null): void {
    this.proveedorId.set(id);
    this.elegidas.set(recepcion ? [recepcion] : []);
    if (!this.letraTocada) this.letra.set(letraSugerida(this.proveedor()?.condicionIva));
    this.limpiarRevision();
    this.cargarDisponibles([]);
  }

  /** Las recepciones del proveedor que faltan facturar (más las que ya tiene este comprobante). */
  private cargarDisponibles(propias: RecepcionDeComprobante[]): void {
    const id = this.cuenta();
    if (id == null || !this.proveedorId()) { this.disponibles.set(propias); return; }
    this.api.recepcionesParaComprobante(id, this.proveedorId(), this.tipo(), this.comprobante()?.id ?? null).subscribe({
      next: (rs) => {
        const todas = [...propias.filter((p) => !rs.some((r) => r.id === p.id)), ...rs];
        this.disponibles.set(todas);
        this.elegidas.update((ids) => ids.filter((x) => todas.some((r) => r.id === x)));
      },
      error: () => this.disponibles.set(propias),
    });
  }

  protected elegirTipo(e: Event): void {
    this.tipo.set((e.target as HTMLSelectElement).value as TipoComprobante);
    this.elegidas.set([]);
    this.limpiarRevision();
    this.cargarDisponibles([]);
  }

  protected elegirLetra(e: Event): void {
    this.letra.set((e.target as HTMLSelectElement).value as LetraComprobante);
    this.letraTocada = true;
    if (!this.discrimina()) this.alicuotas.update((as) => as.map((a) => ({ ...a, iva: '', ivaTocado: false })));
    else this.alicuotas.update((as) => as.map((a) => ({ ...a, iva: a.ivaTocado ? a.iva : this.ivaTexto(a.neto, a.alicuota) })));
    this.limpiarRevision();
  }

  protected alternarRecepcion(id: number, e: Event): void {
    const si = (e.target as HTMLInputElement).checked;
    this.elegidas.update((ids) => (si ? [...ids, id] : ids.filter((x) => x !== id)));
    this.limpiarRevision();
  }

  /** Arma alícuotas, total y renglones con lo recibido en las recepciones tildadas. */
  protected desdeRecepciones(): void {
    const id = this.cuenta();
    if (id == null || this.elegidas().length === 0) return;
    this.trabajando.set(true);
    this.api.desdeRecepciones(id, this.elegidas()).subscribe({
      next: (d) => {
        this.trabajando.set(false);
        const conIva = !this.discrimina();
        this.alicuotas.set(d.alicuotas.map((a) => conIva
          ? { alicuota: a.alicuota, neto: decimalAr(Math.round((a.neto + a.iva) * 100) / 100), iva: '', ivaTocado: false }
          : { alicuota: a.alicuota, neto: decimalAr(a.neto), iva: decimalAr(a.iva), ivaTocado: false }));
        this.renglones.set(d.renglones.map((r) => ({
          articuloId: r.articuloId, codigo: r.codigo, descripcion: r.descripcion, unidades: decimalAr(r.unidades),
          costo: decimalAr(conIva ? Math.round(r.costoNeto * (100 + r.alicuota)) / 100 : r.costoNeto), bonif: '', alicuota: r.alicuota,
        })));
        this.conRenglones.set(true);
        const armado = this.armar(true);
        if (typeof armado !== 'string') this.total.set(decimalAr(sumaComprobante(armado)));
        this.limpiarRevision();
      },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos leer las recepciones.')); },
    });
  }

  // ------------------------------------------------------------------ importes

  private ivaTexto(neto: string, alicuota: number): string {
    const n = num(neto);
    return !neto.trim() || Number.isNaN(n) ? '' : decimalAr(ivaDe(n, alicuota));
  }

  protected campo(nombre: 'puntoVenta' | 'numero' | 'fecha' | 'cae' | 'caeVencimiento' | 'noGravado' | 'exento' | 'internos' | 'otros' | 'total' | 'nota', e: Event): void {
    this[nombre].set((e.target as HTMLInputElement).value);
    this.limpiarRevision();
  }

  protected cambiarAlicuota(i: number, campo: 'alicuota' | 'neto' | 'iva', e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    this.alicuotas.update((as) => as.map((a, j) => {
      if (j !== i) return a;
      if (campo === 'iva') return { ...a, iva: v, ivaTocado: true };
      const fila = campo === 'alicuota' ? { ...a, alicuota: Number(v) } : { ...a, neto: v };
      return this.discrimina() && !fila.ivaTocado ? { ...fila, iva: this.ivaTexto(fila.neto, fila.alicuota) } : fila;
    }));
    this.limpiarRevision();
  }

  protected agregarAlicuota(): void {
    const usadas = this.alicuotas().map((a) => a.alicuota);
    const libre = ALICUOTAS_IVA.find((a) => !usadas.includes(a)) ?? 0;
    this.alicuotas.update((as) => [...as, { alicuota: libre, neto: '', iva: '', ivaTocado: false }]);
  }

  protected quitarAlicuota(i: number): void {
    this.alicuotas.update((as) => as.filter((_, j) => j !== i));
    this.limpiarRevision();
  }

  protected agregarPercepcion(): void {
    this.percepciones.update((ps) => [...ps, { tipo: 'iibb', jurisdiccion: 'AR-D', importe: '' }]);
  }

  protected cambiarPercepcion(i: number, campo: keyof FilaPercepcion, e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    this.percepciones.update((ps) => ps.map((p, j) => (j === i ? { ...p, [campo]: v } : p)));
    this.limpiarRevision();
  }

  protected quitarPercepcion(i: number): void {
    this.percepciones.update((ps) => ps.filter((_, j) => j !== i));
    this.limpiarRevision();
  }

  protected usarSuma(): void {
    const s = this.suma();
    if (s != null) { this.total.set(decimalAr(s)); this.limpiarRevision(); }
  }

  // ------------------------------------------------------------------ renglones

  protected alternarRenglones(e: Event): void {
    this.conRenglones.set((e.target as HTMLInputElement).checked);
    this.limpiarRevision();
  }

  protected agregarArticulo(a: ArticuloElegido): void {
    this.renglones.update((rs) => [...rs, { articuloId: null, codigo: a.codigo, descripcion: a.descripcion ?? a.codigo, unidades: '1', costo: '', bonif: '', alicuota: 21 }]);
    this.limpiarRevision();
  }

  protected agregarSinArticulo(): void {
    this.renglones.update((rs) => [...rs, { articuloId: null, codigo: null, descripcion: 'Flete', unidades: '1', costo: '', bonif: '', alicuota: 21 }]);
  }

  protected cambiarRenglon(i: number, campo: 'descripcion' | 'unidades' | 'costo' | 'bonif' | 'alicuota', e: Event): void {
    const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
    this.renglones.update((rs) => rs.map((r, j) => (j === i ? { ...r, [campo]: campo === 'alicuota' ? Number(v) : v } : r)));
    this.limpiarRevision();
  }

  protected quitarRenglon(i: number): void {
    this.renglones.update((rs) => rs.filter((_, j) => j !== i));
    this.limpiarRevision();
  }

  protected subtotal(r: FilaRenglon): number {
    const u = num(r.unidades), c = num(r.costo), b = num(r.bonif);
    if ([u, c, b].some(Number.isNaN)) return 0;
    return Math.round(u * c * (1 - b / 100) * 100) / 100;
  }

  // ------------------------------------------------------------------ revisar, guardar, anular

  private limpiarRevision(): void {
    this.revisado.set(false);
    this.problemas.set([]);
  }

  /** El pedido para la API, o el error para mostrar. suelto: para la suma en vivo (no exige proveedor ni número). */
  armar(suelto = false): ComprobanteRequest | string {
    const id = this.cuenta();
    if (!suelto && id == null) return 'No pudimos cargar tu cuenta.';
    if (!suelto && !this.proveedorId()) return 'Elegí el proveedor.';
    const pv = Number(this.puntoVenta()), n = Number(this.numero());
    if (!suelto && (!Number.isInteger(pv) || pv < 1 || pv > 99999)) return 'El punto de venta va de 1 a 99999.';
    if (!suelto && (!Number.isInteger(n) || n < 1 || n > 99999999)) return 'El número va de 1 a 99999999.';
    const importes = [this.noGravado(), this.exento(), this.internos(), this.otros()].map(num);
    if (importes.some(Number.isNaN)) return 'Revisá los importes: alguno no es un número.';
    const alicuotas = [];
    for (const a of this.alicuotas()) {
      const neto = num(a.neto), iva = this.discrimina() ? num(a.iva) : 0;
      if (Number.isNaN(neto) || Number.isNaN(iva)) return `Revisá el ${a.alicuota} %: no es un número.`;
      if (neto !== 0 || iva !== 0) alicuotas.push({ alicuota: a.alicuota, neto, iva });
    }
    const percepciones = [];
    for (const p of this.percepciones()) {
      const imp = num(p.importe);
      if (Number.isNaN(imp)) return 'Revisá las percepciones: algún importe no es un número.';
      if (imp > 0) percepciones.push({ tipo: p.tipo, jurisdiccion: p.tipo === 'iibb' ? p.jurisdiccion || null : null, importe: imp });
    }
    const total = num(this.total());
    if (!suelto && (Number.isNaN(total) || total <= 0)) return 'Poné el total del comprobante.';
    const renglones = [];
    if (this.conRenglones()) {
      for (const r of this.renglones()) {
        const u = num(r.unidades), c = num(r.costo), b = r.bonif.trim() ? num(r.bonif) : null;
        if (!suelto && (Number.isNaN(u) || u <= 0)) return `La cantidad de «${r.descripcion}» no es válida.`;
        if (!suelto && (Number.isNaN(c) || c < 0)) return `El precio de «${r.descripcion}» no es válido.`;
        renglones.push({ articuloId: r.articuloId, codigo: r.articuloId ? null : r.codigo, descripcion: r.descripcion, unidades: u, costoNeto: c,
          bonificacionPct: b, alicuota: r.alicuota });
      }
    }
    return {
      businessAccountId: id ?? 0, supplierId: this.proveedorId(), tipo: this.tipo(), letra: this.letra(), puntoVenta: pv, numero: n,
      fecha: this.fecha() || null, cae: this.cae().trim() || null, caeVencimiento: this.caeVencimiento() || null,
      noGravado: importes[0], exento: importes[1], impuestosInternos: importes[2], otrosTributos: importes[3], total: Number.isNaN(total) ? 0 : total,
      alicuotas, percepciones, recepcionIds: this.elegidas(), renglones, nota: this.nota().trim() || null, aplicarCostos: this.aplicarCostos(),
      vistaPrevia: false,
    };
  }

  protected revisar(): void { this.enviar(true); }
  protected guardar(): void { this.enviar(false); }

  private enviar(vistaPrevia: boolean): void {
    if (this.trabajando()) return;
    const req = this.armar();
    if (typeof req === 'string') { this.error.set(req); return; }
    this.trabajando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    const id = this.comprobante()?.id ?? null;
    this.api.guardarComprobante(id, { ...req, vistaPrevia }).subscribe({
      next: (r: ComprobanteGuardarResponse) => {
        this.trabajando.set(false);
        this.problemas.set(r.problemas);
        this.avisos.set(r.avisos);
        if (r.vistaPrevia) { this.revisado.set(r.problemas.length === 0); return; }
        const c = r.comprobante!;
        const aviso = `${textoTipoComprobante(c.tipo)} ${c.numeroTexto} guardada`
          + (r.costosCargados > 0 ? `; ${r.costosCargados} ${r.costosCargados === 1 ? 'costo cambió' : 'costos cambiaron'}` : '') + '.';
        if (!id) { void this.router.navigate(['/gestion/compras/comprobantes', c.id], { replaceUrl: true, state: { aviso } }); return; }
        this.mostrar(c);
        this.aviso.set(aviso);
      },
      error: (err) => {
        this.trabajando.set(false);
        const problemas = err instanceof HttpErrorResponse ? (err.error?.problemas as ProblemaComprobante[] | undefined) : undefined;
        if (problemas?.length) { this.problemas.set(problemas); return; }
        this.error.set(mensajeDeError(err, 'No pudimos guardar el comprobante.'));
      },
    });
  }

  protected anular(): void {
    const id = this.cuenta();
    const c = this.comprobante();
    if (id == null || !c || this.trabajando()) return;
    this.confirmandoAnular.set(false);
    this.trabajando.set(true);
    this.api.anularComprobante(id, c.id).subscribe({
      next: (x) => { this.trabajando.set(false); this.mostrar(x); this.aviso.set(`${textoTipoComprobante(x.tipo)} ${x.numeroTexto} anulada: sus recepciones quedan libres.`); },
      error: (err) => { this.trabajando.set(false); this.error.set(mensajeDeError(err, 'No pudimos anular el comprobante.')); },
    });
  }

  protected plata(n: number | null): string { return n == null ? '—' : n < 0 ? `−${plata.format(-n)}` : plata.format(n); }
}
