import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { ProfileService } from '../../core/profile';

// E-Cuenta (17-ago-2026) -- "Cambiar contraseña" del menu de cuenta. No existe (todavia)
// un endpoint de "cambiar sabiendo la contraseña actual" -- se reusa el mismo circuito
// de ForgotPassword/ResetPassword que ya usa la pantalla publica de "olvidé mi
// contraseña" (codigo de 6 digitos por mail + contraseña nueva). Ese circuito ya prueba
// que el mail es tuyo sin necesitar la contraseña vieja, asi que sirve igual estando
// logueado -- el email se precarga solo desde el perfil, no hay que tipearlo.
@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './change-password.html',
  styleUrl: './change-password.scss',
})
export class ChangePasswordComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly profileService = inject(ProfileService);
  private readonly fb = inject(FormBuilder);

  protected readonly email = signal<string | null>(null);

  protected readonly sendingCode = signal(false);
  protected readonly codeSent = signal(false);
  protected readonly sendError = signal<string | null>(null);

  protected readonly resetting = signal(false);
  protected readonly resetError = signal<string | null>(null);
  protected readonly resetSuccess = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
  });

  ngOnInit(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => this.email.set(profile.email),
      error: () => {},
    });
  }

  protected sendCode(): void {
    const email = this.email();
    if (!email) return;

    this.sendingCode.set(true);
    this.sendError.set(null);

    this.authService.forgotPassword({ email }).subscribe({
      next: () => {
        this.sendingCode.set(false);
        this.codeSent.set(true);
      },
      error: (err) => {
        this.sendingCode.set(false);
        this.sendError.set(err?.error?.error ?? 'No se pudo enviar el código. Probá de nuevo.');
      },
    });
  }

  protected submit(): void {
    const email = this.email();
    if (!email || this.form.invalid) return;

    this.resetting.set(true);
    this.resetError.set(null);

    const { code, newPassword } = this.form.getRawValue();
    this.authService.resetPassword({ email, code, newPassword }).subscribe({
      next: () => {
        this.resetting.set(false);
        this.resetSuccess.set(true);
        this.form.reset();
      },
      error: (err) => {
        this.resetting.set(false);
        this.resetError.set(err?.error?.error ?? 'No se pudo cambiar la contraseña. Probá de nuevo.');
      },
    });
  }
}
