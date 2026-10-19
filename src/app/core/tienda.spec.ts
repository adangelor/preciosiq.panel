import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TiendaService } from './tienda';
import { environment } from '../../environments/environment';

// BP-167 (19-oct-2026) -- el cliente de /api/business/tienda con una tienda por cuenta. Todo contra HttpTestingController.
describe('TiendaService (BP-167)', () => {
  const api = `${environment.apiBaseUrl}business/tienda`;
  let service: TiendaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TiendaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('cuenta() pide GET /cuenta con la cuenta', () => {
    service.cuenta(101).subscribe();
    const req = http.expectOne(`${api}/cuenta?businessAccountId=101`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('guardarSucursales() manda PUT /{id}/sucursales con las filas y la principal', () => {
    const body = { sucursales: [{ branchId: '10', habilitada: false, whatsApp: null }], principal: '' };
    service.guardarSucursales(11, body).subscribe();
    const req = http.expectOne(`${api}/11/sucursales`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(body);
    req.flush({});
  });

  it('chequearSlug() ya no manda branchId', () => {
    service.chequearSlug(101, 'aiello').subscribe();
    const req = http.expectOne((r) => r.url === `${api}/slug`);
    expect(req.request.params.get('businessAccountId')).toBe('101');
    expect(req.request.params.get('slug')).toBe('aiello');
    expect(req.request.params.has('branchId')).toBeFalse();
    req.flush({ slug: 'aiello', disponible: true, motivo: null });
  });

  it('pedidos() pasa ?sucursal= solo si hay filtro', () => {
    service.pedidos(11).subscribe();
    http.expectOne(`${api}/11/pedidos?dias=30`).flush([]);
    service.pedidos(11, 30, '10').subscribe();
    http.expectOne(`${api}/11/pedidos?dias=30&sucursal=10`).flush([]);
  });

  it('estadisticas() pasa ?sucursal= solo si hay filtro', () => {
    service.estadisticas(11).subscribe();
    http.expectOne(`${api}/11/estadisticas`).flush({});
    service.estadisticas(11, '2').subscribe();
    http.expectOne(`${api}/11/estadisticas?sucursal=2`).flush({});
  });

  it('urlSucursal() abre la tienda de la cadena en esa sucursal', () => {
    expect(service.urlSucursal('aiello-supermercados', '10')).toBe(`${environment.misuperUrl}/aiello-supermercados?sucursal=10`);
  });
});
