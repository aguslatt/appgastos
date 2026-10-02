import { describe, expect, it } from 'vitest';
import { defaultCategories } from './categories';
import { generateDemo } from './demo';
import { isValidDateStr } from './dates';
import { computeMonthStats, groupByMonth } from './stats';
import type { Expense } from './types';

const categories = defaultCategories();
const sample = (over: Partial<Parameters<typeof generateDemo>[0]> = {}) =>
  generateDemo({ today: '2026-10-20', currency: 'ARS', categories, ...over });

describe('generateDemo', () => {
  it('is deterministic for the same seed and differs for another', () => {
    expect(sample()).toEqual(sample());
    expect(sample({ seed: 99 })).not.toEqual(sample());
  });

  it('produces valid entries inside the last four months, never in the future', () => {
    const drafts = sample();
    expect(drafts.length).toBeGreaterThan(100);
    for (const d of drafts) {
      expect(isValidDateStr(d.date)).toBe(true);
      expect(d.date <= '2026-10-20').toBe(true);
      expect(d.date >= '2026-07-01').toBe(true);
      expect(Number.isInteger(d.amount) && d.amount > 0).toBe(true);
      expect(categories.some((c) => c.id === d.categoryId)).toBe(true);
    }
  });

  it('covers every month and a mix of folders', () => {
    const byMonth = groupByMonth(sample().map((d, i) => ({ ...d, id: String(i), createdAt: 0, updatedAt: 0 }) as Expense));
    expect([...byMonth.keys()].sort()).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    const folders = new Set(sample().map((d) => d.categoryId));
    expect(folders.size).toBeGreaterThanOrEqual(8);
  });

  it('only fills the current month up to today', () => {
    const early = generateDemo({ today: '2026-10-02', currency: 'ARS', categories });
    expect(early.filter((d) => d.date.startsWith('2026-10')).every((d) => d.date <= '2026-10-02')).toBe(true);
  });

  it('scales amounts to the currency', () => {
    const total = (currency: string) => {
      const list = sample({ currency }).map((d, i) => ({ ...d, id: String(i), createdAt: 0, updatedAt: 0 }) as Expense);
      return computeMonthStats(groupByMonth(list).get('2026-09') ?? [], '2026-09', '2026-10-20').total;
    };
    expect(total('ARS')).toBeGreaterThan(total('USD') * 500);
    expect(total('USD')).toBeGreaterThan(500_00); // a few hundred to ~1500 dollars a month
    expect(total('USD')).toBeLessThan(2_500_00);
  });

  it('falls back to "otros" when a folder kind is missing', () => {
    const onlyOtros = categories.filter((c) => c.id === 'otros');
    expect(sample({ categories: onlyOtros }).every((d) => d.categoryId === 'otros')).toBe(true);
  });
});
