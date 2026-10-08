import { Component, Signal, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BenchmarkCategoryResult } from '../../core/business-benchmark.models';
import { BenchmarkTrendPoint, CategoryProductDetailItem } from '../../core/benchmark-trend.models';
import { BenchmarkTrendChartComponent } from '../benchmark-trend-chart/benchmark-trend-chart';
import { BrandLabelPipe } from '../../core/brand-label';

// 16-ago-2026 -- pedido de Andres: el detalle de categoria (tendencia + productos) va
// en un POPUP real, no debajo de la tabla en flujo normal. La primera implementacion
// (position:fixed + backdrop propio, dentro del mismo template de BenchmarkDashboard)
// quedaba atrapada dentro de <mat-sidenav-content>: Angular Material le pone un
// transform para animar la apertura/cierre del drawer, y eso crea un "containing
// block" nuevo para cualquier descendiente position:fixed -- el popup quedaba
// recortado al panel de contenido en vez de cubrir toda la pantalla (bug reportado
// por Andres con captura: se veia el sidebar y el header por encima, sin oscurecer).
//
// Fix real: usar Angular CDK Overlay via MatDialog (ya es dependencia del proyecto,
// @angular/material/dialog). MatDialog monta el popup en un contenedor propio pegado
// directo a <body>, FUERA del arbol del sidenav -- no hay forma de que quede atrapado
// por ningun ancestro con transform. Ademas viene con Escape/click-afuera-cierra y
// manejo de foco gratis, sin tener que reimplementarlo a mano.
//
// 16-ago-2026 -- pedido de Andres: lo primero que tiene que ver el comerciante son SUS
// productos con precio cargado (no los que solo tiene la competencia), y entre esos,
// primero los que estan MAS CAROS respecto a la zona (mayor diferencia) -- son los que
// mas urge revisar. Despues, que pueda reordenar la tabla clickeando cualquier
// columna, "como se le de la real gana". `competitorRefPrice`/`deltaPct` son
// calculados en el frontend (promedio simple de las cadenas SEPA nombradas + el
// agregado family si tiene piso) -- no vienen del backend, no hace falta: es solo para
// el orden default y la columna "Diferencia", no cambia que datos se muestran.
export type ProductSortColumn = 'description' | 'ownPrice' | 'delta' | 'family';

export interface ProductDetailRow extends CategoryProductDetailItem {
  competitorRefPrice: number | null;
  deltaPct: number | null;
}

export interface BenchmarkDetailDialogData {
  category: BenchmarkCategoryResult;
  trendPoints: Signal<BenchmarkTrendPoint[] | null>;
  products: Signal<CategoryProductDetailItem[] | null>;
  pagedProducts: Signal<ProductDetailRow[]>;
  loadingDetail: Signal<boolean>;
  productPage: Signal<number>;
  productTotalPages: Signal<number>;
  sortColumn: Signal<ProductSortColumn | 'default'>;
  sortDirection: Signal<'asc' | 'desc'>;
  goToProductPage: (page: number) => void;
  toggleSort: (column: ProductSortColumn) => void;
  resetSort: () => void;
  sourceLabel: (source: string) => string;
}

@Component({
  selector: 'app-benchmark-detail-dialog',
  standalone: true,
  imports: [BenchmarkTrendChartComponent, BrandLabelPipe],
  templateUrl: './benchmark-detail-dialog.html',
  styleUrl: './benchmark-detail-dialog.scss',
})
export class BenchmarkDetailDialogComponent {
  protected readonly dialogRef = inject(MatDialogRef<BenchmarkDetailDialogComponent>);
  protected readonly data = inject<BenchmarkDetailDialogData>(MAT_DIALOG_DATA);

  protected close(): void {
    this.dialogRef.close();
  }

  protected sortArrow(column: ProductSortColumn): string {
    if (this.data.sortColumn() !== column) return '';
    return this.data.sortDirection() === 'asc' ? ' ▲' : ' ▼';
  }

  protected sortLabel(column: ProductSortColumn | 'default'): string {
    switch (column) {
      case 'description': return 'Producto';
      case 'ownPrice': return 'Tu precio';
      case 'delta': return 'Diferencia';
      case 'family': return 'Otras cuentas (zona)';
      default: return '';
    }
  }
}
