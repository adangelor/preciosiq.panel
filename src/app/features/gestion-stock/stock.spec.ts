import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import {
  cantidad, diferencia, filasExcelStock, leerPlanillaDeLimites, leerPlanillaDeRecuento, origenTexto,
} from '../../core/stock-form';
import { StockListaResponse, StockMovimiento, StockTransferencia } from '../../core/stock.models';
import { StockComponent } from './stock';
import { StockMovimientoComponent } from './stock-movimiento';
import { StockRecuentoComponent } from './stock-recuento';
import { StockTransferenciasComponent } from './stock-transferencias';

// BP-179 bloque 7 (21-oct-2026) -- Gestión → Stock, con la API de mentira. Nunca contra la API de prod.
const API = `${environment.apiBaseUrl}business/stock`;
const SUC = [{ branchId: '999-13', nombre: 'Centro' }, { branchId: '999-14', nombre: 'Norte' }];

function mov(p: Partial<StockMovimiento>): StockMovimiento {
  return {
    id: 1, tipo: 'venta', cantidad: -2, cantidadContada: null, saldo: 8, ocurridoAtLocal: '2026-10-21T14:32:05', registradoAtUtc: '2026-10-21T17:32:10Z',
    origenTipo: 'caja_ticket', mermaMotivo: null, nota: null, costoUnitario: null, transferenciaId: null, llegoDespuesDeUnRecuento: false,
    origenId: 'abc', dispositivo: 'caja-2', usuario: null, ...p,
  };
}

describe('stock-form (BP-179)', () => {
  it('de dónde vino cada movimiento, en palabras', () => {
    expect(origenTexto(mov({}))).toBe('Venta, caja caja-2, ticket 14:32');
    expect(origenTexto(mov({ tipo: 'recuento', origenTipo: 'panel', usuario: 'Juan Pérez', dispositivo: null }))).toBe('Recuento de Juan Pérez');
    expect(origenTexto(mov({ tipo: 'recuento', origenTipo: 'planilla', usuario: 'Juan' }))).toBe('Recuento por planilla de Juan');
    expect(origenTexto(mov({ tipo: 'transferencia_salida', origenTipo: 'transferencia', transferenciaId: 12, nota: 'A Norte' }))).toBe('Transferencia #12: A Norte');
    expect(origenTexto(mov({ tipo: 'merma', origenTipo: 'caja_ajuste', mermaMotivo: 'vencido', dispositivo: 'f3a1c9d2e8b7a6c5' }))).toBe('Merma (Vencido) en la caja …a6c5');
    expect(origenTexto(mov({ tipo: 'recuento', origenTipo: 'migracion' }))).toBe('Stock al pasar al historial');
  });

  it('cantidades y diferencias', () => {
    expect(cantidad(-3)).toBe('−3');
    expect(cantidad(1234.5)).toBe('1.234,5');
    expect(diferencia(-9)).toBe('−9');
    expect(diferencia(2)).toBe('+2');
  });

  it('la planilla de recuento: encuentra el encabezado, saltea vacías y avisa las malas', () => {
    const r = leerPlanillaDeRecuento([
      ['Recuento góndola 3'],
      ['Código', 'Descripción', 'Cantidad'],
      [7790895000997, 'Galletitas', 31],
      ['7791234000017', 'Yerba', '4,5'],
      [null, null, null],
      ['779000', 'Malo', 'muchos'],
    ]);
    expect(r.filas).toEqual([{ codigo: '7790895000997', cantidadContada: 31 }, { codigo: '7791234000017', cantidadContada: 4.5 }]);
    expect(r.errores.length).toBe(1);
    expect(r.errores[0].fila).toBe(6);
    expect(leerPlanillaDeRecuento([['a', 'b']]).errores[0].motivo).toContain('código');
  });

  it('la planilla de mínimos: con columna de sucursal (id o nombre) o la elegida', () => {
    const conCol = leerPlanillaDeLimites([['codigo', 'sucursal', 'minimo', 'maximo'], ['779', 'Norte', 2, 10], ['780', '999-13', 5, 1], ['781', 'Sur', 1, 2]], SUC, null);
    expect(conCol.filas).toEqual([{ branchId: '999-14', codigo: '779', minimo: 2, maximo: 10 }]);
    expect(conCol.errores.map((e) => e.fila)).toEqual([3, 4]);
    const sinCol = leerPlanillaDeLimites([['ean', 'mínimo'], ['779', 3]], SUC, '999-13');
    expect(sinCol.filas).toEqual([{ branchId: '999-13', codigo: '779', minimo: 3, maximo: null }]);
  });

  it('el Excel tiene una columna por sucursal y el total', () => {
    const f = filasExcelStock([{
      codigo: '779', descripcion: 'Yerba', marca: null, rubro: 'Almacén', costoNeto: 100, cantidad: 7, valorizado: 700,
      porSucursal: { '999-13': { cantidad: 5, minimo: null, maximo: null }, '999-14': { cantidad: 2, minimo: null, maximo: null } },
      bajoMinimo: false, negativo: false, sinFicha: false,
    }], SUC);
    expect(f[0]['Centro']).toBe(5);
    expect(f[0]['Norte']).toBe(2);
    expect(f[0]['Total']).toBe(7);
  });
});

function configurar(conPlan: boolean) {
  const g = {
    businessAccountId: 10, branches: [{ branchId: '999-13', branchName: 'Centro' }, { branchId: '999-14', branchName: 'Norte' }],
    gestionArticulos: conPlan, gestionStock: conPlan, formacionPrecios: conPlan, compras: conPlan, tier: 'avanzado',
  } as unknown as GestionContexto;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'gestion/stock', component: StockComponent },
        { path: 'gestion/stock/ingreso', component: StockMovimientoComponent, data: { tipo: 'ingreso' } },
        { path: 'gestion/stock/recuento', component: StockRecuentoComponent },
        { path: 'gestion/stock/transferencias', component: StockTransferenciasComponent },
      ]),
      { provide: GestionContextoService, useValue: { load: () => of(g) } },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

function contestarRubros(http: HttpTestingController): void {
  for (const r of http.match((x) => x.url.includes('/business/articles'))) r.flush(r.request.url.includes('rubros') ? [] : { total: 0, page: 1, pageSize: 8, items: [] });
}

const lista: StockListaResponse = {
  sucursales: SUC, total: 1, page: 1, pageSize: 100, valorizado: 700, sinCosto: 0, bajoMinimo: 1, negativos: 0,
  porRubro: [{ rubro: 'Almacén', articulos: 1, cantidad: 7, valorizado: 700 }],
  items: [{
    codigo: '779', descripcion: 'Yerba', marca: null, rubro: 'Almacén', costoNeto: 100, cantidad: 7, valorizado: 700,
    porSucursal: { '999-13': { cantidad: 5, minimo: 6, maximo: null }, '999-14': { cantidad: 2, minimo: null, maximo: null } },
    bajoMinimo: true, negativo: false, sinFicha: false,
  }],
};

describe('Gestión → Stock (BP-179)', () => {
  it('sin el plan: dice qué plan lo trae y no llama a la API', async () => {
    const http = configurar(false);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/stock', StockComponent);
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Avanzado');
    http.expectNone((r) => r.url.startsWith(API));
  });

  it('todas las sucursales en columnas; tocar un artículo muestra su historial con el origen', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/stock', StockComponent);
    const req = http.expectOne((r) => r.url === API);
    expect(req.request.params.has('branchId')).toBeFalse();
    req.flush(lista);
    contestarRubros(http);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('Centro');
    expect(el.textContent).toContain('Norte');
    expect(el.querySelector('.stock__bajo')?.textContent?.trim()).toBe('5');
    (el.querySelector('tr.clickable') as HTMLElement).click();
    harness.detectChanges();
    const h = http.expectOne((r) => r.url === `${API}/movimientos`);
    expect(h.request.params.get('branchId')).toBe('999-13');
    h.flush({ branchId: '999-13', codigo: '779', descripcion: 'Yerba', saldoActual: 5, items: [
      mov({ id: 2, saldo: 5, cantidad: -1, llegoDespuesDeUnRecuento: true }),
      mov({ id: 1, tipo: 'recuento', cantidad: 2, cantidadContada: 6, saldo: 6, origenTipo: 'panel', usuario: 'Juan', dispositivo: null }),
    ] });
    harness.detectChanges();
    expect(el.textContent).toContain('Venta, caja caja-2, ticket 14:32');
    expect(el.textContent).toContain('Recuento de Juan');
    expect(el.textContent).toContain('no movió el saldo');
  });

  it('con una sucursal, el mínimo se edita en la tabla y se guarda en lote', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/stock', StockComponent);
    http.expectOne((r) => r.url === API).flush(lista);
    contestarRubros(http);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const sel = el.querySelector('select') as HTMLSelectElement;
    sel.value = '999-13';
    sel.dispatchEvent(new Event('change'));
    http.expectOne((r) => r.url === API && r.params.get('branchId') === '999-13').flush({ ...lista, sucursales: [SUC[0]] });
    harness.detectChanges();
    const min = el.querySelector('input.stock__lim') as HTMLInputElement;
    min.value = '8';
    min.dispatchEvent(new Event('change'));
    harness.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Guardar 1 cambio')) as HTMLButtonElement).click();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${API}/limites`);
    expect(put.request.body.filas).toEqual([{ branchId: '999-13', codigo: '779', minimo: 8, maximo: null }]);
  });
});

describe('Gestión → Stock → Ingreso y Recuento (BP-179)', () => {
  it('ingreso: el código escaneado entra, se elige bulto y costo, y se registra todo junto', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/stock/ingreso', StockMovimientoComponent);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const buscar = el.querySelector('app-articulo-buscador input') as HTMLInputElement;
    buscar.value = '7790000000417';
    buscar.dispatchEvent(new Event('input'));
    buscar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    harness.detectChanges();
    const filaSel = el.querySelector('tbody select') as HTMLSelectElement;
    filaSel.value = 'bulto';
    filaSel.dispatchEvent(new Event('change'));
    const inputs = el.querySelectorAll('tbody input');
    (inputs[0] as HTMLInputElement).value = '2';
    inputs[0].dispatchEvent(new Event('change'));
    (inputs[1] as HTMLInputElement).value = '850,50';
    inputs[1].dispatchEvent(new Event('change'));
    harness.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Registrar ingreso')) as HTMLButtonElement).click();
    const req = http.expectOne(`${API}/ingreso`);
    expect(req.request.body.branchId).toBe('999-13');
    expect(req.request.body.renglones).toEqual([{ codigo: '7790000000417', cantidad: 2, unidad: 'bulto', costoNeto: 850.5 }]);
    req.flush({ aplicados: 1, renglones: [{ codigo: '779', descripcion: 'Yerba', cantidad: 24, saldoAntes: 5, saldoDespues: 29, costoUnitario: 850.5 }], noEncontrados: [] });
    harness.detectChanges();
    expect(el.textContent).toContain('Listo: 1 artículo');
    contestarRubros(http);
  });

  it('recuento a mano: vista previa con la diferencia y después se aplica', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/stock/recuento', StockRecuentoComponent);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const buscar = el.querySelector('app-articulo-buscador input') as HTMLInputElement;
    buscar.value = '7790895000997';
    buscar.dispatchEvent(new Event('input'));
    buscar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    harness.detectChanges();
    const contado = el.querySelector('tbody input') as HTMLInputElement;
    contado.value = '31';
    contado.dispatchEvent(new Event('change'));
    harness.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Ver diferencias')) as HTMLButtonElement).click();
    const previa = http.expectOne((r) => r.url === `${API}/recuento` && r.params.get('vistaPrevia') === 'true');
    expect(previa.request.body.renglones).toEqual([{ codigo: '7790895000997', cantidadContada: 31 }]);
    expect(previa.request.body.ocurridoAtLocal).toBeNull();   // sin tocar la hora: la del servidor al aplicar
    previa.flush({ vistaPrevia: true, renglones: 1, conDiferencia: 1, diferenciaValorizada: -900, noEncontrados: [],
      items: [{ codigo: '7790895000997', descripcion: 'Galletitas X', saldo: 40, contada: 31, diferencia: -9, costoNeto: 100 }] });
    harness.detectChanges();
    expect(el.textContent).toContain('Galletitas X');
    expect(el.textContent).toContain('−9');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Aplicar el recuento')) as HTMLButtonElement).click();
    http.expectOne((r) => r.url === `${API}/recuento` && r.params.get('vistaPrevia') === 'false')
      .flush({ vistaPrevia: false, renglones: 1, conDiferencia: 1, diferenciaValorizada: -900, noEncontrados: [], items: [] });
    harness.detectChanges();
    expect(el.textContent).toContain('Recuento aplicado');
    contestarRubros(http);
  });
});

describe('Gestión → Stock → Transferencias (BP-179)', () => {
  it('recibir con una unidad menos manda lo recibido', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/stock/transferencias', StockTransferenciasComponent);
    const t: StockTransferencia = {
      id: 12, desdeBranchId: '999-13', desdeNombre: 'Centro', haciaBranchId: '999-14', haciaNombre: 'Norte', estado: 'en_transito',
      creadaAtUtc: '2026-10-21T20:00:00Z', recibidaAtUtc: null, canceladaAtUtc: null, nota: null,
      items: [{ codigo: '779', descripcion: 'Yerba', cantidadEnviada: 5, cantidadRecibida: null, diferencia: null }],
    };
    http.expectOne((r) => r.url === `${API}/transferencias`).flush([t]);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('#12 · Centro → Norte');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === 'Recibir') as HTMLButtonElement).click();
    harness.detectChanges();
    const rec = el.querySelector('.stock__transf input') as HTMLInputElement;
    rec.value = '4';
    rec.dispatchEvent(new Event('change'));
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Confirmar lo recibido')) as HTMLButtonElement).click();
    const req = http.expectOne(`${API}/transferencias/12/recibir`);
    expect(req.request.body.renglones).toEqual([{ codigo: '779', cantidadRecibida: 4 }]);
    req.flush({ ...t, estado: 'recibida', items: [{ ...t.items[0], cantidadRecibida: 4, diferencia: -1 }] });
    http.expectOne((r) => r.url === `${API}/transferencias`).flush([]);
    harness.detectChanges();
    expect(el.textContent).toContain('1 artículo llegó con diferencia');
  });
});
