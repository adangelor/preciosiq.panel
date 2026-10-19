import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TiendaSucursalesComponent } from './tienda-sucursales';
import { TiendaDeCuenta } from '../../core/tienda';
import { API, cuentaAiello } from './tienda-fixtures.spec';

// BP-167 (19-oct-2026) -- "Sucursales en tu tienda". API simulada con HttpTestingController.
describe('TiendaSucursalesComponent (BP-167)', () => {
  let fixture: ComponentFixture<TiendaSucursalesComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let guardadas: TiendaDeCuenta[];

  function montar(cuenta: TiendaDeCuenta, enApp: Partial<Record<string, boolean>> = {}): void {
    fixture = TestBed.createComponent(TiendaSucursalesComponent);
    fixture.componentRef.setInput('cuenta', cuenta);
    fixture.componentRef.setInput('businessAccountId', 101);
    fixture.componentRef.setInput('enApp', enApp);
    guardadas = [];
    fixture.componentInstance.guardadas.subscribe((c) => guardadas.push(c));
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  const fila = (branchId: string) => el.querySelector<HTMLElement>(`li[data-branch="${branchId}"]`)!;
  const interruptor = (branchId: string) => fila(branchId).querySelector<HTMLInputElement>('input[role="switch"]')!;
  const boton = (texto: string, dentro: HTMLElement = el) =>
    Array.from(dentro.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(texto))!;

  function tocar(input: HTMLInputElement): void {
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function guardar() {
    boton('Guardar sucursales').click();
    fixture.detectChanges();
    const req = http.expectOne(`${API}/11/sucursales`);
    expect(req.request.method).toBe('PUT');
    return req;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TiendaSucursalesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('muestra una fila por sucursal, cuál es automática y por qué no entran las que no entran', () => {
    montar(cuentaAiello());
    expect(el.querySelectorAll('li.suc').length).toBe(5);

    expect(fila('2').textContent).toContain('Automática');
    expect(fila('2').textContent).toContain('Entra sola');
    expect(fila('2').textContent).toContain('La tienda abre acá');
    expect(interruptor('2').checked).toBeTrue();

    expect(fila('1').textContent).toContain('Elegida a mano');
    expect(fila('10').textContent).toContain('la sucursal Sur no está habilitada');
    expect(interruptor('10').checked).toBeFalse();

    // Sin ubicacion: explica por que y lleva a Sucursales para ubicarla.
    expect(fila('4').textContent).toContain('no tiene ubicación');
    const ubicar = fila('4').querySelector<HTMLAnchorElement>('a[href="/sucursales"]');
    expect(ubicar?.textContent).toContain('Ubicala en Sucursales');
    expect(interruptor('4').checked).toBeFalse();

    // Sin productos: explica por que y lleva a cargar precios.
    expect(fila('5').textContent).toContain('todavía no tiene productos');
    expect(fila('5').querySelector('a[href="/precios/cargar"]')).not.toBeNull();

    // El link viejo de la sucursal y su cartel con QR.
    expect(fila('1').textContent).toContain('misuper.app/aiello-supermercados-centro');
    expect(fila('1').querySelector('a[href="/mi-tienda/cartel/1"]')).not.toBeNull();

    // Sin cambios no hay nada que guardar.
    expect(boton('Guardar sucursales')).toBeUndefined();
  });

  it('sacar la principal y sumar otra manda solo esas filas y saca la principal', () => {
    montar(cuentaAiello());
    tocar(interruptor('2')); // Norte afuera (era la principal)
    tocar(interruptor('10')); // Sur adentro
    expect(fila('1').textContent).toContain('La tienda abre acá'); // ahora abre en la de menor BranchId

    const req = guardar();
    expect(req.request.body).toEqual({
      sucursales: [
        { branchId: '2', habilitada: false, whatsApp: null },
        { branchId: '10', habilitada: true, whatsApp: null },
      ],
      principal: '',
    });
    const respuesta = cuentaAiello();
    req.flush(respuesta);
    fixture.detectChanges();
    expect(guardadas).toEqual([respuesta]);
    expect(el.textContent).toContain('Listo, guardamos las sucursales');
  });

  it('"Volver a automática" manda habilitada null y conserva el WhatsApp propio', () => {
    montar(cuentaAiello());
    boton('Volver a automática', fila('1')).click();
    fixture.detectChanges();
    expect(fila('1').textContent).toContain('Automática');

    const req = guardar();
    expect(req.request.body).toEqual({
      sucursales: [{ branchId: '1', habilitada: null, whatsApp: '+5492664000001' }],
      principal: null,
    });
    req.flush(cuentaAiello());
  });

  it('marcar otra principal y ponerle WhatsApp a una sucursal', () => {
    montar(cuentaAiello());
    const radio = fila('1').querySelector<HTMLInputElement>('input[type="radio"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    const wa = fila('2').querySelector<HTMLInputElement>('input[type="tel"]')!;
    expect(wa.placeholder).toContain('266 400-0002'); // vacio = el de la tienda
    wa.value = '266 4555555';
    wa.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const req = guardar();
    expect(req.request.body).toEqual({
      sucursales: [{ branchId: '2', habilitada: null, whatsApp: '266 4555555' }],
      principal: '1',
    });
    req.flush(cuentaAiello());
  });

  it('el 400 de WhatsApp aparece debajo del WhatsApp de esa sucursal', () => {
    montar(cuentaAiello());
    const wa = fila('2').querySelector<HTMLInputElement>('input[type="tel"]')!;
    wa.value = '123';
    wa.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    guardar().flush(
      { error: 'El WhatsApp de Norte no es un celular argentino. Escribilo con el código de área, por ejemplo 266 4123456.', campo: 'whatsApp' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(fila('2').querySelector('.form-error')?.textContent).toContain('El WhatsApp de Norte no es un celular argentino');
    expect(fila('1').querySelector('.form-error')).toBeNull();
  });

  it('el 400 de "sacar todas con la tienda publicada" aparece en la sección', () => {
    montar(cuentaAiello());
    tocar(interruptor('1'));
    tocar(interruptor('2'));
    guardar().flush(
      { error: 'Tiene que quedar al menos una sucursal en la tienda (o despublicala).', campo: 'sucursales' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(el.querySelector('.sucs > .form-error')?.textContent).toContain('Tiene que quedar al menos una sucursal');
  });

  it('BP-72: una sucursal habilitada que no se ve en la app ofrece mostrarla', () => {
    montar(cuentaAiello(), { '1': true, '2': false });
    expect(fila('1').textContent).not.toContain('No aparece en la app BuscaPrecios');
    boton('Mostrarla en BuscaPrecios', fila('2')).click();
    const req = http.expectOne('https://localhost:7214/api/business/branches/2/visibilidad');
    expect(req.request.body).toEqual({ businessAccountId: 101, isPublic: true });
    req.flush({ branchId: '2', isPublic: true });
    fixture.detectChanges();
    expect(fila('2').textContent).not.toContain('No aparece en la app BuscaPrecios');
  });

  it('sin tienda todavía: muestra cuáles entran solas, sin dejar tocar nada', () => {
    montar(cuentaAiello({ tienda: null }));
    expect(el.textContent).toContain('Cuando crees tu tienda entran solas');
    expect(interruptor('2').disabled).toBeTrue();
    expect(interruptor('2').checked).toBeTrue();
    expect(fila('2').querySelector('input[type="tel"]')).toBeNull();
    expect(boton('Volver a automática')).toBeUndefined();
  });
});
