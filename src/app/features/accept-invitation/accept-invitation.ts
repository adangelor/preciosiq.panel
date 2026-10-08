import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountUsersService } from '../../core/account-users';

// E-Cuenta (17-ago-2026) -- pantalla que resuelve /invitacion/:token en PreciosIQ.
// Idéntica a la de distribucioniq.panel (E4.7) -- mismo backend generico. Hija del
// PanelHeaderComponent (authGuard en el padre): quien llega aca YA esta logueado,
// aunque puede ser con un mail DISTINTO al invitado (por ejemplo, reenviaron el link, o
// ya tenia sesion abierta con otra cuenta) -- el backend valida eso al aceptar (no acá:
// el preview, GET /api/business/invitations/{token}, es AllowAnonymous y no sabe quien
// esta mirando), asi que el mensaje de error de "aceptar" puede pedir loguearse con
// otro mail -- ver guestGuard/authGuard + returnUrl en auth-guard.ts/login.ts para como
// vuelve el usuario aca despues de resolver eso.
@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './accept-invitation.html',
  styleUrl: './accept-invitation.scss',
})
export class AcceptInvitationComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountUsersService = inject(AccountUsersService);

  private token = '';

  protected readonly loading = signal(true);
  protected readonly valid = signal(false);
  protected readonly previewError = signal<string | null>(null);
  protected readonly razonSocial = signal<string | null>(null);
  protected readonly invitedEmail = signal<string | null>(null);
  protected readonly role = signal<string | null>(null);

  protected readonly accepting = signal(false);
  protected readonly acceptError = signal<string | null>(null);
  protected readonly accepted = signal(false);

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.loading.set(false);
      this.previewError.set('Link de invitación inválido.');
      return;
    }

    this.accountUsersService.previewInvitation(this.token).subscribe({
      next: (preview) => {
        this.loading.set(false);
        this.valid.set(preview.valid);
        if (preview.valid) {
          this.razonSocial.set(preview.razonSocial);
          this.invitedEmail.set(preview.email);
          this.role.set(preview.role);
        } else {
          this.previewError.set(preview.error ?? 'Esta invitación no es válida.');
        }
      },
      error: () => {
        this.loading.set(false);
        this.previewError.set('No pudimos cargar esta invitación. Probá de nuevo en unos minutos.');
      },
    });
  }

  protected accept(): void {
    this.accepting.set(true);
    this.acceptError.set(null);

    this.accountUsersService.acceptInvitation(this.token).subscribe({
      next: () => {
        this.accepting.set(false);
        this.accepted.set(true);
        setTimeout(() => this.router.navigateByUrl('/dashboard'), 1500);
      },
      error: (err) => {
        this.accepting.set(false);
        this.acceptError.set(err?.error?.error ?? 'No pudimos aceptar la invitación. Probá de nuevo.');
      },
    });
  }
}
