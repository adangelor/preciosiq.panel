import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/auth';
import { ProfileService } from '../../core/profile';
import { profileInitials, resolveProfilePictureUrl, UserProfileResponse } from '../../core/profile.models';

// E-Cuenta (17-ago-2026) -- pedido de Andres: avatar + menu de cuenta en la barra
// superior (Perfil / Cambiar contraseña / Salir). Antes solo habia un boton de "Cerrar
// sesión" suelto al fondo del sidenav -- ese boton se deja (no rompe nada quitarlo del
// medio), esto se agrega en el toolbar. Mismo componente exacto en distribucioniq.panel
// (duplicado a proposito, mismo criterio que auth.ts/account-users: cada panel es un
// proyecto Angular independiente, no hay lib compartida todavia).
//
// Best-effort igual que panel-header con el logo del comercio: si falla el fetch de
// perfil el avatar cae a un circulo con "?" en vez de romper la barra.
@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatDividerModule, MatIconModule, MatMenuModule],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.scss',
})
export class AccountMenuComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);

  protected readonly profile = signal<UserProfileResponse | null>(null);
  protected resolveProfilePictureUrl = resolveProfilePictureUrl;

  ngOnInit(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => this.profile.set(profile),
      error: () => {},
    });
  }

  protected initials(): string {
    const profile = this.profile();
    return profile ? profileInitials(profile) : '?';
  }

  protected logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
