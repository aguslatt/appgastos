import { describe, expect, it } from 'vitest';
import { heatLevels } from './heat';

describe('heatLevels', () => {
  it('leaves empty days at 0', () => {
    expect(heatLevels([0, 0, 0])).toEqual([0, 0, 0]);
    expect(heatLevels([])).toEqual([]);
  });

  it('spreads five different days across the five shades', () => {
    expect(heatLevels([10, 20, 30, 40, 50])).toEqual([1, 2, 3, 4, 5]);
  });

  it('is not flattened by one huge day', () => {
    expect(heatLevels([100, 200, 300, 400, 1_000_000])).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps zero days at 0 among spending days', () => {
    expect(heatLevels([0, 10, 0, 20])).toEqual([0, 2, 0, 4]);
  });

  it('puts equal days in the middle', () => {
    expect(heatLevels([5, 5, 5])).toEqual([3, 3, 3]);
    expect(heatLevels([7])).toEqual([3]);
  });
});
