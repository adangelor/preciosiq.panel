import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BusinessPriceService } from '../../core/business-price';
import {
  BusinessAccountProductItem,
  BusinessPriceResponse,
  esPesable,
  PagedBusinessAccountProductsResponse,
  PRESENTATION_UNIT_OPTIONS,
  ProductSearchResult,
  PromoRule,
  PromoTipo,
  UpsertBusinessPriceRequest,
} from '../../core/business-price.models';
import { vistaPrevia } from '../../core/promo-calculator';
import { planGateErrorMessage } from '../../core/plan-gate';
import { BusinessContextService } from '../../core/business-context';
import { BranchListItem } from '../../core/business-account.models';
import { BrandLabelPipe } from '../../core/brand-label';

// E4.4 -- carga manual de precio. Busca el producto por EAN/descripcion (E4.2) para
// autocompletar; si no aparece nada, el comerciante completa Description/Brand a mano
// y el backend da de alta el producto en el mismo paso (E4.3).
//
// E1.9 (16-ago-2026) -- businessAccountId ya no se pide a mano (queda oculto, resuelto
// solo via BusinessContextService) y branchId paso de texto libre a un <select> con
// nombre de sucursal -- mismo fix que el resto del panel.
//
// E10.6 (18-ago-2026) -- dos pedidos de Andres juntos:
// 1) Cuando se llega al cupo de EAN del plan, el 402 generico no alcanza -- hay que
//    mostrar CUALES EAN estan ocupando el cupo (paginado de a 20) con boton grande a
//    /plan, y poder borrar/renombrar un EAN desde ahi mismo sin salir de la pantalla.
// 2) Los campos de nombre/cantidad/unidad de presentacion YA NO se ocultan cuando el
//    EAN es conocido (`productKnown`) -- hay demasiados nombres mal cargados en la
//    base ("Aceit Cañul1500lts" en vez de "Aceite Cañuelas 1.5 litros", cantidad "1"
//    cuando en realidad son "1500 cc") como para no dejar corregirlos desde aca. La
//    unidad ahora es un <select> (ver PRESENTATION_UNIT_OPTIONS) en vez de texto libre.
//
// BP-38 (16-sep-2026) -- los dos pares "Precio Promo / Leyenda" se fueron. La promo es una
// REGLA (la misma que cobra la caja: precio por cantidad, porcentaje, NxM, N-ésima), con
// vista previa en vivo calculada con core/promo-calculator.ts. Al elegir un producto ya
// cargado, la regla activa viene cargada. Guardar SIN tocar la sección Promo manda
// promoRule AUSENTE (no null): guardar solo un cambio de precio no borra la promo.
@Component({
  selector: 'app-price-upsert',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, RouterLink, BrandLabelPipe],
  templateUrl: './price-upsert.html',
  styleUrl: './price-upsert.scss',
})
export class PriceUpsertComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly priceService = inject(BusinessPriceService);
  private readonly context = inject(BusinessContextService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly branches = signal<BranchListItem[]>([]);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<BusinessPriceResponse | null>(null);
  protected readonly suggestions = signal<ProductSearchResult[]>([]);
  protected readonly productKnown = signal(false);

  protected readonly unitOptions = PRESENTATION_UNIT_OPTIONS;

  // E12.6 (22-ago-2026, pedido de Andres) -- despues de guardar, el formulario
  // quedaba con los valores del producto anterior: no habia forma de saber si
  // habia guardado, y el precio viejo seguia ahi listo para mandarse de nuevo por
  // error contra otro EAN. Ahora se avisa con un toast y se limpia el formulario.
  protected readonly toastMessage = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly TOAST_MS = 5000;

  // Para devolver el foco al EAN despues de guardar: cargar precios es repetitivo,
  // el siguiente paso SIEMPRE es tipear el proximo codigo.
  private readonly eanInput = viewChild<ElementRef<HTMLInputElement>>('eanInput');

  // E10.6 -- estado del panel de "llegaste al cupo de tu plan".
  protected readonly planLimitReached = signal(false);
  protected readonly productsPage = signal<PagedBusinessAccountProductsResponse | null>(null);
  protected readonly loadingProducts = signal(false);

  // Confirmacion en 2 clicks para borrar (sin dialog modal: primer click marca la fila
  // "por confirmar", el boton cambia a "¿Seguro? Borrar" -- segundo click ejecuta).
  protected readonly confirmDeleteKey = signal<string | null>(null);
  protected readonly deletingKey = signal<string | null>(null);

  // Edicion inline de EAN: una fila a la vez.
  protected readonly editingEanKey = signal<string | null>(null);
  protected readonly newEanValue = signal('');
  protected readonly changingEan = signal(false);
  protected readonly changeEanError = signal<string | null>(null);

  // BP-38 -- la regla activa del producto elegido (para mostrar "cargada en la caja", etc.),
  // la vista previa en vivo y el error de la regla (mismos mensajes que la caja y el servidor).
  protected readonly loadedRule = signal<PromoRule | null>(null);
  protected readonly loadedRuleOrigin = signal<'propio' | null>(null);
  protected readonly promoPreview = signal<string | null>(null);
  protected readonly promoError = signal<string | null>(null);
  protected readonly showPromo2 = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    businessAccountId: [null as number | null, [Validators.required]],
    branchId: ['', [Validators.required]],
    ean: ['', [Validators.required, Validators.minLength(3)]],
    listPrice: [null as number | null, [Validators.required, Validators.min(0.01)]],
    description: [''],
    brand: [''],
    presentationQuantity: [1],
    presentationUnit: ['UN'],
    // BP-38 -- la regla de promo. Grupo propio para saber si el usuario la TOCO (dirty):
    // si no la toco, se manda promoRule ausente y el servidor no toca la regla.
    promo: this.fb.nonNullable.group({
      tipo: ['' as PromoTipo | ''],
      precio: [null as number | null],
      porcentaje: [null as number | null],
      grupoN: [null as number | null],
      pagaM: [null as number | null],
      cadaN: [null as number | null],
      min: [null as number | null],
      max: [null as number | null],
      desde: [''],
      hasta: [''],
      leyenda: [''],
      todasLasSucursales: [false],
    }),
    // Promo 2 queda como leyenda adicional: solo se muestra en la red, la caja no la cobra.
    promo2Text: [''],
  });

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.branches.set(ctx.branches);
        this.form.patchValue({ businessAccountId: ctx.account.businessAccountId });
        if (ctx.branches.length > 0) {
          this.form.patchValue({ branchId: ctx.branches[0].branchId });
        }
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  constructor() {
    this.form.controls.ean.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          // Al limpiar el formulario despues de guardar, el EAN pasa a '' y esto
          // disparaba una busqueda con query vacio. De paso evita pegarle a la API
          // con 1-2 caracteres, que nunca devuelve nada util.
          const q = (query ?? '').trim();
          return q.length < 3 ? of([] as ProductSearchResult[]) : this.priceService.searchProduct(q);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        this.suggestions.set(results);
        const exact = results.find((r) => r.ean === this.form.controls.ean.value);
        this.productKnown.set(!!exact);
        if (exact) {
          this.form.patchValue({ description: exact.description, brand: exact.brand }, { emitEvent: false });
        }
        this.loadOwnProduct();
      });

    // BP-38 -- la regla y su vista previa dependen de la sucursal (la regla activa es por
    // sucursal), del precio de lista y de la unidad (pesables).
    this.form.controls.branchId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.loadOwnProduct());
    this.form.controls.promo.controls.tipo.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onPromoTipoChange());
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.recomputePromo());
  }

  protected pickSuggestion(result: ProductSearchResult): void {
    this.form.patchValue({ ean: result.ean, description: result.description, brand: result.brand });
    this.productKnown.set(true);
    this.suggestions.set([]);
    this.loadOwnProduct();
  }

  // ─────────────────────────────────────────────────────────────
  // BP-38 -- promo (regla)
  // ─────────────────────────────────────────────────────────────

  protected get pesable(): boolean {
    return esPesable(this.form.controls.presentationUnit.value);
  }

  protected get promoTipo(): PromoTipo | '' {
    return this.form.controls.promo.controls.tipo.value;
  }

  private lastOwnLookup = '';

  /** Si el EAN ya está cargado en la sucursal elegida, trae precio, presentación y la regla activa. */
  private loadOwnProduct(): void {
    const { businessAccountId, branchId, ean } = this.form.getRawValue();
    const e = (ean ?? '').trim();
    const key = `${businessAccountId}|${branchId}|${e}`;
    if (!businessAccountId || !branchId || e.length < 3 || key === this.lastOwnLookup) return;
    this.lastOwnLookup = key;

    this.priceService.getOwnProduct(businessAccountId, branchId, e).subscribe({
      next: (page) => {
        // El usuario pudo seguir tipeando: solo vale si sigue siendo el mismo producto.
        const now = this.form.getRawValue();
        if (`${now.businessAccountId}|${now.branchId}|${(now.ean ?? '').trim()}` !== key) return;
        const item = page.items.find((i) => i.ean === e && i.branchId === branchId) ?? null;
        this.applyOwnProduct(item);
      },
      error: () => {
        // Sin el producto propio el formulario sigue sirviendo para dar de alta: no se avisa.
      },
    });
  }

  private applyOwnProduct(item: BusinessAccountProductItem | null): void {
    this.loadedRuleOrigin.set(item ? 'propio' : null);
    this.loadedRule.set(item?.promoRule ?? null);
    if (item) {
      const v = this.form.getRawValue();
      this.form.patchValue(
        {
          listPrice: v.listPrice ?? item.listPrice,
          presentationQuantity: item.presentationQuantity,
          presentationUnit: item.presentationUnit || 'UN',
          promo2Text: item.promo2Text ?? '',
        },
        { emitEvent: false },
      );
      this.showPromo2.set(!!item.promo2Text);
    }
    this.patchRule(item?.promoRule ?? null);
  }

  /** Carga la regla en la sección Promo SIN marcarla como tocada (guardar igual manda promoRule ausente). */
  private patchRule(r: PromoRule | null): void {
    const promo = this.form.controls.promo;
    promo.reset(
      {
        tipo: r?.tipo ?? '',
        precio: r?.precioPromo ?? null,
        porcentaje: r?.porcentaje ?? null,
        grupoN: r?.grupoN ?? null,
        pagaM: r?.pagaM ?? null,
        cadaN: r?.cadaN ?? null,
        min: r?.minQty ?? null,
        max: r?.maxQty ?? null,
        desde: r?.validFrom ?? '',
        hasta: r?.validTo ?? '',
        leyenda: r?.leyenda ?? '',
        todasLasSucursales: r ? r.branchId === null : false,
      },
      { emitEvent: false },
    );
    promo.markAsPristine();
    this.recomputePromo();
  }

  private onPromoTipoChange(): void {
    // Defaults razonables por tipo, para que la vista previa aparezca de una (como la caja).
    const c = this.form.controls.promo.controls;
    const min = c.min.value;
    switch (this.promoTipo) {
      case 'n_x_m': {
        const n = c.grupoN.value ?? 3;
        c.grupoN.setValue(n);
        if (c.pagaM.value == null) c.pagaM.setValue(2);
        c.min.setValue(Math.max(min ?? 0, n));
        break;
      }
      case 'enesima_porcentaje': {
        const n = c.cadaN.value ?? 2;
        c.cadaN.setValue(n);
        if (c.porcentaje.value == null) c.porcentaje.setValue(50);
        c.min.setValue(Math.max(min ?? 0, n));
        break;
      }
      case 'precio_unitario':
      case 'porcentaje':
        if (min == null) c.min.setValue(3);
        break;
    }
    this.recomputePromo();
  }

  /** La regla tal como se manda (null = sin promo). Lanza un Error con mensaje a persona si está mal. */
  protected buildRule(): PromoRule | null {
    const v = this.form.controls.promo.getRawValue();
    const tipo = v.tipo;
    if (!tipo) return null;
    const num = (x: number | string | null | undefined): number | null =>
      x === null || x === '' || x === undefined ? null : Number(x);
    const listPrice = num(this.form.controls.listPrice.value);
    const unit = this.form.controls.presentationUnit.value;
    const rule: PromoRule = {
      id: null,
      branchId: null, // el ámbito lo decide promoRuleTodasLasSucursales
      tipo,
      minQty: num(v.min) ?? 1,
      maxQty: num(v.max),
      precioPromo: tipo === 'precio_unitario' ? num(v.precio) : null,
      porcentaje: tipo === 'porcentaje' || tipo === 'enesima_porcentaje' ? num(v.porcentaje) : null,
      grupoN: tipo === 'n_x_m' ? num(v.grupoN) : null,
      pagaM: tipo === 'n_x_m' ? num(v.pagaM) : null,
      cadaN: tipo === 'enesima_porcentaje' ? num(v.cadaN) : null,
      validFrom: v.desde || null,
      validTo: v.hasta || null,
      activa: true,
      leyenda: v.leyenda?.trim() ? v.leyenda.trim() : null,
    };
    // Misma validación que la caja (pages/producto) y el servidor (PromoRuleService.ValidarRegla).
    if (rule.minQty <= 0) throw new Error('El mínimo tiene que ser mayor a cero.');
    if (rule.maxQty != null && rule.maxQty < rule.minQty) throw new Error('El máximo no puede ser menor que el mínimo.');
    if (rule.validFrom && rule.validTo && rule.validTo < rule.validFrom)
      throw new Error('La vigencia termina antes de empezar: revisá las fechas.');
    switch (rule.tipo) {
      case 'precio_unitario':
        if (!rule.precioPromo || rule.precioPromo <= 0) throw new Error('Falta el precio promo (mayor a cero).');
        if (listPrice && rule.precioPromo >= listPrice) throw new Error('El precio promo tiene que ser menor que el de lista.');
        break;
      case 'porcentaje':
        if (!rule.porcentaje || rule.porcentaje <= 0 || rule.porcentaje > 100)
          throw new Error('El porcentaje tiene que estar entre 0 y 100.');
        break;
      case 'n_x_m':
        if (esPesable(unit)) throw new Error(`Un producto que se vende por ${unit} no puede tener 3x2.`);
        if (!rule.grupoN || !rule.pagaM || rule.pagaM <= 0 || rule.grupoN <= rule.pagaM)
          throw new Error('NxM necesita N mayor que M y M mayor a cero (ej. 3x2).');
        if (rule.minQty < rule.grupoN)
          throw new Error(`Con ${rule.grupoN}x${rule.pagaM} el mínimo tiene que ser al menos ${rule.grupoN}.`);
        if (rule.minQty !== Math.floor(rule.minQty)) throw new Error('Con NxM el mínimo tiene que ser entero.');
        break;
      case 'enesima_porcentaje':
        if (esPesable(unit)) throw new Error(`Un producto que se vende por ${unit} no puede tener "segunda al 50 %".`);
        if (!rule.cadaN || rule.cadaN < 2) throw new Error('La N-ésima unidad tiene que ser la segunda o más (N ≥ 2).');
        if (!rule.porcentaje || rule.porcentaje <= 0 || rule.porcentaje > 100)
          throw new Error('El porcentaje tiene que estar entre 0 y 100.');
        if (rule.minQty < rule.cadaN)
          throw new Error(`Con la ${rule.cadaN}ª unidad con descuento el mínimo tiene que ser al menos ${rule.cadaN}.`);
        if (rule.minQty !== Math.floor(rule.minQty)) throw new Error('Con N-ésima el mínimo tiene que ser entero.');
        break;
    }
    return rule;
  }

  /** Vista previa en vivo con la misma función que cobra la caja: "Llevando 3 de $2.500: $6.300 (ahorra $1.200)". */
  private recomputePromo(): void {
    const tipo = this.form.controls.promo.controls.tipo;
    if (this.pesable && (tipo.value === 'n_x_m' || tipo.value === 'enesima_porcentaje')) {
      tipo.setValue('', { emitEvent: false });
      // Pasó a pesable con un 3x2 cargado: "sin promo" tiene que viajar (null), no quedar ausente.
      this.form.controls.promo.markAsDirty();
    }
    try {
      const rule = this.buildRule();
      const listPrice = Number(this.form.controls.listPrice.value);
      this.promoError.set(null);
      this.promoPreview.set(rule && listPrice > 0 ? vistaPrevia(rule, listPrice, PriceUpsertComponent.hoy()) : null);
    } catch (e) {
      this.promoPreview.set(null);
      this.promoError.set((e as Error).message);
    }
  }

  private static hoy(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const nullIfEmpty = (s: string) => (s?.trim() ? s.trim() : null);
    const request: UpsertBusinessPriceRequest = {
      businessAccountId: value.businessAccountId!,
      branchId: value.branchId,
      ean: value.ean,
      listPrice: value.listPrice!,
      description: value.description,
      brand: value.brand,
      presentationQuantity: value.presentationQuantity,
      presentationUnit: value.presentationUnit,
      promo2UnitPrice: null,
      promo2Text: nullIfEmpty(value.promo2Text),
    };

    // BP-38 -- promoRule solo si la sección se tocó: ausente = el servidor no toca la regla.
    if (this.form.controls.promo.dirty) {
      try {
        request.promoRule = this.buildRule();
      } catch (e) {
        this.promoError.set((e as Error).message);
        this.errorMessage.set((e as Error).message);
        return;
      }
      request.promoRuleTodasLasSucursales = request.promoRule ? value.promo.todasLasSucursales : false;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.result.set(null);
    this.planLimitReached.set(false);

    this.priceService.upsert(request).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.result.set(response);
        this.showToast(PriceUpsertComponent.successMessage(response));
        this.resetForNextProduct();
        // Si la lista de abajo estaba abierta (cupo lleno o "Ver mis productos"), queda
        // vieja -- se refresca para reflejar el estado real.
        if (this.productsPage()) this.loadProductsPage(this.productsPage()!.page);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        // PreciosIQ E10.2 (rediseñado) -- si esto es un EAN nuevo y la cuenta ya llego
        // al cupo de productos de su plan, el backend devuelve 402 con un mensaje
        // especifico (ver PlanLimits.ProductLimitMessage). E10.6: ademas de mostrar el
        // mensaje, se carga la lista paginada de EAN ya cargados para que el
        // comerciante pueda borrar/renombrar uno en vez de quedarse trabado.
        this.errorMessage.set(
          planGateErrorMessage(err) ?? err?.error?.error ?? 'No se pudo guardar el precio. Intenta de nuevo en unos minutos.',
        );
        if (err.status === 402) {
          this.planLimitReached.set(true);
          this.loadProductsPage(1);
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Confirmacion de guardado
  // ─────────────────────────────────────────────────────────────

  private static successMessage(r: BusinessPriceResponse): string {
    const accion = r.wasNewProduct ? 'Producto creado' : 'Precio actualizado';
    const detalle: string[] = [];
    if (r.previousListPrice) detalle.push(`antes $${r.previousListPrice}`);
    if (r.promoRuleTexto) detalle.push(`promo: ${r.promoRuleTexto}`);

    const base = `${accion} — ${r.ean}: $${r.listPrice}`;
    return detalle.length ? `${base} (${detalle.join(' · ')})` : base;
  }

  private showToast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage.set(message);
    this.toastTimer = setTimeout(
      () => this.toastMessage.set(null),
      PriceUpsertComponent.TOAST_MS,
    );
  }

  protected dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toastMessage.set(null);
  }

  ngOnDestroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  /**
   * Deja el formulario listo para el proximo producto.
   *
   * Se limpia SOLO lo que cambia de un producto a otro. La cuenta y la sucursal
   * quedan puestas a proposito: quien carga precios carga varios seguidos de la
   * misma sucursal, y volver a elegirla en cada uno seria una friccion tonta.
   */
  private resetForNextProduct(): void {
    this.form.patchValue({
      ean: '',
      listPrice: null,
      description: '',
      brand: '',
      presentationQuantity: 1,
      presentationUnit: 'UN',
      promo2Text: '',
    });
    this.lastOwnLookup = '';
    this.loadedRule.set(null);
    this.loadedRuleOrigin.set(null);
    this.showPromo2.set(false);
    this.patchRule(null);

    // Sin esto, los `required` de ean y listPrice se marcan en rojo apenas se
    // limpian: el usuario acaba de hacer todo bien, no corresponde retarlo.
    this.form.markAsPristine();
    this.form.markAsUntouched();

    this.suggestions.set([]);
    this.productKnown.set(false);
    this.errorMessage.set(null);

    this.eanInput()?.nativeElement.focus();
  }

  // BP-38 -- la lista de productos ya no aparece solo con el cupo lleno (desde E10.2 los
  // planes no tienen tope, asi que nunca se veia): "Ver mis productos" la abre.
  protected toggleProducts(): void {
    if (this.productsPage() && !this.planLimitReached()) {
      this.productsPage.set(null);
      return;
    }
    this.loadProductsPage(1);
  }

  protected loadProductsPage(page: number): void {
    const businessAccountId = this.form.controls.businessAccountId.value;
    if (!businessAccountId) return;

    this.loadingProducts.set(true);
    this.priceService.listProducts(businessAccountId, page, 20).subscribe({
      next: (response) => {
        this.loadingProducts.set(false);
        this.productsPage.set(response);
      },
      error: () => {
        this.loadingProducts.set(false);
      },
    });
  }

  private static rowKey(item: BusinessAccountProductItem): string {
    return `${item.branchId}::${item.ean}`;
  }

  protected askDelete(item: BusinessAccountProductItem): void {
    this.confirmDeleteKey.set(PriceUpsertComponent.rowKey(item));
  }

  protected cancelDelete(): void {
    this.confirmDeleteKey.set(null);
  }

  // E10.6 -- segundo click sobre "¿Seguro? Borrar" confirma. Libera un cupo del plan
  // y refresca la pagina actual (si quedo vacia por el borrado, retrocede una pagina).
  protected confirmDelete(item: BusinessAccountProductItem): void {
    const businessAccountId = this.form.controls.businessAccountId.value;
    if (!businessAccountId) return;

    const key = PriceUpsertComponent.rowKey(item);
    this.deletingKey.set(key);
    this.priceService.deleteProduct(businessAccountId, item.branchId, item.ean).subscribe({
      next: () => {
        this.deletingKey.set(null);
        this.confirmDeleteKey.set(null);
        const current = this.productsPage();
        const isLastItemOnPage = current && current.items.length === 1 && current.page > 1;
        this.loadProductsPage(isLastItemOnPage ? current!.page - 1 : (current?.page ?? 1));
      },
      error: (err) => {
        this.deletingKey.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo borrar el EAN. Intenta de nuevo.');
      },
    });
  }

  protected startChangeEan(item: BusinessAccountProductItem): void {
    this.editingEanKey.set(PriceUpsertComponent.rowKey(item));
    this.newEanValue.set(item.ean);
    this.changeEanError.set(null);
  }

  protected cancelChangeEan(): void {
    this.editingEanKey.set(null);
    this.changeEanError.set(null);
  }

  protected onNewEanInput(value: string): void {
    this.newEanValue.set(value);
  }

  // E10.6 -- corrige un EAN mal tipeado sin gastar un cupo nuevo (el backend borra la
  // fila vieja e inserta la nueva en la misma transaccion, ver ChangeProductEan en
  // BusinessPriceEndpoints.cs).
  protected submitChangeEan(item: BusinessAccountProductItem): void {
    const businessAccountId = this.form.controls.businessAccountId.value;
    const newEan = this.newEanValue().trim();
    if (!businessAccountId || !newEan || newEan === item.ean) return;

    this.changingEan.set(true);
    this.changeEanError.set(null);
    this.priceService
      .changeEan({ businessAccountId, branchId: item.branchId, oldEan: item.ean, newEan })
      .subscribe({
        next: () => {
          this.changingEan.set(false);
          this.editingEanKey.set(null);
          this.loadProductsPage(this.productsPage()?.page ?? 1);
        },
        error: (err) => {
          this.changingEan.set(false);
          this.changeEanError.set(err?.error?.error ?? 'No se pudo cambiar el EAN. Intenta de nuevo.');
        },
      });
  }

  protected rowKeyOf(item: BusinessAccountProductItem): string {
    return PriceUpsertComponent.rowKey(item);
  }

  protected totalPages(page: PagedBusinessAccountProductsResponse): number {
    return Math.max(1, Math.ceil(page.totalCount / page.pageSize));
  }
}
