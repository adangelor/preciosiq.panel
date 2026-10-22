import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { OrdenesComponent } from './ordenes';
import { FilaOrden, OrdenComponent, costoDeFila, unidadesDeFila } from './orden';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { BranchListItem } from '../../core/business-account.models';
import {
  Orden, ProveedorFicha, Sugerida, cantidadDeRenglon, linkWhatsApp, mensajeDeOrden, telefonoParaWhatsApp,
} from '../../core/compras';
import { environment } from '../../../environments/environment';

// BP-180 (22-oct-2026) -- compras, bloque 3: órdenes de compra y compra sugerida. API de mentira.
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

const distri: ProveedorFicha = {
  id: 5, nombre: 'Distri Norte', razonSocial: null, cuit: null, condicionIva: 'ri', domicilio: null, telefono: '0266 4123456',
  email: 'ventas@distri.com.ar', contacto: 'Juan', plazoPagoDias: 30, nota: null, activo: true, articulosEnLista: 2, articulosHabituales: 1,
};

const orden = (cambios: Partial<Orden> = {}): Orden => ({
  id: 41, numero: 7, numeroTexto: 'OC-000007', estado: 'borrador', entregaEsperada: '2026-10-28', nota: 'Por la mañana',
  createdAtUtc: '2026-10-22T13:00:00', enviadaAtUtc: null, supplierId: 5, proveedor: 'Distri Norte', proveedorCuit: null,
  proveedorTelefono: '0266 4123456', proveedorEmail: 'ventas@distri.com.ar', proveedorContacto: 'Juan', branchId: '999-13',
  sucursal: 'Centro', sucursalDomicilio: 'San Martín 100, San Luis', comercio: 'Súper Prueba',
  items: [
    { articuloId: 1, codigo: '7790000000017', descripcion: 'Aceite', marca: null, codigoProveedor: 'A-1', unidades: 24, bultos: 2,
      unidadesPorBulto: 12, costoNetoPactado: 1000, bonificacionPct: 10, costoFinal: 900, subtotal: 21600 },
    { articuloId: 2, codigo: '7790000000024', descripcion: 'Yerba', marca: null, codigoProveedor: null, unidades: 5, bultos: null,
      unidadesPorBulto: null, costoNetoPactado: null, bonificacionPct: null, costoFinal: null, subtotal: null },
  ],
  totalEstimado: 21600,
  ...cambios,
});

function configurar() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'gestion/compras/ordenes', component: OrdenesComponent },
        { path: 'gestion/compras/ordenes/nueva', component: OrdenComponent },
        { path: 'gestion/compras/ordenes/:id', component: OrdenComponent },
        { path: 'compras/ordenes/imprimir/:id', component: OrdenesComponent },
      ]),
      { provide: GestionContextoService, useValue: contexto() },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const texto = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const boton = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(t))!;
const escribir = (input: HTMLInputElement | HTMLSelectElement, v: string, evento = 'input') => {
  input.value = v;
  input.dispatchEvent(new Event(evento));
};

describe('La orden para mandar (BP-180)', () => {
  it('arma el texto con cantidades, códigos del proveedor, costos y total', () => {
    const t = mensajeDeOrden(orden());
    expect(t.split('\n')).toEqual([
      'Orden de compra OC-000007 de Súper Prueba',
      'Entregar en: Centro (San Martín 100, San Luis)',
      'Para el 28/10/2026',
      '',
      '- 2 bultos (24 u.) [A-1] Aceite (7790000000017) a $1.000,00 -10 %',
      '- 5 u. Yerba (7790000000024)',
      '',
      'Total estimado sin IVA: $21.600,00',
      '',
      'Por la mañana',
    ]);
    expect(mensajeDeOrden(orden(), false)).not.toContain('$');
  });

  it('entiende el teléfono del proveedor para WhatsApp (o lo deja elegir)', () => {
    expect(telefonoParaWhatsApp('0266 4123456')).toBe('5492664123456');
    expect(telefonoParaWhatsApp('+54 9 266 412-3456')).toBe('5492664123456');
    expect(telefonoParaWhatsApp('11 4000-0000')).toBe('5491140000000');
    expect(telefonoParaWhatsApp('412-3456')).toBeNull();
    expect(linkWhatsApp(null, 'hola que tal')).toBe('https://wa.me/?text=hola%20que%20tal');
    expect(cantidadDeRenglon({ unidades: 12, bultos: 1 })).toBe('1 bulto (12 u.)');
  });

  it('un renglón en bultos cuenta las unidades; costo vacío usa el de la lista', () => {
    const f: FilaOrden = {
      articuloId: 1, codigo: 'x', descripcion: 'x', codigoProveedor: null, unidadesPorBulto: 12, enBultos: true, cantidad: '2',
      costo: '', bonif: '', costoLista: 900,
    };
    expect(unidadesDeFila(f)).toBe(24);
    expect(costoDeFila(f)).toBe(900);
    expect(costoDeFila({ ...f, costo: '1.000', bonif: '5' })).toBe(950);
    expect(unidadesDeFila({ ...f, cantidad: '0' })).toBeNull();
  });
});

describe('Órdenes de compra: el listado (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  it('arranca con las abiertas y filtra por estado y sucursal', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/ordenes');
    http.expectOne(`${COMPRAS}/ordenes?businessAccountId=10&page=1&pageSize=30&estado=abiertas`).flush({
      total: 1, page: 1, pageSize: 30,
      items: [{ id: 41, numero: 7, numeroTexto: 'OC-000007', supplierId: 5, proveedor: 'Distri Norte', branchId: '999-13', sucursal: 'Centro',
        estado: 'enviada', entregaEsperada: '2026-10-28', renglones: 2, totalEstimado: 21600, createdAtUtc: '2026-10-22T13:00:00', enviadaAtUtc: null }],
    });
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    const fila = texto(el.querySelector('tr[data-orden="41"]'));
    expect(fila).toContain('OC-000007');
    expect(fila).toContain('Enviada');
    expect(fila).toContain('28/10/2026');
    expect(fila).toContain('21.600,00');
    expect(el.querySelector('tr[data-orden="41"] .pill--info')).not.toBeNull();

    const [estado, suc] = Array.from(el.querySelectorAll<HTMLSelectElement>('.gestion__filtros select'));
    escribir(estado, 'cancelada', 'change');
    http.expectOne(`${COMPRAS}/ordenes?businessAccountId=10&page=1&pageSize=30&estado=cancelada`).flush({ total: 0, page: 1, pageSize: 30, items: [] });
    escribir(suc, '999-14', 'change');
    http.expectOne(`${COMPRAS}/ordenes?businessAccountId=10&page=1&pageSize=30&estado=cancelada&sucursal=999-14`).flush({ total: 0, page: 1, pageSize: 30, items: [] });
    h.detectChanges();
    expect(texto(el)).toContain('No hay órdenes con ese filtro.');
  });
});

describe('Una orden de compra (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  const sugerida: Sugerida = {
    supplierId: 5, branchId: '999-13', dias: 30, diasACubrir: 15, articulos: 3, conSugerido: 2, totalEstimado: 63600, milisegundos: 12,
    items: [
      { articuloId: 1, codigo: '7790000000017', descripcion: 'Aceite', codigoProveedor: 'A-1', vendido: 120, stock: 20, minimo: null, maximo: 70,
        unidadesPorBulto: 12, sugerido: 48, bultos: 4, motivo: 'por lo que se vende', costoFinal: 900 },
      { articuloId: 3, codigo: '7790000000031', descripcion: 'Leche', codigoProveedor: null, vendido: 3, stock: 10, minimo: 20, maximo: null,
        unidadesPorBulto: null, sugerido: 10, bultos: null, motivo: 'para llegar al mínimo', costoFinal: null },
    ],
  };

  async function abrirNueva() {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/ordenes/nueva?proveedor=5&sucursal=999-13');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri]);
    h.detectChanges();
    return { h, el: h.routeNativeElement as HTMLElement };
  }

  it('nueva: sugerir compra, agregar lo tildado y guardar en bultos', async () => {
    const { h, el } = await abrirNueva();
    expect(el.querySelector<HTMLSelectElement>('select[data-campo="proveedor"]')!.value).toBe('5');
    expect(el.querySelector<HTMLSelectElement>('select[data-campo="sucursal"]')!.value).toBe('999-13');

    boton(el, 'Sugerir compra').click();
    http.expectOne(`${COMPRAS}/sugerida?businessAccountId=10&proveedorId=5&sucursal=999-13&dias=30&cubrir=15`).flush(sugerida);
    h.detectChanges();
    expect(texto(el.querySelector('#titulo-sugerida')!.parentElement)).toContain('Hay que pedir 2 de 3 artículos');
    const aceite = el.querySelector('tr[data-sugerida="7790000000017"]')!;
    expect(texto(aceite)).toContain('bultos');
    expect(aceite.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('4');
    escribir(aceite.querySelector<HTMLInputElement>('input[type=text]')!, '5');

    boton(el, 'Agregar a la orden').click();
    h.detectChanges();
    expect(texto(el.querySelector('.alert--success'))).toBe('2 artículos agregados. Revisá y guardá la orden.');
    // 5 bultos de 12 a $900 (de la lista) = $54.000; la leche sin costo.
    expect(texto(el.querySelector('tr[data-renglon="7790000000017"]'))).toContain('54.000,00');
    expect(texto(el.querySelector('.orden__renglones tfoot'))).toContain('1 sin costo');

    boton(el, 'Guardar borrador').click();
    const req = http.expectOne(`${COMPRAS}/ordenes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      businessAccountId: 10, supplierId: 5, branchId: '999-13', entregaEsperada: null, nota: null,
      renglones: [
        { articuloId: 1, codigo: null, unidades: null, bultos: 5, costoNetoPactado: null, bonificacionPct: null },
        { articuloId: 3, codigo: null, unidades: 10, bultos: null, costoNetoPactado: null, bonificacionPct: null },
      ],
    });
    const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    req.flush(orden());
    h.detectChanges();
    expect(navegar).toHaveBeenCalledWith(['/gestion/compras/ordenes', 41], { replaceUrl: true, state: { aviso: 'OC-000007 guardada.' } });
    expect(texto(el.querySelector('h1'))).toContain('Orden OC-000007');
    expect(texto(el.querySelector('.alert--success'))).toBe('OC-000007 guardada.');
  });

  it('sin sucursal no se guarda', async () => {
    const { h, el } = await abrirNueva();
    escribir(el.querySelector<HTMLSelectElement>('select[data-campo="sucursal"]')!, '', 'change');
    boton(el, 'Guardar borrador').click();
    h.detectChanges();
    expect(texto(el.querySelector('[role=alert]'))).toBe('Elegí la sucursal donde llega la mercadería.');
  });

  it('en borrador: WhatsApp al proveedor con el texto, y marcarla como enviada', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/ordenes/41');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri]);
    http.expectOne(`${COMPRAS}/ordenes/41?businessAccountId=10`).flush(orden());
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    const wa = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('WhatsApp'))!;
    expect(wa.href).toContain('https://wa.me/5492664123456?text=Orden%20de%20compra%20OC-000007');
    const mail = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('Mail'))!;
    expect(mail.href).toContain('mailto:ventas@distri.com.ar?subject=');

    // "Con los costos" apagado: el texto va sin plata.
    const conCostos = Array.from(el.querySelectorAll('label')).find((l) => l.textContent!.includes('Con los costos'))!.querySelector('input')!;
    conCostos.checked = false;
    conCostos.dispatchEvent(new Event('change'));
    h.detectChanges();
    expect(texto(el.querySelector('.orden__texto pre'))).not.toContain('$');

    boton(el, 'Marcar como enviada').click();
    h.detectChanges();
    expect(texto(el.querySelector('.orden__estado'))).toContain('¿Ya se la mandaste?');
    boton(el, 'Sí, enviada').click();
    const req = http.expectOne(`${COMPRAS}/ordenes/41/enviar`);
    expect(req.request.body).toEqual({ businessAccountId: 10 });
    req.flush(orden({ estado: 'enviada', enviadaAtUtc: '2026-10-22T15:00:00' }));
    h.detectChanges();
    expect(texto(el.querySelector('h1'))).toContain('Enviada');
    expect(el.querySelector('.orden__renglones input')).toBeNull();
    expect(texto(el.querySelector('tr[data-renglon="7790000000017"]'))).toContain('2 bultos (24 u.)');
    expect(boton(el, 'Marcar como enviada')).toBeUndefined();
    expect(boton(el, 'Cancelar la orden')).toBeDefined();
  });

  it('con cambios sin guardar, enviar guarda primero', async () => {
    http = configurar();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/ordenes/41');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri]);
    http.expectOne(`${COMPRAS}/ordenes/41?businessAccountId=10`).flush(orden());
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    escribir(el.querySelector<HTMLInputElement>('tr[data-renglon="7790000000024"] input')!, '8');
    h.detectChanges();
    expect(texto(el)).toContain('Guardá los cambios para imprimirla o mandarla.');
    boton(el, 'Marcar como enviada').click();
    h.detectChanges();
    boton(el, 'Sí, enviada').click();
    const put = http.expectOne(`${COMPRAS}/ordenes/41`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body.renglones[1]).toEqual({ articuloId: 2, codigo: null, unidades: 8, bultos: null, costoNetoPactado: null, bonificacionPct: null });
    expect(put.request.body.renglones[0]).toEqual({ articuloId: 1, codigo: null, unidades: null, bultos: 2, costoNetoPactado: 1000, bonificacionPct: 10 });
    put.flush(orden());
    http.expectOne(`${COMPRAS}/ordenes/41/enviar`).flush(orden({ estado: 'enviada' }));
  });
});
