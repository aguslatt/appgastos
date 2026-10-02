import { describe, expect, it } from 'vitest';
import { areaPath, cumulative, donutArcs, linePath, niceCeil, plotPoints } from './chart';

describe('cumulative', () => {
  it('adds up day by day', () => {
    expect(cumulative([5, 0, 10, 5], 4)).toEqual([5, 5, 15, 20]);
  });

  it('stops at the given number of days', () => {
    expect(cumulative([5, 5, 5, 5], 2)).toEqual([5, 10]);
  });

  it('does not invent days that are not in the data', () => {
    expect(cumulative([5, 5], 10)).toEqual([5, 10]);
    expect(cumulative([], 3)).toEqual([]);
    expect(cumulative([1, 2], 0)).toEqual([]);
  });
});

describe('niceCeil', () => {
  it.each([
    [1, 1],
    [1.01, 1.5],
    [1.4, 1.5],
    [1_738_600, 2_000_000],
    [2_140_000, 3_000_000],
    [900, 1000],
    [4_100_000, 5_000_000],
    [7_000_000, 8_000_000],
    [8_000_001, 10_000_000],
    [0.07, 0.08],
  ])('rounds %d up to %d', (value, expected) => {
    expect(niceCeil(value)).toBeCloseTo(expected, 10);
  });

  it('never goes below the value and never more than 1.5x above it', () => {
    for (let v = 1; v < 5_000_000; v = Math.ceil(v * 1.37)) {
      const c = niceCeil(v);
      expect(c).toBeGreaterThanOrEqual(v);
      expect(c / v).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  it('falls back to 1 for nothing, negatives and non-numbers', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
    expect(niceCeil(Number.NaN)).toBe(1);
    expect(niceCeil(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('paths', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 5.123, y: 4.5 },
    { x: 10, y: 0 },
  ];

  it('draws a line through the points', () => {
    expect(linePath(pts)).toBe('M0 10 L5.12 4.5 L10 0');
    expect(linePath([])).toBe('');
  });

  it('closes an area down to the baseline', () => {
    expect(areaPath(pts, 12)).toBe('M0 10 L5.12 4.5 L10 0 L10 12 L0 12 Z');
    expect(areaPath([], 12)).toBe('');
  });
});

describe('plotPoints', () => {
  const box = { left: 0, right: 100, top: 0, bottom: 50, max: 200, slots: 5 };

  it('spreads x evenly over the slots and puts the max at the top', () => {
    expect(plotPoints([0, 100, 200], box)).toEqual([
      { x: 0, y: 50 },
      { x: 25, y: 25 },
      { x: 50, y: 0 },
    ]);
  });

  it('clamps values to the box and survives a zero max', () => {
    expect(plotPoints([-5, 999], box).map((p) => p.y)).toEqual([50, 0]);
    expect(plotPoints([5], { ...box, max: 0 })[0]?.y).toBe(50);
  });

  it('puts a single slot at the left edge instead of dividing by zero', () => {
    expect(plotPoints([10], { ...box, slots: 1 })[0]?.x).toBe(0);
  });
});

describe('donutArcs', () => {
  it('gives every share an arc, in order, separated by the gap', () => {
    const arcs = donutArcs([0.5, 0.25, 0.25], 100, 4);
    expect(arcs).toHaveLength(3);
    expect(arcs[0]?.offset).toBe(0);
    for (let i = 1; i < arcs.length; i++) {
      const prev = arcs[i - 1];
      expect(arcs[i]?.offset).toBeCloseTo((prev?.offset ?? 0) + (prev?.length ?? 0) + 4, 9);
    }
  });

  it('fills the circle exactly: arcs plus gaps add up to the circumference', () => {
    const arcs = donutArcs([0.4, 0.3, 0.2, 0.1], 301.6, 3);
    const total = arcs.reduce((a, arc) => a + arc.length + 3, 0);
    expect(total).toBeCloseTo(301.6, 9);
  });

  it('keeps a tiny share visible', () => {
    expect(donutArcs([0.999999, 0.000001], 100, 2)[1]?.length).toBeGreaterThanOrEqual(0.5);
  });

  it('copes with nothing to draw', () => {
    expect(donutArcs([], 100, 2)).toEqual([]);
    expect(donutArcs([0, 0], 100, 2)).toEqual([]);
  });
});
