import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../core/lead';
import { AgendaOmnivoxComponent } from './agenda-omnivox';

// Landing publica de PreciosIQ -- misma pieza visual que antes vivia como vista Razor
// en Buscaprecios.web (Views/PreciosIq/Index.cshtml). Ahora es la ruta raiz del propio
// SPA: se sirve entera desde Hostinger, sin depender del backend .NET para pintarse (el
// CSS/imagenes del tema se copiaron a public/home -- ver ese folder). El backend .NET
// sigue siendo la API (leads, login, negocio), pero ya no sirve esta pagina.
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, AgendaOmnivoxComponent],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class LandingComponent {
  private readonly fb = inject(FormBuilder);
  private readonly leadService = inject(LeadService);

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // 11-oct-2026 -- el modal de demo muestra el calendario de Omnivox (ver agenda-omnivox.ts).
  // agendaPedida: alguien toco un boton de demo; recien ahi se crea el calendario (y pega al API).
  // agendaCaida: el bundle de Omnivox no cargo; el modal vuelve al formulario de contacto de abajo.
  protected readonly agendaPedida = signal(false);
  protected readonly agendaCaida = signal(false);

  protected readonly demoForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    businessName: [''],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    message: [''],
  });

  protected submitDemo(): void {
    if (this.demoForm.invalid) {
      this.demoForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { name, businessName, email, phone, message } = this.demoForm.getRawValue();
    this.leadService
      .create({
        name,
        businessName: businessName || null,
        email,
        phone: phone || null,
        message: message || null,
        source: 'PreciosIQ',
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.submitted.set(true);
          this.demoForm.reset();
        },
        error: (err) => {
          this.submitting.set(false);
          this.errorMessage.set(
            err?.error?.error ?? 'Hubo un error al enviar el mensaje. Probá de nuevo en unos minutos.'
          );
        },
      });
  }
}
