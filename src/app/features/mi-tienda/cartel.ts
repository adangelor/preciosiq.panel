import { Component, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap, of } from 'rxjs';
import QRCode from 'qrcode';
import { BusinessContextService } from '../../core/business-context';
import { TiendaService, formatearWhatsApp } from '../../core/tienda';
import { environment } from '../../../environments/environment';

/**
 * BP-71 (08-oct-2026) -- el cartel A5 para pegar en la vidriera: logo, nombre, el QR de
 * misuper.app/<slug> y "pedí por WhatsApp". Fuera del shell del panel (sin menu) para que se imprima
 * limpio: el boton imprime y el dialogo del navegador ofrece "Guardar como PDF". El QR lo genera el
 * panel (es el QR de una URL, no el de pago).
 * BP-167 (19-oct-2026) -- una tienda por cuenta: el cartel sigue siendo de UNA sucursal (/mi-tienda/cartel/:branchId),
 * pero el QR lleva a la tienda de la cadena abierta en esa sucursal (misuper.app/<slug>?sucursal=<branchId>). Asi cada
 * sucursal pega el suyo y el que lo escanea ve los precios de donde esta parado.
 */
@Component({
  selector: 'app-cartel-tienda',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="barra no-imprimir">
      <a routerLink="/mi-tienda">← Volver a Mi tienda</a>
      @if (listo()) {
        <button type="button" (click)="imprimir()">Imprimir o guardar como PDF</button>
      }
    </div>

    @if (error()) {
      <p class="error no-imprimir">{{ error() }}</p>
    } @else if (listo()) {
      <section class="cartel">
        @if (logo()) {
          <img class="cartel__logo" [src]="logo()" alt="" />
        }
        <h1 class="cartel__nombre">{{ nombre() }}</h1>
        @if (sucursal()) {
          <p class="cartel__sucursal">{{ sucursal() }}</p>
        }
        <p class="cartel__bajada">Mirá nuestros precios y promos<br />y pedí por WhatsApp</p>
        <div class="cartel__qr" [innerHTML]="qr()"></div>
        <p class="cartel__url">{{ urlCorta() }}</p>
        <p class="cartel__escanea">Escaneá con la cámara del celular</p>
        @if (whatsapp()) {
          <p class="cartel__whatsapp">WhatsApp {{ whatsapp() }}</p>
        }
      </section>
      <p class="hint no-imprimir">
        Tamaño A5 (media hoja A4). Si tu impresora usa A4, elegí "Ajustar a la página" o imprimí dos por hoja.
      </p>
    } @else {
      <p class="hint no-imprimir">Armando el cartel…</p>
    }
  `,
  styles: `
    :host { display: block; background: #fff; color: #111; min-height: 100vh; }
    .barra { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem 1.5rem; }
    .barra button { padding: 0.6rem 1.3rem; border: 0; border-radius: 6px; background: #4f46e5; color: #fff; font-size: 1rem; cursor: pointer; }
    .hint { text-align: center; color: #666; font-size: 0.9rem; }
    .error { text-align: center; color: #b91c1c; }
    .cartel {
      width: 148mm; min-height: 200mm; margin: 0 auto; padding: 12mm 10mm;
      border: 1px dashed #ccc; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: center; text-align: center;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    .cartel__logo { max-width: 40mm; max-height: 22mm; object-fit: contain; margin-bottom: 4mm; }
    .cartel__nombre { font-size: 24pt; line-height: 1.1; margin: 0 0 3mm; }
    .cartel__sucursal { font-size: 13pt; margin: 0 0 3mm; color: #444; }
    .cartel__bajada { font-size: 15pt; margin: 0 0 6mm; color: #333; }
    .cartel__qr { width: 92mm; height: 92mm; }
    .cartel__qr ::ng-deep svg { width: 100%; height: 100%; }
    .cartel__url { font-size: 17pt; font-weight: 700; margin: 4mm 0 1mm; letter-spacing: 0.02em; }
    .cartel__escanea { font-size: 11pt; color: #555; margin: 0; }
    .cartel__whatsapp { font-size: 13pt; margin: 5mm 0 0; }
    @media print {
      @page { size: A5 portrait; margin: 0; }
      .no-imprimir { display: none !important; }
      .cartel { border: 0; width: 148mm; height: 210mm; }
    }
  `,
})
export class CartelTiendaComponent implements OnInit {
  private readonly context = inject(BusinessContextService);
  private readonly service = inject(TiendaService);
  private readonly sanitizer = inject(DomSanitizer);

  /** :branchId de la ruta (el panel no usa withComponentInputBinding: se lee del snapshot). */
  private readonly branchId = inject(ActivatedRoute).snapshot.paramMap.get('branchId') ?? '';

  protected readonly listo = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly nombre = signal('');
  /** BP-167 -- "Sucursal Centro · Pringles 100", debajo del nombre de la tienda. */
  protected readonly sucursal = signal<string | null>(null);
  /** BP-167 -- la URL del QR: la tienda abierta en esta sucursal. */
  protected readonly urlQr = signal('');
  protected readonly logo = signal<string | null>(null);
  protected readonly qr = signal<SafeHtml>('');
  protected readonly urlCorta = signal('');
  protected readonly whatsapp = signal<string | null>(null);

  ngOnInit(): void {
    this.context
      .load()
      .pipe(
        switchMap((ctx) => {
          if (!ctx) return of(null);
          const logo = ctx.account.logoUrl;
          this.logo.set(logo ? environment.assetsBaseUrl + logo.replace(/^\//, '') : null);
          return this.service.cuenta(ctx.account.businessAccountId);
        }),
      )
      .subscribe({
        next: async (c) => {
          const t = c?.tienda;
          if (!c || !t) {
            this.error.set('Todavía no tenés tu tienda. Creala primero en "Mi tienda".');
            return;
          }
          const s = c.sucursales.find((x) => x.branchId === this.branchId);
          if (!s) {
            this.error.set('Esa sucursal no es de tu cuenta. Volvé a "Mi tienda" y elegí el cartel de una de tus sucursales.');
            return;
          }
          if (!s.habilitada) {
            // El sitio la abriria en otra sucursal: mejor no imprimir un cartel que miente.
            this.error.set(`La sucursal ${s.nombre} no está habilitada en tu tienda. Habilitala en "Mi tienda" y volvé a armar el cartel.`);
            return;
          }
          const url = this.service.urlSucursal(t.slug, s.branchId);
          this.urlQr.set(url);
          // El SVG lo arma la libreria a partir de NUESTRA url: es seguro marcarlo como confiable.
          const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000', light: '#fff' } });
          this.qr.set(this.sanitizer.bypassSecurityTrustHtml(svg));
          this.nombre.set(t.nombreVisible);
          // Con una sola sucursal en la cuenta no hace falta decir cual es.
          this.sucursal.set(c.sucursales.length > 1 ? [`Sucursal ${s.nombre}`, s.domicilio].filter(Boolean).join(' · ') : null);
          // Lo impreso es la direccion corta (la que se puede tipear); el QR ademas elige la sucursal.
          this.urlCorta.set(this.service.urlPublica(t.slug).replace(/^https?:\/\//, ''));
          const wa = s.whatsApp ?? t.whatsApp;
          this.whatsapp.set(wa ? formatearWhatsApp(wa) : null);
          this.listo.set(true);
        },
        error: () => this.error.set('No pudimos cargar la tienda. Probá recargar la página.'),
      });
  }

  protected imprimir(): void {
    window.print();
  }
}
