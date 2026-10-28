import { DecimalPipe, registerLocaleData } from '@angular/common';
import localeEsAr from '@angular/common/locales/es-AR';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfertasCercaService } from '../../core/ofertas-cerca';
import {
  EtiquetaOferta,
  NOMBRE_ETIQUETA,
  OfertaCercaItem,
  OfertasCercaRespuesta,
  distancia,
} from '../../core/ofertas-cerca.models';

registerLocaleData(localeEsAr, 'es-AR');

const POR_TANDA = 10;

const CLASE_PILL: Record<EtiquetaOferta, string> = {
  subio_antes: 'pill--danger',
  mas_barato_cerca: 'pill--warning',
  real: 'pill--success',
  sin_marca: 'pill--neutral',
  sin_dato: 'pill--neutral',
};

const AYUDA: Record<EtiquetaOferta, string> = {
  subio_antes: 'La cadena subió el precio de lista en los 30 días antes de la oferta.',
  mas_barato_cerca: 'En otras cadenas a menos de 5 km el producto sale 5 % o más barato que esta oferta.',
  real: 'El precio de lista no se movió antes y la oferta no es más cara que la zona.',
  sin_marca: 'La zona lo tiene apenas más barato (menos de 5 %): se cuenta como oferta, sin marca.',
  sin_dato: 'No se pudo calificar: falta historia del precio o no hay otras cadenas cerca.',
};

// BP-204 (28-oct-2026, bloque 5) -- "OFERTAS DE LA COMPETENCIA CERCA" en el dashboard: las ofertas de los
// supermercados SEPA a 5 km de la sucursal elegida, calificadas por BP-201. Sirve para no salir a igualar una oferta que
// no es tal: arriba lo que el comercio VENDE y, de eso, las que subieron el precio antes o tienen algo mas barato cerca
// (decision 4 de Andres). Los conteos son productos, no sucursales (en CABA el mismo producto esta en 200 DIA).
// Desde Pyme: los demas planes ven la tarjeta con candado. Se pide sola al cambiar la sucursal, sin esperar a "Ver
// dashboard": no depende del radio (es el de BP-201, 5 km).
@Component({
  selector: 'app-ofertas-cerca',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './ofertas-cerca.html',
  styleUrl: './ofertas-cerca.scss',
})
export class OfertasCercaComponent {
  private readonly ofertas = inject(OfertasCercaService);

  readonly businessAccountId = input<number | null>(null);
  readonly branchId = input<string | null>(null);
  readonly branchName = input<string | null>(null);

  protected readonly cargando = signal(false);
  protected readonly bloqueado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly datos = signal<OfertasCercaRespuesta | null>(null);
  protected readonly soloLoQueVendo = signal(true);
  protected readonly etiqueta = signal<EtiquetaOferta | null>(null);
  protected readonly visibles = signal(POR_TANDA);
  protected readonly lista = computed(() => (this.datos()?.lista ?? []).slice(0, this.visibles()));

  protected readonly nombreEtiqueta = NOMBRE_ETIQUETA;
  protected readonly etiquetas: EtiquetaOferta[] = ['subio_antes', 'mas_barato_cerca', 'real', 'sin_marca', 'sin_dato'];
  protected readonly distancia = distancia;
  protected readonly porTanda = POR_TANDA;

  /** Los conteos de lo que se está mirando: lo que vende o todo. */
  protected readonly conteo = computed(() => {
    const d = this.datos();
    if (!d) return null;
    return this.soloLoQueVendo() ? d.deLoQueVendes : d.todas;
  });

  constructor() {
    effect(() => {
      const cuenta = this.businessAccountId();
      const sucursal = this.branchId();
      if (cuenta == null || !sucursal) return;
      untracked(() => {
        this.etiqueta.set(null);
        this.soloLoQueVendo.set(true);
        this.datos.set(null);
        this.cargar(true);
      });
    });
  }

  protected verLoQueVendo(v: boolean): void {
    if (v === this.soloLoQueVendo()) return;
    this.soloLoQueVendo.set(v);
    this.etiqueta.set(null);
    this.cargar();
  }

  protected filtrar(e: EtiquetaOferta | null): void {
    this.etiqueta.set(this.etiqueta() === e ? null : e);
    this.cargar();
  }

  protected verMas(): void {
    this.visibles.update((n) => n + POR_TANDA);
  }

  protected cuantas(e: EtiquetaOferta): number {
    const c = this.conteo();
    if (!c) return 0;
    switch (e) {
      case 'subio_antes': return c.subioAntes;
      case 'mas_barato_cerca': return c.masBaratoCerca;
      case 'real': return c.reales;
      case 'sin_marca': return c.sinMarca;
      default: return c.sinDato;
    }
  }

  protected pill(e: EtiquetaOferta): string {
    return CLASE_PILL[e];
  }

  protected ayuda(e: EtiquetaOferta): string {
    return AYUDA[e];
  }

  protected donde(o: OfertaCercaItem): string {
    const suc = o.sucursal ? ` ${o.sucursal}` : '';
    const mas = o.sucursales > 1 ? ` (y ${o.sucursales - 1} ${o.sucursales === 2 ? 'sucursal más' : 'sucursales más'} de ${o.bandera} cerca)` : '';
    return `${o.bandera}${suc}, ${distancia(o.metros)}${mas}`;
  }

  protected fecha(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  /**
   * primeraVez: si no vende nada de lo que esta en oferta cerca, se pasa sola a "Todo" (si no, la tarjeta diria "nada" y
   * hay ofertas).
   */
  private cargar(primeraVez = false): void {
    const cuenta = this.businessAccountId();
    const sucursal = this.branchId();
    if (cuenta == null || !sucursal) return;
    this.cargando.set(true);
    this.error.set(null);
    this.visibles.set(POR_TANDA);
    this.ofertas
      .leer(cuenta, { branchId: sucursal, etiqueta: this.etiqueta(), soloLoQueVendo: this.soloLoQueVendo(), top: 100 })
      .subscribe({
        next: (r) => {
          // La respuesta de otra sucursal (se cambio mientras cargaba) no se pinta.
          if (sucursal !== this.branchId()) return;
          this.cargando.set(false);
          this.bloqueado.set(false);
          if (primeraVez && this.soloLoQueVendo() && r.deLoQueVendes.ofertas === 0 && r.todas.ofertas > 0) {
            this.soloLoQueVendo.set(false);
            this.cargar();
            return;
          }
          this.datos.set(r);
        },
        error: (err) => {
          this.cargando.set(false);
          if (err?.status === 402) this.bloqueado.set(true);
          else this.error.set(err?.error?.error ?? 'No se pudieron leer las ofertas de la competencia.');
        },
      });
  }
}
