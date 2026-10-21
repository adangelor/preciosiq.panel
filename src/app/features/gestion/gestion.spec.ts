import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { ArticulosComponent } from './articulos';
import { ArticuloFichaComponent } from './articulo-ficha';
import { RubrosComponent } from './rubros';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { ArticuloListaResponse, Rubro } from '../../core/articulos.models';
import { environment } from '../../../environments/environment';

// BP-178 (21-oct-2026) -- las pantallas de Gestión, con la API de mentira. Nunca contra la API de prod.
const API = `${environment.apiBaseUrl}business/articles`;

function contexto(conPlan: boolean): Partial<GestionContextoService> {
  const g: GestionContexto = {
    businessAccountId: 10, branches: [], gestionArticulos: conPlan, gestionStock: conPlan, formacionPrecios: conPlan, tier: 'avanzado',
  };
  return { load: () => of(g) };
}

const listaVacia: ArticuloListaResponse = { total: 0, page: 1, pageSize: 50, items: [] };
const listaUno: ArticuloListaResponse = {
  total: 1, page: 1, pageSize: 50,
  items: [{
    id: 7, codigo: '7790895000997', esEan: true, codigoInterno: null, descripcion: 'Galletitas', marca: 'M',
    presentacionCantidad: 200, presentacionUnidad: 'GR', rubroId: 2, rubro: 'Almacén > Galletitas', proveedorHabitualId: null,
    proveedor: null, ivaAlicuota: 21, costoNeto: null, costoDesde: null, margenObjetivoPct: 30, margenDe: 'Almacén',
    sucursales: 2, activo: true, ivaParaRevisar: true,
  }],
};

function configurar(conPlan: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'gestion/articulos', component: ArticulosComponent },
        { path: 'gestion/articulos/:id', component: ArticuloFichaComponent },
        { path: 'gestion/rubros', component: RubrosComponent },
      ]),
      { provide: GestionContextoService, useValue: contexto(conPlan) },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

describe('Gestión → Artículos (BP-178)', () => {
  it('sin el plan: dice qué plan la trae y no llama a la API', async () => {
    const http = configurar(false);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/articulos', ArticulosComponent);
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Avanzado');
    http.expectNone((r) => r.url.startsWith(API));
    http.verify();
  });

  it('sin artículos: ofrece "Armar mis artículos"', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/articulos', ArticulosComponent);
    http.expectOne((r) => r.url === API).flush(listaVacia);
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush([]);
    http.expectOne(`${API}/proveedores?businessAccountId=10`).flush([]);
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Todavía no tenés fichas de artículo');
  });

  it('el filtro "Sin costo" le pide al servidor sinCosto=true; la fila muestra el IVA para revisar', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/articulos', ArticulosComponent);
    http.expectOne((r) => r.url === API).flush(listaUno);
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush([]);
    http.expectOne(`${API}/proveedores?businessAccountId=10`).flush([]);
    harness.detectChanges();
    const el = harness.routeNativeElement!;
    expect(el.querySelector('tbody tr')?.textContent).toContain('revisar');
    expect(el.querySelector('tbody tr')?.textContent).toContain('30 % (de Almacén)');

    const chip = [...el.querySelectorAll<HTMLButtonElement>('.chip')].find((b) => b.textContent?.includes('Sin costo'))!;
    chip.click();
    const req = http.expectOne((r) => r.url === API);
    expect(req.request.params.get('sinCosto')).toBe('true');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(listaVacia);
  });

  it('"Armar mis artículos" muestra el resultado y el aviso de IVA para revisar', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/articulos', ArticulosComponent);
    http.expectOne((r) => r.url === API).flush(listaVacia);
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush([]);
    http.expectOne(`${API}/proveedores?businessAccountId=10`).flush([]);
    harness.detectChanges();
    const el = harness.routeNativeElement!;
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Armar mis artículos'))!.click();
    http.expectOne((r) => r.url === `${API}/armar` && r.method === 'POST').flush({
      creados: 11653, yaEstaban: 0, conRubro: 11203, conProveedor: 0, rubrosCreados: 112, proveedoresCreados: 0,
      ivaParaRevisar: 696, ivaParaRevisarMuestra: [], enConflicto: 0, productosSinEanCorregidos: 0, milisegundos: 8135, soloMedido: false,
    });
    http.expectOne((r) => r.url === API).flush(listaUno);
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush([]);
    http.expectOne(`${API}/proveedores?businessAccountId=10`).flush([]);
    harness.detectChanges();
    expect(el.textContent).toContain('11.653 artículos nuevos');
    expect(el.textContent).toContain('696 son de rubros que muchas veces van al 10,5 %');
  });
});

describe('Gestión → ficha del artículo (BP-178)', () => {
  it('el alta muestra el error del servidor tal cual ("Ese código ya es de …")', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    const ficha = await harness.navigateByUrl('/gestion/articulos/nuevo', ArticuloFichaComponent);
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush([]);
    http.expectOne(`${API}/proveedores?businessAccountId=10`).flush([]);
    harness.detectChanges();
    const el = harness.routeNativeElement!;
    const f = (ficha as unknown as { form: { patchValue: (v: object) => void } }).form;
    f.patchValue({ codigo: '7790895000997', descripcion: 'Galletitas' });
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne((r) => r.url === API && r.method === 'POST');
    expect(req.request.body.codigo).toBe('7790895000997');
    expect(req.request.body.ivaAlicuota).toBe(21);
    req.flush({ error: 'Ese código ya es de «Galletitas Prueba 178».' }, { status: 400, statusText: 'Bad Request' });
    harness.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Ese código ya es de «Galletitas Prueba 178».');
  });

  it('un código de 13 números marcado "sin código de barras" se frena antes de mandar', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    const ficha = await harness.navigateByUrl('/gestion/articulos/nuevo', ArticuloFichaComponent);
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush([]);
    http.expectOne(`${API}/proveedores?businessAccountId=10`).flush([]);
    harness.detectChanges();
    const f = (ficha as unknown as { form: { patchValue: (v: object) => void } }).form;
    f.patchValue({ codigo: '7790895000997', descripcion: 'Pan', sinCodigoDeBarras: true });
    harness.routeNativeElement!.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    http.expectNone((r) => r.url === API && r.method === 'POST');
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('no puede tener 13 números');
  });
});

describe('Gestión → Rubros (BP-178)', () => {
  it('el árbol muestra el margen heredado', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gestion/rubros', RubrosComponent);
    const rubros: Rubro[] = [
      { id: 1, parentId: null, nombre: 'Almacén', camino: 'Almacén', nivel: 1, margenObjetivoPct: 30, margenEfectivoPct: 30, margenHeredadoDe: null, orden: 0, activo: true, articulos: 3 },
      { id: 2, parentId: 1, nombre: 'Galletitas', camino: 'Almacén > Galletitas', nivel: 2, margenObjetivoPct: null, margenEfectivoPct: 30, margenHeredadoDe: 'Almacén', orden: 0, activo: true, articulos: 5 },
    ];
    http.expectOne(`${API}/rubros?businessAccountId=10`).flush(rubros);
    harness.detectChanges();
    const filas = harness.routeNativeElement!.querySelectorAll('tbody tr');
    expect(filas.length).toBe(2);
    expect(filas[1].className).toContain('rubros__nivel-2');
    expect(filas[1].textContent).toContain('30 % (heredado de Almacén)');
  });
});
