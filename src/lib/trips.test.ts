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

  describe('prices found for the trip itself', () => {
    it('uses a daily price found for a stop instead of the table', () => {
      const e = estimateTrip({ ...base, fxRate: 1, stops: [{ place: 'Madrid', days: 5, dailyUsd: 200 }] });
      expect(e.lines.find((l) => l.id === 'stay')?.amount).toBe(5 * 200 * 100);
    });

    it('prices a place that is not in the table with its own daily price, and no longer calls it unknown', () => {
      const e = estimateTrip({ ...base, fxRate: 1, stops: [{ place: 'Islandia', days: 4, dailyUsd: 250 }] });
      expect(e.unknown).toEqual([]);
      expect(e.lines.find((l) => l.id === 'stay')?.amount).toBe(4 * 250 * 100);
    });

    it('still reports the stops that have no price of their own', () => {
      const e = estimateTrip({ ...base, fxRate: 1, stops: [{ place: 'Islandia', days: 4, dailyUsd: 250 }, { place: 'Narnia', days: 2 }] });
      expect(e.unknown).toEqual(['Narnia']);
    });

    it('scales a daily price with people, days and the exchange rate', () => {
      const e = estimateTrip({ ...base, people: 2, fxRate: 1000, stops: [{ place: 'Lisboa', days: 3, dailyUsd: 90 }] });
      expect(e.lines.find((l) => l.id === 'stay')?.amount).toBe(90 * 3 * 2 * 1000 * 100);
    });

    it('ignores a daily price that is not a positive number', () => {
      const withBad = estimateTrip({ ...base, fxRate: 1, stops: [{ place: 'Madrid', days: 5, dailyUsd: 0 }] });
      const plain = estimateTrip({ ...base, fxRate: 1, stops: [{ place: 'Madrid', days: 5 }] });
      expect(withBad.total).toBe(plain.total);
    });

    it('uses the price of a transfer between stops instead of the table', () => {
      const e = estimateTrip({ ...base, fxRate: 1, people: 2, hopUsd: 100, stops: [{ place: 'Madrid', days: 3 }, { place: 'Roma', days: 3 }, { place: 'Paris', days: 3 }] });
      // 2 transfers x 100 USD x 2 people
      expect(e.lines.find((l) => l.id === 'hops')?.amount).toBe(2 * 100 * 2 * 100);
    });

    it('lets a transfer price of zero mean the transfers are free', () => {
      const e = estimateTrip({ ...base, fxRate: 1, hopUsd: 0, stops: [{ place: 'Madrid', days: 3 }, { place: 'Roma', days: 3 }] });
      expect(e.lines.some((l) => l.id === 'hops')).toBe(false);
    });

    it('falls back to the table when no transfer price is given', () => {
      const e = estimateTrip({ ...base, fxRate: 1, hopUsd: null, stops: [{ place: 'Madrid', days: 3 }, { place: 'Roma', days: 3 }] });
      expect(e.lines.find((l) => l.id === 'hops')?.amount).toBe(60 * 100);
    });
  });
});
