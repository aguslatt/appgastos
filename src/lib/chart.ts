/*
 * The little bit of arithmetic behind the charts, kept apart from the drawing so it can be tested:
 * running totals, nice axis ceilings, SVG paths and the arcs of a donut.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Running total per day for the first `days` days; days after the last known one are not included. */
export function cumulative(byDay: readonly number[], days: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < Math.min(days, byDay.length); i++) {
    sum += byDay[i] ?? 0;
    out.push(sum);
  }
  return out;
}

/** The smallest "round" number (1, 1.5, 2, 3, 4, 5, 6, 8, 10 times a power of ten) that is at least `value`. */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const unit = value / magnitude;
  const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => unit <= s + 1e-9) ?? 10;
  return step * magnitude;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** `M x y L x y ...` through the points. */
export function linePath(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

/** The same line closed down to a baseline, to fill the area under it. */
export function areaPath(points: readonly Pt[], baselineY: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points)} L${round(last.x)} ${round(baselineY)} L${round(first.x)} ${round(baselineY)} Z`;
}

/** Where a value sits on a box: x spread evenly over `count` slots, y from the bottom (0) to the top (`max`). */
export function plotPoints(values: readonly number[], box: { left: number; right: number; top: number; bottom: number; max: number; slots: number }): Pt[] {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  return values.map((v, i) => ({
    x: box.left + (box.slots > 1 ? (i / (box.slots - 1)) * width : 0),
    y: box.bottom - (box.max > 0 ? Math.min(1, Math.max(0, v / box.max)) : 0) * height,
  }));
}

export interface Arc {
  /** Visible length of the arc along the circle. */
  length: number;
  /** Where along the circle it starts. */
  offset: number;
}

/**
 * Splits a circle into one arc per share (shares add up to about 1), leaving `gap` between them.
 * An arc is never shorter than a sliver, so even a tiny share stays visible.
 */
export function donutArcs(shares: readonly number[], circumference: number, gap: number): Arc[] {
  const total = shares.reduce((a, s) => a + Math.max(0, s), 0);
  if (total <= 0) return [];
  const usable = circumference - gap * shares.length;
  let offset = 0;
  return shares.map((share) => {
    const length = Math.max(0.5, (Math.max(0, share) / total) * usable);
    const arc = { length, offset };
    offset += length + gap;
    return arc;
  });
}
