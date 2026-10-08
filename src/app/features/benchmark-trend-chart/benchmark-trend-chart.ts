import { Component, computed, input, signal } from '@angular/core';
import { BenchmarkTrendPoint } from '../../core/benchmark-trend.models';

const WIDTH = 640;
const HEIGHT = 280;
const PADDING_LEFT = 56;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 34;
const Y_TICK_COUNT = 4;
const MAX_X_LABELS = 5;

interface SeriesLine {
  color: string;
  label: string;
  // Varios segmentos de path -- se corta cada vez que un punto no tiene precio
  // (cobertura insuficiente, E8.5), asi la linea nunca "inventa" un valor uniendo
  // dos puntos separados por un hueco de datos.
  segments: string[];
}

interface Bucket {
  x: number;
  date: string;
  own: number | null;
  ownY: number | null;
  comp: number | null;
  compY: number | null;
}

interface AxisTick {
  pos: number;
  label: string;
}

interface ChartLayout {
  lines: SeriesLine[];
  buckets: Bucket[];
  yTicks: AxisTick[];
  xTicks: AxisTick[];
  plotTop: number;
  plotBottom: number;
}

// 17-ago-2026 -- pedido de Andres: "la tabla de tendencias queda pobre, no tiene
// referencias". Antes este grafico tiraba un par de puntos sueltos en un SVG en
// blanco -- sin eje, sin grilla, sin fecha ni precio a la vista salvo el <title>
// nativo del navegador (que ni siquiera se ve hasta que pasas el mouse encima Y
// esperas). Redibujado siguiendo el skill de dataviz del workspace: grilla
// horizontal recesiva con precios "lindos" (niceTicks, no los min/max crudos),
// fechas en el eje X, crosshair + tooltip real al pasar el mouse (en vez de
// depender del <title> del navegador), y un anillo de 2px color superficie
// alrededor de cada punto para que no se pierdan sobre la linea.
function niceNum(range: number, round: boolean): number {
  if (range === 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function niceTicks(minVal: number, maxVal: number, tickCount: number): { min: number; max: number; ticks: number[] } {
  let min = minVal;
  let max = maxVal;
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (tickCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return { min: niceMin, max: niceMax, ticks };
}

// E8.3 -- tendencia de indice de precio (propio vs. competencia) para UNA categoria,
// en SVG puro (mismo criterio que PriceHistoryChartComponent: sin libreria de charts
// nueva, no pude verificar que un npm install la instale bien en este entorno).
@Component({
  selector: 'app-benchmark-trend-chart',
  standalone: true,
  templateUrl: './benchmark-trend-chart.html',
  styleUrl: './benchmark-trend-chart.scss',
})
export class BenchmarkTrendChartComponent {
  readonly points = input<BenchmarkTrendPoint[]>([]);

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly plotLeft = PADDING_LEFT;
  protected readonly plotRight = WIDTH - PADDING_RIGHT;

  protected readonly hoverIndex = signal<number | null>(null);

  protected readonly layout = computed<ChartLayout | null>(() => {
    const pts = [...this.points()].sort(
      (a, b) => new Date(a.weekBucket).getTime() - new Date(b.weekBucket).getTime(),
    );
    if (pts.length === 0) return null;

    const allPrices = pts.flatMap((p) => [p.ownAvgPrice, p.competitorAvgPrice]).filter((p): p is number => p !== null);
    if (allPrices.length === 0) return null;

    const { min: minPrice, max: maxPrice, ticks: priceTicks } = niceTicks(
      Math.min(...allPrices),
      Math.max(...allPrices),
      Y_TICK_COUNT,
    );
    const priceRange = maxPrice - minPrice || 1;

    const times = pts.map((p) => new Date(p.weekBucket).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime || 1;

    const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
    const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

    const xOf = (t: number) =>
      pts.length === 1 ? PADDING_LEFT + plotWidth / 2 : PADDING_LEFT + ((t - minTime) / timeRange) * plotWidth;
    const yOf = (price: number) => HEIGHT - PADDING_BOTTOM - ((price - minPrice) / priceRange) * plotHeight;

    const buckets: Bucket[] = pts.map((p) => {
      const x = xOf(new Date(p.weekBucket).getTime());
      return {
        x,
        date: new Date(p.weekBucket).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
        own: p.ownAvgPrice,
        ownY: p.ownAvgPrice !== null ? yOf(p.ownAvgPrice) : null,
        comp: p.competitorAvgPrice,
        compY: p.competitorAvgPrice !== null ? yOf(p.competitorAvgPrice) : null,
      };
    });

    const buildLine = (color: string, label: string, pick: (b: Bucket) => number | null): SeriesLine => {
      const segments: string[] = [];
      let current = '';
      for (const b of buckets) {
        const y = pick(b);
        if (y === null) {
          if (current) segments.push(current);
          current = '';
          continue;
        }
        current += current ? ` L${b.x.toFixed(1)},${y.toFixed(1)}` : `M${b.x.toFixed(1)},${y.toFixed(1)}`;
      }
      if (current) segments.push(current);
      return { color, label, segments };
    };

    const lines: SeriesLine[] = [
      buildLine('#2e5aac', 'Tu precio', (b) => b.ownY),
      buildLine('#d98a15', 'Competencia (zona)', (b) => b.compY),
    ];

    const yTicks: AxisTick[] = priceTicks.map((v) => ({
      pos: yOf(v),
      label: '$' + v.toFixed(Number.isInteger(v) ? 0 : 2),
    }));

    // Maximo ~5 etiquetas de fecha para no amontonarlas -- siempre incluye la
    // primera y la ultima, y reparte el resto lo mas parejo posible entre medio.
    const step = Math.max(1, Math.ceil(buckets.length / MAX_X_LABELS));
    const xTickIndices = new Set<number>();
    for (let i = 0; i < buckets.length; i += step) xTickIndices.add(i);
    xTickIndices.add(buckets.length - 1);
    const xTicks: AxisTick[] = [...xTickIndices]
      .sort((a, b) => a - b)
      .map((i) => ({ pos: buckets[i].x, label: buckets[i].date }));

    return { lines, buckets, yTicks, xTicks, plotTop: PADDING_TOP, plotBottom: HEIGHT - PADDING_BOTTOM };
  });

  protected readonly hoverBucket = computed<Bucket | null>(() => {
    const idx = this.hoverIndex();
    const l = this.layout();
    if (idx === null || !l) return null;
    return l.buckets[idx] ?? null;
  });

  // Recorta el tooltip lejos de los bordes del grafico para que nunca se corte
  // contra el borde del SVG -- se ancla centrado en el punto (translateX(-50%) en
  // el CSS) salvo cuando eso lo sacaria de la vista.
  protected readonly tooltipLeftPct = computed(() => {
    const b = this.hoverBucket();
    if (!b) return 50;
    const pct = (b.x / WIDTH) * 100;
    return Math.min(90, Math.max(10, pct));
  });

  protected onPointerMove(event: PointerEvent): void {
    const l = this.layout();
    if (!l || l.buckets.length === 0) return;
    // 17-ago-2026 -- BUG real (build rota): Angular tipa una variable de referencia
    // de plantilla puesta sobre un <svg> (ej. "#chartSvg") como HTMLElement, no
    // SVGSVGElement -- error de tipos en el compilador de plantillas, no del runtime.
    // Se evita el problema de raiz tomando el elemento desde event.currentTarget
    // (el listener esta puesto directo en el <svg>, asi que currentTarget siempre
    // es ese elemento) y casteando aca adentro, en vez de pasarlo como parametro.
    const svgEl = event.currentTarget as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const scaleX = WIDTH / rect.width;
    const px = (event.clientX - rect.left) * scaleX;

    let nearest = 0;
    let nearestDist = Infinity;
    l.buckets.forEach((b, i) => {
      const dist = Math.abs(b.x - px);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    this.hoverIndex.set(nearest);
  }

  protected onPointerLeave(): void {
    this.hoverIndex.set(null);
  }
}
