import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../core/auth';
import { BusinessAccountService } from '../../core/business-account';
import { environment } from '../../../environments/environment';
import { BackLinkComponent } from '../../layout/back-link/back-link';

// Google Identity Services se carga por script en index.html; no hay @types oficiales
// livianos para esto, así que se tipa suelto aca nomas.
declare const google: any;

// Login del panel, 15-ago-2026: contraseña como default (E-Auth -- decision de Andres,
// "los dos en paralelo"), con OTP por mail y Google como alternativas. Los tres
// terminan en el mismo lugar: accessToken/refreshToken guardados (AuthService.storeSession).
// Una cuenta que hasta ahora solo entro por OTP o Google (nunca seteo contraseña) no
// rompe nada aca: PasswordLogin en el backend le da el mismo mensaje generico que una
// contraseña incorrecta, y "¿Olvidaste tu contraseña?" es tambien el camino para ponerse
// la PRIMERA (ResetPassword no distingue los dos casos).
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, BackLinkComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent implements AfterViewInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly router = inject(Router);

  // E-Incident (19-ago-2026) -- los tres metodos de login (password/OTP/Google) mandaban
  // SIEMPRE a /alta, sin importar si la persona ya tenia un comercio dado de alta (con
  // plan bonificado y sucursales cargadas incluso). Reportado por Andres: le subio el
  // plan a una cadena por SQL y al loguearse la mandaba a /alta como si no tuviera nada.
  // El backend (GetMyBusinessAccounts) no filtra por plan/tier para nada -- el bug era
  // 100% de este archivo, que nunca preguntaba. Ahora se consulta getMine() despues de
  // cada login exitoso: si ya tiene alguna cuenta, va a /dashboard; recien si no tiene
  // ninguna, a /alta. Si la consulta de getMine() falla (ej. token todavia no
  // propagado), se prioriza no trabar al usuario: cae a /alta como antes.
  private redirectAfterLogin(): void {
    this.businessAccountService
      .getMine()
      .pipe(catchError(() => of([])))
      .subscribe((accounts) => {
        this.router.navigateByUrl(accounts.length > 0 ? '/dashboard' : '/alta');
      });
  }

  private readonly googleButtonContainer = viewChild<ElementRef<HTMLDivElement>>('googleButton');

  protected readonly step = signal<'password' | 'email' | 'otp'>('password');
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly googleAvailable = signal(!!environment.googleWebClientId);

  ngAfterViewInit(): void {
    this.renderGoogleButton();
  }

  private renderGoogleButton(): void {
    const container = this.googleButtonContainer()?.nativeElement;
    if (!container || !environment.googleWebClientId) {
      return;
    }

    // El script de Google carga async -- si todavia no esta listo, reintentamos en vez
    // de asumir que ngAfterViewInit ya lo tiene disponible.
    if (typeof google === 'undefined' || !google?.accounts?.id) {
      setTimeout(() => this.renderGoogleButton(), 200);
      return;
    }

    google.accounts.id.initialize({
      client_id: environment.googleWebClientId,
      callback: (response: { credential: string }) => this.handleGoogleCredential(response.credential),
    });
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'continue_with',
      locale: 'es',
    });
  }

  private handleGoogleCredential(idToken: string): void {
    this.submitting.set(true);
    this.errorMessage.set(null);

    this.authService.googleLogin({ idToken }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.redirectAfterLogin();
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos validar tu cuenta de Google. Probá de nuevo.');
      },
    });
  }

  protected readonly passwordForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected readonly emailForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    firstName: [''],
    lastName: [''],
  });

  protected readonly otpForm = this.fb.nonNullable.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  protected loginWithPassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { email, password } = this.passwordForm.getRawValue();
    this.authService.passwordLogin({ email, password }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.redirectAfterLogin();
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos iniciar sesión. Probá de nuevo.');
      },
    });
  }

  protected requestOtp(): void {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { email, firstName, lastName } = this.emailForm.getRawValue();
    this.authService
      .startOtp({ email, firstName: firstName || undefined, lastName: lastName || undefined })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.step.set('otp');
        },
        error: (err) => {
          this.submitting.set(false);
          this.errorMessage.set(
            err?.error?.error ?? 'No pudimos enviar el código. Probá de nuevo en unos minutos.'
          );
        },
      });
  }

  protected verifyOtp(): void {
    if (this.otpForm.invalid) {
      this.otpForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const email = this.emailForm.getRawValue().email;
    const otp = this.otpForm.getRawValue().otp;

    this.authService.verifyOtp({ email, otp }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.redirectAfterLogin();
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? 'Código incorrecto o vencido. Probá de nuevo.');
      },
    });
  }

  protected backToEmail(): void {
    this.step.set('email');
    this.errorMessage.set(null);
    this.otpForm.reset();
  }

  protected useOtpInstead(): void {
    // Si ya habia un email cargado en el form de contraseña, se lo pasamos al de OTP
    // para no hacerselo escribir dos veces.
    const email = this.passwordForm.getRawValue().email;
    if (email) this.emailForm.patchValue({ email });

    this.step.set('email');
    this.errorMessage.set(null);
  }

  protected usePasswordInstead(): void {
    const email = this.emailForm.getRawValue().email;
    if (email) this.passwordForm.patchValue({ email });

    this.step.set('password');
    this.errorMessage.set(null);
  }
}
