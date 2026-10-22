import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BusinessContextService } from '../../core/business-context';
import {
  AVISOS,
  ejemploDeConfiguracion,
  enHojas,
  precioFinal,
  precioPartido,
  presentacionTexto,
  promoDelCartel,
  redondear,
  referenciaDelCartel,
  resumenDeAplicar,
  resumenTexto,
} from '../../core/formacion-form';
import { CartelesResponse, SugeridoItem, SugeridosResponse } from '../../core/formacion.models';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { CartelesGondolaComponent, origenDe } from './carteles';
import { FormacionConfiguracionComponent } from './configuracion';
import { FormacionPreciosComponent } from './formacion';

// BP-181 (21-oct-2026) -- formación de precios y carteles de góndola, con la API de mentira. Nunca contra la API de prod.
const API = `${environment.apiBaseUrl}business/pricing`;

describe('Formación de precios: la fórmula (espejo del backend)', () => {
  // Los mismos casos que el harness `formacion` del backend: si el backend cambia, esto tiene que cambiar igual.
  const casos: [string, number | null, number][] = [
    ['inscripto 1000 + 30 % + IVA 21', precioFinal(1000, null, 21, null, 30, 'sobre_costo', true), 1580],
    ['sobre el precio', precioFinal(1000, null, 21, null, 30, 'sobre_precio', true), 1730],
    ['monotributo con costo con IVA', precioFinal(1000, 1210, 21, null, 30, 'sobre_costo', false), 1580],
    ['impuestos internos 10 %', precioFinal(1000, null, 21, 10, 30, 'sobre_costo', true), 1740],
    ['IVA 10,5 %', precioFinal(1000, null, 10.5, null, 30, 'sobre_costo', true), 1440],
  ];
  for (const [nombre, precio, esperado] of casos) {
    it(`${nombre} → ${esperado}`, () => {
      expect(precio).not.toBeNull();
      expect(redondear(precio!, 10, 'arriba', false)).toBe(esperado);
    });
  }

  it('los redondeos: cercano, de a 50, terminar en 9', () => {
    expect(redondear(1573, 10, 'cercano', false)).toBe(1570);
    expect(redondear(1573, 50, 'arriba', false)).toBe(1600);
    expect(redondear(1573, 10, 'arriba', true)).toBe(1579);
    expect(redondear(1573, 100, 'arriba', true)).toBe(1590);
    expect(redondear(12940, 1000, 'arriba', true)).toBe(12990);
    expect(redondear(1595, 100, 'arriba', true)).toBe(1690);
    expect(redondear(1580, 10, 'arriba', false)).toBe(1580);
  });

  it('sobre el precio con 100 %: no da precio', () => {
    expect(precioFinal(1000, null, 21, null, 100, 'sobre_precio', true)).toBeNull();
  });

  it('el ejemplo vivo de la configuración', () => {
    const t = ejemploDeConfiguracion({ margenDefaultPct: 30, baseMargen: 'sobre_costo', redondeoMultiplo: 10, redondeoModo: 'arriba', terminarEn9: false });
    expect(t).toContain('30 % sobre el costo');
    expect(t).toMatch(/1\.573,00 → \$\s?1\.580$/);
    const en9 = ejemploDeConfiguracion({ margenDefaultPct: 30, baseMargen: 'sobre_costo', redondeoMultiplo: 10, redondeoModo: 'arriba', terminarEn9: true });
    expect(en9).toMatch(/1\.579$/);
    expect(ejemploDeConfiguracion({ margenDefaultPct: 100, baseMargen: 'sobre_precio', redondeoMultiplo: 10, redondeoModo: 'arriba', terminarEn9: false }))
      .toContain('no da un precio');
  });
});

function item(p: Partial<SugeridoItem>): SugeridoItem {
  return {
    articuloId: 1, codigo: '7790000000001', descripcion: 'Galletitas', marca: 'M', rubro: 'Almacén > Galletitas', proveedor: null,
    costoNeto: 1000, costoConIva: null, costoDesde: '2026-10-01', ivaAlicuota: 21, margenPct: 30, margenDe: 'Almacén',
    precioActual: 1500, sucursalesConPrecio: 2, preciosDistintos: false, sugerido: 1580, diferenciaPct: 5.3, esTestigo: false,
    competencia: null, avisos: [], motivoDudosa: null, ...p,
  };
}

describe('Formación de precios: el resumen de aplicar', () => {
  it('cuenta los que suben y bajan y dice el que más sube', () => {
    const r = resumenDeAplicar([
      { item: item({ codigo: 'a', descripcion: 'Galletitas X', precioActual: 1000 }), precio: 1180 },
      { item: item({ codigo: 'b', descripcion: 'Yerba', precioActual: 2000 }), precio: 2100 },
      { item: item({ codigo: 'c', descripcion: 'Aceite', precioActual: 3000 }), precio: 2700 },
      { item: item({ codigo: 'd', descripcion: 'Arroz', precioActual: 900 }), precio: 900 },
    ]);
    expect(r.suben).toBe(2);
    expect(r.bajan).toBe(1);
    expect(r.iguales).toBe(1);
    expect(r.masSube).toEqual({ descripcion: 'Galletitas X', pct: 18 });
    expect(r.masBaja).toEqual({ descripcion: 'Aceite', pct: -10 });
    expect(resumenTexto(r)).toBe('Suben 2, bajan 1, 1 quedan igual; el que más sube: +18 % Galletitas X; el que más baja: −10 % Aceite.');
  });

  it('cada aviso tiene su texto y su color', () => {
    expect(AVISOS.caro.clase).toBe('pill--danger');
    expect(AVISOS.renegociar.texto).toBe('Renegociar costo');
  });
});

describe('Carteles de góndola: los textos', () => {
  it('presentación y precio por unidad de medida', () => {
    expect(presentacionTexto(900, 'ML')).toBe('900 ml');
    expect(presentacionTexto(1, 'UN')).toBe('');
    expect(presentacionTexto(6, 'uni')).toBe('x 6');
    expect(referenciaDelCartel({ precio: 2125, precioReferencia: 4250, cantidadReferencia: 1, unidadReferencia: 'KG' })).toMatch(/4\.250 el kilo$/);
    expect(referenciaDelCartel({ precio: 4250, precioReferencia: 4250, cantidadReferencia: 1, unidadReferencia: 'KG' })).toBeNull();
    expect(referenciaDelCartel({ precio: 900, precioReferencia: 900, cantidadReferencia: 1, unidadReferencia: 'EA' })).toBeNull();
    expect(referenciaDelCartel({ precio: 500, precioReferencia: 120, cantidadReferencia: 100, unidadReferencia: 'gr.' })).toMatch(/120 los 100 g$/);
  });

  it('el precio grande con centavos aparte', () => {
    expect(precioPartido(1580)).toEqual({ enteros: '1.580', centavos: null });
    expect(precioPartido(1579.9)).toEqual({ enteros: '1.579', centavos: '90' });
  });

  it('la promo usa el texto de la caja', () => {
    const p = promoDelCartel({ precio: 1000, promo: { tipo: 'n_x_m', minQty: 3, maxQty: null, precioPromo: null, porcentaje: null, grupoN: 3, pagaM: 2, cadaN: null, validFrom: null, validTo: null } }, '2026-10-21');
    expect(p?.texto).toBe('3x2');
    expect(p?.ejemplo).toContain('Llevando 3');
  });

  it('en hojas de a 24', () => {
    const hojas = enHojas(Array.from({ length: 50 }, (_, i) => i), 24);
    expect(hojas.map((h) => h.length)).toEqual([24, 24, 2]);
  });

  it('el origen sale de los query params', () => {
    expect(origenDe('12', null, null, null)).toEqual({ batchId: 12, branchId: null });
    expect(origenDe(null, '3', null, '999-14')).toEqual({ groupId: 3, branchId: '999-14' });
    expect(origenDe(null, null, '779,780', null)).toEqual({ eans: ['779', '780'], branchId: null });
    expect(origenDe('x', null, '', null)).toBeNull();
  });
});

// ------------------------------------------------------------------ pantallas
function contexto(conPlan: boolean, branches = [{ branchId: '999-13', branchName: 'Prueba Centro' }, { branchId: '999-14', branchName: 'Prueba Norte' }]): Partial<GestionContextoService> {
  const g = {
    businessAccountId: 10, branches, gestionArticulos: conPlan, gestionStock: conPlan, formacionPrecios: conPlan, compras: conPlan, tier: 'avanzado',
  } as unknown as GestionContexto;
  return { load: () => of(g) };
}

function configurar(conPlan: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'precios/formacion', component: FormacionPreciosComponent },
        { path: 'precios/formacion/configuracion', component: FormacionConfiguracionComponent },
        { path: 'precios/carteles', component: CartelesGondolaComponent },
      ]),
      { provide: GestionContextoService, useValue: contexto(conPlan) },
      {
        provide: BusinessContextService,
        useValue: { load: () => of({ account: { businessAccountId: 10 }, branches: [] }) },
      },
    ],
  });
  try { localStorage.removeItem('preciosiq.formacion.destino.10'); } catch { /* nada */ }
  return TestBed.inject(HttpTestingController);
}

function respuesta(items: SugeridoItem[]): SugeridosResponse {
  return {
    destino: 'Todas las sucursales (2)', competenciaDisponible: true, sinCompetenciaPorque: null,
    configuracion: { margenDefaultPct: 30, baseMargen: 'sobre_costo', redondeoMultiplo: 10, redondeoModo: 'arriba', terminarEn9: false, avisoCompetenciaPct: 10, guardada: false },
    resumen: { articulos: items.length, conCosto: items.length, sinCosto: 0, cambian: items.length, suben: items.length, bajan: 0, conAviso: 1 },
    total: items.length, page: 1, pageSize: 100, items,
  };
}

/** Las llamadas de apoyo (rubros, proveedores, zonas) se contestan vacías. */
function contestarApoyo(http: HttpTestingController): void {
  for (const r of http.match((x) => x.url.includes('/business/articles/rubros') || x.url.includes('/business/articles/proveedores') || x.url.includes('price-zones'))) {
    r.flush(r.request.url.includes('price-zones') ? { tablaLista: false, zonas: [] } : []);
  }
}

describe('Precios → Formación de precios (BP-181)', () => {
  it('sin el plan: dice qué plan la trae y no llama a la API', async () => {
    const http = configurar(false);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/precios/formacion', FormacionPreciosComponent);
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Avanzado');
    http.expectNone((r) => r.url.startsWith(API));
  });

  it('pide todas las sucursales y solo los que cambian; muestra el aviso y el margen heredado', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/precios/formacion', FormacionPreciosComponent);
    const req = http.expectOne((r) => r.url === `${API}/sugeridos`);
    expect(req.request.params.get('todasLasSucursales')).toBe('true');
    expect(req.request.params.get('soloCambios')).toBe('true');
    req.flush(respuesta([item({ avisos: ['caro'], competencia: { minimo: 1200, referencia: 1300, maximo: 1400, cadenas: 3, masBarata: 1200, cadenaMasBarata: 'X', masBarataEsNacional: true, promoMasBaja: null, promoCadena: null, promoTexto: null, metaTestigo: null } })]));
    contestarApoyo(http);
    harness.detectChanges();
    const texto = harness.routeNativeElement!.textContent!;
    expect(texto).toContain('Caro para la zona');
    expect(texto).toContain('30 % (de Almacén)');
    expect(texto).toContain('3 cadenas');
  });

  it('tildar, ver el resumen y aplicar: manda los precios (con el corregido a mano) y ofrece los carteles', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/precios/formacion', FormacionPreciosComponent);
    http.expectOne((r) => r.url === `${API}/sugeridos`).flush(respuesta([
      item({ codigo: 'a', descripcion: 'Galletitas X', precioActual: 1000, sugerido: 1180 }),
      item({ codigo: 'b', descripcion: 'Yerba', precioActual: 2000, sugerido: 2100 }),
    ]));
    contestarApoyo(http);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;

    // Corregir a mano la yerba: queda tildada.
    const inputs = el.querySelectorAll<HTMLInputElement>('input.formacion__precio');
    inputs[1].value = '2150';
    inputs[1].dispatchEvent(new Event('change'));
    harness.detectChanges();
    // Y "Tildar todas las que cambian" suma las galletitas.
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Tildar todas'))!.click();
    harness.detectChanges();
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Aplicar 2 precios'))!.click();
    harness.detectChanges();
    expect(el.textContent).toContain('Suben 2, bajan 0; el que más sube: +18 % Galletitas X.');

    Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Sí, aplicar'))!.click();
    const ap = http.expectOne(`${API}/aplicar`);
    expect(ap.request.body.todasLasSucursales).toBeTrue();
    expect(ap.request.body.filas).toEqual(jasmine.arrayWithExactContents([{ ean: 'a', precio: 1180 }, { ean: 'b', precio: 2150 }]));
    ap.flush({ batchId: 5, groupId: 9, batchIds: [5, 6], aplicados: 4, sinCambio: 0, sinPrecioEnLaSucursal: 0, errores: [], nombreDeLaCarga: 'Formación de precios 21/10 18:32' });
    http.expectOne((r) => r.url === `${API}/sugeridos`).flush(respuesta([]));
    harness.detectChanges();
    expect(el.textContent).toContain('Formación de precios 21/10 18:32');
    const cartel = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent!.includes('Imprimir carteles'))!;
    expect(cartel.getAttribute('href')).toContain('groupId=9');
  });
});

describe('Formación de precios → Configuración (BP-181)', () => {
  it('el ejemplo cambia con el formulario y guarda', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/precios/formacion/configuracion', FormacionConfiguracionComponent);
    http.expectOne((r) => r.url === `${API}/settings`).flush(
      { margenDefaultPct: 30, baseMargen: 'sobre_costo', redondeoMultiplo: 10, redondeoModo: 'arriba', terminarEn9: false, avisoCompetenciaPct: 10, guardada: false });
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toMatch(/1\.580/);
    const en9 = el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    en9.checked = true;
    en9.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(el.querySelector('.formacion-config__ejemplo')!.textContent).toMatch(/1\.579$/);
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Guardar'))!.click();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${API}/settings`);
    expect(put.request.body.terminarEn9).toBeTrue();
    expect(put.request.body.businessAccountId).toBe(10);
    put.flush({ ...put.request.body, guardada: true });
    harness.detectChanges();
    expect(el.textContent).toContain('Guardado');
  });
});

describe('Carteles de góndola (BP-181)', () => {
  it('arma la grilla con el precio grande, la referencia por kilo y la promo', async () => {
    const http = configurar(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/precios/carteles?groupId=9', CartelesGondolaComponent);
    const req = http.expectOne((r) => r.url === `${API}/carteles`);
    expect(req.request.params.get('groupId')).toBe('9');
    const r: CartelesResponse = {
      titulo: 'Formación de precios 21/10 18:32',
      sucursal: { branchId: '999-13', nombre: 'Prueba Centro' },
      sucursales: [{ branchId: '999-13', nombre: 'Prueba Centro' }, { branchId: '999-14', nombre: 'Prueba Norte' }],
      items: [
        { codigo: '779001', descripcion: 'Queso cremoso', marca: 'La Paulina', presentacionCantidad: 500, presentacionUnidad: 'GR', precio: 2125, precioReferencia: 4250, cantidadReferencia: 1, unidadReferencia: 'KG', promo: null },
        { codigo: '779002', descripcion: 'Gaseosa cola', marca: null, presentacionCantidad: 2250, presentacionUnidad: 'ML', precio: 1890, precioReferencia: 840, cantidadReferencia: 1, unidadReferencia: 'LT',
          promo: { tipo: 'n_x_m', minQty: 3, maxQty: null, precioPromo: null, porcentaje: null, grupoN: 3, pagaM: 2, cadaN: null, validFrom: null, validTo: null } },
      ],
      noEstan: [],
    };
    req.flush(r);
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    const carteles = el.querySelectorAll('article.cartel');
    expect(carteles.length).toBe(2);
    expect(carteles[0].textContent).toContain('2.125');
    expect(carteles[0].textContent).toMatch(/4\.250 el kilo/);
    expect(carteles[1].classList).toContain('cartel--promo');
    expect(carteles[1].querySelector('.cartel__promo')!.textContent).toBe('3x2');
    // Con un grupo, se elige de qué sucursal son los precios.
    expect(el.querySelectorAll('select')[0].textContent).toContain('Prueba Norte');
  });
});
