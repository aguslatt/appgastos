import { describe, expect, it } from 'vitest';
import { defaultCategories } from './categories';
import { generateDemo, generateDemoIncomes } from './demo';
import { isIncomeSourceId } from './incomeSources';
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

describe('generateDemoIncomes', () => {
  const incomes = (over: Partial<Parameters<typeof generateDemoIncomes>[0]> = {}) => generateDemoIncomes({ today: '2026-10-20', currency: 'ARS', ...over });
  const inMonth = (list: ReturnType<typeof incomes>, month: string) => list.filter((d) => d.date.startsWith(month));

  it('is deterministic for the same seed and differs for another', () => {
    expect(incomes()).toEqual(incomes());
    expect(incomes({ seed: 99 })).not.toEqual(incomes());
  });

  it('produces valid entries with real sources, inside the same four months, never in the future', () => {
    const drafts = incomes();
    expect(drafts.length).toBeGreaterThan(8);
    for (const d of drafts) {
      expect(isValidDateStr(d.date)).toBe(true);
      expect(d.date <= '2026-10-20').toBe(true);
      expect(d.date >= '2026-07-01').toBe(true);
      expect(Number.isInteger(d.amount) && d.amount > 0).toBe(true);
      expect(isIncomeSourceId(d.sourceId)).toBe(true);
    }
  });

  it('has a salary on the 5th of every month and some freelance work on top', () => {
    const drafts = incomes();
    for (const month of ['2026-07', '2026-08', '2026-09', '2026-10']) {
      const list = inMonth(drafts, month);
      expect(list.filter((d) => d.sourceId === 'sueldo').map((d) => d.date)).toEqual([`${month}-05`]);
      expect(list.some((d) => d.sourceId === 'freelance')).toBe(true);
    }
  });

  it('only records what has happened by today (no salary before the 5th)', () => {
    const early = generateDemoIncomes({ today: '2026-10-03', currency: 'ARS' });
    expect(inMonth(early, '2026-10')).toEqual([]);
    expect(inMonth(early, '2026-09').length).toBeGreaterThan(0);
  });

  it('scales amounts to the currency', () => {
    const total = (currency: string) => inMonth(incomes({ currency }), '2026-08').reduce((a, d) => a + d.amount, 0);
    expect(total('ARS')).toBeGreaterThan(total('USD') * 500);
    expect(total('USD')).toBeGreaterThan(500_00);
    expect(total('USD')).toBeLessThan(4_000_00);
  });

  it('tells a story next to the sample spending: most months leave something, one is tight', () => {
    const spent = generateDemo({ today: '2026-10-20', currency: 'ARS', categories });
    const balances = ['2026-07', '2026-08', '2026-09'].map(
      (m) => inMonth(incomes(), m).reduce((a, d) => a + d.amount, 0) - spent.filter((d) => d.date.startsWith(m)).reduce((a, d) => a + d.amount, 0),
    );
    expect(balances.filter((b) => b > 0).length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...balances)).toBeLessThan(Math.max(...balances) / 2);
  });
});
