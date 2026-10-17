import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BusinessPriceService } from '../../core/business-price';
import { UpsertBusinessPriceRequest } from '../../core/business-price.models';
import { BrandLabelPipe } from '../../core/brand-label';
import { ProductDetailRow } from './benchmark-detail-dialog';

// ─────────────────────────────────────────────────────────────
// BP-152 (17-oct-2026) -- pedido de Andres: el "para revisar" (BP-143) y el "EAN dudoso" (BP-137) del benchmark eran
// carteles sin salida: habia que ir a Cargar precio a buscar el producto. Ahora se tocan y abren este popup: tu precio
// contra el de cada cadena, la pista de que puede estar mal (una coma corrida, otra presentacion, el codigo de otro
// producto) y la correccion ahi mismo, con los mismos endpoints que Cargar precio (PUT /business/prices, change-ean),
// asi pasa por las mismas validaciones y deja su historial. Se corrige en la sucursal del calculo del benchmark.
// ─────────────────────────────────────────────────────────────
export interface PriceReviewDialogData {
  row: ProductDetailRow;
  businessAccountId: number;
  branchId: string;
  branchName: string;
}

/** Lo que cambio: el dashboard actualiza la fila (precio) o vuelve a pedir el detalle (codigo). */
export type PriceReviewResult = { kind: 'price'; ean: string; listPrice: number } | { kind: 'ean'; ean: string; newEan: string };

@Component({
  selector: 'app-price-review-dialog',
  standalone: true,
  imports: [BrandLabelPipe],
  templateUrl: './price-review-dialog.html',
  styleUrl: './price-review-dialog.scss',
})
export class PriceReviewDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PriceReviewDialogComponent, PriceReviewResult>);
  private readonly priceService = inject(BusinessPriceService);
  protected readonly data = inject<PriceReviewDialogData>(MAT_DIALOG_DATA);
  protected readonly row = this.data.row;

  /** Un precio que viene de SEPA lo publica el sistema de la cadena: no se corrige desde el panel. */
  protected readonly editable = this.row.ownPriceSource !== 'sepa';

  /** Precio de referencia de la zona. Con EAN dudoso no se calcula (BP-137): se arma con las cadenas igual, solo para mostrar. */
  protected readonly zoneRef = computed<number | null>(() => {
    if (this.row.competitorRefPrice !== null) return this.row.competitorRefPrice;
    const points = this.row.sepaChains.map((c) => c.avgPrice);
    if (this.row.familySufficientCoverage && this.row.familyAvgPrice != null) points.push(this.row.familyAvgPrice);
    return points.length ? points.reduce((a, b) => a + b, 0) / points.length : null;
  });

  /** Cuantas veces tu precio es el de la zona (>1 = mas caro). */
  protected readonly ratio = computed<number | null>(() => {
    const ref = this.zoneRef();
    return ref && this.row.ownPrice ? this.row.ownPrice / ref : null;
  });

  /**
   * Si la diferencia es casi exacta una potencia de 10 (x10, x100, x1000, o /10...), casi seguro es la coma corrida o
   * un cero de mas: se propone el precio con la coma en su lugar. Margen de +-35 %: un precio de lista vs. el promedio
   * de la zona rara vez se aleja mas que eso.
   */
  protected readonly commaFix = computed<number | null>(() => {
    const r = this.ratio();
    const own = this.row.ownPrice;
    if (r === null || own == null) return null;
    const k = Math.round(Math.log10(r));
    if (k === 0) return null;
    const off = r / Math.pow(10, k);
    if (off < 0.65 || off > 1.35) return null;
    return Math.round((own / Math.pow(10, k)) * 100) / 100;
  });

  protected readonly newPrice = signal<number | null>(this.row.ownPrice);
  protected readonly newEan = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showEanForm = signal(this.row.eanDudoso === true);

  protected ratioText(): string {
    const r = this.ratio();
    if (r === null) return '';
    return r >= 1 ? `${this.fmt(r, 1)} veces el de la zona` : `${this.fmt(1 / r, 1)} veces más barato que la zona`;
  }

  protected fmt(n: number, decimals = 2): string {
    return n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  protected setPrice(value: number | null): void {
    this.newPrice.set(value);
    this.error.set(null);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected savePrice(): void {
    const listPrice = Number(this.newPrice());
    if (!(listPrice > 0)) {
      this.error.set('El precio tiene que ser mayor a cero.');
      return;
    }
    const { businessAccountId, branchId } = this.data;
    const ean = this.row.ean;
    this.saving.set(true);
    this.error.set(null);

    // Igual que el corrector de la importacion (csv-import.ts): se lee el producto como esta en la base para no pisar
    // descripcion, marca ni presentacion; sin promoRule el servidor no toca la promo y la re-espeja con el precio nuevo.
    this.priceService.getOwnProduct(businessAccountId, branchId, ean).subscribe({
      next: (page) => {
        const item = page.items[0];
        if (!item) {
          this.saving.set(false);
          this.error.set(`No encontramos este producto cargado en ${this.data.branchName}.`);
          return;
        }
        const request: UpsertBusinessPriceRequest = {
          businessAccountId,
          branchId,
          ean,
          listPrice,
          description: item.description,
          brand: item.brand,
          presentationQuantity: item.presentationQuantity,
          presentationUnit: item.presentationUnit,
          promo2UnitPrice: null,
          promo2Text: item.promo2Text ?? null,
        };
        this.priceService.upsert(request).subscribe({
          next: (resp) => {
            this.saving.set(false);
            this.dialogRef.close({ kind: 'price', ean, listPrice: resp.listPrice });
          },
          error: (err) => {
            this.saving.set(false);
            this.error.set(err?.error?.error ?? 'No se pudo guardar el precio.');
          },
        });
      },
      error: () => {
        this.saving.set(false);
        this.error.set('No pudimos leer el producto. Probá de nuevo.');
      },
    });
  }

  protected saveEan(): void {
    const newEan = this.newEan().trim();
    if (!/^\d{8,14}$/.test(newEan)) {
      this.error.set('El código tiene que tener entre 8 y 14 números.');
      return;
    }
    if (newEan === this.row.ean) {
      this.error.set('Es el mismo código que ya tiene.');
      return;
    }
    const { businessAccountId, branchId } = this.data;
    this.saving.set(true);
    this.error.set(null);
    this.priceService.changeEan({ businessAccountId, branchId, oldEan: this.row.ean, newEan }).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogRef.close({ kind: 'ean', ean: this.row.ean, newEan });
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.error ?? 'No se pudo cambiar el código.');
      },
    });
  }
}
