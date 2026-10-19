import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TiendaEstadisticasComponent } from './tienda-estadisticas';
import { TiendaEstadisticas } from '../../core/tienda';
import { API, cuentaAiello } from './tienda-fixtures.spec';

function stats(sucursal: string | null): TiendaEstadisticas {
  const p = { visitas: 10, pedidos: 2, monto: 5000 };
  return {
    resumen: { desde: '2026-10-13', hasta: '2026-10-19', actual: p, anterior: p },
    detalleIncluido: false,
    detalle: null,
    sucursal,
    porSucursal: [
      { branchId: '1', nombre: 'Centro', actual: { visitas: 7, pedidos: 2, monto: 5000 } },
      { branchId: '2', nombre: 'Norte', actual: { visitas: 3, pedidos: 0, monto: 0 } },
      { branchId: null, nombre: null, actual: { visitas: 1, pedidos: 0, monto: 0 } },
    ],
  };
}

// BP-167 (19-oct-2026) -- estadisticas por sucursal: filtro y tabla "Por sucursal".
describe('TiendaEstadisticasComponent (BP-167)', () => {
  let fixture: ComponentFixture<TiendaEstadisticasComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TiendaEstadisticasComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TiendaEstadisticasComponent);
    fixture.componentRef.setInput('tiendaId', 11);
    fixture.componentRef.setInput('sucursales', cuentaAiello().sucursales.filter((s) => s.habilitada));
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('muestra la tabla "Por sucursal" y filtra con ?sucursal=', () => {
    http.expectOne(`${API}/11/estadisticas`).flush(stats(null));
    fixture.detectChanges();

    const tabla = el.querySelector('.est__porsucursal')!;
    expect(tabla.textContent).toContain('Por sucursal');
    const filas = Array.from(tabla.querySelectorAll('tbody tr')).map((tr) => tr.textContent!.replace(/\s+/g, ' ').trim());
    expect(filas[0]).toContain('Centro');
    expect(filas[0]).toContain('$5.000');
    expect(filas[2]).toContain('Sin sucursal (antes del cambio)');

    // Tocar una sucursal de la tabla la filtra.
    tabla.querySelector<HTMLButtonElement>('.est__link')!.click();
    fixture.detectChanges();
    http.expectOne(`${API}/11/estadisticas?sucursal=1`).flush(stats('1'));
    fixture.detectChanges();
    expect(el.textContent).toContain('en Centro');

    // Y el selector vuelve a "Todas".
    const select = el.querySelector<HTMLSelectElement>('.est__filtro select')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    http.expectOne(`${API}/11/estadisticas`).flush(stats(null));
  });
});
