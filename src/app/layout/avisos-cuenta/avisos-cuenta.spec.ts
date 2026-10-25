import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AvisosCuentaComponent } from './avisos-cuenta';
import { AvisosCuentaService } from '../../core/avisos-cuenta';
import { BusinessSubscriptionService } from '../../core/business-subscription';
import { ProfileService } from '../../core/profile';

const CLAVE = 'avisos.mailSinConfirmar.ocultoHasta';

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('AvisosCuentaComponent: cerrar el aviso de mail hasta mañana', () => {
  const avisosFalso = {
    estado: signal(null),
    emailSinConfirmar: signal<string | null>('info@lpsa.com'),
    businessAccountId: signal<number | null>(1),
    cargar: () => {},
  };

  function crear() {
    const f = TestBed.createComponent(AvisosCuentaComponent);
    f.detectChanges();
    return f;
  }

  const aviso = (el: HTMLElement) => el.querySelector('.aviso--atencion');

  beforeEach(() => {
    localStorage.removeItem(CLAVE);
    avisosFalso.emailSinConfirmar.set('info@lpsa.com');
    TestBed.configureTestingModule({
      imports: [AvisosCuentaComponent],
      providers: [
        provideRouter([]),
        { provide: AvisosCuentaService, useValue: avisosFalso },
        { provide: BusinessSubscriptionService, useValue: {} },
        { provide: ProfileService, useValue: { enviarConfirmacionEmail: () => of({ yaConfirmado: false }) } },
      ],
    });
  });

  afterEach(() => localStorage.removeItem(CLAVE));

  it('muestra el aviso con la cruz', () => {
    const el: HTMLElement = crear().nativeElement;
    expect(aviso(el)).not.toBeNull();
    expect(el.querySelector('.aviso__cerrar')).not.toBeNull();
  });

  it('la cruz lo esconde y guarda el día de hoy', () => {
    const f = crear();
    (f.nativeElement.querySelector('.aviso__cerrar') as HTMLButtonElement).click();
    f.detectChanges();
    expect(aviso(f.nativeElement)).toBeNull();
    expect(JSON.parse(localStorage.getItem(CLAVE)!)).toEqual({ email: 'info@lpsa.com', dia: hoy() });
  });

  it('sigue escondido al volver a entrar el mismo día', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ email: 'info@lpsa.com', dia: hoy() }));
    expect(aviso(crear().nativeElement)).toBeNull();
  });

  it('vuelve al día siguiente', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ email: 'info@lpsa.com', dia: '2000-01-01' }));
    expect(aviso(crear().nativeElement)).not.toBeNull();
  });

  it('con otro mail se muestra igual', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ email: 'otro@ejemplo.com', dia: hoy() }));
    expect(aviso(crear().nativeElement)).not.toBeNull();
  });

  it('con el mail ya confirmado no hay aviso', () => {
    avisosFalso.emailSinConfirmar.set(null);
    expect(aviso(crear().nativeElement)).toBeNull();
  });
});
