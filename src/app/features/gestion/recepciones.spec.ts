import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { RecepcionesComponent } from './recepciones';
import { FilaRecepcion, RecepcionComponent, sumarLectura } from './recepcion';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { BranchListItem } from '../../core/business-account.models';
import { CodigoLeido, Recepcion, motivoAutomatico } from '../../core/compras';
import { environment } from '../../../environments/environment';

// BP-180 (22-oct-2026) -- compras, bloque 4: la recepción. API de mentira.
const COMPRAS = `${environment.apiBaseUrl}business/compras`;

const sucursal = (branchId: string, branchName: string) =>
  ({ commerceId: '999-12', bannerId: '1', branchId, branchName, street: '', streetNumber: '', city: '', provinceCode: '', postalCode: '', isPublic: true }) as BranchListItem;

function contexto(): Partial<GestionContextoService> {
  const g: GestionContexto = {
    businessAccountId: 10, branches: [sucursal('999-13', 'Centro'), sucursal('999-14', 'Norte')],
    gestionArticulos: true, gestionStock: true, formacionPrecios: true, compras: true, tier: 'avanzado',
  };
  return { load: () => of(g) };
}

const recepcion = (cambios: Partial<Recepcion> = {}): Recepcion => ({
  id: 25, numeroTexto: 'R-000025', supplierId: 5, proveedor: 'Distri Norte', branchId: '999-13', sucursal: 'Centro', ordenId: 41,
  ordenNumeroTexto: 'OC-000007', ordenEstado: 'enviada', esDevolucion: false, remitoNumero: null, recibidaAtLocal: '2026-10-22T10:30:00',
  estado: 'borrador', origen: 'panel', nota: null, createdAtUtc: '2026-10-22T13:30:00', confirmadaAtUtc: null, anuladaAtUtc: null,
  items: [
    { articuloId: 1, codigo: '7790000000017', descripcion: 'Aceite', marca: null, codigoProveedor: 'A-1', unidadesPorBulto: 12,
      unidadesPedidas: 24, unidadesRecibidas: 0, diferencia: -24, costoNeto: 900, motivoDiferencia: 'faltante', subtotal: 0 },
    { articuloId: 2, codigo: '7790000000024', descripcion: 'Yerba', marca: null, codigoProveedor: null, unidadesPorBulto: null,
      unidadesPedidas: 10, unidadesRecibidas: 0, diferencia: -10, costoNeto: 480, motivoDiferencia: 'faltante', subtotal: 0 },
  ],
  total: 0, faltantes: 2, sobrantes: 0,
  ...cambios,
});

const bultoAceite: CodigoLeido = {
  articuloId: 1, codigo: '7790000000017', descripcion: 'Aceite', factor: 12, por: 'bulto', unidadesPorBulto: 12, codigoProveedor: 'A-1',
  costoFinal: 900, activo: true,
};

function configurar() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'gestion/compras/recepciones', component: RecepcionesComponent },
        { path: 'gestion/compras/recepciones/nueva', component: RecepcionComponent },
        { path: 'gestion/compras/recepciones/:id', component: RecepcionComponent },
        { path: 'gestion/compras/ordenes/:id', component: RecepcionesComponent },
      ]),
      { provide: GestionContextoService, useValue: contexto() },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const texto = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const boton = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(t))!;
const escanear = (el: HTMLElement, codigo: string) => {
  const i = el.querySelector<HTMLInputElement>('input[aria-label="Código leído"]')!;
  i.value = codigo;
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
};

describe('La recepción: lo que suma el lector (BP-180)', () => {
  it('un código de bulto suma sus unidades; un artículo nuevo entra sin pedido', () => {
    const filas: FilaRecepcion[] = [{
      articuloId: 1, codigo: '7790000000017', descripcion: 'Aceite', codigoProveedor: 'A-1', unidadesPorBulto: 12, pedidas: 24,
      recibidas: '0', costo: '900', motivo: null,
    }];
    const una = sumarLectura(filas, bultoAceite);
    expect(una[0].recibidas).toBe('12');
    const dos = sumarLectura(una, { ...bultoAceite, factor: 1 });
    expect(dos[0].recibidas).toBe('13');
    const otra = sumarLectura(dos, { ...bultoAceite, articuloId: 3, codigo: '779', descripcion: 'Leche', factor: 1, costoFinal: null });
    expect(otra.length).toBe(2);
    expect(otra[1]).toEqual(jasmine.objectContaining({ articuloId: 3, pedidas: null, recibidas: '1', costo: '' }));
  });

  it('el motivo automático: faltante, sobrante, o sobrante si no estaba en la orden', () => {
    expect(motivoAutomatico(24, 12, true)).toBe('faltante');
    expect(motivoAutomatico(10, 12, true)).toBe('sobrante');
    expect(motivoAutomatico(10, 10, true)).toBeNull();
    expect(motivoAutomatico(null, 3, true)).toBe('sobrante');
    expect(motivoAutomatico(null, 3, false)).toBeNull();
  });
});

describe('Recepciones: el listado (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  it('las órdenes por recibir con "Recibir", las recepciones hechas y empezar una sin orden', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/recepciones');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([]);
    http.expectOne(`${COMPRAS}/ordenes?businessAccountId=10&page=1&pageSize=100&estado=abiertas`).flush({
      total: 2, page: 1, pageSize: 100,
      items: [
        { id: 41, numero: 7, numeroTexto: 'OC-000007', supplierId: 5, proveedor: 'Distri Norte', branchId: '999-13', sucursal: 'Centro',
          estado: 'enviada', entregaEsperada: null, renglones: 2, totalEstimado: 0, createdAtUtc: '2026-10-22T13:00:00', enviadaAtUtc: null },
        { id: 42, numero: 8, numeroTexto: 'OC-000008', supplierId: 5, proveedor: 'Distri Norte', branchId: '999-13', sucursal: 'Centro',
          estado: 'borrador', entregaEsperada: null, renglones: 0, totalEstimado: 0, createdAtUtc: '2026-10-22T13:00:00', enviadaAtUtc: null },
      ],
    });
    http.expectOne(`${COMPRAS}/recepciones?businessAccountId=10&page=1&pageSize=30`).flush({
      total: 1, page: 1, pageSize: 30,
      items: [{ id: 25, numeroTexto: 'R-000025', supplierId: 5, proveedor: 'Distri Norte', branchId: '999-13', sucursal: 'Centro', ordenId: 41,
        ordenNumeroTexto: 'OC-000007', esDevolucion: false, remitoNumero: null, recibidaAtLocal: '2026-10-22T10:30:00', estado: 'confirmada',
        origen: 'panel', renglones: 2, unidades: 22, total: 15600, conDiferencias: true }],
    });
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    expect(el.querySelector('tr[data-por-recibir="42"]')).toBeNull();
    const recibir = el.querySelector<HTMLAnchorElement>('tr[data-por-recibir="41"] a.btn')!;
    expect(recibir.getAttribute('href')).toBe('/gestion/compras/recepciones/nueva?orden=41');
    const fila = texto(el.querySelector('tr[data-recepcion="25"]'));
    expect(fila).toContain('R-000025');
    expect(fila).toContain('con diferencias');
    expect(fila).toContain('22/10/2026 10:30');
    expect(fila).toContain('15.600,00');

    boton(el, 'Devolución al proveedor').click();
    h.detectChanges();
    boton(el, 'Empezar la devolución').click();
    h.detectChanges();
    expect(texto(el.querySelector('[role=alert]'))).toBe('Elegí la sucursal.');
  });
});

describe('Una recepción (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  it('contra una orden: crea el borrador, el lector suma, resumen de diferencias y confirmar guarda primero', async () => {
    http = configurar();
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/recepciones/nueva?orden=41');
    const alta = http.expectOne(`${COMPRAS}/recepciones`);
    expect(alta.request.body).toEqual(jasmine.objectContaining({ businessAccountId: 10, ordenId: 41, supplierId: null, branchId: null, esDevolucion: false, renglones: null }));
    alta.flush(recepcion());
    h.detectChanges();
    expect(navegar).toHaveBeenCalledWith(['/gestion/compras/recepciones', 25], { replaceUrl: true });
    const el = h.routeNativeElement as HTMLElement;
    expect(texto(el.querySelector('h1'))).toContain('Recepción R-000025');

    // El bulto del aceite (lo pregunta) y la yerba por su código (ya está en la tabla: no pregunta).
    escanear(el, '2991800000417');
    const leido = http.expectOne(`${COMPRAS}/codigo?businessAccountId=10&codigo=2991800000417&proveedorId=5`);
    leido.flush(bultoAceite);
    h.detectChanges();
    expect(texto(el.querySelector('.recepcion__lectura'))).toBe('+12 Aceite (un bulto) · van 12 de 24');
    for (let i = 0; i < 10; i++) escanear(el, '7790000000024');
    h.detectChanges();
    expect(texto(el.querySelector('.recepcion__lectura'))).toBe('+1 Yerba · van 10 de 10');
    expect(el.querySelector<HTMLInputElement>('tr[data-renglon="7790000000024"] input')!.value).toBe('10');
    expect(texto(el.querySelector('tr[data-renglon="7790000000017"]'))).toContain('−12');
    const resumen = texto(el.querySelector('.recepcion__resumen'));
    expect(resumen).toContain('Faltante: Aceite (−12)');
    expect(resumen).not.toContain('Yerba');

    boton(el, 'Confirmar la recepción').click();
    h.detectChanges();
    boton(el, 'Sí, confirmar').click();
    const put = http.expectOne(`${COMPRAS}/recepciones/25`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body.renglones).toEqual([
      { articuloId: 1, codigo: null, unidades: 12, bultos: null, costoNeto: 900, motivo: null },
      { articuloId: 2, codigo: null, unidades: 10, bultos: null, costoNeto: 480, motivo: null },
    ]);
    put.flush(recepcion());
    const conf = http.expectOne(`${COMPRAS}/recepciones/25/confirmar`);
    conf.flush({
      recepcion: recepcion({ estado: 'confirmada', ordenEstado: 'recibida_parcial', confirmadaAtUtc: '2026-10-22T14:00:00' }),
      movimientos: 2, costosCargados: 1, estadoOrden: 'recibida_parcial',
    });
    h.detectChanges();
    expect(texto(el.querySelector('.alert--success'))).toBe(
      'R-000025 confirmada: 2 artículos entraron al stock y 1 costo cambió. La orden OC-000007 quedó recibida en parte.');
    expect(el.querySelector('input[aria-label="Código leído"]')).toBeNull();
    expect(boton(el, 'Anular la recepción')).toBeDefined();
  });

  it('un código que no es tuyo avisa y no agrega nada', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/recepciones/25');
    http.expectOne(`${COMPRAS}/recepciones/25?businessAccountId=10`).flush(recepcion());
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    escanear(el, '123');
    http.expectOne(`${COMPRAS}/codigo?businessAccountId=10&codigo=123&proveedorId=5`)
      .flush({ error: 'El código 123 no es de ningún artículo tuyo.', campo: 'codigo' }, { status: 404, statusText: 'Not Found' });
    h.detectChanges();
    expect(texto(el.querySelector('.recepcion__lectura--mal'))).toBe('El código 123 no es de ningún artículo tuyo.');
    expect(el.querySelectorAll('tr[data-renglon]').length).toBe(2);
  });

  it('confirmada: anular con confirmación', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/recepciones/25');
    http.expectOne(`${COMPRAS}/recepciones/25?businessAccountId=10`).flush(recepcion({ estado: 'confirmada' }));
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    boton(el, 'Anular la recepción').click();
    h.detectChanges();
    expect(texto(el.querySelector('.recepcion__cierre'))).toContain('el stock vuelve atrás');
    boton(el, 'Sí, anularla').click();
    const req = http.expectOne(`${COMPRAS}/recepciones/25/anular`);
    expect(req.request.body).toEqual({ businessAccountId: 10 });
    req.flush(recepcion({ estado: 'anulada', ordenEstado: 'enviada', anuladaAtUtc: '2026-10-22T15:00:00' }));
    h.detectChanges();
    expect(texto(el.querySelector('.alert--success'))).toBe('R-000025 anulada: el stock volvió atrás y la orden OC-000007 quedó enviada.');
    expect(texto(el.querySelector('h1'))).toContain('Anulada');
  });
});
