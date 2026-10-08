import { Component, computed, input } from '@angular/core';
import { PriceHistoryPoint } from '../../core/price-history.models';

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = 32;

const SOURCE_COLOR: Record<string, string> = {
  sepa: '#8a8a8a',
  self_reported: '#2e5aac',
  crowd: '#d98a15',
};

interface PlottedPoint {
  x: number;
  y: number;
  price: number;
  date: string;
  source: string;
  color: string;
}

// E7.4 -- grafico de evolucion de precio, en SVG puro (sin libreria de charts: el
// proyecto no tiene ninguna instalada todavia y no pude verificar un npm install en
// este entorno). Pensado para ser reusable tal cual en el dashboard de benchmarking
// (E8) -- solo necesita un arreglo de puntos, no sabe nada de de-donde-vienen.
@Component({
  selector: 'app-price-history-chart',
  standalone: true,
  templateUrl: './price-history-chart.html',
  styleUrl: './price-history-chart.scss',
})
export class PriceHistoryChartComponent {
  readonly points = input<PriceHistoryPoint[]>([]);

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;

  protected readonly plotted = computed<PlottedPoint[]>(() => {
    const pts = this.points();
    if (pts.length === 0) return [];

    const prices = pts.map((p) => p.listPrice);
    const times = pts.map((p) => new Date(p.capturedAt).getTime());
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    const priceRange = maxPrice - minPrice || 1;
    const timeRange = maxTime - minTime || 1;

    return pts.map((p) => {
      const t = new Date(p.capturedAt).getTime();
      const x = pts.length === 1
        ? WIDTH / 2
        : PADDING + ((t - minTime) / timeRange) * (WIDTH - 2 * PADDING);
      const y = HEIGHT - PADDING - ((p.listPrice - minPrice) / priceRange) * (HEIGHT - 2 * PADDING);
      return {
        x,
        y,
        price: p.listPrice,
        date: new Date(p.capturedAt).toLocaleDateString('es-AR'),
        source: p.source,
        color: SOURCE_COLOR[p.source] ?? '#555',
      };
    });
  });

  protected readonly pathD = computed(() => {
    const pts = this.plotted();
    if (pts.length === 0) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });

  protected readonly minPriceLabel = computed(() => {
    const pts = this.points();
    return pts.length ? Math.min(...pts.map((p) => p.listPrice)).toFixed(2) : '';
  });

  protected readonly maxPriceLabel = computed(() => {
    const pts = this.points();
    return pts.length ? Math.max(...pts.map((p) => p.listPrice)).toFixed(2) : '';
  });
}
