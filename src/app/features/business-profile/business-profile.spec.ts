import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BusinessContextService } from '../../core/business-context';
import { CondicionIvaResponse } from '../../core/business-account.models';
import { BusinessProfileComponent } from './business-profile';

// BP-207 (26-oct-2026) -- la tarjeta "Condición frente al IVA" de Datos del negocio, con la API de mentira.
const URL = `${environment.apiBaseUrl}business/accounts/10/condicion-iva`;

describe('Datos del negocio: condición frente al IVA (BP-207)', () => {
  function crear() {
    TestBed.configureTestingModule({
      imports: [BusinessProfileComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: BusinessContextService,
          useValue: {
            load: () => of({ account: { businessAccountId: 10, razonSocial: 'Prueba', cuit: '20123456789', logoUrl: null }, branches: [] }),
            invalidate: () => {},
          },
        },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(BusinessProfileComponent);
    f.detectChanges();
    return { f, http };
  }

  const tarjeta = (el: HTMLElement) =>
    [...el.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.includes('Condición frente al IVA'));

  it('sin dato: se puede elegir y avisa que se calcula como inscripto', () => {
    const { f, http } = crear();
    http.expectOne(URL).flush({ condicionIva: null, origen: null, editable: true, elegida: null } satisfies CondicionIvaResponse);
    f.detectChanges();
    const t = tarjeta(f.nativeElement)!;
    expect(t).toBeTruthy();
    expect(t.querySelector('mat-select')).not.toBeNull();
    expect(t.textContent).toContain('se calculan como responsable inscripto');
  });

  it('elegir monotributista hace PUT y muestra «Guardado»', () => {
    const { f, http } = crear();
    http.expectOne(URL).flush({ condicionIva: null, origen: null, editable: true, elegida: null });
    f.detectChanges();
    (f.componentInstance as any).condicionElegida.set('mono');
    f.detectChanges();
    const boton = [...tarjeta(f.nativeElement)!.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar'))!;
    boton.click();
    const req = http.expectOne((r) => r.url === URL && r.method === 'PUT');
    expect(req.request.body).toEqual({ condicionIva: 'mono' });
    req.flush({ condicionIva: 'mono', origen: 'cuenta', editable: true, elegida: 'mono' });
    f.detectChanges();
    expect(tarjeta(f.nativeElement)!.textContent).toContain('Guardado');
  });

  it('con la facturación activada: se muestra y no se edita', () => {
    const { f, http } = crear();
    http.expectOne(URL).flush({ condicionIva: 'ri', origen: 'facturacion', editable: false, elegida: null });
    f.detectChanges();
    const t = tarjeta(f.nativeElement)!;
    expect(t.textContent).toContain('Responsable inscripto');
    expect(t.textContent).toContain('ARCA');
    expect(t.querySelector('mat-select')).toBeNull();
  });

  it('si el backend no la ofrece (falta el script o es viejo), la tarjeta no aparece', () => {
    const { f, http } = crear();
    http.expectOne(URL).flush({ error: 'x' }, { status: 404, statusText: 'Not Found' });
    f.detectChanges();
    expect(tarjeta(f.nativeElement)).toBeUndefined();
  });
});
