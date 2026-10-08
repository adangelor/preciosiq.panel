import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { ProfileService } from '../../core/profile';
import { profileInitials, resolveProfilePictureUrl, UserProfileResponse } from '../../core/profile.models';

// E-Cuenta (17-ago-2026) -- "Perfil" del menu de cuenta: nombre/apellido + foto.
// Cambiar contraseña vive en features/change-password aparte -- son dos formularios
// con reglas de validacion y flujo muy distintos (este es un PUT directo; el otro
// necesita el circuito de codigo por mail), mezclarlos en una sola pantalla los haria
// mas confusos a los dos.
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfileComponent implements OnInit {
  private readonly profileService = inject(ProfileService);
  private readonly fb = inject(FormBuilder);

  protected readonly loading = signal(true);
  protected readonly profile = signal<UserProfileResponse | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveSuccess = signal(false);

  protected readonly uploadingPicture = signal(false);
  protected readonly pictureError = signal<string | null>(null);

  protected resolveProfilePictureUrl = resolveProfilePictureUrl;
  protected profileInitials = profileInitials;

  protected readonly form = this.fb.nonNullable.group({
    firstName: ['', Validators.maxLength(100)],
    lastName: ['', Validators.maxLength(100)],
  });

  ngOnInit(): void {
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        this.loading.set(false);
        this.profile.set(profile);
        this.form.patchValue({ firstName: profile.firstName ?? '', lastName: profile.lastName ?? '' });
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo cargar tu perfil. Probá de nuevo en unos minutos.');
      },
    });
  }

  protected save(): void {
    this.saving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);

    this.profileService.updateProfile(this.form.getRawValue()).subscribe({
      next: (profile) => {
        this.saving.set(false);
        this.saveSuccess.set(true);
        this.profile.set(profile);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.error ?? 'No se pudo guardar. Probá de nuevo.');
      },
    });
  }

  protected onPictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadingPicture.set(true);
    this.pictureError.set(null);

    this.profileService.uploadPicture(file).subscribe({
      next: (response) => {
        this.uploadingPicture.set(false);
        this.profile.update((p) => (p ? { ...p, profilePictureUrl: response.profilePictureUrl } : p));
        input.value = '';
      },
      error: (err) => {
        this.uploadingPicture.set(false);
        this.pictureError.set(err?.error ?? 'No se pudo subir la foto. Probá con otra imagen.');
        input.value = '';
      },
    });
  }
}
