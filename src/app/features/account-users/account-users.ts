import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountUsersService } from '../../core/account-users';
import { AccountInvitationResponse, AccountMemberResponse, memberDisplayName } from '../../core/account-users.models';
import { BusinessAccountService } from '../../core/business-account';

// E-Cuenta (17-ago-2026) -- pedido de Andres: "necesitamos otro menu lateral que
// maneje los usuarios" para PreciosIQ tambien. Idéntico al AccountUsersComponent de
// distribucioniq.panel (E4.7) -- mismo backend generico (AccountUsersEndpoints.cs),
// solo cambia BusinessAccountService en vez de ProductoraAccountService para resolver
// la cuenta (una sola cuenta Comercio por usuario, primera de GET /me).
//
// currentUserRole sale de la propia lista de miembros (el que tiene isCurrentUser=true)
// en vez de pedirlo aparte -- evita un segundo request solo para saber "que puedo hacer
// yo aca". Un Manager ve la lista igual (el backend no restringe GetAccountUsers a
// Owner) pero el formulario de invitar y los botones de quitar/revocar se ocultan.
@Component({
  selector: 'app-account-users',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './account-users.html',
  styleUrl: './account-users.scss',
})
export class AccountUsersComponent implements OnInit {
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly accountUsersService = inject(AccountUsersService);

  protected readonly loadingAccount = signal(true);
  protected readonly businessAccountId = signal<number | null>(null);
  protected readonly razonSocial = signal<string | null>(null);

  protected readonly loadingUsers = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly members = signal<AccountMemberResponse[]>([]);
  protected readonly pendingInvitations = signal<AccountInvitationResponse[]>([]);

  protected readonly memberDisplayName = memberDisplayName;

  protected readonly currentUserRole = computed(
    () => this.members().find((m) => m.isCurrentUser)?.role ?? null,
  );
  protected readonly isOwner = computed(() => this.currentUserRole() === 'Owner');

  // Formulario de invitacion
  protected readonly inviteEmail = signal('');
  protected readonly inviteRole = signal<'Owner' | 'Manager'>('Manager');
  protected readonly inviting = signal(false);
  protected readonly inviteError = signal<string | null>(null);
  protected readonly inviteSuccess = signal<string | null>(null);

  // userId del miembro que se esta por quitar / id de la invitacion que se esta por
  // revocar -- confirmacion inline en vez de un modal aparte (mismo criterio liviano
  // que el resto del panel).
  protected readonly confirmingRemoveUserId = signal<string | null>(null);
  protected readonly confirmingRevokeInvitationId = signal<number | null>(null);

  ngOnInit(): void {
    this.businessAccountService.getMine().subscribe({
      next: (accounts) => {
        this.loadingAccount.set(false);
        if (accounts.length === 0) return;

        const account = accounts[0];
        this.businessAccountId.set(account.businessAccountId);
        this.razonSocial.set(account.razonSocial);
        this.loadUsers(account.businessAccountId);
      },
      error: () => {
        this.loadingAccount.set(false);
        this.errorMessage.set('No se pudo cargar tu cuenta. Probá de nuevo en unos minutos.');
      },
    });
  }

  private loadUsers(businessAccountId: number): void {
    this.loadingUsers.set(true);
    this.errorMessage.set(null);

    this.accountUsersService.list(businessAccountId).subscribe({
      next: (response) => {
        this.loadingUsers.set(false);
        this.members.set(response.members);
        this.pendingInvitations.set(response.pendingInvitations);
      },
      error: (err) => {
        this.loadingUsers.set(false);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo cargar la lista de usuarios. Probá de nuevo.');
      },
    });
  }

  protected sendInvite(): void {
    const businessAccountId = this.businessAccountId();
    if (!businessAccountId) return;

    const email = this.inviteEmail().trim();
    if (!email) {
      this.inviteError.set('Ingresá un email.');
      return;
    }

    this.inviting.set(true);
    this.inviteError.set(null);
    this.inviteSuccess.set(null);

    this.accountUsersService.invite(businessAccountId, { email, role: this.inviteRole() }).subscribe({
      next: (invitation) => {
        this.inviting.set(false);
        this.inviteSuccess.set(`Invitación enviada a ${invitation.email}.`);
        this.inviteEmail.set('');
        this.pendingInvitations.update((list) => [...list, invitation]);
      },
      error: (err) => {
        this.inviting.set(false);
        this.inviteError.set(err?.error?.error ?? 'No se pudo enviar la invitación. Probá de nuevo.');
      },
    });
  }

  protected confirmRemoveMember(userId: string): void {
    this.confirmingRemoveUserId.set(userId);
  }

  protected cancelRemoveMember(): void {
    this.confirmingRemoveUserId.set(null);
  }

  protected removeMember(userId: string): void {
    const businessAccountId = this.businessAccountId();
    if (!businessAccountId) return;

    this.errorMessage.set(null);
    this.accountUsersService.removeMember(businessAccountId, userId).subscribe({
      next: () => {
        this.confirmingRemoveUserId.set(null);
        this.members.update((list) => list.filter((m) => m.userId !== userId));
      },
      error: (err) => {
        this.confirmingRemoveUserId.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo quitar al miembro. Probá de nuevo.');
      },
    });
  }

  protected confirmRevokeInvitation(invitationId: number): void {
    this.confirmingRevokeInvitationId.set(invitationId);
  }

  protected cancelRevokeInvitation(): void {
    this.confirmingRevokeInvitationId.set(null);
  }

  protected revokeInvitation(invitationId: number): void {
    const businessAccountId = this.businessAccountId();
    if (!businessAccountId) return;

    this.errorMessage.set(null);
    this.accountUsersService.revokeInvitation(businessAccountId, invitationId).subscribe({
      next: () => {
        this.confirmingRevokeInvitationId.set(null);
        this.pendingInvitations.update((list) => list.filter((i) => i.id !== invitationId));
      },
      error: (err) => {
        this.confirmingRevokeInvitationId.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo revocar la invitación. Probá de nuevo.');
      },
    });
  }
}
