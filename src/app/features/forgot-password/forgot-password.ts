import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { BackLinkComponent } from '../../layout/back-link/back-link';

type Step = 'email' | 'reset' | 'done';

// Login estandar (E-Auth, 15-ago-2026) -- "olvidé mi contraseña" Y "poné tu primera
// contraseña" son el MISMO flujo (ResetPassword no distingue los dos casos): una cuenta
// que hasta ahora solo entro por OTP o Google puede usar esta pantalla para setear su
// primera contraseña, sin necesidad de una pantalla aparte. Mismo patron de 2 pasos que
// el login por OTP: paso 1 pide el mail y manda un codigo de 6 digitos, paso 2 pide el
// codigo + la contraseña nueva.
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, BackLinkComponent],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly step = signal<Step>('email');
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly emailForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly resetForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected requestCode(): void {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.authService.forgotPassword({ email: this.emailForm.getRawValue().email }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.step.set('reset');
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No pudimos procesar el pedido. Probá de nuevo en unos minutos.');
      },
    });
  }

  protected resetPassword(): void {
    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const email = this.emailForm.getRawValue().email;
    const { code, newPassword } = this.resetForm.getRawValue();

    this.authService.resetPassword({ email, code, newPassword }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.step.set('done');
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? 'Código incorrecto o vencido. Probá de nuevo.');
      },
    });
  }

  protected goToLogin(): void {
    this.router.navigateByUrl('/login');
  }

  protected backToEmail(): void {
    this.step.set('email');
    this.errorMessage.set(null);
    this.resetForm.reset();
  }
}
