import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TiendaEnviosComponent, numeroEnvio } from './tienda-envios';
import { CondicionesEnvio, EnviosDeLaTienda, ResumenDeEnvios, fraseDeEnvio } from '../../core/tienda-envios';
import { PedidoTienda, detalleEnvio } from '../../core/tienda';
import { API } from './tienda-fixtures.spec';

// BP-193 (22-oct-2026) -- Mi tienda -> Envios. API simulada con HttpTestingController; sin mapa (conMapa = false).
describe('TiendaEnviosComponent (BP-193)', () => {
  let fixture: ComponentFixture<TiendaEnviosComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const sinConfigurar: CondicionesEnvio = { configurado: false, haceEnvio: true, radioKm: null, pedidoMinimo: null, costo: null, gratisDesde: null, nota: null };
  const centroMag: CondicionesEnvio = { configurado: true, haceEnvio: true, radioKm: 5, pedidoMinimo: 60000, costo: 1500, gratisDesde: 100000, nota: 'Martes y jueves' };

  function envios(cambios: Partial<EnviosDeLaTienda> = {}, centro = sinConfigurar, norte = sinConfigurar): EnviosDeLaTienda {
    return {
      tiendaId: 11, disponible: true, ningunaConfigurada: !centro.configurado && !norte.configurado, avisos: [],
      sucursales: [
        { branchId: '1', nombre: 'Centro', calle: 'Pringles 100', ciudad: 'San Luis', lat: -33.3, lon: -66.33, tieneUbicacion: true, enLaTienda: true, condiciones: centro, frase: fraseDeEnvio(centro) },
        { branchId: '2', nombre: 'Norte', calle: 'Lafinur 1200', ciudad: 'San Luis', lat: -33.27, lon: -66.33, tieneUbicacion: true, enLaTienda: true, condiciones: norte, frase: fraseDeEnvio(norte) },
        { branchId: '9', nombre: 'Depósito', calle: null, ciudad: null, lat: null, lon: null, tieneUbicacion: false, enLaTienda: false, condiciones: sinConfigurar, frase: fraseDeEnvio(sinConfigurar) },
      ],
      ...cambios,
    };
  }
  const resumenVacio: ResumenDeEnvios = {
    dias: 30, disponible: true, porSucursal: [],
    total: { pedidos: 0, envios: 0, retiros: 0, fueraDelRadio: 0, ticketEnvio: null, ticketRetiro: null, costoDeEnvios: 0 },
  };

  function montar(d: EnviosDeLaTienda, resumen: ResumenDeEnvios = resumenVacio): void {
    fixture = TestBed.createComponent(TiendaEnviosComponent);
    fixture.componentRef.setInput('tiendaId', 11);
    fixture.componentRef.setInput('conMapa', false);
    fixture.detectChanges();
    http.expectOne(`${API}/11/envios`).flush(d);
    http.expectOne((r) => r.url === `${API}/11/envios/resumen`).flush(resumen);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }
  /** Las localidades se piden con una espera de 400 ms (mientras se tipea el radio). */
  function coberturaPendiente(sucursal: string, radio: string | null) {
    return http.expectOne((r) => r.url === `${API}/11/envios/cobertura` && r.params.get('sucursal') === sucursal && r.params.get('radioKm') === radio);
  }

  const tarjeta = (branchId: string) => el.querySelector<HTMLElement>(`li[data-branch="${branchId}"]`)!;
  const campo = (branchId: string, etiqueta: string) =>
    Array.from(tarjeta(branchId).querySelectorAll('label')).find((l) => l.textContent!.includes(etiqueta))!.querySelector('input')!;
  const boton = (texto: string, dentro: HTMLElement = el) =>
    Array.from(dentro.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(texto))!;
  const texto = (x: Element | null) => x?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  function tipear(input: HTMLInputElement, valor: string): void {
    input.value = valor;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TiendaEnviosComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('sin nada configurado: el aviso, solo las sucursales de la tienda y la frase de siempre', fakeAsync(() => {
    montar(envios());
    tick(400);
    coberturaPendiente('1', null).flush({ branchId: '1', nombre: 'Centro', radioKm: 10, radioDeReferencia: true, localidades: [], totalLocalidades: 0, aclaracion: 'x' });
    fixture.detectChanges();
    expect(texto(el)).toContain('Todavía no configuraste el envío');
    expect(el.querySelectorAll('li.envio').length).toBe(2);
    expect(tarjeta('9')).toBeNull();
    expect(texto(el)).toContain('Una sucursal no está en la tienda');
    expect(texto(tarjeta('1').querySelector('.envio__frase'))).toContain('Envío a domicilio: se coordina con el comercio por WhatsApp');
    expect(texto(el)).toContain('Centro no tiene radio: te mostramos lo que hay a 10 km como referencia.');
    expect(boton('Guardar envíos').disabled).toBeTrue();
  }));

  it('la frase sigue lo que se tipea, y se guarda solo lo que cambió', fakeAsync(() => {
    montar(envios());
    tick(400);
    coberturaPendiente('1', null).flush({ branchId: '1', nombre: 'Centro', radioKm: 10, radioDeReferencia: true, localidades: [], totalLocalidades: 0, aclaracion: '' });

    tipear(campo('1', 'Hasta (km)'), '5');
    tipear(campo('1', 'Pedido mínimo'), '60.000');
    tipear(campo('1', 'Costo del envío'), '1500');
    tipear(campo('1', 'Gratis desde'), '100.000');
    tipear(campo('1', 'Nota'), 'Martes y jueves');
    expect(texto(tarjeta('1').querySelector('.envio__frase')))
      .toContain('Envío a domicilio hasta 5 km · pedido mínimo $60.000 · envío $1.500, gratis desde $100.000');
    expect(texto(el)).toContain('Una sucursal con cambios sin guardar.');

    // Las localidades se vuelven a pedir con el radio que se esta tipeando.
    tick(400);
    coberturaPendiente('1', '5').flush({
      branchId: '1', nombre: 'Centro', radioKm: 5, radioDeReferencia: false, totalLocalidades: 1, aclaracion: 'Se mide hasta el centro.',
      localidades: [{ nombre: 'San Luis', provincia: 'San Luis', km: 0.4, sucursalesDeReferencia: 80 }],
    });
    fixture.detectChanges();
    expect(Array.from(el.querySelectorAll('.envios__tabla tbody td')).map(texto)).toEqual(['San Luis', 'San Luis', '0,4 km']);

    boton('Guardar envíos').click();
    const req = http.expectOne(`${API}/11/envios`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      sucursales: [{ branchId: '1', haceEnvio: true, radioKm: 5, pedidoMinimo: 60000, costo: 1500, gratisDesde: 100000, nota: 'Martes y jueves' }],
    });
    req.flush(envios({}, centroMag));
    http.expectOne((r) => r.url === `${API}/11/envios/resumen`).flush(resumenVacio);
    fixture.detectChanges();
    expect(texto(el)).toContain('Listo: tus clientes ya ven las condiciones de envío');
    expect(texto(el)).not.toContain('Todavía no configuraste el envío');
    expect(boton('Guardar envíos').disabled).toBeTrue();
  }));

  it('copiar a todas, apagar el envío de una y volver a sin configurar', fakeAsync(() => {
    montar(envios({}, centroMag));
    tick(400);
    coberturaPendiente('1', '5').flush({ branchId: '1', nombre: 'Centro', radioKm: 5, radioDeReferencia: false, localidades: [], totalLocalidades: 0, aclaracion: '' });

    boton('Copiar a todas', tarjeta('1')).click();
    fixture.detectChanges();
    expect(campo('2', 'Pedido mínimo').value).toBe('60000');
    expect(texto(tarjeta('2').querySelector('.envio__frase'))).toContain('pedido mínimo $60.000');

    const interruptor = tarjeta('2').querySelector<HTMLInputElement>('input[role="switch"]')!;
    interruptor.checked = false;
    interruptor.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(texto(tarjeta('2').querySelector('.envio__frase'))).toContain('Solo retiro en la sucursal');
    expect(tarjeta('2').querySelector('.envio__campos')).toBeNull();

    boton('Volver a sin configurar', tarjeta('1')).click();
    fixture.detectChanges();
    boton('Guardar envíos').click();
    const req = http.expectOne(`${API}/11/envios`);
    // Norte apagado conserva lo copiado (para cuando lo vuelva a prender); Centro vuelve a sin configurar.
    expect(req.request.body.sucursales).toEqual([
      { branchId: '1', haceEnvio: true, radioKm: null, pedidoMinimo: null, costo: null, gratisDesde: null, nota: null, sinConfigurar: true },
      { branchId: '2', haceEnvio: false, radioKm: 5, pedidoMinimo: 60000, costo: 1500, gratisDesde: 100000, nota: 'Martes y jueves' },
    ]);
    req.flush(envios());
    http.expectOne((r) => r.url === `${API}/11/envios/resumen`).flush(resumenVacio);
    tick(400);
    http.match(() => true).forEach((r) => r.flush({ branchId: '1', nombre: 'Centro', radioKm: 10, radioDeReferencia: true, localidades: [], totalLocalidades: 0, aclaracion: '' }));
  }));

  it('lo que no es un número se marca sin mandar nada; el 400 del servidor va a su campo', fakeAsync(() => {
    montar(envios());
    tick(400);
    coberturaPendiente('1', null).flush({ branchId: '1', nombre: 'Centro', radioKm: 10, radioDeReferencia: true, localidades: [], totalLocalidades: 0, aclaracion: '' });

    tipear(campo('1', 'Pedido mínimo'), 'sesenta mil');
    boton('Guardar envíos').click();
    fixture.detectChanges();
    expect(texto(tarjeta('1'))).toContain('Escribí solo el número');
    http.expectNone(`${API}/11/envios`);

    tipear(campo('1', 'Pedido mínimo'), '60000');
    tipear(campo('1', 'Gratis desde'), '50000');
    boton('Guardar envíos').click();
    http.expectOne(`${API}/11/envios`).flush(
      {
        error: 'Centro: El envío gratis tiene que arrancar en el pedido mínimo ($60.000) o más arriba.', campo: 'gratisDesde', branchId: '1',
        errores: [{ campo: 'gratisDesde', mensaje: 'El envío gratis tiene que arrancar en el pedido mínimo ($60.000) o más arriba.', branchId: '1' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    const gratis = Array.from(tarjeta('1').querySelectorAll('label')).find((l) => l.textContent!.includes('Gratis desde'))!;
    expect(texto(gratis)).toContain('tiene que arrancar en el pedido mínimo ($60.000)');
    tick(400);
    http.match(() => true).forEach((r) => r.flush({ branchId: '1', nombre: 'Centro', radioKm: 10, radioDeReferencia: true, localidades: [], totalLocalidades: 0, aclaracion: '' }));
  }));

  it('probar una dirección muestra quién lo atiende y cada sucursal', fakeAsync(() => {
    montar(envios({}, centroMag));
    tick(400);
    coberturaPendiente('1', '5').flush({ branchId: '1', nombre: 'Centro', radioKm: 5, radioDeReferencia: false, localidades: [], totalLocalidades: 0, aclaracion: '' });

    const input = el.querySelector<HTMLInputElement>('.envios__buscar input')!;
    input.value = 'Pringles 1000';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    boton('Probar').click();
    const req = http.expectOne((r) => r.url === `${API}/11/envios/probar` && r.params.get('direccion') === 'Pringles 1000');
    req.flush({
      lat: -33.301, lon: -66.335, direccionBuscada: 'Pringles 1000, San Luis',
      atiende: { branchId: '1', nombre: 'Centro', km: 0.4, llega: 'llega', frase: '' },
      texto: 'Lo atiende Centro: 0,4 km, mínimo $60.000, envío $1.500 (gratis desde $100.000).',
      sucursales: [
        { branchId: '1', nombre: 'Centro', km: 0.4, llega: 'llega', frase: '' },
        { branchId: '2', nombre: 'Norte', km: 3.6, llega: 'llega', frase: '' },
      ],
    });
    fixture.detectChanges();
    expect(texto(el.querySelector('.envios__prueba'))).toContain('Lo atiende Centro: 0,4 km, mínimo $60.000');
    expect(texto(el.querySelector('.envios__prueba'))).toContain('Buscamos «Pringles 1000, San Luis».');
    expect(texto(el.querySelector('.envios__prueba ul'))).toContain('Norte: 3,6 km · llega');
  }));

  it('sin el script: no se puede guardar y lo dice', fakeAsync(() => {
    montar(envios({ disponible: false, avisos: ['Los envíos todavía no se pueden configurar: falta actualizar la base (Deploy_BP193_EnvioADomicilio_22oct.sql).'] }));
    tick(400);
    coberturaPendiente('1', null).flush({ branchId: '1', nombre: 'Centro', radioKm: 10, radioDeReferencia: true, localidades: [], totalLocalidades: 0, aclaracion: '' });
    fixture.detectChanges();
    expect(texto(el)).toContain('Los envíos todavía no se pueden configurar');
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent!.includes('Guardar envíos'))).toBeFalse();
    expect(tarjeta('1').querySelector<HTMLInputElement>('input[role="switch"]')!.disabled).toBeTrue();
  }));

  it('los números de 30 días por sucursal', fakeAsync(() => {
    montar(envios({}, centroMag), {
      dias: 30, disponible: true,
      total: { pedidos: 3, envios: 2, retiros: 1, fueraDelRadio: 1, ticketEnvio: 90000, ticketRetiro: 30000, costoDeEnvios: 1500 },
      porSucursal: [{ branchId: '1', nombre: 'Centro', numeros: { pedidos: 3, envios: 2, retiros: 1, fueraDelRadio: 1, ticketEnvio: 90000, ticketRetiro: 30000, costoDeEnvios: 1500 } }],
    });
    tick(400);
    coberturaPendiente('1', '5').flush({ branchId: '1', nombre: 'Centro', radioKm: 5, radioDeReferencia: false, localidades: [], totalLocalidades: 0, aclaracion: '' });
    fixture.detectChanges();
    const filas = Array.from(el.querySelectorAll('.envios__bloque')).at(-1)!;
    expect(texto(filas)).toContain('Últimos 30 días');
    expect(Array.from(filas.querySelectorAll('tbody td')).map(texto)).toEqual(['Centro', '2', '1', '$90.000', '1', '$30.000', '$1.500']);
  }));
});

describe('Envíos: números y textos (BP-193)', () => {
  it('lee montos y radios como se escriben en Argentina', () => {
    expect(numeroEnvio('60.000')).toBe(60000);
    expect(numeroEnvio('$ 1.500')).toBe(1500);
    expect(numeroEnvio('1.250,50')).toBe(1250.5);
    expect(numeroEnvio('2,5', true)).toBe(2.5);
    expect(numeroEnvio('2.5', true)).toBe(2.5);
    expect(numeroEnvio('')).toBeNull();
    expect(numeroEnvio('mucho')).toBeNaN();
  });

  it('la frase es la del servidor', () => {
    expect(fraseDeEnvio({ configurado: true, haceEnvio: true, radioKm: 2.5, pedidoMinimo: null, costo: null, gratisDesde: null, nota: null }))
      .toBe('Envío a domicilio hasta 2,5 km · costo a coordinar');
    expect(fraseDeEnvio({ configurado: true, haceEnvio: true, radioKm: null, pedidoMinimo: null, costo: 0, gratisDesde: null, nota: null }))
      .toBe('Envío a domicilio · envío gratis');
    expect(fraseDeEnvio({ configurado: true, haceEnvio: true, radioKm: null, pedidoMinimo: null, costo: null, gratisDesde: 80000, nota: null }))
      .toBe('Envío a domicilio · costo a coordinar, gratis desde $80.000');
  });

  it('el detalle del envío de un pedido', () => {
    const p = { entrega: 'envio', costoEnvio: 1500, envioKm: 3.2 } as PedidoTienda;
    expect(detalleEnvio(p)).toBe('Envío $1.500 · 3,2 km');
    expect(detalleEnvio({ ...p, costoEnvio: 0, envioKm: null })).toBe('Envío gratis');
    expect(detalleEnvio({ ...p, costoEnvio: null, envioKm: 6.3 })).toBe('Envío a coordinar · 6,3 km');
    expect(detalleEnvio({ ...p, entrega: 'retiro' })).toBeNull();
    expect(detalleEnvio({ entrega: 'envio' } as PedidoTienda)).toBeNull(); // backend anterior
  });
});
