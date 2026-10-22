import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { ComprobantesComponent, mesActual } from './comprobantes';
import { ComprobanteComponent } from './comprobante';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { Comprobante, ProveedorFicha, ivaDe, letraSugerida, sumaComprobante } from '../../core/compras';
import { environment } from '../../../environments/environment';

// BP-180 (22-oct-2026) -- compras, bloque 5: comprobantes de proveedores. API de mentira.
const COMPRAS = `${environment.apiBaseUrl}business/compras`;

function contexto(): Partial<GestionContextoService> {
  const g: GestionContexto = {
    businessAccountId: 10, branches: [], gestionArticulos: true, gestionStock: true, formacionPrecios: true, compras: true, tier: 'avanzado',
  };
  return { load: () => of(g) };
}

const distri: ProveedorFicha = {
  id: 5, nombre: 'Distri Norte', razonSocial: null, cuit: '20172543597', condicionIva: 'ri', domicilio: null, telefono: null, email: null,
  contacto: null, plazoPagoDias: 30, nota: null, activo: true, articulosEnLista: 0, articulosHabituales: 0,
};
const mono: ProveedorFicha = { ...distri, id: 6, nombre: 'Don Mono', condicionIva: 'mono', cuit: null, plazoPagoDias: null };

const comprobante = (cambios: Partial<Comprobante> = {}): Comprobante => ({
  id: 70, supplierId: 5, proveedor: 'Distri Norte', proveedorCuit: '20172543597', proveedorCondicionIva: 'ri', tipo: 'factura', letra: 'A',
  puntoVenta: 12, numero: 1001, numeroTexto: 'A 00012-00001001', fecha: '2026-10-22', cae: null, caeVencimiento: null, noGravado: 0,
  exento: 0, impuestosInternos: 0, otrosTributos: 0, total: 14678, vencimiento: '2026-11-21', estado: 'registrada', estadoPago: 'impaga',
  nota: null, createdAtUtc: '2026-10-22T15:00:00', anuladaAtUtc: null,
  alicuotas: [{ alicuota: 21, neto: 11400, iva: 2394 }, { alicuota: 10.5, neto: 800, iva: 84 }], percepciones: [],
  recepciones: [{ id: 25, numeroTexto: 'R-000025', sucursal: 'Centro', recibidaAtLocal: '2026-10-22T10:30:00', esDevolucion: false,
    remitoNumero: null, unidades: 15, total: 11400, ordenNumeroTexto: null }],
  renglones: [], avisos: [], ...cambios,
});

function configurar() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'gestion/compras/comprobantes', component: ComprobantesComponent },
        { path: 'gestion/compras/comprobantes/nueva', component: ComprobanteComponent },
        { path: 'gestion/compras/comprobantes/:id', component: ComprobanteComponent },
        { path: 'gestion/compras/recepciones/:id', component: ComprobantesComponent },
      ]),
      { provide: GestionContextoService, useValue: contexto() },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const texto = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const boton = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim().startsWith(t))!;
const escribir = (input: HTMLInputElement | HTMLSelectElement, v: string, evento = 'input') => {
  input.value = v;
  input.dispatchEvent(new Event(evento));
};

describe('El comprobante: cuentas (BP-180)', () => {
  it('la suma, el IVA, la letra esperada y el mes', () => {
    expect(sumaComprobante({
      alicuotas: [{ alicuota: 21, neto: 11400, iva: 2394 }, { alicuota: 10.5, neto: 800, iva: 84 }], noGravado: 10, exento: 0,
      impuestosInternos: 5, otrosTributos: 0, percepciones: [{ tipo: 'iibb', jurisdiccion: 'AR-D', importe: 100 }],
    })).toBe(14793);
    expect(ivaDe(1234.56, 21)).toBe(259.26);
    expect(letraSugerida('ri')).toBe('A');
    expect(letraSugerida('mono')).toBe('C');
    expect(mesActual(new Date(2026, 9, 22))).toBe('2026-10');
  });
});

describe('Comprobantes: el listado (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  it('arranca en el mes, las notas de crédito restan', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/comprobantes');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri]);
    http.expectOne(`${COMPRAS}/comprobantes?businessAccountId=10&page=1&pageSize=30&mes=${mesActual()}`).flush({
      total: 2, page: 1, pageSize: 30, importeNeto: 13516.4,
      items: [
        { id: 70, supplierId: 5, proveedor: 'Distri Norte', tipo: 'factura', letra: 'A', puntoVenta: 12, numero: 1001, numeroTexto: 'A 00012-00001001',
          fecha: '2026-10-22', total: 14678, vencimiento: '2026-11-21', estado: 'registrada', estadoPago: 'impaga', recepciones: 2 },
        { id: 71, supplierId: 5, proveedor: 'Distri Norte', tipo: 'nota_credito', letra: 'A', puntoVenta: 12, numero: 3001, numeroTexto: 'A 00012-00003001',
          fecha: '2026-10-22', total: 1161.6, vencimiento: null, estado: 'registrada', estadoPago: 'impaga', recepciones: 1 },
      ],
    });
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    expect(texto(el.querySelector('tr[data-comprobante="70"]'))).toContain('Factura A 00012-00001001');
    expect(texto(el.querySelector('tr[data-comprobante="70"]'))).toContain('21/11/2026');
    expect(texto(el.querySelector('tr[data-comprobante="71"]'))).toContain('−$ 1.161,60');
    expect(texto(el.querySelector('.gestion__total'))).toContain('13.516,40');
  });
});

describe('Cargar un comprobante (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  async function abrirNueva(url = '/gestion/compras/comprobantes/nueva?proveedor=5&recepcion=25') {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(url);
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri, mono]);
    return { h, el: h.routeNativeElement as HTMLElement };
  }

  it('desde la recepción: arma importes y renglones, revisa (avisos) y guarda', async () => {
    const { h, el } = await abrirNueva();
    http.expectOne(`${COMPRAS}/comprobantes/recepciones?businessAccountId=10&proveedorId=5&tipo=factura`).flush(comprobante().recepciones);
    h.detectChanges();
    expect(el.querySelector<HTMLSelectElement>('select[data-campo="letra"]')!.value).toBe('A');
    expect(el.querySelector<HTMLInputElement>('input[data-recepcion="25"]')!.checked).toBeTrue();

    boton(el, 'Armar desde las recepciones').click();
    http.expectOne(`${COMPRAS}/comprobantes/desde-recepciones?businessAccountId=10&ids=25`).flush({
      renglones: [{ articuloId: 1, codigo: '7790000000017', descripcion: 'Aceite', unidades: 10, costoNeto: 900, bonificacionPct: null, alicuota: 21, costoFinal: 900, subtotal: 9000 }],
      alicuotas: [{ alicuota: 21, neto: 9000, iva: 1890 }], total: 10890,
    });
    h.detectChanges();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Neto al 21 %"]')!.value).toBe('9000');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="IVA al 21 %"]')!.value).toBe('1890');
    expect(el.querySelector<HTMLInputElement>('input[data-campo="total"]')!.value).toBe('10890');
    expect(texto(el.querySelector('.comprobante__total'))).toContain('cuadra');
    expect(el.querySelectorAll('.comprobante__renglones tbody tr').length).toBe(1);

    // El neto cambia: el IVA se recalcula solo y la suma muestra la diferencia.
    escribir(el.querySelector<HTMLInputElement>('input[aria-label="Neto al 21 %"]')!, '9100');
    h.detectChanges();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="IVA al 21 %"]')!.value).toBe('1911');
    expect(texto(el.querySelector('.comprobante__total'))).toContain('diferencia −$ 121,00');

    escribir(el.querySelector<HTMLInputElement>('input[data-campo="puntoVenta"]')!, '12');
    escribir(el.querySelector<HTMLInputElement>('input[data-campo="numero"]')!, '1001');
    escribir(el.querySelector<HTMLInputElement>('input[data-campo="total"]')!, '11011');
    boton(el, 'Revisar').click();
    const previa = http.expectOne(`${COMPRAS}/comprobantes`);
    expect(previa.request.body).toEqual(jasmine.objectContaining({
      businessAccountId: 10, supplierId: 5, tipo: 'factura', letra: 'A', puntoVenta: 12, numero: 1001, total: 11011, vistaPrevia: true,
      alicuotas: [{ alicuota: 21, neto: 9100, iva: 1911 }], recepcionIds: [25],
      renglones: [{ articuloId: 1, codigo: null, descripcion: 'Aceite', unidades: 10, costoNeto: 900, bonificacionPct: null, alicuota: 21 }],
    }));
    previa.flush({ vistaPrevia: true, comprobante: null, problemas: [], avisos: [{ tipo: 'renglones', texto: 'Los renglones al 21 % suman $9.000,00 y el neto dice $9.100,00.' }], costosCargados: 0 });
    h.detectChanges();
    expect(texto(el.querySelector('.comprobante__avisos'))).toContain('Los renglones al 21 % suman $9.000,00');

    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    boton(el, 'Guardar').click();
    const alta = http.expectOne(`${COMPRAS}/comprobantes`);
    expect(alta.request.method).toBe('POST');
    expect(alta.request.body.vistaPrevia).toBeFalse();
    alta.flush({ vistaPrevia: false, comprobante: comprobante(), problemas: [], avisos: [], costosCargados: 0 });
    expect(navegar).toHaveBeenCalledWith(['/gestion/compras/comprobantes', 70],
      { replaceUrl: true, state: { aviso: 'Factura A 00012-00001001 guardada.' } });
  });

  it('una C de un monotributista: sin columna de IVA, el importe va entero', async () => {
    const { h, el } = await abrirNueva('/gestion/compras/comprobantes/nueva?proveedor=6');
    http.expectOne(`${COMPRAS}/comprobantes/recepciones?businessAccountId=10&proveedorId=6&tipo=factura`).flush([]);
    h.detectChanges();
    expect(el.querySelector<HTMLSelectElement>('select[data-campo="letra"]')!.value).toBe('C');
    expect(el.querySelector('input[aria-label="IVA al 21 %"]')).toBeNull();
    escribir(el.querySelector<HTMLInputElement>('input[aria-label="Neto al 21 %"]')!, '1.210');
    escribir(el.querySelector<HTMLInputElement>('input[data-campo="puntoVenta"]')!, '3');
    escribir(el.querySelector<HTMLInputElement>('input[data-campo="numero"]')!, '77');
    h.detectChanges();
    boton(el, 'Usar la suma').click();
    boton(el, 'Guardar').click();
    const req = http.expectOne(`${COMPRAS}/comprobantes`);
    expect(req.request.body).toEqual(jasmine.objectContaining({ letra: 'C', total: 1210, alicuotas: [{ alicuota: 21, neto: 1210, iva: 0 }], recepcionIds: [] }));
    req.flush({ error: 'Factura C 00003-00000077 de Don Mono ya está cargada.', campo: 'numero',
      problemas: [{ campo: 'numero', mensaje: 'Factura C 00003-00000077 de Don Mono ya está cargada.' }] }, { status: 409, statusText: 'Conflict' });
    h.detectChanges();
    expect(texto(el.querySelector('.comprobante__problemas'))).toContain('ya está cargada');
  });

  it('uno registrado: se corrige y se anula con confirmación', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/comprobantes/70');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri]);
    http.expectOne(`${COMPRAS}/comprobantes/70?businessAccountId=10`).flush(comprobante());
    http.expectOne(`${COMPRAS}/comprobantes/recepciones?businessAccountId=10&proveedorId=5&tipo=factura&comprobanteId=70`).flush([]);
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    expect(texto(el.querySelector('h1'))).toBe('Factura A 00012-00001001');
    expect(el.querySelector<HTMLInputElement>('input[data-recepcion="25"]')!.checked).toBeTrue();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Neto al 10.5 %"]')!.value).toBe('800');

    boton(el, 'Anular').click();
    h.detectChanges();
    boton(el, 'Sí, anular').click();
    http.expectOne(`${COMPRAS}/comprobantes/70/anular`).flush(comprobante({ estado: 'anulada', anuladaAtUtc: '2026-10-22T16:00:00' }));
    http.expectOne(`${COMPRAS}/comprobantes/recepciones?businessAccountId=10&proveedorId=5&tipo=factura&comprobanteId=70`).flush([]);
    h.detectChanges();
    expect(texto(el.querySelector('.alert--success'))).toBe('Factura A 00012-00001001 anulada: sus recepciones quedan libres.');
    expect(texto(el.querySelector('h1'))).toContain('Anulado');
  });
});
