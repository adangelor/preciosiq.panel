import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessSubscriptionService } from '../../core/business-subscription';
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
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink, AgendaOmnivoxComponent],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class LandingComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly leadService = inject(LeadService);
  private readonly subscriptionService = inject(BusinessSubscriptionService);

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // 11-oct-2026 -- el modal de demo muestra el calendario de Omnivox (ver agenda-omnivox.ts).
  // agendaPedida: alguien toco un boton de demo; recien ahi se crea el calendario (y pega al API).
  // agendaCaida: el bundle de Omnivox no cargo; el modal vuelve al formulario de contacto de abajo.
  protected readonly agendaPedida = signal(false);
  protected readonly agendaCaida = signal(false);

  // BP-101 (11-oct-2026) -- los precios de las tarjetas salen de la API (Billing:Plans), el mismo
  // lugar del que cobra el checkout. tier -> montos ya formateados ("$20.000").
  protected readonly precios = signal<Record<string, { mes: string; anio: string }>>({});
  protected readonly preciosCaidos = signal(false);

  ngOnInit(): void {
    const pesos = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
    this.subscriptionService.getPlans().subscribe({
      next: (planes) => {
        const precios: Record<string, { mes: string; anio: string }> = {};
        for (const p of planes) {
          if (p.priceArs !== null && p.priceArsAnnual !== null) {
            precios[p.tier] = { mes: pesos(p.priceArs), anio: pesos(p.priceArsAnnual) };
          }
        }
        this.precios.set(precios);
        // Un plan sin monto configurado en el servidor cae en "Consultanos el precio".
        this.preciosCaidos.set(true);
      },
      error: () => this.preciosCaidos.set(true),
    });
  }

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
