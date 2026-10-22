import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { LibroIvaComponent, mesAnterior } from './libro-iva';
import { GestionContexto, GestionContextoService } from '../../core/gestion-contexto';
import { LibroIva, alicuotasDelLibro, filasDelLibro } from '../../core/compras';
import { environment } from '../../../environments/environment';

// BP-180 (22-oct-2026) -- compras, bloque 7: el Libro IVA compras. API de mentira.
const COMPRAS = `${environment.apiBaseUrl}business/compras`;

function contexto(): Partial<GestionContextoService> {
  const g: GestionContexto = {
    businessAccountId: 10, branches: [], gestionArticulos: true, gestionStock: true, formacionPrecios: true, compras: true, tier: 'avanzado',
  };
  return { load: () => of(g) };
}

const base = {
  supplierId: 5, proveedor: 'Distri Norte', cuit: '30712345674', condicionIva: 'ri' as const, noGravado: 0, exento: 0, percepcionIva: 0,
  percepcionIibb: 0, percepcionMunicipal: 0, percepcionOtras: 0, impuestosInternos: 0, otrosTributos: 0, sinDiscriminar: 0,
};
const libro = (cambios: Partial<LibroIva> = {}): LibroIva => ({
  mes: '2026-09', comercio: 'Súper Prueba', cuit: null, comprobantes: 2,
  renglones: [
    { ...base, comprobanteId: 1, fecha: '2026-09-05', tipo: 'factura', letra: 'A', puntoVenta: 7, numero: 101, numeroTexto: 'A 00007-00000101',
      codigoArca: 1, signo: 1, alicuotas: [{ alicuota: 21, neto: 10000, iva: 2100 }, { alicuota: 10.5, neto: 2000, iva: 210 }],
      percepcionIibb: 200, total: 14510, creditoFiscal: 2310 },
    { ...base, comprobanteId: 2, fecha: '2026-09-20', tipo: 'nota_credito', letra: 'A', puntoVenta: 7, numero: 103, numeroTexto: 'A 00007-00000103',
      codigoArca: 3, signo: -1, alicuotas: [{ alicuota: 21, neto: 1000, iva: 210 }], total: 1210, creditoFiscal: 210 },
  ],
  totales: {
    alicuotas: [{ alicuota: 21, neto: 9000, iva: 1890 }, { alicuota: 10.5, neto: 2000, iva: 210 }], netoGravado: 11000, iva: 2100, sinDiscriminar: 0,
    noGravado: 0, exento: 0, percepcionIva: 0, percepcionIibb: 200, percepcionMunicipal: 0, percepcionOtras: 0, impuestosInternos: 0,
    otrosTributos: 0, total: 13300, creditoFiscal: 2100,
  },
  iibbPorProvincia: [{ jurisdiccion: 'AR-D', importe: 200 }],
  problemasParaArca: [],
  ...cambios,
});

const texto = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const boton = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(t));

describe('El Libro IVA compras: la planilla (BP-180)', () => {
  it('columnas por alícuota, la nota de crédito en negativo, totales e IIBB por provincia', () => {
    const l = libro();
    expect(alicuotasDelLibro(l)).toEqual([21, 10.5]);
    const filas = filasDelLibro(l);
    expect(filas[0].slice(0, 10)).toEqual(['Fecha', 'Comprobante', 'Número', 'Proveedor', 'CUIT', 'Condición', 'Neto 21 %', 'IVA 21 %', 'Neto 10,5 %', 'IVA 10,5 %']);
    expect(filas[1].slice(0, 10)).toEqual(['05/09/2026', 'Factura A', '00007-00000101', 'Distri Norte', '30-71234567-4', 'Responsable inscripto', 10000, 2100, 2000, 210]);
    expect(filas[2].slice(1, 10)).toEqual(['Nota de crédito A', '00007-00000103', 'Distri Norte', '30-71234567-4', 'Responsable inscripto', -1000, -210, 0, 0]);
    expect(filas[3][1]).toBe('Totales');
    expect(filas[3].slice(6, 10)).toEqual([9000, 1890, 2000, 210]);
    expect(filas[filas.length - 1]).toEqual(['San Luis', 200]);
    expect(mesAnterior(new Date(2026, 0, 15))).toBe('2025-12');
  });
});

describe('El Libro IVA compras: la pantalla (BP-180)', () => {
  let http: HttpTestingController;
  afterEach(() => http.verify());

  async function abrir() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        provideRouter([{ path: 'gestion/compras/libro-iva', component: LibroIvaComponent }]),
        { provide: GestionContextoService, useValue: contexto() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/gestion/compras/libro-iva');
    return { h, el: h.routeNativeElement as HTMLElement };
  }

  it('arranca en el mes anterior y muestra el libro con la NC restando', async () => {
    const { h, el } = await abrir();
    http.expectOne(`${COMPRAS}/libro-iva?businessAccountId=10&mes=${mesAnterior()}`).flush(libro());
    h.detectChanges();
    const resumen = Array.from(el.querySelectorAll('.libro__resumen div')).map((d) => texto(d));
    expect(resumen).toContain('Crédito fiscal (IVA)$ 2.100,00');
    expect(el.querySelector('tr[data-comprobante="2"]')!.classList).toContain('libro__nc');
    expect(texto(el.querySelector('tr[data-comprobante="2"]'))).toContain('−$ 1.000,00');
    expect(texto(el.querySelector('.libro__tabla tfoot'))).toContain('$ 13.300,00');
    expect(texto(el.querySelector('.libro__iibb'))).toContain('San Luis: $ 200,00');

    escribirMes(el, '2026-08');
    http.expectOne(`${COMPRAS}/libro-iva?businessAccountId=10&mes=2026-08`).flush(libro({ mes: '2026-08', comprobantes: 0, renglones: [] }));
    h.detectChanges();
    expect(texto(el)).toContain('En ARCA se presenta "sin movimientos"');
    expect(boton(el, 'Archivos para ARCA')).toBeUndefined();
  });

  it('con un proveedor sin CUIT: lo avisa y los archivos no se ofrecen', async () => {
    const { h, el } = await abrir();
    http.expectOne(`${COMPRAS}/libro-iva?businessAccountId=10&mes=${mesAnterior()}`)
      .flush(libro({ problemasParaArca: ['Don Pepe no tiene CUIT (o no es válido): cargalo en su ficha (1 comprobante).'] }));
    h.detectChanges();
    expect(texto(el.querySelector('.libro__problemas'))).toContain('Don Pepe no tiene CUIT');
    expect(boton(el, 'Archivos para ARCA')!.disabled).toBeTrue();
    expect(boton(el, 'Excel')!.disabled).toBeFalse();
  });

  it('los archivos: baja el zip; si el servidor no los arma, muestra el motivo', async () => {
    const { h, el } = await abrir();
    http.expectOne(`${COMPRAS}/libro-iva?businessAccountId=10&mes=${mesAnterior()}`).flush(libro());
    h.detectChanges();
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    boton(el, 'Archivos para ARCA')!.click();
    http.expectOne(`${COMPRAS}/libro-iva/archivos?businessAccountId=10&mes=2026-09`).flush(new Blob(['PK']));
    expect(click).toHaveBeenCalled();

    boton(el, 'Archivos para ARCA')!.click();
    http.expectOne(`${COMPRAS}/libro-iva/archivos?businessAccountId=10&mes=2026-09`)
      .flush(new Blob([JSON.stringify({ error: 'No se pueden armar los archivos: falta un CUIT.' })]), { status: 400, statusText: 'Bad Request' });
    // El motivo se lee del Blob (asíncrono): se espera a que aparezca.
    for (let i = 0; i < 40 && !el.querySelector('[role=alert]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      h.detectChanges();
    }
    expect(texto(el.querySelector('[role=alert]'))).toBe('No se pueden armar los archivos: falta un CUIT.');
  });
});

function escribirMes(el: HTMLElement, mes: string): void {
  const i = el.querySelector<HTMLInputElement>('input[type=month]')!;
  i.value = mes;
  i.dispatchEvent(new Event('change'));
}
