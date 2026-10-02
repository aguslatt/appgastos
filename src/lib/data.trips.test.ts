import { describe, expect, it } from 'vitest';
import { normalizeData } from './data';

const normalizeTrip = (trip: unknown) => {
  const data = normalizeData(
    { expenses: [], goals: [{ id: 'g1', kind: 'trip', name: 'Europa', target: 100, deadline: '2027-03', trip }] },
    { makeId: () => 'id', today: '2026-10-02', language: 'es-AR' },
  );
  return data?.goals[0]?.trip;
};

describe('trip prices found by the AI, when loading saved data', () => {
  const base = { stops: [{ place: 'Madrid', days: 5 }], people: 2, style: 'mid' };

  it('keeps a daily price per stop and the transfer price', () => {
    const trip = normalizeTrip({ ...base, stops: [{ place: 'Madrid', days: 5, dailyUsd: 130 }], hopUsd: 55 });
    expect(trip?.stops).toEqual([{ place: 'Madrid', days: 5, dailyUsd: 130 }]);
    expect(trip?.hopUsd).toBe(55);
  });

  it('rounds prices to whole dollars', () => {
    const trip = normalizeTrip({ ...base, stops: [{ place: 'Madrid', days: 5, dailyUsd: 129.6 }], hopUsd: 54.4 });
    expect(trip?.stops[0]?.dailyUsd).toBe(130);
    expect(trip?.hopUsd).toBe(54);
  });

  it('leaves the fields out when nothing was found, so older goals stay as they were', () => {
    const trip = normalizeTrip(base);
    expect(trip?.stops).toEqual([{ place: 'Madrid', days: 5 }]);
    expect(trip).not.toHaveProperty('hopUsd');
  });

  it.each([
    ['zero', 0],
    ['negative', -20],
    ['absurdly high', 1_000_000],
    ['not a number', '130'],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('drops a daily price that is %s', (_name, value) => {
    const trip = normalizeTrip({ ...base, stops: [{ place: 'Madrid', days: 5, dailyUsd: value }], hopUsd: value });
    expect(trip?.stops[0]).toEqual({ place: 'Madrid', days: 5 });
    expect(trip).not.toHaveProperty('hopUsd');
  });
});
