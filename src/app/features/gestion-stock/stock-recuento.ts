import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensajeDeError, numeroONull, plata } from '../../core/articulos-form';
import { GestionContextoService } from '../../core/gestion-contexto';
import { StockService } from '../../core/stock';
import { cantidad, diferencia, leerPlanillaDeRecuento } from '../../core/stock-form';
import { StockRecuentoResponse, StockSucursal } from '../../core/stock.models';
import { ArticuloBuscadorComponent, ArticuloElegido } from './articulo-buscador';

interface Renglon {
  codigo: string;
  descripcion: string | null;
  contada: string;
}

/**
 * BP-179 bloque 7 (21-oct-2026) -- Gestión → Stock → Recuento. Lo contado, por planilla (código y cantidad) o a mano, con
 * una sola hora para todo el recuento. Primero la vista previa ("Galletitas X: el sistema dice 40, contaste 31, −9") y
 * después se aplica. Solo cambian los artículos de la planilla; el resto queda como está.
 */
@Component({
  selector: 'app-stock-recuento',
  standalone: true,
  imports: [RouterLink, ArticuloBuscadorComponent],
  template: `
    <div class="gestion stock card--page">
      <p><a routerLink="/gestion/stock">← Stock</a></p>
      <h1>Recuento</h1>
      <p class="subtitle">
        Subí la planilla del recuento (dos columnas: <strong>código</strong> y <strong>cantidad</strong>) o cargalo a mano. Antes de
        aplicarlo ves las diferencias contra lo que dice el sistema. Solo cambian los artículos que contaste.
      </p>

      @if (cargandoCuenta()) {
        <p class="muted">Cargando tu comercio…</p>
      } @else if (errorCuenta()) {
        <p class="alert alert--danger">{{ errorCuenta() }}</p>
      } @else if (sinPlan()) {
        <div class="alert alert--info">
          <span>El stock con historial viene con los planes <strong>Avanzado</strong> y <strong>Cadena</strong>. <a routerLink="/plan">Ver planes →</a></span>
        </div>
      } @else {
        <section class="gestion__seccion">
          <div class="gestion__fila-form">
            @if (sucursales().length > 1) {
              <label>
                Sucursal
                <select (change)="cambioSucursal($any($event.target).value)">
                  @for (s of sucursales(); track s.branchId) {
                    <option [value]="s.branchId" [selected]="s.branchId === branchId()">{{ s.nombre }}</option>
                  }
                </select>
              </label>
            }
            <label>
              Cuándo se contó
              <input type="datetime-local" [value]="cuando()" (change)="cuando.set($any($event.target).value); cuandoTocado.set(true); previa.set(null)" />
            </label>
            <label class="btn btn--ghost">
              <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Subir planilla
              <input type="file" accept=".xlsx,.xls,.csv" hidden (change)="planilla($event)" />
            </label>
          </div>
          <p class="muted gestion__ayuda">
            La hora importa: lo que se vendió después de esa hora se descuenta de lo contado; lo de antes ya estaba contado.
            Si no la cambiás, vale la hora en que lo aplicás.
          </p>

          <div class="gestion__fila-form">
            @if (cuenta(); as id) {
              <app-articulo-buscador [cuenta]="id" placeholder="Agregar a mano: código o nombre" (elegido)="agregar($event)" />
            }
          </div>

          @if (erroresPlanilla().length > 0) {
            <div class="alert alert--warning">
              <span>
                {{ erroresPlanilla().length }} {{ erroresPlanilla().length === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer' }}:
                @for (x of erroresPlanilla().slice(0, 8); track $index) { <br />Fila {{ x.fila }}: {{ x.motivo }} }
              </span>
            </div>
          }

          @if (renglones().length > 0 && !previa()) {
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Artículo</th><th class="num">Contado</th><th></th></tr></thead>
                <tbody>
                  @for (r of renglones(); track r.codigo; let i = $index) {
                    <tr>
                      <td class="strong">{{ r.descripcion ?? r.codigo }}<div class="muted gestion__sub">{{ r.codigo }}</div></td>
                      <td class="num"><input class="stock__lim" type="text" inputmode="decimal" [value]="r.contada" (change)="cambiar(i, $event)" [attr.aria-label]="'Contado de ' + (r.descripcion ?? r.codigo)" /></td>
                      <td><button type="button" class="btn btn--ghost btn--small" (click)="quitar(i)" aria-label="Sacar">✕</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="gestion__acciones">
              <button type="button" class="btn" (click)="verDiferencias()" [disabled]="trabajando()">
                {{ trabajando() ? 'Calculando…' : 'Ver diferencias (' + renglones().length + ')' }}
              </button>
              <button type="button" class="btn btn--ghost" (click)="descartar()">Descartar</button>
            </div>
          }

          @if (previa(); as p) {
            <h2>{{ p.vistaPrevia ? 'Diferencias' : 'Recuento aplicado' }}</h2>
            <p>
              {{ p.renglones }} {{ p.renglones === 1 ? 'artículo' : 'artículos' }}, {{ p.conDiferencia }} con diferencia@if (p.diferenciaValorizada !== 0) {
              ({{ p.diferenciaValorizada > 0 ? 'sobran' : 'faltan' }} {{ plata(abs(p.diferenciaValorizada)) }} a costo)}.
              @if (cuandoTocado()) { Comparado con lo que había a las {{ cuando().slice(11, 16) }} del {{ cuando().slice(8, 10) }}/{{ cuando().slice(5, 7) }}. }
            </p>
            @if (p.noEncontrados.length > 0) {
              <p class="alert alert--warning">
                <span>
                  {{ p.noEncontrados.length }} {{ p.noEncontrados.length === 1 ? 'código no es' : 'códigos no son' }} de tu cuenta y no se {{ p.vistaPrevia ? 'van a tocar' : 'tocaron' }}:
                  {{ codigosNoEncontrados(p) }}
                </span>
              </p>
            }
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Artículo</th><th class="num">El sistema dice</th><th class="num">Contaste</th><th class="num">Diferencia</th><th class="num">A costo</th></tr></thead>
                <tbody>
                  @for (x of p.items; track x.codigo) {
                    <tr>
                      <td class="strong">{{ x.descripcion }}<div class="muted gestion__sub">{{ x.codigo }}</div></td>
                      <td class="num">{{ cantidad(x.saldo) }}</td>
                      <td class="num">{{ cantidad(x.contada) }}</td>
                      <td class="num" [class.stock__neg]="x.diferencia < 0">{{ diferencia(x.diferencia) }}</td>
                      <td class="num">{{ x.costoNeto == null ? '—' : plata(x.diferencia * x.costoNeto) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (p.vistaPrevia) {
              <div class="gestion__acciones">
                <button type="button" class="btn" (click)="aplicar()" [disabled]="trabajando()">{{ trabajando() ? 'Aplicando…' : 'Aplicar el recuento' }}</button>
                <button type="button" class="btn btn--ghost" (click)="previa.set(null)">Volver a la lista</button>
              </div>
            } @else {
              <div class="gestion__acciones">
                <a class="btn btn--ghost" routerLink="/gestion/stock">Ver el stock</a>
                <button type="button" class="btn btn--ghost" (click)="descartar()">Otro recuento</button>
              </div>
            }
          }

          @if (error()) { <p class="alert alert--danger">{{ error() }}</p> }
        </section>
      }
    </div>
  `,
  styleUrls: ['../gestion/gestion.scss', './stock.scss'],
})
export class StockRecuentoComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(StockService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);
  protected readonly sucursales = signal<StockSucursal[]>([]);
  protected readonly branchId = signal('');
  protected readonly cuando = signal(ahoraLocal());
  /** Sin tocar la hora, el recuento va con la hora del servidor al aplicarlo (no con la del minuto en que se abrió la página). */
  protected readonly cuandoTocado = signal(false);
  protected readonly origen = signal<'panel' | 'planilla'>('panel');

  protected readonly renglones = signal<Renglon[]>([]);
  protected readonly erroresPlanilla = signal<{ fila: number; motivo: string }[]>([]);
  protected readonly previa = signal<StockRecuentoResponse | null>(null);
  protected readonly trabajando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly plata = plata;
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
        this.branchId.set(g.branches[0]?.branchId ?? '');
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected cambioSucursal(id: string): void {
    this.branchId.set(id);
    this.previa.set(null);
  }

  protected agregar(a: ArticuloElegido): void {
    this.previa.set(null);
    if (this.renglones().some((r) => r.codigo === a.codigo)) return;
    this.renglones.update((l) => [...l, { codigo: a.codigo, descripcion: a.descripcion, contada: '' }]);
  }

  protected cambiar(i: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.renglones.update((l) => l.map((r, j) => (j === i ? { ...r, contada: v } : r)));
  }

  protected quitar(i: number): void {
    this.renglones.update((l) => l.filter((_, j) => j !== i));
  }

  protected descartar(): void {
    this.renglones.set([]);
    this.previa.set(null);
    this.erroresPlanilla.set([]);
    this.error.set(null);
    this.origen.set('panel');
  }

  protected async planilla(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.error.set(null);
    this.previa.set(null);
    try {
      const XLSX = await import('xlsx');
      // Un CSV se lee como texto: si no, "0000000000017" se vuelve el número 17.
      const libro = /\.csv$/i.test(archivo.name)
        ? XLSX.read(await archivo.text(), { type: 'string', raw: true })
        : XLSX.read(await archivo.arrayBuffer());
      const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true });
      const leida = leerPlanillaDeRecuento(filas);
      this.erroresPlanilla.set(leida.errores);
      if (leida.filas.length === 0) {
        this.error.set(leida.errores[0]?.motivo ?? 'La planilla no tiene filas.');
        return;
      }
      this.origen.set('planilla');
      this.renglones.set(leida.filas.map((f) => ({ codigo: f.codigo, descripcion: null, contada: String(f.cantidadContada) })));
      this.verDiferencias();
    } catch {
      this.error.set('No pudimos leer la planilla. Guardala como Excel (.xlsx) o CSV.');
    }
  }

  protected verDiferencias(): void {
    this.enviar(true);
  }

  protected aplicar(): void {
    this.enviar(false);
  }

  private enviar(vistaPrevia: boolean): void {
    const id = this.cuenta();
    const b = this.branchId();
    if (id == null || !b || this.trabajando()) return;
    const malos = this.renglones().filter((r) => numeroONull(r.contada) == null || numeroONull(r.contada)! < 0);
    if (malos.length > 0) {
      this.error.set(`Falta lo contado de ${malos[0].descripcion ?? malos[0].codigo} (0 si no hay ninguno).`);
      return;
    }
    this.trabajando.set(true);
    this.error.set(null);
    const renglones = this.renglones().map((r) => ({ codigo: r.codigo, cantidadContada: numeroONull(r.contada)! }));
    const hora = this.cuandoTocado() && this.cuando() ? `${this.cuando()}:00` : null;
    this.api.recuento(id, b, renglones, vistaPrevia, hora, this.origen(), null).subscribe({
      next: (r) => {
        this.trabajando.set(false);
        this.previa.set(r);
        if (!vistaPrevia) this.renglones.set([]);
      },
      error: (err) => {
        this.trabajando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos procesar el recuento. Probá de nuevo.'));
      },
    });
  }

  protected codigosNoEncontrados(p: StockRecuentoResponse): string {
    const l = p.noEncontrados.map((x) => x.codigo ?? `fila ${x.fila}`);
    return l.slice(0, 10).join(', ') + (l.length > 10 ? '…' : '');
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }
}

/** "2026-10-21T18:40" para un datetime-local. */
function ahoraLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
