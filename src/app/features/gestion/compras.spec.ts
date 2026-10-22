import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { ProveedoresComponent } from './proveedores';
import { ProveedorListaComponent } from './proveedor-lista';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { ImportarListaResponse, ProveedorFicha, adivinarColumnas, importeAr, leerListaDeProveedor } from '../../core/compras';
import { environment } from '../../../environments/environment';

// BP-180 (22-oct-2026) -- compras, bloque 2: la ficha completa del proveedor y su lista. API de mentira.
const COMPRAS = `${environment.apiBaseUrl}business/compras`;
const ARTICULOS = `${environment.apiBaseUrl}business/articles`;

function contexto(compras: boolean): Partial<GestionContextoService> {
  const g: GestionContexto = {
    businessAccountId: 10, branches: [], gestionArticulos: true, gestionStock: true, formacionPrecios: true, compras, tier: 'avanzado',
  };
  return { load: () => of(g) };
}

const distri: ProveedorFicha = {
  id: 5, nombre: 'Distri Norte', razonSocial: 'Distribuidora Norte S.A.', cuit: '20172543597', condicionIva: 'ri', domicilio: null,
  telefono: '266 400', email: null, contacto: 'Juan', plazoPagoDias: 30, nota: null, activo: true, articulosEnLista: 2, articulosHabituales: 1,
};

function configurar(compras: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'gestion/proveedores', component: ProveedoresComponent },
        { path: 'gestion/proveedores/:id', component: ProveedorListaComponent },
      ]),
      { provide: GestionContextoService, useValue: contexto(compras) },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const texto = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('Compras: leer la planilla del proveedor (BP-180)', () => {
  it('adivina las columnas por el encabezado (y no confunde descripción con descuento)', () => {
    const m = adivinarColumnas(['Cód. Prov.', 'EAN', 'Descripción', 'Precio neto', 'Bonif. %', 'Unid x bulto']);
    expect(m).toEqual({ codigoProveedor: 0, codigo: 1, descripcion: 2, costo: 3, bonificacionPct: 4, unidadesPorBulto: 5 });
    const otra = adivinarColumnas(['Código de barras', 'Producto', 'Costo', 'Algo']);
    expect(otra).toEqual({ codigoProveedor: null, codigo: 0, descripcion: 1, costo: 2, bonificacionPct: null, unidadesPorBulto: null });
  });

  it('lee importes como se escriben acá', () => {
    expect(importeAr(1234.5)).toBe(1234.5);
    expect(importeAr('1.234,56')).toBe(1234.56);
    expect(importeAr('1.500')).toBe(1500);
    expect(importeAr('1234.56')).toBe(1234.56);
    expect(importeAr('$ 2.000')).toBe(2000);
    expect(importeAr('10%')).toBe(10);
    expect(importeAr('')).toBeNull();
    expect(importeAr('mucho')).toBeNull();
  });

  it('arma los renglones: códigos como texto, filas vacías afuera, la fila de la planilla', () => {
    const filas: unknown[][] = [
      ['EAN', 'Cod prov', 'Desc', 'Costo', 'Bonif'],
      [7790000000017, 'A-1', 'Aceite', '1.250,50', 10],
      [null, null, null, null, null],
      [null, 'B-2', 'Yerba', 900, null],
      ['', '', 'Sin código', 100, null],
    ];
    const m = adivinarColumnas(filas[0] as string[]);
    expect(leerListaDeProveedor(filas, m)).toEqual([
      { fila: 2, codigo: '7790000000017', codigoProveedor: 'A-1', descripcion: 'Aceite', costo: 1250.5, bonificacionPct: 10, unidadesPorBulto: null },
      { fila: 4, codigo: null, codigoProveedor: 'B-2', descripcion: 'Yerba', costo: 900, bonificacionPct: null, unidadesPorBulto: null },
    ]);
  });
});

describe('Proveedores con compras (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  it('con compras: la ficha completa, el link a su lista y guardar manda todo', async () => {
    http = configurar(true);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/proveedores');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush([distri]);
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    const fila = el.querySelector('tr[data-proveedor="5"]')!;
    expect(texto(fila)).toContain('Distribuidora Norte S.A.');
    expect(texto(fila)).toContain('20-17254359-7');
    expect(texto(fila)).toContain('Responsable inscripto');
    expect(texto(fila)).toContain('30 días');
    expect(fila.querySelector('a[href="/gestion/proveedores/5"]')).not.toBeNull();

    Array.from(fila.querySelectorAll('button')).find((b) => b.textContent!.includes('Editar'))!.click();
    h.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('.gestion__seccion select')!;
    select.value = 'mono';
    select.dispatchEvent(new Event('change'));
    Array.from(el.querySelectorAll<HTMLButtonElement>('.gestion__seccion button')).find((b) => b.textContent!.includes('Guardar'))!.click();
    const req = http.expectOne(`${COMPRAS}/proveedores/5`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(jasmine.objectContaining({
      businessAccountId: 10, nombre: 'Distri Norte', razonSocial: 'Distribuidora Norte S.A.', cuit: '20172543597', condicionIva: 'mono',
      contacto: 'Juan', plazoPagoDias: 30, telefono: '266 400',
    }));
    req.flush({ error: 'El CUIT no es válido: revisá los 11 números.', campo: 'cuit' }, { status: 400, statusText: 'Bad Request' });
    h.detectChanges();
    expect(texto(el.querySelector('[role=alert]'))).toBe('El CUIT no es válido: revisá los 11 números.');
    expect(el.querySelector('label.campo--error')?.textContent).toContain('CUIT');
  });

  it('sin el script de compras (503): sigue con lo de BP-178 y lo avisa', async () => {
    http = configurar(true);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/proveedores');
    http.expectOne(`${COMPRAS}/proveedores?businessAccountId=10`).flush({ error: 'x' }, { status: 503, statusText: 'No' });
    http.expectOne(`${ARTICULOS}/proveedores?businessAccountId=10`).flush([{ id: 5, nombre: 'Distri Norte', cuit: null, activo: true, articulos: 3 }]);
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    expect(texto(el)).toContain('todavía no están habilitadas en el servidor');
    expect(el.querySelector('a[href="/gestion/proveedores/5"]')).toBeNull();
    expect(texto(el.querySelector('tr[data-proveedor="5"]'))).toContain('3');
  });

  it('sin el plan de compras: la pantalla de antes', async () => {
    http = configurar(false);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/proveedores');
    http.expectOne(`${ARTICULOS}/proveedores?businessAccountId=10`).flush([]);
    h.detectChanges();
    expect(texto(h.routeNativeElement as HTMLElement)).toContain('Todavía no tenés proveedores.');
  });
});

describe('La lista del proveedor (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  const lista = {
    total: 1, page: 1, pageSize: 50,
    items: [{
      articuloId: 7, codigo: '7790000000017', descripcion: 'Aceite', marca: 'M', codigoProveedor: 'A-1', unidadesPorBulto: 12, costoNeto: 1000,
      bonificacionPct: 10, costoFinal: 900, vigenteDesde: '2026-10-22', costoVigente: 800, costoVigenteDesde: '2026-10-01',
      costoVigenteOrigen: 'csv', costoVigenteProveedor: null, esHabitual: true,
    }],
  };
  const respuesta = (cambios: Partial<ImportarListaResponse> = {}): ImportarListaResponse => ({
    vistaPrevia: true, renglones: 3, emparejados: 2, nuevos: 1, actualizados: 1, sinCambios: 0, subas: 1, bajas: 0, costosCargados: 0,
    habitualesMarcados: 0, cambios: [{ articuloId: 7, codigo: '7790000000017', descripcion: 'Aceite', costoAnteriorLista: 900, costoVigente: 800, costoNuevo: 990, variacionPct: 23.8 }],
    noEncontrados: [{ fila: 4, codigo: '7791', codigoProveedor: null, descripcion: 'Otra cosa' }], errores: [], ...cambios,
  });

  async function abrir() {
    http = configurar(true);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/proveedores/5');
    http.expectOne(`${COMPRAS}/proveedores/5?businessAccountId=10`).flush(distri);
    http.expectOne((r) => r.url === `${COMPRAS}/proveedores/5/articulos`).flush(lista);
    h.detectChanges();
    return { h, el: h.routeNativeElement as HTMLElement, cmp: h.routeDebugElement!.componentInstance as ProveedorListaComponent };
  }

  it('muestra la ficha y la lista con el costo final y el vigente', async () => {
    const { el } = await abrir();
    expect(texto(el.querySelector('h1'))).toBe('Distri Norte');
    expect(texto(el.querySelector('.proveedor__ficha'))).toContain('Paga a 30 días');
    const fila = texto(el.querySelector('tr[data-articulo="7790000000017"]'));
    expect(fila).toContain('A-1');
    expect(fila).toContain('habitual');
    expect(fila).toContain('900,00');
    expect(fila).toContain('800,00');
    expect(fila).toContain('planilla');
    expect(fila).toContain('la lista: +12,5 %');
  });

  it('importar: columnas adivinadas, "Ver qué cambia" y después "Importar"', async () => {
    const { h, el, cmp } = await abrir();
    cmp.cargarFilas('lista.xlsx', [
      ['EAN', 'Descripción', 'Precio', 'Bonif'],
      ['7790000000017', 'Aceite', 1100, 10],
      ['7791', 'Otra cosa', 50, null],
    ]);
    h.detectChanges();
    expect(texto(el)).toContain('lista.xlsx · 2 filas con código');
    expect(el.querySelector<HTMLSelectElement>('select[data-columna="costo"]')!.value).toBe('2');

    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes('Ver qué cambia'))!.click();
    const previa = http.expectOne(`${COMPRAS}/proveedores/5/lista`);
    expect(previa.request.body).toEqual(jasmine.objectContaining({
      businessAccountId: 10, vistaPrevia: true, costoPorBulto: false, aplicarCostos: true, marcarHabitual: true,
      renglones: [
        { fila: 2, codigo: '7790000000017', codigoProveedor: null, descripcion: 'Aceite', costo: 1100, bonificacionPct: 10, unidadesPorBulto: null },
        { fila: 3, codigo: '7791', codigoProveedor: null, descripcion: 'Otra cosa', costo: 50, bonificacionPct: null, unidadesPorBulto: null },
      ],
    }));
    previa.flush(respuesta());
    h.detectChanges();
    expect(texto(el.querySelector('.proveedor__previa'))).toContain('2 de 3 filas son artículos tuyos');
    expect(texto(el.querySelector('.proveedor__previa'))).toContain('+23,8 %');
    expect(texto(el.querySelector('.proveedor__previa'))).toContain('1 fila no es un artículo tuyo (se saltea)');

    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === 'Importar')!.click();
    const real = http.expectOne(`${COMPRAS}/proveedores/5/lista`);
    expect(real.request.body.vistaPrevia).toBeFalse();
    real.flush(respuesta({ vistaPrevia: false, costosCargados: 1, habitualesMarcados: 1 }));
    http.expectOne(`${COMPRAS}/proveedores/5?businessAccountId=10`).flush(distri);
    http.expectOne((r) => r.url === `${COMPRAS}/proveedores/5/articulos`).flush(lista);
    h.detectChanges();
    expect(texto(el.querySelector('.alert--success'))).toBe(
      'Lista importada: 1 nuevos y 1 actualizados, 1 costos vigentes cambiados, y es el proveedor habitual de 1 artículos más.');
    expect(texto(el)).not.toContain('lista.xlsx');
  });

  it('sin columna de costo no se manda nada', async () => {
    const { h, el, cmp } = await abrir();
    cmp.cargarFilas('raro.csv', [['EAN', 'Nombre'], ['7790000000017', 'Aceite']]);
    h.detectChanges();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes('Ver qué cambia'))!.click();
    h.detectChanges();
    expect(texto(el.querySelector('[role=alert]'))).toBe('Elegí la columna del costo.');
  });

  it('cambiar un artículo de la lista: trae lo que tenía y guarda', async () => {
    const { h, el } = await abrir();
    Array.from(el.querySelectorAll<HTMLButtonElement>('tr[data-articulo] button')).find((b) => b.textContent!.includes('Cambiar'))!.click();
    h.detectChanges();
    const costo = Array.from(el.querySelectorAll('label')).find((l) => l.textContent!.includes('Costo sin IVA'))!.querySelector('input')!;
    expect(costo.value).toBe('1000');
    costo.value = '1.200';
    costo.dispatchEvent(new Event('input'));
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes('Guardar en la lista'))!.click();
    const req = http.expectOne(`${COMPRAS}/proveedores/5/articulos`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      businessAccountId: 10, codigo: '7790000000017', codigoProveedor: 'A-1', unidadesPorBulto: 12, costoNeto: 1200, bonificacionPct: 10,
      costoPorBulto: false, aplicarCosto: true,
    });
    req.flush(respuesta({ vistaPrevia: false, costosCargados: 1 }));
    http.expectOne((r) => r.url === `${COMPRAS}/proveedores/5/articulos`).flush(lista);
    h.detectChanges();
    expect(texto(el.querySelector('.alert--success'))).toBe('«Aceite» guardado en la lista y como costo vigente.');
  });
});
