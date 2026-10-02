import { describe, expect, it } from 'vitest';
import { PLACES, estimateTrip, findPlace, searchPlaces } from './trips';

describe('places', () => {
  it('has sane, ordered prices for every place', () => {
    expect(PLACES.length).toBeGreaterThan(40);
    for (const place of PLACES) {
      const [budget, mid, comfort] = place.daily;
      expect(budget, place.id).toBeGreaterThan(0);
      expect(budget, place.id).toBeLessThan(mid);
      expect(mid, place.id).toBeLessThan(comfort);
    }
    expect(new Set(PLACES.map((x) => x.id)).size).toBe(PLACES.length);
  });

  it('finds a place ignoring case, accents and aliases', () => {
    expect(findPlace('PARÍS')?.id).toBe('paris');
    expect(findPlace('rome')?.id).toBe('roma');
    expect(findPlace('Nueva York')?.id).toBe('nueva-york');
    expect(findPlace('Narnia')).toBeUndefined();
  });

  it('suggests places while typing, exact and prefix matches first', () => {
    expect(searchPlaces('ma').map((x) => x.id)).toContain('madrid');
    expect(searchPlaces('mad')[0]?.id).toBe('madrid');
    expect(searchPlaces('new yo')[0]?.id).toBe('nueva-york');
    expect(searchPlaces('m')).toEqual([]);
    expect(searchPlaces('zzzz')).toEqual([]);
  });
});

describe('estimateTrip', () => {
  const base = { people: 1, style: 'mid' as const, fxRate: 1500, buffer: 0 };

  it('adds flights and daily costs for a single stop', () => {
    // Madrid mid = 120 USD/day x 7 days = 840 USD; Europe flight 1100 USD; fx 1500
    const e = estimateTrip({ ...base, stops: [{ place: 'Madrid', days: 7 }] });
    expect(e.lines.find((l) => l.id === 'stay')?.amount).toBe(840 * 1500 * 100);
    expect(e.lines.find((l) => l.id === 'flights')?.amount).toBe(1100 * 1500 * 100);
    expect(e.total).toBe((840 + 1100) * 1500 * 100);
    expect(e.days).toBe(7);
    expect(e.unknown).toEqual([]);
  });

  it('adds hops between stops and scales with people and style', () => {
    const solo = estimateTrip({ ...base, stops: [{ place: 'Madrid', days: 4 }, { place: 'Roma', days: 4 }] });
    // hops: 1 x 60 USD
    expect(solo.lines.find((l) => l.id === 'hops')?.amount).toBe(60 * 1500 * 100);
    const duo = estimateTrip({ ...base, people: 2, stops: [{ place: 'Madrid', days: 4 }, { place: 'Roma', days: 4 }] });
    expect(duo.total).toBe(solo.total * 2);
    const cheap = estimateTrip({ ...base, style: 'budget', stops: [{ place: 'Madrid', days: 4 }, { place: 'Roma', days: 4 }] });
    expect(cheap.total).toBeLessThan(solo.total);
  });

  it('uses the most expensive region for the flight', () => {
    const e = estimateTrip({ ...base, stops: [{ place: 'Río de Janeiro', days: 3 }, { place: 'Madrid', days: 3 }] });
    expect(e.lines.find((l) => l.id === 'flights')?.amount).toBe(1100 * 1500 * 100);
  });

  it('lets the real flight price override the reference', () => {
    const e = estimateTrip({ ...base, people: 2, flightEach: 2_000_000_00, stops: [{ place: 'Madrid', days: 1 }] });
    expect(e.lines.find((l) => l.id === 'flights')?.amount).toBe(4_000_000_00);
  });

  it('adds extras and a margin on top', () => {
    const e = estimateTrip({ ...base, buffer: 0.1, extras: 100_000_00, stops: [{ place: 'Madrid', days: 5 }] });
    const subtotal = e.lines.filter((l) => l.id !== 'buffer').reduce((a, l) => a + l.amount, 0);
    expect(e.lines.find((l) => l.id === 'buffer')?.amount).toBe(Math.round(subtotal * 0.1));
    expect(e.total).toBe(subtotal + Math.round(subtotal * 0.1));
  });

  it('prices unknown places at the average and says so', () => {
    const e = estimateTrip({ ...base, stops: [{ place: 'Narnia', days: 5 }] });
    expect(e.unknown).toEqual(['Narnia']);
    expect(e.total).toBeGreaterThan(0);
  });

  it('ignores empty stops and bad numbers', () => {
    const e = estimateTrip({ ...base, people: 0, fxRate: 0, stops: [{ place: 'Madrid', days: 0 }, { place: 'Roma', days: 3 }] });
    expect(e.days).toBe(3);
    expect(e.lines.some((l) => l.id === 'hops')).toBe(false);
    expect(e.total).toBeGreaterThan(0);
  });

  it('works in dollars with a rate of 1', () => {
    const e = estimateTrip({ ...base, fxRate: 1, stops: [{ place: 'Madrid', days: 10 }] });
    expect(e.total).toBe((1200 + 1100) * 100);
  });
});
