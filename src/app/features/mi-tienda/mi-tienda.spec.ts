import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MiTiendaComponent } from './mi-tienda';
import { BusinessContextService } from '../../core/business-context';
import { TiendaDeCuenta } from '../../core/tienda';
import { API, contextoFalso, cuentaAiello, sucursal, tienda } from './tienda-fixtures.spec';
import { environment } from '../../../environments/environment';

// BP-167 (19-oct-2026) -- "Mi tienda" = una tienda por cuenta (GET /cuenta). API simulada con HttpTestingController.
describe('MiTiendaComponent (BP-167)', () => {
  let fixture: ComponentFixture<MiTiendaComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  function montar(cuenta: TiendaDeCuenta): void {
    fixture = TestBed.createComponent(MiTiendaComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/cuenta?businessAccountId=101`).flush(cuenta);
    http.expectOne(`${environment.apiBaseUrl}business/branches?businessAccountId=101`).flush([]);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  const boton = (texto: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(texto))!;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MiTiendaComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BusinessContextService, useValue: contextoFalso },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('sin tienda: el alta arranca con el slug y el nombre sugeridos, sin elegir sucursal', fakeAsync(() => {
    montar(cuentaAiello({ tienda: null }));
    expect(el.querySelectorAll('app-tienda-cuenta').length).toBe(1);
    const slug = el.querySelector<HTMLInputElement>('.slug input')!;
    expect(slug.value).toBe('aiello-supermercados');
    expect(el.textContent).toContain('Sucursales en tu tienda');

    tick(400);
    const chequeo = http.expectOne((r) => r.url === `${API}/slug`);
    expect(chequeo.request.params.has('branchId')).toBeFalse();
    chequeo.flush({ slug: 'aiello-supermercados', disponible: true, motivo: null });
    fixture.detectChanges();

    boton('Crear mi tienda').click();
    const alta = http.expectOne(API);
    expect(alta.request.method).toBe('PUT');
    expect(alta.request.body.branchId).toBeUndefined(); // varias sucursales: entran solas
    expect(alta.request.body.slug).toBe('aiello-supermercados');
    expect(alta.request.body.activa).toBeTrue();
    alta.flush(tienda());
    // Despues del alta se vuelve a pedir la cuenta (las sucursales como las dejo el servidor).
    http.expectOne(`${API}/cuenta?businessAccountId=101`).flush(cuentaAiello());
    fixture.detectChanges();
    expect(el.textContent).toContain('¡Listo! Tu tienda ya está publicada.');
    http.match(() => true); // carrusel, destacados y estadisticas de la tienda nueva: no importan aca
  }));

  it('una sola sucursal sin ubicación: el alta la mete a mano (como antes de BP-167)', fakeAsync(() => {
    const sola = sucursal({ branchId: '7', nombre: 'Única', tieneUbicacion: false, habilitadaPorDefecto: false, habilitada: false });
    montar(cuentaAiello({ tienda: null, sucursales: [sola], sucursalPorDefecto: null }));
    tick(400);
    http.expectOne((r) => r.url === `${API}/slug`).flush({ slug: 'x', disponible: true, motivo: null });
    fixture.detectChanges();
    boton('Crear mi tienda').click();
    expect(http.expectOne(API).request.body.branchId).toBe('7');
  }));

  it('varias sucursales y ninguna entra sola: arranca sin publicar y el 400 de "activa" va al lado del publicar', fakeAsync(() => {
    const c = cuentaAiello({ tienda: null, sucursalPorDefecto: null });
    c.sucursales = c.sucursales.map((s) => ({ ...s, habilitada: false, habilitadaPorDefecto: false, habilitadaAMano: null }));
    montar(c);
    expect(el.textContent).toContain('Ninguna de tus sucursales entra sola todavía');
    tick(400);
    http.expectOne((r) => r.url === `${API}/slug`).flush({ slug: 'x', disponible: true, motivo: null });
    fixture.detectChanges();

    const publicar = Array.from(el.querySelectorAll<HTMLInputElement>('.formulario input[type="checkbox"]')).pop()!;
    expect(publicar.checked).toBeFalse();
    publicar.click(); // la quiere publicar igual
    fixture.detectChanges();
    boton('Crear mi tienda').click();
    http.expectOne(API).flush(
      { error: 'Para publicar la tienda tiene que haber al menos una sucursal en ella.', campo: 'activa' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(el.querySelector('.formulario .form-error')?.textContent).toContain('al menos una sucursal');
  }));

  it('con tienda: una sola tarjeta, el cartel de la sucursal en la que abre y "Tus links viejos siguen andando"', () => {
    montar(cuentaAiello({ tienda: tienda({ slugsAnteriores: ['aiello-supermercados-centro', 'aiello-supermercados-sur'] }) }));
    expect(el.querySelectorAll('app-tienda-cuenta').length).toBe(1);
    expect(el.querySelector('.tarjeta__titulo')?.textContent).toContain('Aiello Supermercados');
    expect(el.querySelector('.tarjeta__cabecera')?.textContent).toContain('2 sucursales en la tienda');
    expect(el.querySelector('.tarjeta__cabecera')?.textContent).toContain('abre en Norte');
    expect(el.querySelector('.acciones a[href="/mi-tienda/cartel/2"]')).not.toBeNull();

    const viejos = el.querySelector('.links-viejos')!;
    expect(viejos.textContent).toContain('Tus links viejos siguen andando');
    expect(viejos.textContent).toContain('misuper.app/aiello-supermercados-centro');
    expect(viejos.textContent).toContain('misuper.app/aiello-supermercados-sur');
    http.match(() => true);
  });

  it('sin links viejos no muestra el aviso', () => {
    montar(cuentaAiello());
    expect(el.querySelector('.links-viejos')).toBeNull();
    http.match(() => true);
  });
});
