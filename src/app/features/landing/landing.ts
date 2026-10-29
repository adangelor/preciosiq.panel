import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessSubscriptionService } from '../../core/business-subscription';
import { LeadService } from '../../core/lead';
import { AgendaOmnivoxComponent } from './agenda-omnivox';

// La letra Inter del diseño nuevo, solo para la landing. Va por <link> y no por @import en el .scss
// porque el build incrusta los @import de Google Fonts en el CSS del componente y pasa el presupuesto.
// Se agrega una sola vez aunque la landing se cree varias veces.
const INTER_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
function cargarInter(): void {
  if (typeof document === 'undefined' || document.querySelector(`link[href="${INTER_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = INTER_URL;
  document.head.appendChild(link);
}

// Landing publica de PreciosIQ -- antes vivia como vista Razor en Buscaprecios.web
// (Views/PreciosIq/Index.cshtml). Ahora es la ruta raiz del propio SPA: se sirve entera desde
// Hostinger, sin depender del backend .NET para pintarse. El backend .NET sigue siendo la API
// (leads, login, negocio), pero ya no sirve esta pagina.
// 29-oct-2026 -- diseño nuevo (el modelo DistribucionIQ_landing.html de Andres, adaptado): los estilos
// son todos de landing.scss y landing-captura.scss; del tema New Age global quedan solo Bootstrap JS
// (los modales de privacidad, terminos y la captura en grande) y Bootstrap Icons.
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink, AgendaOmnivoxComponent],
  templateUrl: './landing.html',
  styleUrls: ['./landing.scss', './landing-captura.scss'],
})
export class LandingComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly leadService = inject(LeadService);
  private readonly subscriptionService = inject(BusinessSubscriptionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // 11-oct-2026 -- la demo se agenda en el calendario de Omnivox (ver agenda-omnivox.ts).
  // agendaPedida: alguien toco un boton de demo; recien ahi se crea el calendario (y pega al API).
  // agendaCaida: el bundle de Omnivox no cargo; la seccion #demo vuelve al formulario de contacto.
  protected readonly agendaPedida = signal(false);
  protected readonly agendaCaida = signal(false);

  // BP-101 (11-oct-2026) -- los precios de las tarjetas salen de la API (Billing:Plans), el mismo
  // lugar del que cobra el checkout. tier -> montos ya formateados ("$20.000").
  protected readonly precios = signal<Record<string, { mes: string; anio: string }>>({});
  protected readonly preciosCaidos = signal(false);

  // La barra de arriba gana un borde apenas se scrollea. En este panel el que scrollea es <app-root>, no
  // la ventana (window.scrollY queda en 0), asi que se escucha el scroll de cualquier contenedor, en
  // captura (el evento scroll no burbujea).
  protected readonly scrolled = signal(false);

  constructor() {
    cargarInter();
    const alScrollear = (e: Event) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement;
      this.scrolled.set((el?.scrollTop ?? 0) > 10);
    };
    document.addEventListener('scroll', alScrollear, { capture: true, passive: true });
    this.destroyRef.onDestroy(() => document.removeEventListener('scroll', alScrollear, { capture: true }));
    // Aparicion suave de cada bloque (.lp-rv) al entrar en pantalla. Sin IntersectionObserver (o con
    // "reducir movimiento", que lo resuelve el CSS) todo se muestra de entrada: nunca queda texto oculto.
    afterNextRender(() => {
      const bloques = this.host.nativeElement.querySelectorAll<HTMLElement>('.lp-rv');
      if (typeof IntersectionObserver === 'undefined') {
        bloques.forEach((b) => b.classList.add('in'));
        return;
      }
      // El observer avisa SIEMPRE una primera vez por cada bloque, apenas el navegador dibuja. Si no
      // llego ningun aviso, la pagina no se esta dibujando (pestaña de fondo, captura, crawler): se
      // muestra todo de una, para que nada quede invisible.
      let avisos = 0;
      const resguardo = setTimeout(() => {
        if (avisos === 0) bloques.forEach((b) => b.classList.add('in'));
      }, 1500);
      const io = new IntersectionObserver(
        (entradas) =>
          entradas.forEach((e) => {
            avisos++;
            if (e.isIntersecting) {
              e.target.classList.add('in');
              io.unobserve(e.target);
            }
          }),
        { threshold: 0.12 },
      );
      bloques.forEach((b) => io.observe(b));
      this.destroyRef.onDestroy(() => {
        clearTimeout(resguardo);
        io.disconnect();
      });
    });
  }

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

  // 29-oct-2026 -- la agenda ya no es un modal: vive al pie (#demo). Cada boton de demo la pide (se crea
  // recien ahi, como antes) y baja hasta la seccion.
  protected irADemo(event: Event): void {
    event.preventDefault();
    this.agendaPedida.set(true);
    this.host.nativeElement.querySelector<HTMLElement>('#demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
