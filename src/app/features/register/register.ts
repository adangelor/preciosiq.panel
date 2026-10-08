import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { BackLinkComponent } from '../../layout/back-link/back-link';

// Login estandar (E-Auth, 15-ago-2026) -- alta con email + contraseña, alternativa al
// alta inline que ya hacia StartOtp (OTP crea el ApplicationUser si el mail no existia).
// Termina en el mismo lugar que login/OTP/Google: sesion iniciada -> /alta (ahi se crea
// el BusinessAccount sobre este usuario, un paso aparte, igual que con OTP/Google).
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, BackLinkComponent],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    firstName: [''],
    lastName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { email, password, firstName, lastName } = this.form.getRawValue();
    this.authService
      .register({ email, password, firstName: firstName || undefined, lastName: lastName || undefined })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.router.navigateByUrl('/alta');
        },
        error: (err) => {
          this.submitting.set(false);
          this.errorMessage.set(err?.error?.error ?? 'No pudimos crear tu cuenta. Probá de nuevo.');
        },
      });
  }
}
