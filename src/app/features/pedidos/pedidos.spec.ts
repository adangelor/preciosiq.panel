import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { PedidosComponent } from './pedidos';
import { BusinessContextService } from '../../core/business-context';
import { PedidoTienda } from '../../core/tienda';
import { API, contextoFalso, cuentaAiello } from '../mi-tienda/tienda-fixtures.spec';

function pedido(codigo: string, sucursal: string, sucursalNombre: string): PedidoTienda {
  return {
    codigo, creadoAtUtc: '2026-10-19T13:10:05', entrega: 'retiro', total: 2000, renglones: 1, estado: 'nuevo',
    estadoAtUtc: '2026-10-19T13:10:05', productos: [], sucursal, sucursalNombre,
  };
}

// BP-167 (19-oct-2026) -- Pedidos de la tienda unica: filtro por sucursal y la sucursal de cada pedido.
describe('PedidosComponent (BP-167)', () => {
  let fixture: ComponentFixture<PedidosComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PedidosComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BusinessContextService, useValue: contextoFalso },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PedidosComponent);
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('una sola lista con la sucursal de cada pedido, y el filtro pasa ?sucursal=', () => {
    http.expectOne(`${API}/cuenta?businessAccountId=101`).flush(cuentaAiello());
    fixture.detectChanges();
    http.expectOne(`${API}/11/pedidos?dias=30`).flush([pedido('3GCSFJ', '1', 'Centro'), pedido('7HHQ2K', '2', 'Norte')]);
    fixture.detectChanges();

    const opciones = Array.from(el.querySelectorAll('select option')).map((o) => o.textContent!.trim());
    expect(opciones).toEqual(['Todas', 'Centro', 'Norte']); // solo las que estan en la tienda
    expect(el.querySelector('.ped__lista')!.textContent).toContain('Centro');
    expect(el.querySelector('.ped__lista')!.textContent).toContain('Norte');

    const select = el.querySelector('select')!;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    http.expectOne(`${API}/11/pedidos?dias=30&sucursal=2`).flush([pedido('7HHQ2K', '2', 'Norte')]);
    fixture.detectChanges();
    expect(el.querySelectorAll('.ped__item').length).toBe(1);

    select.value = '';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    http.expectOne(`${API}/11/pedidos?dias=30`).flush([]);
  });

  it('sin tienda manda a crearla', () => {
    http.expectOne(`${API}/cuenta?businessAccountId=101`).flush(cuentaAiello({ tienda: null }));
    fixture.detectChanges();
    expect(el.textContent).toContain('Todavía no tenés tu tienda online');
  });
});
