import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type * as LeafletNS from 'leaflet';
import { BusinessAccountService } from '../../core/business-account';
import { BusinessContextService } from '../../core/business-context';
import { BranchListItem } from '../../core/business-account.models';

// E6.3 -- listado de sucursales con el switch de publicacion. El copy tiene que dejar
// claro que esto es SOLO sobre la app de consumidores: el precio de la sucursal ya
// contribuye de forma anonima al benchmark de la zona por el solo hecho de estar dada
// de alta (segun el NDA), este switch no cambia eso.
//
// E1.9 (16-ago-2026) -- pedido de Andres: "¿ID de cuenta de negocio? De nuevo... y casi
// todas las pantallas lo tienen". Ya no se pide a mano -- se resuelve solo via
// BusinessContextService (mismo service compartido que ahora usan todas las pantallas
// del panel), primera cuenta del usuario.
//
// E2.3 (16-ago-2026) -- segundo pedido en el mismo mensaje: "si [la sucursal] no tiene
// [coordenadas], tendria que tener un boton para calcular las coordenadas... y que
// aparezca el mapa". CreateBranch (E2.2) ya geocodificaba automaticamente al dar de
// alta, pero si el proveedor no encontraba nada la sucursal quedaba asi para siempre --
// nunca se habia construido la forma de completarlo despues. Ahora cada fila sin
// coordenadas (o con coordenadas, para poder corregirlas) tiene "Editar ubicación",
// que abre un editor con dos caminos: reintentar el geocoding automatico, o marcar el
// punto a mano en un mapa Leaflet (mismo patron que ya usa DistribucionIQ en
// territorial-map.ts: carga dinamica de 'leaflet', tiles de OpenStreetMap).
@Component({
  selector: 'app-branches-list',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './branches-list.html',
  styleUrl: './branches-list.scss',
})
export class BranchesListComponent implements OnInit, OnDestroy {
  private readonly accountService = inject(BusinessAccountService);
  private readonly context = inject(BusinessContextService);

  protected readonly loadingContext = signal(true);
  protected readonly contextErrorMessage = signal<string | null>(null);
  protected readonly noAccountYet = signal(false);
  protected readonly businessAccountId = signal<number | null>(null);

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly branches = signal<BranchListItem[] | null>(null);
  protected readonly togglingBranchId = signal<string | null>(null);

  // Editor de ubicacion: una sola instancia de mapa reutilizada, atada a
  // editingBranch(). null = editor cerrado.
  protected readonly editingBranch = signal<BranchListItem | null>(null);
  protected readonly pendingLatLng = signal<{ lat: number; lng: number } | null>(null);
  protected readonly regeocoding = signal(false);
  protected readonly regeocodeMessage = signal<string | null>(null);
  protected readonly savingLocation = signal(false);

  @ViewChild('locationMapContainer') mapContainer?: ElementRef<HTMLDivElement>;
  private L: typeof LeafletNS | null = null;
  private map: LeafletNS.Map | null = null;
  private marker: LeafletNS.Marker | null = null;

  ngOnInit(): void {
    this.context.load().subscribe({
      next: (ctx) => {
        this.loadingContext.set(false);
        if (!ctx) {
          this.noAccountYet.set(true);
          return;
        }
        this.businessAccountId.set(ctx.account.businessAccountId);
        this.branches.set(ctx.branches);
      },
      error: () => {
        this.loadingContext.set(false);
        this.contextErrorMessage.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  protected toggleVisibility(branch: BranchListItem): void {
    const businessAccountId = this.businessAccountId();
    if (businessAccountId === null) return;
    const nextValue = !branch.isPublic;

    this.togglingBranchId.set(branch.branchId);
    this.accountService.updateBranchVisibility(branch.branchId, { businessAccountId, isPublic: nextValue }).subscribe({
      next: (updated) => {
        this.togglingBranchId.set(null);
        this.replaceBranch(updated);
      },
      error: (err) => {
        this.togglingBranchId.set(null);
        this.errorMessage.set(err?.error?.error ?? 'No se pudo cambiar la visibilidad. Intenta de nuevo.');
      },
    });
  }

  private replaceBranch(updated: BranchListItem): void {
    const current = this.branches();
    if (!current) return;
    this.branches.set(current.map((b) => (b.branchId === updated.branchId ? updated : b)));
  }

  // E2.3 -- abre el editor para esta sucursal. El div del mapa recien existe en el DOM
  // despues de que Angular renderice el @if que lo contiene -- pedirle el ViewChild en
  // el mismo tick todavia da undefined (mismo gotcha ya documentado en
  // territorial-map.ts de DistribucionIQ). setTimeout(0) alcanza: Angular ya corrio su
  // ciclo de deteccion de cambios antes de que el macrotask se ejecute.
  protected openLocationEditor(branch: BranchListItem): void {
    this.editingBranch.set(branch);
    this.regeocodeMessage.set(null);
    this.pendingLatLng.set(
      branch.latitude != null && branch.longitude != null ? { lat: branch.latitude, lng: branch.longitude } : null,
    );
    setTimeout(() => this.initOrUpdateMap(), 0);
  }

  protected closeLocationEditor(): void {
    this.map?.remove();
    this.map = null;
    this.marker = null;
    this.editingBranch.set(null);
    this.pendingLatLng.set(null);
    this.regeocodeMessage.set(null);
  }

  private async initOrUpdateMap(): Promise<void> {
    if (!this.mapContainer) return;
    const branch = this.editingBranch();
    if (!branch) return;

    if (!this.L) {
      // 18-ago-2026 -- BUG real (reportado por Andres via consola: "TypeError: e.map is
      // not a function" al abrir el editor de ubicacion): bajo el bundler de esbuild de
      // Angular, el `import('leaflet')` dinamico devuelve el modulo CJS envuelto en
      // `.default` (no aplana los named exports como si pasa con el `import` estatico
      // de arriba, que es solo de tipos). Sin este fallback, `this.L` quedaba siendo el
      // wrapper del modulo en vez del namespace de Leaflet, y `L.map(...)` explotaba.
      const leafletModule = await import('leaflet');
      this.L = ((leafletModule as unknown as { default?: typeof LeafletNS }).default ?? leafletModule) as typeof LeafletNS;
    }
    const L = this.L;

    // Si ya habia un mapa (el usuario paso de editar una sucursal a otra sin cerrar el
    // editor), se destruye antes de crear el nuevo -- Leaflet no admite re-inicializar
    // sobre el mismo <div> sin liberar la instancia anterior primero.
    this.map?.remove();
    this.marker = null;

    const hasCoords = branch.latitude != null && branch.longitude != null;
    // Fallback (-34.6, -58.4 = CABA) en vez de dejar que Leaflet arranque en (0,0), que
    // cae en el Golfo de Guinea y no le dice nada al usuario -- la mayoria de los
    // comercios autoreportados de este panel son de Argentina.
    const initialCenter: [number, number] = hasCoords ? [branch.latitude!, branch.longitude!] : [-34.6, -58.4];
    const initialZoom = hasCoords ? 16 : 5;

    const map = L.map(this.mapContainer.nativeElement).setView(initialCenter, initialZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    if (hasCoords) {
      this.marker = L.marker([branch.latitude!, branch.longitude!], { draggable: true, icon: this.pinIcon() }).addTo(
        map,
      );
      this.marker.on('dragend', () => this.onMarkerMoved());
    }

    map.on('click', (e: LeafletNS.LeafletMouseEvent) => this.placeMarker(e.latlng.lat, e.latlng.lng));

    this.map = map;
  }

  private placeMarker(lat: number, lng: number): void {
    if (!this.L || !this.map) return;
    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.marker = this.L.marker([lat, lng], { draggable: true, icon: this.pinIcon() }).addTo(this.map);
      this.marker.on('dragend', () => this.onMarkerMoved());
    }
    this.pendingLatLng.set({ lat, lng });
  }

  // 16-ago-2026 -- BUG real (reportado por Andres via consola: "marker-shadow.png ...
  // 404"): L.marker() sin icono explicito usa el marker azul por defecto de Leaflet,
  // que carga sus PNG (marker-icon.png/marker-icon-2x.png/marker-shadow.png) con una
  // ruta relativa a la propia carpeta de node_modules/leaflet -- eso funciona en un
  // <script> suelto, pero no bajo el bundler de Angular (los assets no se copian ni la
  // ruta resuelve). Fix: pin propio armado con divIcon (mismo enfoque, sin PNGs, que ya
  // usa territorial-map.ts de DistribucionIQ para sus marcadores) -- cero dependencia
  // de assets, no hay nada que "olvidarse de copiar" en angular.json.
  private pinIcon(): LeafletNS.DivIcon {
    return this.L!.divIcon({
      className: 'branch-location-pin',
      html:
        '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;' +
        'background:#2e5aac;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.45);' +
        'transform:rotate(-45deg);"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 20],
    });
  }

  private onMarkerMoved(): void {
    if (!this.marker) return;
    const pos = this.marker.getLatLng();
    this.pendingLatLng.set({ lat: pos.lat, lng: pos.lng });
  }

  // E2.3 -- primer camino: reintentar el geocoding automatico por la direccion ya
  // guardada de la sucursal. Util si el proveedor fallo transitoriamente en el alta, o
  // si la direccion se corrigio despues.
  protected retryAutoGeocode(): void {
    const branch = this.editingBranch();
    const businessAccountId = this.businessAccountId();
    if (!branch || businessAccountId === null) return;

    this.regeocoding.set(true);
    this.regeocodeMessage.set(null);

    this.accountService.regeocodeBranch(branch.branchId, { businessAccountId }).subscribe({
      next: (updated) => {
        this.regeocoding.set(false);
        this.replaceBranch(updated);
        this.editingBranch.set(updated);
        this.pendingLatLng.set(
          updated.latitude != null && updated.longitude != null
            ? { lat: updated.latitude, lng: updated.longitude }
            : null,
        );
        this.regeocodeMessage.set('¡Listo! Encontramos la ubicación automáticamente.');
        setTimeout(() => this.initOrUpdateMap(), 0);
      },
      error: (err) => {
        this.regeocoding.set(false);
        this.regeocodeMessage.set(
          err?.status === 422
            ? (err?.error?.error ?? 'No pudimos encontrar la dirección automáticamente. Marcá el punto en el mapa.')
            : (err?.error?.error ?? 'No se pudo reintentar. Intenta de nuevo en unos minutos.'),
        );
      },
    });
  }

  // E2.3 -- segundo camino: el punto que el usuario marco/arrastro en el mapa.
  protected saveLocation(): void {
    const branch = this.editingBranch();
    const businessAccountId = this.businessAccountId();
    const latLng = this.pendingLatLng();
    if (!branch || businessAccountId === null || !latLng) return;

    this.savingLocation.set(true);
    this.accountService
      .setBranchLocation(branch.branchId, { businessAccountId, latitude: latLng.lat, longitude: latLng.lng })
      .subscribe({
        next: (updated) => {
          this.savingLocation.set(false);
          this.replaceBranch(updated);
          this.closeLocationEditor();
        },
        error: (err) => {
          this.savingLocation.set(false);
          this.regeocodeMessage.set(err?.error?.error ?? 'No se pudo guardar la ubicación. Intenta de nuevo.');
        },
      });
  }
}
