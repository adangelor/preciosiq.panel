import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';
import { ProfileService } from '../../core/profile';

type Modo = 'actual' | 'codigo';

/** La nueva y la repetida tienen que coincidir. */
function coinciden(group: AbstractControl): ValidationErrors | null {
  const nueva = group.get('newPassword')?.value;
  const repetida = group.get('repeatPassword')?.value;
  return nueva && repetida && nueva !== repetida ? { noCoinciden: true } : null;
}

// "Cambiar contraseña" del menu de cuenta.
//
// BP-282 (3-nov-2026) -- antes era SOLO con un codigo por mail (no habia endpoint de "cambiar sabiendo la actual"), y
// si el mail no llegaba el usuario no podia cambiarla. Ahora el camino normal es la contraseña actual + la nueva
// (POST /api/identity/change-password). El codigo por mail queda para dos casos: la cuenta no tiene contraseña (nacio
// por codigo o Google) o el usuario no se acuerda de la actual.
//
// Tambien es la pantalla a la que manda cambioObligadoGuard cuando el admin blanqueo la contraseña (BP-281): ahi la
// "actual" es la temporal que le pasaron, y al terminar vuelve a donde iba.
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  protected readonly email = signal<string | null>(null);
  protected readonly modo = signal<Modo>('actual');
  protected readonly obligado = signal(this.authService.debeCambiarContrasena());
  /** false = la cuenta no tiene contraseña: solo puede crear una con el codigo. */
  protected readonly tieneContrasena = signal(true);

  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly listo = signal(false);

  protected readonly sendingCode = signal(false);
  protected readonly codeSent = signal(false);
  protected readonly sendError = signal<string | null>(null);

  protected readonly formActual = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      repeatPassword: ['', Validators.required],
    },
    { validators: coinciden },
  );

  protected readonly formCodigo = this.fb.nonNullable.group(
    {
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      repeatPassword: ['', Validators.required],
    },
    { validators: coinciden },
  );

  ngOnInit(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        this.email.set(profile.email);
        if (profile.tieneContrasena === false) {
          this.tieneContrasena.set(false);
          this.modo.set('codigo');
        }
        this.obligado.set(this.authService.debeCambiarContrasena());
      },
      error: () => {},
    });
  }

  protected usarCodigo(): void {
    this.modo.set('codigo');
    this.error.set(null);
  }

  protected usarActual(): void {
    this.modo.set('actual');
    this.error.set(null);
  }

  protected cambiarConActual(): void {
    if (this.formActual.invalid || this.guardando()) return;
    const { currentPassword, newPassword } = this.formActual.getRawValue();
    this.guardando.set(true);
    this.error.set(null);
    this.authService.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => this.terminar(),
      error: (err) => {
        this.guardando.set(false);
        if (err?.error?.sinContrasena) {
          this.tieneContrasena.set(false);
          this.modo.set('codigo');
        }
        this.error.set(err?.error?.error ?? 'No se pudo cambiar la contraseña. Probá de nuevo.');
      },
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

  protected cambiarConCodigo(): void {
    const email = this.email();
    if (!email || this.formCodigo.invalid || this.guardando()) return;
    const { code, newPassword } = this.formCodigo.getRawValue();
    this.guardando.set(true);
    this.error.set(null);
    this.authService.resetPassword({ email, code, newPassword }).subscribe({
      next: () => this.terminar(),
      error: (err) => {
        this.guardando.set(false);
        this.error.set(err?.error?.error ?? 'No se pudo cambiar la contraseña. Probá de nuevo.');
      },
    });
  }

  /** Al terminar un cambio obligado, sigue a donde iba; si no, se queda con el aviso de listo. */
  protected seguir(): void {
    const volver = this.route.snapshot.queryParamMap.get('volver');
    this.router.navigateByUrl(volver && volver.startsWith('/') && !volver.startsWith('//') ? volver : '/dashboard');
  }

  private terminar(): void {
    this.guardando.set(false);
    this.listo.set(true);
    this.formActual.reset();
    this.formCodigo.reset();
  }
}
