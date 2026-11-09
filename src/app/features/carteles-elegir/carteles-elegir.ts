import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BranchListItem } from '../../core/business-account.models';
import { BusinessContextService } from '../../core/business-context';
import { BusinessPriceService } from '../../core/business-price';
import { BusinessAccountProductItem } from '../../core/business-price.models';
import { MAX_CARTELES, ProductoElegido, codigosPegados, coincide, sumar } from '../../core/carteles-seleccion';
import { presentacionTexto } from '../../core/formacion-form';

const CLAVE_SELECCION = 'preciosiq.carteles.seleccion';

// 5-nov-2026 -- "Carteles de góndola" en el menú. Hasta hoy los carteles solo se abrían desde Importaciones (lo que
// cambió en una carga) o desde la formación de precios, y no se encontraban (Andrés: "no logro recordar dónde
// imprimo las etiquetas"). Acá se eligen productos sueltos (buscando o pegando códigos) y se abre la misma hoja de
// siempre, /precios/carteles?eans=&branchId=, en otra pestaña. Todos los planes, como la hoja.
// La selección queda en el navegador (sessionStorage) para no perderla al ir y volver.
@Component({
  selector: 'app-carteles-elegir',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './carteles-elegir.html',
  styleUrl: './carteles-elegir.scss',
})
export class CartelesElegirComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly prices = inject(BusinessPriceService);

  protected readonly max = MAX_CARTELES;
  protected readonly loadingContext = signal(true);
  protected readonly noAccountYet = signal(false);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly branches = signal<BranchListItem[]>([]);
  protected readonly branchId = signal('');
  private businessAccountId: number | null = null;

  protected readonly texto = signal('');
  protected readonly buscando = signal(false);
  protected readonly resultados = signal<BusinessAccountProductItem[] | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly pegadoAbierto = signal(false);
  protected readonly pegado = signal('');

  protected readonly seleccion = signal<ProductoElegido[]>(leerSeleccion());
  protected readonly elegidos = computed(() => new Set(this.seleccion().map((p) => p.ean)));
  protected readonly llena = computed(() => this.seleccion().length >= MAX_CARTELES);
  protected readonly nombreSucursal = computed(() => this.branches().find((b) => b.branchId === this.branchId())?.branchName ?? '');
  /** BP-226 -- la tarea "colgá estos carteles" con estos productos, a todas las sucursales (se puede cambiar en el alta). */
  protected readonly paramsTarea = computed(() => ({
    eans: this.seleccion().map((p) => p.ean).join(','),
    origen: 'carteles',
  }));
  /** Los parámetros de la hoja de carteles. */
  protected readonly paramsCarteles = computed(() => ({
    eans: this.seleccion().map((p) => p.ean).join(','),
    branchId: this.branchId(),
  }));

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId = ctx.account.businessAccountId;
        this.branches.set(ctx.branches);
        if (ctx.branches[0]) this.branchId.set(ctx.branches[0].branchId);
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected onSucursal(event: Event): void {
    this.branchId.set((event.target as HTMLSelectElement).value);
    // Los precios del resultado son de la sucursal anterior: se vuelve a buscar.
    if (this.resultados() !== null) this.buscar();
  }

  protected onTexto(event: Event): void {
    this.texto.set((event.target as HTMLInputElement).value);
  }

  protected buscar(): void {
    const q = this.texto().trim();
    if (this.businessAccountId == null || !this.branchId() || q.length < 2) return;
    this.buscando.set(true);
    this.errorMessage.set(null);
    this.aviso.set(null);
    this.prices.searchOwnProducts(this.businessAccountId, this.branchId(), q).subscribe({
      next: (r) => {
        this.buscando.set(false);
        this.resultados.set(r.items.filter((i) => coincide(i, q)));
      },
      error: () => {
        this.buscando.set(false);
        this.errorMessage.set('No pudimos buscar en tus productos. Probá de nuevo en un rato.');
      },
    });
  }

  protected agregar(p: BusinessAccountProductItem): void {
    this.sumar([{ ean: p.ean, descripcion: p.description, marca: p.brand || null, precio: p.listPrice }]);
  }

  protected agregarTodos(): void {
    const items = (this.resultados() ?? []).map((p) => ({ ean: p.ean, descripcion: p.description, marca: p.brand || null, precio: p.listPrice }));
    this.sumar(items);
  }

  protected onPegado(event: Event): void {
    this.pegado.set((event.target as HTMLTextAreaElement).value);
  }

  protected agregarPegados(): void {
    const codigos = codigosPegados(this.pegado());
    if (codigos.length === 0) {
      this.aviso.set('No encontramos códigos en lo que pegaste.');
      return;
    }
    this.sumar(codigos.map((ean) => ({ ean, descripcion: null, marca: null, precio: null })));
    this.pegado.set('');
  }

  private sumar(nuevos: ProductoElegido[]): void {
    const r = sumar(this.seleccion(), nuevos);
    this.guardar(r.lista);
    this.aviso.set(
      r.sobran > 0
        ? `Se pueden imprimir hasta ${MAX_CARTELES} carteles por tanda: ${r.sobran} no ${r.sobran === 1 ? 'entró' : 'entraron'}. Imprimí estos y después armá otra tanda.`
        : null,
    );
  }

  protected quitar(ean: string): void {
    this.guardar(this.seleccion().filter((p) => p.ean !== ean));
    this.aviso.set(null);
  }

  protected vaciar(): void {
    this.guardar([]);
    this.aviso.set(null);
  }

  private guardar(lista: ProductoElegido[]): void {
    this.seleccion.set(lista);
    try {
      sessionStorage.setItem(CLAVE_SELECCION, JSON.stringify(lista));
    } catch {
      /* sin almacenamiento: la selección dura lo que la pantalla */
    }
  }

  protected presentacion(p: BusinessAccountProductItem): string {
    return presentacionTexto(p.presentationQuantity, p.presentationUnit);
  }

  protected precio(n: number | null): string {
    return n == null ? '—' : '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

function leerSeleccion(): ProductoElegido[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLAVE_SELECCION) ?? '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.ean === 'string').slice(0, MAX_CARTELES) : [];
  } catch {
    return [];
  }
}
