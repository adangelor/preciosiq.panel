import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { MatSidenavContainer, MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth';
import { ThemeService } from '../../core/theme';
import { BusinessAccountService } from '../../core/business-account';
import { BusinessAccountResponse, resolveLogoUrl } from '../../core/business-account.models';
import { AccountMenuComponent } from '../account-menu/account-menu';

// E1.7 (16-ago-2026) -- pedido de Andres: unificar interfaz con distribucioniq.panel
// (menu lateral + barra superior sticky con logo/usuario), en vez del header simple sin
// drawer que tenia esta pantalla hasta ayer. Mismo componente exacto que el app-shell de
// DistribucionIQ (mat-sidenav-container/mat-toolbar/mat-nav-list, Angular Material real,
// BreakpointObserver para mobile vs. desktop), solo con los items de nav propios de
// PreciosIQ y BusinessAccountService en vez de ProductoraAccountService. Login/registrarme/
// recuperar-contrasena/alta quedan AFUERA del shell a proposito, mismo criterio que alla:
// son pantallas de antes de tener (o de estar creando) la cuenta.
@Component({
  selector: 'app-panel-header',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatSidenavModule,
    MatIconModule,
    AccountMenuComponent,
  ],
  templateUrl: './panel-header.html',
  styleUrl: './panel-header.scss',
})
export class PanelHeaderComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly businessAccountService = inject(BusinessAccountService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  // Publico: el template lo usa para el toggle claro/oscuro de la barra de arriba.
  protected readonly themeService = inject(ThemeService);

  protected readonly razonSocial = signal<string | null>(null);
  protected readonly logoUrl = signal<string | null>(null);
  protected resolveLogoUrl = resolveLogoUrl;

  // E10.5 -- solo para mostrar/ocultar el link "Admin: trials" del menu. La
  // seguridad real la hace el backend (policy "AdminsOnly"), esto es cosmetico.
  protected readonly isAdmin = this.authService.isAdmin;

  // Responsive con BreakpointObserver, identico a distribucioniq.panel: en desktop el
  // sidenav es "side" (fijo, empuja el contenido) y arranca abierto; en mobile es "over"
  // (flota encima) y arranca cerrado, con boton de hamburguesa. sidenavOpened es la
  // UNICA fuente de verdad de si esta abierto -- un effect() lo resetea SOLO cuando
  // isMobile() cambia de verdad (cruzar el breakpoint), para no pelear con el toggle manual.
  protected readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 768px)').pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  protected readonly sidenavOpened = signal(true);

  // 19-ago-2026 -- pedido de Andres: boton de colapsar/expandir el menu lateral (con
  // icono de caret, estilo SB Admin 2) en vez de solo poder ocultarlo/mostrarlo entero
  // en mobile. Colapsado, el sidenav se reduce a solo los iconos (sin texto) -- ver
  // .shell__sidenav--collapsed en el scss. Solo tiene sentido en desktop (mode "side");
  // en mobile el sidenav ya se oculta entero con el toggle de hamburguesa existente, asi
  // que ahi se ignora (no se muestra el boton de colapsar, ver panel-header.html).
  protected readonly sidenavCollapsed = signal(false);

  // 25-ago-2026 -- "solo iconos" es la combinacion real que le importa al template: en
  // mobile el drawer nunca se colapsa (se oculta entero), asi que el title de los links
  // (el tooltip nativo que reemplaza al texto oculto) solo va cuando esto da true.
  protected readonly iconsOnly = computed(() => !this.isMobile() && this.sidenavCollapsed());

  // No "required": el effect de abajo corre antes de que la vista este armada, y ahi las
  // queries todavia no resolvieron. Se chequea en cada frame.
  private readonly container = viewChild(MatSidenavContainer);
  private readonly sidenavEl = viewChild('sidenavEl', { read: ElementRef });
  private readonly destroyRef = inject(DestroyRef);
  private marginSyncFrame: number | null = null;

  constructor() {
    effect(() => {
      this.sidenavOpened.set(!this.isMobile());
    });

    // 25-ago-2026 -- bug de fondo del colapso: mat-sidenav-container mide el ancho del
    // drawer UNA vez (al abrirse / cambiar de modo) y con eso fija el margin-left del
    // contenido. Al angostar el drawer por CSS, el contenido se quedaba con el margen del
    // ancho viejo y aparecia un hueco entre el menu colapsado y la pagina. Aca, cada vez
    // que cambia el estado, se le pide al container que re-mida mientras dura la
    // transicion de ancho (frame a frame), asi el contenido acompaña al drawer en vez de
    // saltar al final. Se corta solo cuando el ancho deja de moverse.
    effect(() => {
      this.sidenavCollapsed();
      this.isMobile();
      this.syncContentMargins();
    });

    this.destroyRef.onDestroy(() => {
      if (this.marginSyncFrame !== null) cancelAnimationFrame(this.marginSyncFrame);
    });
  }

  protected toggleCollapse(): void {
    this.sidenavCollapsed.update((collapsed) => !collapsed);
  }

  private syncContentMargins(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.marginSyncFrame !== null) cancelAnimationFrame(this.marginSyncFrame);

    let lastWidth = -1;
    let stableFrames = 0;
    let frames = 0;

    const tick = (): void => {
      this.marginSyncFrame = null;
      const container = this.container();
      const el = this.sidenavEl()?.nativeElement as HTMLElement | undefined;
      if (!container || !el) return;
      container.updateContentMargins();
      const width = el.offsetWidth;
      stableFrames = width === lastWidth ? stableFrames + 1 : 0;
      lastWidth = width;
      frames++;
      // 3 frames quietos = termino la transicion. El tope de 60 (~1s) es solo por si
      // el navegador nunca la corre (reduced-motion, pestaña en segundo plano).
      if (stableFrames < 3 && frames < 60) {
        this.marginSyncFrame = requestAnimationFrame(tick);
      }
    };
    this.marginSyncFrame = requestAnimationFrame(tick);
  }

  ngOnInit(): void {
    // Best-effort: si falla (o todavia no hay cuenta) el shell se ve igual, solo sin
    // nombre/logo de marca en el header -- no bloquea la navegacion.
    this.businessAccountService.getMine().subscribe({
      next: (accounts) => {
        if (accounts.length === 0) return;
        this.cuentas.set(accounts);   // BP-88: la elegida viene primera (ver BusinessAccountService.getMine)
        this.razonSocial.set(accounts[0].razonSocial);
        this.logoUrl.set(accounts[0].logoUrl);
      },
      error: () => {},
    });
  }

  /** BP-88: empresas del usuario, la elegida primero. El selector aparece solo si hay más de una. */
  protected readonly cuentas = signal<BusinessAccountResponse[]>([]);

  protected cambiarCuenta(businessAccountId: string): void {
    const id = Number(businessAccountId);
    if (!id || id === this.cuentas()[0]?.businessAccountId) return;
    this.businessAccountService.elegirCuenta(id);
    window.location.reload();
  }

  // 25-ago-2026 -- pedido de Andres: la hamburguesa de arriba hace lo mismo que el caret
  // de abajo. En desktop (mode "side") colapsa/expande a solo-iconos en vez de esconder
  // el menu entero; en mobile (mode "over") sigue abriendo y cerrando el drawer, que es
  // lo unico que tiene sentido en una pantalla chica.
  protected toggleSidenav(): void {
    if (this.isMobile()) {
      this.sidenavOpened.update((opened) => !opened);
      return;
    }
    this.toggleCollapse();
  }
}
