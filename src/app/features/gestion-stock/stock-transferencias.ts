import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensajeDeError, numeroONull } from '../../core/articulos-form';
import { GestionContextoService } from '../../core/gestion-contexto';
import { StockService } from '../../core/stock';
import { cantidad, diferencia } from '../../core/stock-form';
import { EstadoDeTransferencia, StockSucursal, StockTransferencia } from '../../core/stock.models';
import { ArticuloBuscadorComponent, ArticuloElegido } from './articulo-buscador';

interface Renglon {
  codigo: string;
  descripcion: string | null;
  cantidad: string;
}

/**
 * BP-179 bloque 7 (21-oct-2026) -- Gestión → Stock → Transferencias entre sucursales. Crear (sale del origen y queda en
 * tránsito), recibir (entra en el destino lo que llegó: si falta algo, la diferencia queda a la vista) o cancelar (vuelve
 * al origen). Nada se borra: cada paso es un movimiento en el historial de cada sucursal.
 */
@Component({
  selector: 'app-stock-transferencias',
  standalone: true,
  imports: [RouterLink, DatePipe, ArticuloBuscadorComponent],
  template: `
    <div class="gestion stock card--page">
      <p><a routerLink="/gestion/stock">← Stock</a></p>
      <h1>Transferencias entre sucursales</h1>
      <p class="subtitle">
        Cuando mandás mercadería de una sucursal a otra: sale del origen al crearla y entra en el destino cuando la reciben.
      </p>

      @if (cargandoCuenta()) {
        <p class="muted">Cargando tu comercio…</p>
      } @else if (errorCuenta()) {
        <p class="alert alert--danger">{{ errorCuenta() }}</p>
      } @else if (sinPlan()) {
        <div class="alert alert--info">
          <span>El stock con historial viene con los planes <strong>Avanzado</strong> y <strong>Cadena</strong>. <a routerLink="/plan">Ver planes →</a></span>
        </div>
      } @else if (sucursales().length < 2) {
        <p class="alert alert--info"><span>Para transferir hacen falta dos sucursales o más.</span></p>
      } @else {
        <section class="gestion__seccion">
          <h2>Nueva transferencia</h2>
          <div class="gestion__fila-form">
            <label>
              Desde
              <select (change)="desde.set($any($event.target).value)">
                @for (s of sucursales(); track s.branchId) { <option [value]="s.branchId" [selected]="s.branchId === desde()">{{ s.nombre }}</option> }
              </select>
            </label>
            <label>
              Hacia
              <select (change)="hacia.set($any($event.target).value)">
                @for (s of sucursales(); track s.branchId) { <option [value]="s.branchId" [selected]="s.branchId === hacia()">{{ s.nombre }}</option> }
              </select>
            </label>
            @if (cuenta(); as id) {
              <app-articulo-buscador [cuenta]="id" (elegido)="agregar($event)" />
            }
          </div>
          @if (renglones().length > 0) {
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Artículo</th><th class="num">Cantidad</th><th></th></tr></thead>
                <tbody>
                  @for (r of renglones(); track r.codigo; let i = $index) {
                    <tr>
                      <td class="strong">{{ r.descripcion ?? r.codigo }}<div class="muted gestion__sub">{{ r.codigo }}</div></td>
                      <td class="num"><input class="stock__lim" type="text" inputmode="decimal" [value]="r.cantidad" (change)="cambiar(i, $event)" [attr.aria-label]="'Cantidad de ' + (r.descripcion ?? r.codigo)" /></td>
                      <td><button type="button" class="btn btn--ghost btn--small" (click)="quitar(i)" aria-label="Sacar">✕</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="gestion__fila-form">
              <label class="stock__nota-input">Nota (opcional) <input type="text" maxlength="300" [value]="nota()" (input)="nota.set($any($event.target).value)" placeholder="Va en la camioneta del martes" /></label>
              <button type="button" class="btn" (click)="crear()" [disabled]="trabajando()">{{ trabajando() ? 'Creando…' : 'Crear transferencia' }}</button>
            </div>
          }
          @if (error()) { <p class="alert alert--danger">{{ error() }}</p> }
          @if (aviso()) { <p class="alert alert--success"><span>{{ aviso() }}</span></p> }
        </section>

        <section class="gestion__seccion">
          <div class="gestion__chips" role="group" aria-label="Estado">
            <button type="button" class="chip" [class.chip--on]="estado() === 'en_transito'" (click)="filtrar('en_transito')">En tránsito</button>
            <button type="button" class="chip" [class.chip--on]="estado() === 'recibida'" (click)="filtrar('recibida')">Recibidas</button>
            <button type="button" class="chip" [class.chip--on]="estado() === 'cancelada'" (click)="filtrar('cancelada')">Canceladas</button>
            <button type="button" class="chip" [class.chip--on]="estado() === null" (click)="filtrar(null)">Todas</button>
          </div>
          @for (t of lista(); track t.id) {
            <div class="stock__transf">
              <div class="stock__transf-cab">
                <strong>#{{ t.id }} · {{ t.desdeNombre }} → {{ t.haciaNombre }}</strong>
                <span class="pill" [class.pill--warning]="t.estado === 'en_transito'" [class.pill--success]="t.estado === 'recibida'" [class.pill--neutral]="t.estado === 'cancelada'">
                  {{ t.estado === 'en_transito' ? 'en tránsito' : t.estado }}
                </span>
                <span class="muted">{{ t.creadaAtUtc | date: 'dd/MM HH:mm' }}@if (t.nota) { · {{ t.nota }} }</span>
              </div>
              <table class="data">
                <thead>
                  <tr><th>Artículo</th><th class="num">Enviado</th><th class="num">Recibido</th>@if (t.estado === 'recibida') { <th class="num">Diferencia</th> }</tr>
                </thead>
                <tbody>
                  @for (i of t.items; track i.codigo) {
                    <tr>
                      <td>{{ i.descripcion ?? i.codigo }}</td>
                      <td class="num">{{ cantidad(i.cantidadEnviada) }}</td>
                      <td class="num">
                        @if (recibiendo() === t.id) {
                          <input class="stock__lim" type="text" inputmode="decimal" [value]="recibido(t.id, i.codigo, i.cantidadEnviada)"
                                 (change)="onRecibido(t.id, i.codigo, $event)" [attr.aria-label]="'Recibido de ' + (i.descripcion ?? i.codigo)" />
                        } @else {
                          {{ i.cantidadRecibida == null ? '—' : cantidad(i.cantidadRecibida) }}
                        }
                      </td>
                      @if (t.estado === 'recibida') {
                        <td class="num" [class.stock__neg]="(i.diferencia ?? 0) < 0">{{ i.diferencia == null ? '—' : diferencia(i.diferencia) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
              @if (t.estado === 'en_transito') {
                <div class="gestion__acciones">
                  @if (recibiendo() === t.id) {
                    <button type="button" class="btn btn--small" (click)="recibir(t)" [disabled]="trabajando()">Confirmar lo recibido</button>
                    <button type="button" class="btn btn--ghost btn--small" (click)="recibiendo.set(null)">Volver</button>
                  } @else {
                    <button type="button" class="btn btn--small" (click)="recibiendo.set(t.id)">Recibir</button>
                    <button type="button" class="btn btn--ghost btn--small" (click)="cancelar(t)" [disabled]="trabajando()">Cancelar</button>
                  }
                </div>
              }
            </div>
          } @empty {
            <p class="muted">{{ cargandoLista() ? 'Cargando…' : 'No hay transferencias ' + (estado() === 'en_transito' ? 'en tránsito' : estado() === 'recibida' ? 'recibidas' : estado() === 'cancelada' ? 'canceladas' : '') + '.' }}</p>
          }
        </section>
      }
    </div>
  `,
  styleUrls: ['../gestion/gestion.scss', './stock.scss'],
})
export class StockTransferenciasComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(StockService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<StockSucursal[]>([]);
  protected readonly desde = signal('');
  protected readonly hacia = signal('');
  protected readonly renglones = signal<Renglon[]>([]);
  protected readonly nota = signal('');

  protected readonly estado = signal<EstadoDeTransferencia | null>('en_transito');
  protected readonly lista = signal<StockTransferencia[]>([]);
  protected readonly cargandoLista = signal(false);
  protected readonly recibiendo = signal<number | null>(null);
  private readonly recibidos = new Map<string, number>();

  protected readonly trabajando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly cantidad = cantidad;
  protected readonly diferencia = diferencia;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) {
          this.errorCuenta.set('Todavía no tenés un comercio dado de alta.');
          return;
        }
        if (!g.gestionStock) {
          this.sinPlan.set(true);
          return;
        }
        this.cuenta.set(g.businessAccountId);
        this.sucursales.set(g.branches.map((b) => ({ branchId: b.branchId, nombre: b.branchName })));
        this.desde.set(g.branches[0]?.branchId ?? '');
        this.hacia.set(g.branches[1]?.branchId ?? '');
        this.cargarLista();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected filtrar(e: EstadoDeTransferencia | null): void {
    this.estado.set(e);
    this.cargarLista();
  }

  private cargarLista(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargandoLista.set(true);
    this.api.transferencias(id, this.estado()).subscribe({
      next: (l) => {
        this.cargandoLista.set(false);
        this.lista.set(l);
      },
      error: (err) => {
        this.cargandoLista.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos cargar las transferencias.'));
      },
    });
  }

  protected agregar(a: ArticuloElegido): void {
    this.aviso.set(null);
    const ya = this.renglones().findIndex((r) => r.codigo === a.codigo);
    if (ya >= 0) {
      this.renglones.update((l) => l.map((r, i) => (i === ya ? { ...r, cantidad: String((numeroONull(r.cantidad) ?? 0) + 1) } : r)));
      return;
    }
    this.renglones.update((l) => [...l, { codigo: a.codigo, descripcion: a.descripcion, cantidad: '1' }]);
  }

  protected cambiar(i: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.renglones.update((l) => l.map((r, j) => (j === i ? { ...r, cantidad: v } : r)));
  }

  protected quitar(i: number): void {
    this.renglones.update((l) => l.filter((_, j) => j !== i));
  }

  protected crear(): void {
    const id = this.cuenta();
    if (id == null || this.trabajando()) return;
    if (this.desde() === this.hacia()) {
      this.error.set('El origen y el destino tienen que ser sucursales distintas.');
      return;
    }
    const malos = this.renglones().filter((r) => (numeroONull(r.cantidad) ?? 0) <= 0);
    if (malos.length > 0) {
      this.error.set(`Revisá la cantidad de ${malos[0].descripcion ?? malos[0].codigo}.`);
      return;
    }
    this.trabajando.set(true);
    this.error.set(null);
    this.api.crearTransferencia(id, this.desde(), this.hacia(), this.renglones().map((r) => ({ codigo: r.codigo, cantidad: numeroONull(r.cantidad)! })),
      this.nota().trim() || null).subscribe({
      next: (t) => {
        this.trabajando.set(false);
        this.renglones.set([]);
        this.nota.set('');
        this.aviso.set(`Transferencia #${t.id} creada: salió de ${t.desdeNombre} y queda en tránsito hasta que la reciban en ${t.haciaNombre}.`);
        this.filtrar('en_transito');
      },
      error: (err) => {
        this.trabajando.set(false);
        const renglones = (err?.error?.renglones ?? []) as { fila: number; codigo: string | null; motivo: string }[];
        this.error.set(mensajeDeError(err, 'No pudimos crear la transferencia.') + (renglones.length ? ` ${renglones[0].codigo}: ${renglones[0].motivo}` : ''));
      },
    });
  }

  protected recibido(tid: number, codigo: string, enviado: number): number {
    return this.recibidos.get(`${tid}|${codigo}`) ?? enviado;
  }

  protected onRecibido(tid: number, codigo: string, e: Event): void {
    const v = numeroONull((e.target as HTMLInputElement).value);
    if (v != null && v >= 0) this.recibidos.set(`${tid}|${codigo}`, v);
  }

  protected recibir(t: StockTransferencia): void {
    const id = this.cuenta();
    if (id == null || this.trabajando()) return;
    this.trabajando.set(true);
    this.error.set(null);
    const renglones = t.items.map((i) => ({ codigo: i.codigo, cantidadRecibida: this.recibido(t.id, i.codigo, i.cantidadEnviada) }));
    this.api.recibirTransferencia(id, t.id, renglones).subscribe({
      next: (r) => {
        this.trabajando.set(false);
        this.recibiendo.set(null);
        const falta = r.items.filter((i) => (i.diferencia ?? 0) !== 0).length;
        this.aviso.set(`Transferencia #${r.id} recibida en ${r.haciaNombre}.${falta ? ` ${falta} ${falta === 1 ? 'artículo llegó' : 'artículos llegaron'} con diferencia.` : ''}`);
        this.cargarLista();
      },
      error: (err) => {
        this.trabajando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos registrar la recepción.'));
      },
    });
  }

  protected cancelar(t: StockTransferencia): void {
    const id = this.cuenta();
    if (id == null || this.trabajando()) return;
    if (!confirm(`¿Cancelar la transferencia #${t.id}? Lo enviado vuelve al stock de ${t.desdeNombre}.`)) return;
    this.trabajando.set(true);
    this.error.set(null);
    this.api.cancelarTransferencia(id, t.id).subscribe({
      next: (r) => {
        this.trabajando.set(false);
        this.aviso.set(`Transferencia #${r.id} cancelada: volvió a ${r.desdeNombre}.`);
        this.cargarLista();
      },
      error: (err) => {
        this.trabajando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos cancelar la transferencia.'));
      },
    });
  }
}
