import { DecimalPipe } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MayoristasCercaService } from '../../core/mayoristas-cerca';
import { MayoristasCercaRespuesta } from '../../core/mayoristas.models';

// BP-209 (28-oct-2026, bloque 4) -- la tarjeta "N artículos que un mayorista cerca vende más barato que tu proveedor".
// Compara el costo cargado de cada artículo con el precio por unidad del mayorista más barato a menos de 50 km de alguna
// sucursal (SEPA Mayorista: Makro, Maxiconsumo, Yaguar...). El conteo es de todo plan; la lista (/precios/mayoristas),
// de Avanzado y Cadena (decisión de Andrés, 28-oct). Sin costos cargados o sin mayorista cerca, la tarjeta no aparece.
// El tono: el dato, nunca "te cobran de más" (el proveedor quizás entrega en el local, da crédito o vende por unidad).
@Component({
  selector: 'app-mayoristas-cerca',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './mayoristas-cerca.html',
  styleUrl: './mayoristas-cerca.scss',
})
export class MayoristasCercaComponent {
  private readonly mayoristas = inject(MayoristasCercaService);

  readonly businessAccountId = input<number | null>(null);

  protected readonly datos = signal<MayoristasCercaRespuesta | null>(null);

  constructor() {
    effect(() => {
      const cuenta = this.businessAccountId();
      if (cuenta == null) return;
      untracked(() => {
        this.datos.set(null);
        // Sin la lista: la tarjeta solo cuenta (la lista se pide en su página).
        this.mayoristas.leer(cuenta, 1).subscribe({
          next: (r) => this.datos.set(r),
          // Un error no ensucia el dashboard: la tarjeta no aparece.
          error: () => this.datos.set(null),
        });
      });
    });
  }

  /** La tarjeta aparece solo con costos cargados y algún mayorista cerca que venda algo de lo que tiene costo. */
  protected visible(d: MayoristasCercaRespuesta): boolean {
    return !d.noDisponible && d.resumen.costosCargados > 0 && d.resumen.conMayoristaCerca > 0;
  }

  protected km(km: number | null): string {
    if (km == null) return '';
    return km < 1 ? 'menos de 1 km' : `${km.toLocaleString('es-AR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
  }
}
