import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GestionContextoService } from '../../core/gestion-contexto';
import { MayoristasCercaService } from '../../core/mayoristas-cerca';
import { MayoristasCercaRespuesta, bultoTexto, dondeMayorista } from '../../core/mayoristas.models';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

// BP-209 (28-oct-2026, bloque 4) -- "lo que un mayorista cerca vende más barato que tu proveedor": la lista que abre la
// tarjeta del dashboard. Avanzado y Cadena (los demás ven el conteo y el candado). Ordenada por plata en juego por mes
// si hay ventas cargadas; si no, por diferencia. El texto es el dato: el proveedor quizás entrega en el local, da
// crédito o vende por unidad, y el mayorista muchas veces vende solo por bulto o pide CUIT.
@Component({
  selector: 'app-mayoristas-mas-baratos',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './mayoristas-mas-baratos.html',
  styleUrls: ['../gestion/gestion.scss', './mayoristas-mas-baratos.scss'],
})
export class MayoristasMasBaratosComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly mayoristas = inject(MayoristasCercaService);

  protected readonly cargando = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly datos = signal<MayoristasCercaRespuesta | null>(null);
  protected readonly q = signal('');

  protected readonly filtrados = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const q = this.q().trim().toLowerCase();
    if (!q) return d.items;
    return d.items.filter(
      (i) =>
        i.ean.startsWith(q) ||
        i.descripcion.toLowerCase().includes(q) ||
        (i.proveedor ?? '').toLowerCase().includes(q) ||
        i.mayorista.mayorista.toLowerCase().includes(q),
    );
  });

  protected readonly conVentas = computed(() => (this.datos()?.items ?? []).some((i) => i.plataEnJuegoMes != null));

  protected readonly dondeMayorista = dondeMayorista;
  protected readonly bultoTexto = bultoTexto;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        if (!g) {
          this.cargando.set(false);
          this.sinCuenta.set(true);
          return;
        }
        this.mayoristas.leer(g.businessAccountId, 2000).subscribe({
          next: (r) => {
            this.cargando.set(false);
            this.datos.set(r);
          },
          error: () => {
            this.cargando.set(false);
            this.error.set('No pudimos leer los precios de los mayoristas. Probá recargar la página.');
          },
        });
      },
      error: () => {
        this.cargando.set(false);
        this.error.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  protected onBuscar(ev: Event): void {
    this.q.set((ev.target as HTMLInputElement).value);
  }

  protected pesos(v: number | null | undefined): string {
    if (v == null) return '—';
    return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 });
  }

  protected pct(v: number): string {
    return `${Math.round(v).toLocaleString('es-AR')} %`;
  }

  protected fecha(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
}
