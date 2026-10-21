import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BusinessContextService } from '../../core/business-context';
import { mensajeDeError } from '../../core/articulos-form';
import { FormacionService } from '../../core/formacion';
import {
  TAMANOS,
  TamanoDeCartel,
  enHojas,
  precioPartido,
  presentacionTexto,
  promoDelCartel,
  referenciaDelCartel,
} from '../../core/formacion-form';
import { CartelItem, CartelesOrigen, CartelesResponse } from '../../core/formacion.models';

const CLAVE_TAMANO = 'preciosiq.carteles.tamano';

/**
 * BP-181 (21-oct-2026) -- carteles de góndola para imprimir en A4, FUERA del shell (como el cartel de la tienda). Entra con
 * ?batchId= o ?groupId= (lo que cambió en esa carga: la formación de precios o cualquier carga masiva) o con ?eans=
 * (una selección). Con un grupo se elige la sucursal (?branchId=), porque cada sucursal puede tener otro precio.
 * Cada cartel: descripción, marca, presentación, precio grande, precio por kilo o litro si aporta, la promo vigente con
 * el texto de la caja (promo-calculator), el código y la fecha. Sin código de barras dibujado en v1 (anotado).
 */
@Component({
  selector: 'app-carteles-gondola',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="barra no-imprimir">
      <a routerLink="/precios/importaciones">← Importaciones</a>
      @if (datos(); as d) {
        <span class="barra__titulo">{{ d.titulo }} · {{ d.items.length }} {{ d.items.length === 1 ? 'cartel' : 'carteles' }}</span>
        @if (d.sucursales.length > 1) {
          <label>Precios de
            <select (change)="elegirSucursal($any($event.target).value)">
              @for (s of d.sucursales; track s.branchId) {
                <option [value]="s.branchId" [selected]="s.branchId === d.sucursal.branchId">{{ s.nombre }}</option>
              }
            </select>
          </label>
        } @else {
          <span>{{ d.sucursal.nombre }}</span>
        }
        <label>Tamaño
          <select (change)="elegirTamano($any($event.target).value)">
            @for (t of tamanos; track t.clave) {
              <option [value]="t.clave" [selected]="t.clave === tamano()">{{ t.etiqueta }}</option>
            }
          </select>
        </label>
        @if (d.items.length > 0) {
          <button type="button" (click)="imprimir()">Imprimir o guardar como PDF</button>
        }
      }
    </div>

    @if (error()) {
      <p class="aviso no-imprimir">{{ error() }}</p>
    } @else if (cargando()) {
      <p class="aviso no-imprimir">Armando los carteles…</p>
    } @else if (datos(); as d) {
      @if (d.items.length === 0) {
        <p class="aviso no-imprimir">
          Esta carga no tiene precios para cartelear: no cambió ningún precio, o se deshizo.
        </p>
      }
      @if (d.noEstan.length > 0) {
        <p class="aviso no-imprimir">
          {{ d.noEstan.length }} {{ d.noEstan.length === 1 ? 'código no tiene' : 'códigos no tienen' }} precio en {{ d.sucursal.nombre }}:
          {{ d.noEstan.slice(0, 10).join(', ') }}{{ d.noEstan.length > 10 ? '…' : '' }}
        </p>
      }
      @for (hoja of hojas(); track $index) {
        <section class="hoja" [class]="'hoja hoja--' + tamano()">
          @for (c of hoja; track c.codigo) {
            <article class="cartel" [class.cartel--promo]="!!c.promo">
              <div class="cartel__desc">{{ c.descripcion }}</div>
              <div class="cartel__sub">
                @if (c.marca) { <span>{{ c.marca }}</span> }
                @if (presentacion(c)) { <span>{{ presentacion(c) }}</span> }
              </div>
              @if (promo(c); as p) {
                <div class="cartel__promo">{{ p.texto }}</div>
              }
              <div class="cartel__precio">
                <span class="cartel__signo">$</span>{{ partido(c).enteros }}@if (partido(c).centavos) {<sup>{{ partido(c).centavos }}</sup>}
              </div>
              @if (referencia(c)) { <div class="cartel__ref">{{ referencia(c) }}</div> }
              @if (promo(c)?.ejemplo; as ej) { <div class="cartel__ej">{{ ej }}</div> }
              <div class="cartel__pie"><span>{{ c.codigo }}</span><span>{{ fecha }}</span></div>
            </article>
          }
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; background: #e5e7eb; color: #111; min-height: 100vh; font-family: Arial, Helvetica, sans-serif; }
    .barra { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1.2rem; padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #d1d5db; }
    .barra__titulo { font-weight: 700; }
    .barra select { margin-left: 0.35rem; padding: 0.3rem; }
    .barra button { margin-left: auto; padding: 0.55rem 1.2rem; border: 0; border-radius: 6px; background: #4f46e5; color: #fff; font-size: 0.95rem; cursor: pointer; }
    .aviso { max-width: 210mm; margin: 1rem auto; padding: 0.75rem 1rem; background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; }

    /* Una hoja A4 por sección; en pantalla, como hojas sobre la mesa. */
    .hoja { width: 210mm; min-height: 297mm; margin: 1rem auto; padding: 6mm; box-sizing: border-box; background: #fff;
            display: grid; align-content: start; gap: 0; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
    .hoja--chico { grid-template-columns: repeat(3, 66mm); grid-auto-rows: 35.6mm; }
    .hoja--mediano { grid-template-columns: repeat(2, 99mm); grid-auto-rows: 57mm; }
    .hoja--grande { grid-template-columns: repeat(2, 99mm); grid-auto-rows: 142mm; }

    .cartel { box-sizing: border-box; border: 0.3mm dashed #9ca3af; padding: 2mm 3mm; display: flex; flex-direction: column; overflow: hidden; }
    .cartel__desc { font-weight: 700; text-transform: uppercase; line-height: 1.1; font-size: 3mm;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .cartel__sub { display: flex; gap: 2mm; font-size: 2.4mm; color: #374151; margin-top: 0.5mm; }
    .cartel__promo { align-self: flex-start; background: #dc2626; color: #fff; font-weight: 700; font-size: 3mm; padding: 0.4mm 1.5mm; border-radius: 1mm; margin-top: 1mm; }
    .cartel__precio { font-weight: 800; font-size: 11mm; line-height: 1; margin-top: auto; letter-spacing: -0.3mm; }
    .cartel__precio sup { font-size: 0.45em; vertical-align: 0.9em; margin-left: 0.3mm; }
    .cartel__signo { font-size: 0.55em; vertical-align: 0.55em; margin-right: 0.5mm; }
    .cartel__ref { font-size: 2.4mm; color: #374151; }
    .cartel__ej { font-size: 2.3mm; color: #b91c1c; font-weight: 700; }
    .cartel__pie { display: flex; justify-content: space-between; font-size: 2mm; color: #6b7280; margin-top: 0.8mm; }
    .cartel--promo { border-color: #dc2626; }

    .hoja--mediano .cartel__desc { font-size: 4mm; }
    .hoja--mediano .cartel__sub, .hoja--mediano .cartel__ref { font-size: 3mm; }
    .hoja--mediano .cartel__promo { font-size: 4mm; }
    .hoja--mediano .cartel__precio { font-size: 18mm; }
    .hoja--mediano .cartel__ej { font-size: 3mm; }
    .hoja--mediano .cartel__pie { font-size: 2.5mm; }

    .hoja--grande .cartel { padding: 6mm; }
    .hoja--grande .cartel__desc { font-size: 7mm; -webkit-line-clamp: 3; }
    .hoja--grande .cartel__sub, .hoja--grande .cartel__ref { font-size: 4.5mm; }
    .hoja--grande .cartel__promo { font-size: 8mm; padding: 1mm 3mm; margin-top: 4mm; }
    .hoja--grande .cartel__precio { font-size: 34mm; }
    .hoja--grande .cartel__ej { font-size: 4.5mm; }
    .hoja--grande .cartel__pie { font-size: 3.5mm; }

    @media print {
      @page { size: A4 portrait; margin: 0; }
      :host { background: #fff; }
      .no-imprimir { display: none !important; }
      .hoja { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
      .hoja:last-of-type { page-break-after: auto; break-after: auto; }
      .cartel__promo { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `,
})
export class CartelesGondolaComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly api = inject(FormacionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly datos = signal<CartelesResponse | null>(null);
  protected readonly tamano = signal<TamanoDeCartel>(leerTamano());
  protected readonly hojas = computed(() => enHojas(this.datos()?.items ?? [], TAMANOS[this.tamano()].porHoja));
  protected readonly tamanos = (Object.keys(TAMANOS) as TamanoDeCartel[]).map((clave) => ({ clave, etiqueta: TAMANOS[clave].etiqueta }));
  protected readonly fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  private readonly hoy = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  private cuenta: number | null = null;

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        if (!ctx) {
          this.cargando.set(false);
          this.error.set('Todavía no tenés un comercio dado de alta.');
          return;
        }
        this.cuenta = ctx.account.businessAccountId;
        this.route.queryParamMap.subscribe((q) => this.cargar(origenDe(q.get('batchId'), q.get('groupId'), q.get('eans'), q.get('branchId'))));
      },
      error: () => {
        this.cargando.set(false);
        this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  private cargar(o: CartelesOrigen | null): void {
    if (this.cuenta == null) return;
    if (!o) {
      this.cargando.set(false);
      this.error.set('Abrí los carteles desde Importaciones (una carga) o desde la formación de precios.');
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    this.api.carteles(this.cuenta, o).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.datos.set(r);
      },
      error: (err) => {
        this.cargando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos armar los carteles. Probá recargar la página.'));
      },
    });
  }

  protected elegirSucursal(branchId: string): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { branchId }, queryParamsHandling: 'merge' });
  }

  protected elegirTamano(t: TamanoDeCartel): void {
    this.tamano.set(t);
    try {
      localStorage.setItem(CLAVE_TAMANO, t);
    } catch {
      /* no importa */
    }
  }

  protected imprimir(): void {
    window.print();
  }

  protected presentacion(c: CartelItem): string {
    return presentacionTexto(c.presentacionCantidad, c.presentacionUnidad);
  }

  protected referencia(c: CartelItem): string | null {
    return referenciaDelCartel(c);
  }

  protected promo(c: CartelItem): { texto: string; ejemplo: string | null } | null {
    return promoDelCartel(c, this.hoy);
  }

  protected partido(c: CartelItem): { enteros: string; centavos: string | null } {
    return precioPartido(c.precio);
  }
}

/** Los query params como origen de los carteles, o null si no hay ninguno válido. */
export function origenDe(batchId: string | null, groupId: string | null, eans: string | null, branchId: string | null): CartelesOrigen | null {
  const b = Number(batchId);
  const g = Number(groupId);
  const lista = (eans ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (batchId && Number.isInteger(b) && b > 0) return { batchId: b, branchId };
  if (groupId && Number.isInteger(g) && g > 0) return { groupId: g, branchId };
  if (lista.length > 0) return { eans: lista, branchId };
  return null;
}

function leerTamano(): TamanoDeCartel {
  try {
    const t = localStorage.getItem(CLAVE_TAMANO);
    return t === 'chico' || t === 'mediano' || t === 'grande' ? t : 'chico';
  } catch {
    return 'chico';
  }
}
