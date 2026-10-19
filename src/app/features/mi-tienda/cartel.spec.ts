import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CartelTiendaComponent } from './cartel';
import { BusinessContextService } from '../../core/business-context';
import { API, contextoFalso, cuentaAiello } from './tienda-fixtures.spec';
import { environment } from '../../../environments/environment';

// BP-167 (19-oct-2026) -- el cartel de cada sucursal: el QR abre la tienda de la cadena en esa sucursal.
describe('CartelTiendaComponent (BP-167)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'mi-tienda/cartel/:branchId', component: CartelTiendaComponent }]),
        { provide: BusinessContextService, useValue: contextoFalso },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function abrir(branchId: string) {
    const harness = await RouterTestingHarness.create();
    const cartel = await harness.navigateByUrl(`/mi-tienda/cartel/${branchId}`, CartelTiendaComponent);
    http.expectOne(`${API}/cuenta?businessAccountId=101`).flush(cuentaAiello());
    await harness.fixture.whenStable();
    harness.detectChanges();
    return { cartel, el: harness.routeNativeElement! };
  }

  it('el QR apunta a /{slug}?sucursal={branchId} y el cartel dice la sucursal', async () => {
    const { cartel, el } = await abrir('1');
    expect((cartel as unknown as { urlQr: () => string }).urlQr()).toBe(`${environment.misuperUrl}/aiello-supermercados?sucursal=1`);
    expect(el.querySelector('.cartel__qr svg')).not.toBeNull();
    expect(el.querySelector('.cartel__nombre')?.textContent).toContain('Aiello Supermercados');
    expect(el.querySelector('.cartel__sucursal')?.textContent).toContain('Sucursal Centro · Pringles 100');
    // Centro tiene WhatsApp propio: ese va en el cartel.
    expect(el.querySelector('.cartel__whatsapp')?.textContent).toContain('266 400-0001');
  });

  it('sin WhatsApp propio usa el de la tienda', async () => {
    const { el } = await abrir('2');
    expect(el.querySelector('.cartel__whatsapp')?.textContent).toContain('266 400-0002');
  });

  it('una sucursal que no está habilitada no tiene cartel', async () => {
    const { el } = await abrir('10');
    expect(el.querySelector('.cartel')).toBeNull();
    expect(el.textContent).toContain('La sucursal Sur no está habilitada en tu tienda');
  });
});
