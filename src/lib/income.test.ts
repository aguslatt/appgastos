// Tests for income.ts, incomeSources.ts and the generic schedule in recurring.ts. A test marked "BUG:" was
// written against a defect found in the source: the comment says what the right behaviour is.
import { describe, expect, it } from 'vitest';
import { isColorKey } from './categories';
import { addDays, addMonths, dateInMonth, isValidDateStr, monthKeyOf } from './dates';
import { computeMonthIncome, expectedIncome, flowSeries, groupIncomesByMonth, monthBalance, nextPaydays, sumIncomes, upcomingFixedIncome, type ExpectedIncome } from './income';
import { FALLBACK_INCOME_SOURCE_ID, INCOME_SOURCE_IDS, createIncomeSuggester, incomeSource, incomeSourceFolders, isIncomeSourceId, resolveIncomeSource } from './incomeSources';
import { nextDates, nextPayments, planRecurring, planSchedule, upcomingRecurringTotal, upcomingTotal, type Schedule } from './recurring';
import { groupByMonth } from './stats';
import type { Expense, Income, IncomeRule, Recurring } from './types';

// ---- helpers ----------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const int = (rng: () => number, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const income = (o: Partial<Income> = {}): Income => ({ id: 'i1', amount: 1000, sourceId: 'freelance', note: '', date: '2026-09-10', createdAt: 1, updatedAt: 1, ...o });
const rule = (o: Partial<IncomeRule> = {}): IncomeRule => ({
  id: 'r1', amount: 100_000, sourceId: 'sueldo', note: 'Sueldo', day: 5, startMonth: '2026-01', lastGenerated: null, active: true, ...o,
});
const expense = (o: Partial<Expense> = {}): Expense => ({ id: 'e1', amount: 500, categoryId: 'super', note: '', date: '2026-09-10', createdAt: 1, updatedAt: 1, ...o });
const TODAY = '2026-10-02';
const expect$ = (o: { incomes?: Income[]; rules?: IncomeRule[]; estimate?: number | null; today?: string }): ExpectedIncome =>
  expectedIncome({ incomes: o.incomes ?? [], rules: o.rules ?? [], estimate: o.estimate ?? null, today: o.today ?? TODAY });

// ---- sumIncomes / groupIncomesByMonth ------------------------------------------

describe('sumIncomes', () => {
  it('is 0 for nothing and the plain total otherwise', () => {
    expect(sumIncomes([])).toBe(0);
    expect(sumIncomes([income({ amount: 1 }), income({ amount: 2 }), income({ amount: 40 })])).toBe(43);
  });

  it('is exact up to the largest safe integer, ignores month and source, and accepts frozen input', () => {
    expect(sumIncomes([income({ amount: 3_000_000_000_000_000 }), income({ amount: 3_000_000_000_000_000 }), income({ amount: 3_000_000_000_000_000 })])).toBe(9_000_000_000_000_000);
    expect(sumIncomes([income({ amount: Number.MAX_SAFE_INTEGER - 1 }), income({ amount: 1 })])).toBe(Number.MAX_SAFE_INTEGER);
    expect(sumIncomes(deepFreeze([income({ amount: 5, date: '2020-01-01' }), income({ amount: 6, date: '2030-12-31', sourceId: 'venta' })]))).toBe(11);
  });
});

describe('groupIncomesByMonth', () => {
  it('groups by the month of the date, keeping first-seen month order and the order inside each month', () => {
    const list = [
      income({ id: 'a', date: '2026-12-31' }), income({ id: 'b', date: '2027-01-01' }), income({ id: 'c', date: '2028-02-29' }),
      income({ id: 'd', date: '2028-03-01' }), income({ id: 'e', date: '2028-02-01' }), income({ id: 'f', date: '2026-12-01' }),
    ];
    const grouped = groupIncomesByMonth(list);
    expect([...grouped.keys()]).toEqual(['2026-12', '2027-01', '2028-02', '2028-03']);
    expect(grouped.get('2026-12')!.map((i) => i.id)).toEqual(['a', 'f']);
    expect(grouped.get('2028-02')!.map((i) => i.id)).toEqual(['c', 'e']);
    expect(grouped.get('2027-01')![0]).toBe(list[1]);
  });

  it('is empty for nothing, does not return months it has no incomes for, and never mutates its input', () => {
    expect(groupIncomesByMonth([]).size).toBe(0);
    const frozen = deepFreeze([income({ date: '2026-05-05' })]);
    expect(groupIncomesByMonth(frozen).has('2026-04')).toBe(false);
    expect(groupIncomesByMonth(frozen).get('2026-05')).toHaveLength(1);
  });

  it('puts every income in exactly one group', () => {
    const rng = mulberry32(3);
    const grouped = groupIncomesByMonth(Array.from({ length: 500 }, (_, i) => income({ id: `i${i}`, date: addDays('2027-12-20', int(rng, 0, 90)) })));
    expect([...grouped.values()].reduce((n, g) => n + g.length, 0)).toBe(500);
    for (const [month, group] of grouped) for (const i of group) expect(monthKeyOf(i.date)).toBe(month);
  });
});

// ---- computeMonthIncome ---------------------------------------------------------

describe('computeMonthIncome', () => {
  const october = [
    income({ id: 'a', amount: 120_000_00, sourceId: 'sueldo', ruleId: 'r1', date: '2026-10-05' }),
    income({ id: 'b', amount: 30_000_00, sourceId: 'freelance', date: '2026-10-12' }),
    income({ id: 'c', amount: 50_000_00, sourceId: 'freelance', date: '2026-10-20' }),
    income({ id: 'd', amount: 7_000_00, sourceId: 'venta', date: '2026-10-21' }),
  ];
  const outside = [income({ id: 'x', amount: 999, date: '2026-09-30' }), income({ id: 'y', amount: 999, date: '2026-11-01' }), income({ id: 'z', amount: 999, date: '2025-10-15' })];

  it('adds up an ordinary month exactly, from frozen input, and is all zeros for a month without incomes', () => {
    const m = computeMonthIncome(deepFreeze([...outside, ...october].map((i) => ({ ...i }))), '2026-10');
    expect(m).toMatchObject({ month: '2026-10', total: 207_000_00, count: 4, fixed: 120_000_00, variable: 87_000_00 });
    expect(m.bySource.map((s) => [s.sourceId, s.total, s.count])).toEqual([['sueldo', 120_000_00, 1], ['freelance', 80_000_00, 2], ['venta', 7_000_00, 1]]);
    expect(m.bySource.map((s) => s.share)).toEqual([12_000_000 / 20_700_000, 8_000_000 / 20_700_000, 700_000 / 20_700_000]);
    expect(m.biggest).toMatchObject({ id: 'a' });
    expect(computeMonthIncome([], '2026-10')).toEqual({ month: '2026-10', total: 0, count: 0, fixed: 0, variable: 0, bySource: [], biggest: null });
    expect(computeMonthIncome(outside, '2026-10').count).toBe(0);
  });

  it.each([
    ['2026-10', '2026-09-30', false], ['2026-10', '2026-10-01', true], ['2026-10', '2026-10-31', true], ['2026-10', '2026-11-01', false], ['2026-10', '2025-10-15', false],
    ['2027-01', '2026-12-31', false], ['2027-01', '2027-01-01', true], ['2026-12', '2026-12-31', true], ['2026-12', '2027-01-01', false],
    ['2028-02', '2028-01-31', false], ['2028-02', '2028-02-01', true], ['2028-02', '2028-02-29', true], ['2028-02', '2028-03-01', false], ['2028-03', '2028-02-29', false],
  ])('in %s, the date %s is counted: %s', (month, date, counted) => {
    expect(computeMonthIncome([income({ date })], month).count).toBe(counted ? 1 : 0);
  });

  it('counts as fixed whatever came from a rule, and nothing else', () => {
    const list = [income({ id: 'a', amount: 10, ruleId: 'r1' }), income({ id: 'b', amount: 20, ruleId: 'r2', sourceId: 'venta' }), income({ id: 'c', amount: 40 })];
    expect(computeMonthIncome(list, '2026-09')).toMatchObject({ total: 70, fixed: 30, variable: 40 });
  });

  it('orders the sources by total, then by number of incomes', () => {
    const list = [
      income({ id: 'a', sourceId: 'regalo', amount: 100 }), income({ id: 'b', sourceId: 'venta', amount: 50 }), income({ id: 'c', sourceId: 'venta', amount: 50 }),
      income({ id: 'd', sourceId: 'sueldo', amount: 300 }), income({ id: 'e', sourceId: 'otros', amount: 1 }),
    ];
    expect(computeMonthIncome(list, '2026-09').bySource.map((s) => s.sourceId)).toEqual(['sueldo', 'venta', 'regalo', 'otros']);
  });

  it('picks the biggest income, and the later one when two are equal', () => {
    const list = [income({ id: 'a', amount: 500, date: '2026-09-02' }), income({ id: 'b', amount: 900, date: '2026-09-03' }), income({ id: 'c', amount: 900, date: '2026-09-20' }), income({ id: 'd', amount: 900, date: '2026-09-10' })];
    expect(computeMonthIncome(list, '2026-09').biggest!.id).toBe('c');
  });

  // BUG: with the same total and count, the order of `bySource` follows the order the incomes happened to
  // arrive in, so the same month can list its sources differently after an unrelated re-sort of the data.
  it('lists tied sources the same way whatever the order of the input', () => {
    const a = income({ id: 'a', sourceId: 'freelance', amount: 100 });
    const b = income({ id: 'b', sourceId: 'venta', amount: 100 });
    expect(computeMonthIncome([b, a], '2026-09').bySource.map((s) => s.sourceId)).toEqual(computeMonthIncome([a, b], '2026-09').bySource.map((s) => s.sourceId));
  });

  // BUG: two incomes with the same amount on the same date: `biggest` is whichever came first in the input.
  it('picks the same biggest income whatever the order of the input, ties included', () => {
    const tied = [income({ id: 'a', amount: 100, date: '2026-09-10', createdAt: 1 }), income({ id: 'b', amount: 100, date: '2026-09-10', createdAt: 2 }), income({ id: 'c', amount: 100, date: '2026-09-10', createdAt: 2 })];
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]]) expect(computeMonthIncome(order.map((k) => tied[k]!), '2026-09').biggest!.id).toBe('c');
    const [late, early] = [income({ id: 'a', amount: 7, createdAt: 9 }), income({ id: 'z', amount: 7, createdAt: 1 })];
    expect([computeMonthIncome([early, late], '2026-09').biggest!.id, computeMonthIncome([late, early], '2026-09').biggest!.id]).toEqual(['a', 'a']);
  });
});

describe('monthBalance', () => {
  it.each([
    [1000, 400, 600, 0.6], [1000, 1000, 0, 0], [1000, 1500, -500, -0.5], [1, 0, 1, 1], [0, 0, 0, null], [0, 300, -300, null], [250, 1000, -750, -3],
  ])('income %i and spent %i leave %i (kept %s)', (income$, spent, balance, keptShare) => {
    expect(monthBalance(income$, spent)).toEqual({ income: income$, spent, balance, keptShare });
    expect(Object.is(monthBalance(income$, spent).balance, -0)).toBe(false);
  });
});

describe('flowSeries', () => {
  const incomes = groupIncomesByMonth([income({ id: 'a', amount: 100, date: '2026-12-31' }), income({ id: 'b', amount: 40, date: '2026-12-01' }), income({ id: 'c', amount: 7, date: '2027-02-10' }), income({ id: 'd', amount: 1000, date: '2026-01-10' })]);
  const expenses = groupByMonth([expense({ id: 'a', amount: 30, date: '2027-01-15' }), expense({ id: 'b', amount: 5, date: '2027-02-28' }), expense({ id: 'c', amount: 9, date: '2027-03-01' })]);

  it('gives the months ending at endMonth, oldest first, zero where nothing happened; none for 0 months and just the end month for 1', () => {
    expect(flowSeries(incomes, expenses, '2027-02', 4)).toEqual([
      { month: '2026-11', income: 0, spent: 0 }, { month: '2026-12', income: 140, spent: 0 }, { month: '2027-01', income: 0, spent: 30 }, { month: '2027-02', income: 7, spent: 5 },
    ]);
    expect(flowSeries(incomes, expenses, '2027-02', 0)).toEqual([]);
    expect(flowSeries(incomes, expenses, '2027-02', 1)).toEqual([{ month: '2027-02', income: 7, spent: 5 }]);
  });

  it('crosses year ends and a leap February without skipping a month', () => {
    expect(flowSeries(new Map(), new Map(), '2028-03', 15).map((p) => p.month)).toEqual([
      '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12', '2028-01', '2028-02', '2028-03',
    ]);
  });
});

// ---- expectedIncome -------------------------------------------------------------

describe('expectedIncome', () => {
  const at = (date: string, amount: number, o: Partial<Income> = {}) => income({ id: `${date}-${amount}`, date, amount, ...o });

  describe('with nothing, or only the rough figure', () => {
    it('is unknown with nothing at all, uses the rough figure when it is all there is, and ignores one of 0, a negative or NaN', () => {
      expect(expect$({})).toEqual({ amount: null, basis: 'none', fixed: 0, variable: null });
      expect(expect$({ estimate: 500_000 })).toEqual({ amount: 500_000, basis: 'estimate', fixed: 0, variable: null });
      expect(expect$({ rules: [rule({ active: false })] })).toMatchObject({ amount: null, basis: 'none' });
      for (const estimate of [0, -5, Number.NaN]) expect(expect$({ estimate })).toEqual({ amount: null, basis: 'none', fixed: 0, variable: null });
    });
  });

  describe('fixed incomes', () => {
    it('adds up the active ones, ignores the paused ones, and takes over from the rough figure', () => {
      const rules = [rule({ amount: 100 }), rule({ id: 'r2', amount: 20, sourceId: 'otros' }), rule({ id: 'r3', amount: 999, active: false })];
      expect(expect$({ rules })).toEqual({ amount: 120, basis: 'fixed', fixed: 120, variable: null });
      expect(expect$({ rules, estimate: 5_000_000 }).amount).toBe(120);
    });

    // documents current behaviour (spec silent): a rule counts from the moment it exists, before its first month
    it('counts a rule that only starts in a later month', () => {
      expect(expect$({ rules: [rule({ amount: 70, startMonth: '2027-06' })] }).fixed).toBe(70);
    });
  });

  describe('what came in over earlier months', () => {
    it('averages the last three complete months', () => {
      const incomes = [at('2026-07-03', 1000), at('2026-08-15', 2000), at('2026-09-20', 3000)];
      expect(expect$({ incomes })).toEqual({ amount: 2000, basis: 'history', fixed: 0, variable: 2000 });
    });

    it('looks no further back than three months', () => {
      expect(expect$({ incomes: [at('2026-06-02', 9000), at('2026-07-03', 1000), at('2026-08-15', 2000), at('2026-09-20', 3000)] }).variable).toBe(2000);
    });

    it('counts a dry month after the first one as zero', () => {
      expect(expect$({ incomes: [at('2026-07-03', 3000)] }).variable).toBe(1000);
      expect(expect$({ incomes: [at('2026-07-03', 3000), at('2026-09-03', 3000)] }).variable).toBe(2000);
    });

    it('does not count the months before the first income as zero', () => {
      expect(expect$({ incomes: [at('2026-09-03', 3000)] }).variable).toBe(3000);
      expect(expect$({ incomes: [at('2026-08-03', 3000)] }).variable).toBe(1500);
    });

    it('trusts the first month only when its first income came in the first week', () => {
      expect(expect$({ incomes: [at('2026-09-07', 3000)] }).variable).toBe(3000);
      expect(expect$({ incomes: [at('2026-09-08', 3000)] })).toEqual({ amount: null, basis: 'none', fixed: 0, variable: null });
      expect(expect$({ incomes: [at('2026-08-20', 999), at('2026-09-10', 3000)] }).variable).toBe(3000);
      expect(expect$({ incomes: [at('2026-08-20', 999), at('2026-08-04', 1), at('2026-09-10', 3000)] }).variable).toBe(2000);
      expect(expect$({ incomes: [at('2026-09-20', 3000)], estimate: 777 })).toEqual({ amount: 777, basis: 'estimate', fixed: 0, variable: null });
    });

    it('never counts the month in progress, even on its last day, nor anything dated later', () => {
      const base = [at('2026-09-05', 1000)];
      for (const today of ['2026-10-01', '2026-10-31']) expect(expect$({ incomes: [...base, at('2026-10-01', 9999)], today }).variable).toBe(1000);
      expect(expect$({ incomes: [...base, at('2026-11-05', 9999), at('2027-05-05', 9999)] }).variable).toBe(1000);
      expect(expect$({ incomes: [at('2026-10-05', 9999), at('2026-11-05', 9999)], estimate: 5 })).toMatchObject({ amount: 5, basis: 'estimate' });
    });

    it('rounds the average to a whole number of cents, halves up', () => {
      expect(expect$({ incomes: [at('2026-07-03', 1000), at('2026-08-03', 1000), at('2026-09-03', 1001)] }).variable).toBe(1000);
      expect(expect$({ incomes: [at('2026-07-03', 1), at('2026-08-03', 1), at('2026-09-03', 2)] }).variable).toBe(1);
      expect(expect$({ incomes: [at('2026-08-03', 1), at('2026-09-03', 4)] }).variable).toBe(3);
    });

    // A stretch with nothing recorded says nothing about what is typical (the app may just not have been used),
    // so it is not an income of zero: the rough figure takes over, or nothing.
    it('does not read an empty stretch as an income of zero: the rough figure takes over, or nothing', () => {
      expect(expect$({ incomes: [at('2026-01-02', 5000)], estimate: 400 })).toEqual({ amount: 400, basis: 'estimate', fixed: 0, variable: 0 });
      expect(expect$({ incomes: [at('2026-01-02', 5000)] })).toEqual({ amount: null, basis: 'none', fixed: 0, variable: 0 });
    });

    it('a fixed income with an empty stretch next to it is just the fixed income', () => {
      expect(expect$({ rules: [rule({ amount: 100_000 })], incomes: [at('2026-01-02', 5000)] })).toEqual({ amount: 100_000, basis: 'fixed', fixed: 100_000, variable: 0 });
    });
  });

  describe('fixed and variable together', () => {
    it('adds what usually comes on top of the fixed incomes', () => {
      const incomes = [at('2026-08-03', 2000), at('2026-09-03', 2000)];
      expect(expect$({ rules: [rule({ amount: 100_000 })], incomes, estimate: 9_999_999 })).toEqual({ amount: 102_000, basis: 'mixed', fixed: 100_000, variable: 2000 });
      expect(expect$({ incomes, estimate: 9_999_999 }).amount).toBe(2000);
    });

    it('does not count what a rule recorded, with or without the rule', () => {
      const incomes = [at('2026-08-03', 777, { ruleId: 'gone' }), at('2026-09-03', 777, { ruleId: 'gone', sourceId: 'venta' })];
      expect(expect$({ incomes })).toEqual({ amount: null, basis: 'none', fixed: 0, variable: null });
      expect(expect$({ incomes, rules: [rule({ amount: 50, sourceId: 'otros' })] })).toMatchObject({ amount: 50, basis: 'fixed' });
    });

  });

  // A salary typed in by hand before it became a fixed income must not be counted twice: what a fixed income
  // covers is its own source, but only from the month it starts. Today is 2026-10-02 unless a test says otherwise.
  describe('what a fixed income already covers (its source, before its start month)', () => {
    const salary = (date: string, amount = 500_000) => at(date, amount, { sourceId: 'sueldo' });

    it('leaves out what was recorded by hand under its source before it started', () => {
      const incomes = [salary('2026-06-05'), salary('2026-07-05'), at('2026-09-04', 2000)];
      expect(expect$({ rules: [rule({ amount: 100_000, startMonth: '2026-08' })], incomes })).toEqual({ amount: 102_000, basis: 'mixed', fixed: 100_000, variable: 2000 });
      expect(expect$({ incomes }).variable).toBe(Math.round((2000 + 0 + 500_000) / 3));
    });

    it('counts what comes in under its source from the month it starts, the start month included, across a year end too', () => {
      const r = rule({ amount: 100_000, sourceId: 'freelance', startMonth: '2026-07' });
      expect(expect$({ rules: [r], incomes: [at('2026-06-30', 9_000_000), at('2026-07-01', 2000), at('2026-08-03', 4000), at('2026-09-03', 6000)] })).toEqual({ amount: 104_000, basis: 'mixed', fixed: 100_000, variable: 4000 });
      const january = rule({ amount: 100_000, sourceId: 'freelance', startMonth: '2027-01' });
      const incomes = [at('2026-12-31', 9_000_000), at('2027-01-02', 3000), at('2027-02-02', 6000)];
      expect(expect$({ rules: [january], incomes, today: '2027-03-15' }).variable).toBe(4500);
    });

    it('a fixed income that starts next month already covers this month\'s entry made by hand', () => {
      const entry = [salary('2026-10-05', 3000)];
      const today = '2026-11-20';
      expect(expect$({ rules: [rule({ amount: 100, startMonth: '2026-11' })], incomes: entry, today })).toEqual({ amount: 100, basis: 'fixed', fixed: 100, variable: null });
      expect(expect$({ rules: [rule({ amount: 100, startMonth: '2026-10' })], incomes: entry, today })).toEqual({ amount: 3100, basis: 'mixed', fixed: 100, variable: 3000 });
    });

    it('with two fixed incomes of the same source, the earlier start is the one that counts', () => {
      const incomes = [at('2026-06-03', 9000), at('2026-07-03', 1000), at('2026-08-03', 2000), at('2026-09-03', 3000)];
      const [late, early] = [rule({ id: 'late', amount: 10, sourceId: 'freelance', startMonth: '2026-09' }), rule({ id: 'early', amount: 20, sourceId: 'freelance', startMonth: '2026-07' })];
      expect(expect$({ rules: [late, early], incomes })).toEqual({ amount: 2030, basis: 'mixed', fixed: 30, variable: 2000 });
      expect([expect$({ rules: [early, late], incomes }).variable, expect$({ rules: [late], incomes }).variable, expect$({ rules: [early], incomes }).variable]).toEqual([2000, 3000, 2000]);
    });

    it('a paused fixed income covers nothing, and neither does one of another source', () => {
      const incomes = [salary('2026-07-03', 2000), salary('2026-08-03', 2000), salary('2026-09-03', 2000)];
      expect(expect$({ rules: [rule({ active: false, startMonth: '2026-09' })], incomes })).toEqual({ amount: 2000, basis: 'history', fixed: 0, variable: 2000 });
      expect(expect$({ rules: [rule({ sourceId: 'venta', amount: 7, startMonth: '2026-09' })], incomes })).toMatchObject({ amount: 2007, variable: 2000 });
    });
  });

  describe('around the end of a month and of a year', () => {
    it('looks across the year end: on January 1st the last complete months are December, November and October', () => {
      const incomes = [at('2026-10-05', 3000), at('2026-11-05', 6000), at('2026-12-31', 9000), at('2027-01-01', 99_999)];
      expect(expect$({ incomes, today: '2027-01-01' }).variable).toBe(6000);
      expect(expect$({ incomes, today: '2027-01-31' }).variable).toBe(6000);
      expect(expect$({ incomes, today: '2027-02-01' }).variable).toBe(Math.round((9000 + 99_999 + 6000) / 3));
    });

    it('counts February 29 as February, so it belongs to the last complete month on March 1st', () => {
      const incomes = [at('2028-01-04', 3000), at('2028-02-29', 6000)];
      expect(expect$({ incomes, today: '2028-03-01' }).variable).toBe(4500);
      expect(expect$({ incomes, today: '2028-02-29' }).variable).toBe(3000);
    });
  });

  describe('upcomingFixedIncome and nextPaydays', () => {
    it('upcomingFixedIncome adds what is due after today and not yet recorded, and nothing else', () => {
      const rules = [
        rule({ id: 'a', amount: 100, day: 15, lastGenerated: '2026-09' }), rule({ id: 'b', amount: 20, day: 28, lastGenerated: null, startMonth: '2026-10' }),
        rule({ id: 'c', amount: 3, day: 2, lastGenerated: '2026-09' }), rule({ id: 'd', amount: 7, day: 20, lastGenerated: '2026-10' }),
        rule({ id: 'e', amount: 9, day: 20, active: false, lastGenerated: '2026-09' }), rule({ id: 'f', amount: 11, day: 20, startMonth: '2026-11', lastGenerated: null }),
      ];
      expect(upcomingFixedIncome(rules, TODAY)).toBe(120);
      expect(upcomingFixedIncome([], TODAY)).toBe(0);
      const r = rule({ day: 31, lastGenerated: '2027-01', startMonth: '2027-01' });
      expect(upcomingFixedIncome([r], '2027-02-27')).toBe(100_000);
      expect(upcomingFixedIncome([r], '2027-02-28')).toBe(0);
      const leap = rule({ day: 31, lastGenerated: '2028-01', startMonth: '2028-01' });
      expect(upcomingFixedIncome([leap], '2028-02-28')).toBe(100_000);
      expect(upcomingFixedIncome([leap], '2028-02-29')).toBe(0);
      expect(upcomingFixedIncome([rule({ day: 31, lastGenerated: '2026-11' })], '2026-12-30')).toBe(100_000);
      expect(upcomingFixedIncome([rule({ day: 31, lastGenerated: '2026-11' })], '2026-12-31')).toBe(0);
    });

    it('nextPaydays lists the next date of each active rule, soonest first, then by note, as the very same rules', () => {
      const rules = [
        rule({ id: 'late', day: 30, note: 'Z', lastGenerated: '2026-09' }), rule({ id: 'b', day: 15, note: 'B', lastGenerated: '2026-09' }),
        rule({ id: 'paused', day: 3, active: false }), rule({ id: 'a', day: 15, note: 'A', lastGenerated: '2026-09' }),
        rule({ id: 'done', day: 1, note: 'C', lastGenerated: '2026-10' }), rule({ id: 'soon', day: 5, note: 'S', lastGenerated: '2026-09' }),
      ];
      const next = nextPaydays(rules, TODAY);
      expect(next.map((p) => `${p.rule.id}:${p.date}`)).toEqual(['soon:2026-10-05', 'a:2026-10-15', 'b:2026-10-15', 'late:2026-10-30', 'done:2026-11-01']);
      expect(next[0]!.rule).toBe(rules[5]);
    });

    it('nextPaydays clamps day 31 per month, uses February 29 in a leap year, crosses the year end, and is empty or late when there is nothing to show yet', () => {
      const r = rule({ day: 31, startMonth: '2026-01' });
      const date = (lastGenerated: string, today: string, rr = r) => nextPaydays([{ ...rr, lastGenerated }], today)[0]!.date;
      expect(date('2027-01', '2027-02-10')).toBe('2027-02-28');
      expect(date('2028-01', '2028-02-10')).toBe('2028-02-29');
      expect(date('2027-02', '2027-02-28')).toBe('2027-03-31');
      expect(date('2027-03', '2027-04-01')).toBe('2027-04-30');
      expect(date('2026-12', '2026-12-31')).toBe('2027-01-31');
      expect(date('2026-11', '2026-12-31', rule({ day: 5 }))).toBe('2027-01-05');
      expect(nextPaydays([], TODAY)).toEqual([]);
      expect(nextPaydays([rule({ active: false })], TODAY)).toEqual([]);
      expect(nextPaydays([rule({ day: 7, startMonth: '2027-01' })], TODAY)[0]!.date).toBe('2027-01-07');
    });
  });

  // BUG (low): nextDates steps a month past `lastGenerated` without looking at the end of the calendar: a valid-looking
  // lastGenerated of '9999-12' asks for the month '10000-01' and throws, so any screen listing the next paydays crashes.
  it('lists the next payday even when lastGenerated is the last month the calendar has', () => {
    expect(() => nextPaydays([rule({ lastGenerated: '9999-12' })], TODAY)).not.toThrow();
    expect(() => nextPayments([{ id: 'r', amount: 5, categoryId: 'hogar', note: '', day: 1, startMonth: '2026-01', lastGenerated: '9999-12', active: true }], TODAY)).not.toThrow();
  });

  // BUG: `Math.min(...days)` spreads every income of the first month as call arguments: a backup with enough
  // incomes in one month (about 150,000 here) throws RangeError, so every screen that asks for the expected income crashes.
  it('copes with a huge number of incomes in the first month', { timeout: 30_000 }, () => {
    const many = Array.from({ length: 200_000 }, (_, i) => income({ id: `i${i}`, amount: 1, date: '2026-07-03' }));
    expect(expect$({ incomes: many }).variable).toBe(Math.round(200_000 / 3));
  });
});

// ---- the fixed-income schedule: generic planSchedule / upcomingTotal / nextDates -------

describe('generic schedule (planSchedule, upcomingTotal, nextDates)', () => {
  it('plans a fixed income like a fixed expense: dated on its day, in order, and records where it got to', () => {
    const r = rule({ day: 31, startMonth: '2026-11' });
    const plan = planSchedule([r], '2027-03-31');
    expect(plan.due.map((d) => d.date)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
    expect(plan.due.every((d) => d.rule === r)).toBe(true);
    expect(plan.rules).toEqual([{ ...r, lastGenerated: '2027-03' }]);
    const two = [rule({ id: 'a', day: 20, lastGenerated: '2026-09' }), rule({ id: 'b', day: 1, lastGenerated: '2026-09' })];
    expect(upcomingTotal(two, TODAY)).toBe(100_000);
    expect(nextDates(two, TODAY).map((p) => `${p.rule.id}:${p.date}`)).toEqual(['a:2026-10-20', 'b:2026-11-01']);
  });

  it('returns rules it did not touch as the very same objects, and keeps the extra fields of those it did', () => {
    type Custom = Schedule & { tag: string; sourceId: string };
    const idle: Custom = { id: 'a', amount: 1, note: '', day: 1, startMonth: '2027-01', lastGenerated: null, active: true, tag: 'x', sourceId: 'sueldo' };
    const busy: Custom = { ...idle, id: 'b', startMonth: '2026-10', tag: 'y' };
    const paused: Custom = { ...idle, id: 'c', active: false, startMonth: '2020-01' };
    const plan = planSchedule([idle, busy, paused], '2026-10-15');
    expect(plan.rules[0]).toBe(idle);
    expect(plan.rules[2]).toBe(paused);
    expect(plan.rules[1]).toEqual({ ...busy, lastGenerated: '2026-10' });
    expect(plan.due.map((d) => d.rule.tag)).toEqual(['y']);
  });
});

// ---- the refactored expense wrappers must behave exactly as before -----------------------

/** The behaviour of recurring.ts before it was made generic (git HEAD), kept here as an oracle. */
const legacy = {
  plan(rules: readonly Recurring[], today: string) {
    const currentMonth = monthKeyOf(today);
    const drafts: Array<{ ruleId: string; date: string; amount: number; categoryId: string; note: string }> = [];
    const next = rules.map((rule) => {
      if (!rule.active) return rule;
      if (rule.lastGenerated !== null && rule.lastGenerated >= currentMonth) return rule;
      let month = rule.lastGenerated ? addMonths(rule.lastGenerated, 1) : rule.startMonth;
      if (month < rule.startMonth) month = rule.startMonth;
      let last = rule.lastGenerated;
      let guard = 0;
      while (month <= currentMonth && guard++ < 36) {
        const date = dateInMonth(month, rule.day);
        if (date > today) break;
        drafts.push({ ruleId: rule.id, date, amount: rule.amount, categoryId: rule.categoryId, note: rule.note });
        last = month;
        month = addMonths(month, 1);
      }
      return last === rule.lastGenerated ? rule : { ...rule, lastGenerated: last };
    });
    return { drafts, rules: next };
  },
  upcoming(rules: readonly Recurring[], today: string) {
    const month = monthKeyOf(today);
    let total = 0;
    for (const rule of rules) {
      if (!rule.active || rule.startMonth > month) continue;
      if (rule.lastGenerated !== null && rule.lastGenerated >= month) continue;
      if (dateInMonth(month, rule.day) > today) total += rule.amount;
    }
    return total;
  },
  next(rules: readonly Recurring[], today: string) {
    const out: Array<{ rule: Recurring; date: string }> = [];
    for (const rule of rules) {
      if (!rule.active) continue;
      let month = monthKeyOf(today);
      if (month < rule.startMonth) month = rule.startMonth;
      if (rule.lastGenerated !== null && rule.lastGenerated >= month) month = addMonths(rule.lastGenerated, 1);
      let date = dateInMonth(month, rule.day);
      if (date < today) date = dateInMonth(addMonths(month, 1), rule.day);
      out.push({ rule, date });
    }
    return out.sort((a, b) => (a.date === b.date ? a.rule.note.localeCompare(b.rule.note) : a.date < b.date ? -1 : 1));
  },
};

function randomRules(rng: () => number, today: string, maxMonthsBack = 45): Recurring[] {
  const month = monthKeyOf(today);
  return Array.from({ length: int(rng, 0, 4) }, (_, i) => ({
    id: `r${i}`, amount: int(rng, 1, 99_999), categoryId: pick(rng, ['hogar', 'servicios', 'otros']), note: pick(rng, ['A', 'B', 'Luz', 'luz', '']),
    day: pick(rng, [int(rng, 1, 31), int(rng, -3, 40), 29, 30, 31]), startMonth: addMonths(month, int(rng, -maxMonthsBack, 4)),
    lastGenerated: rng() < 0.4 ? null : addMonths(month, int(rng, -45, 5)), active: rng() < 0.85,
  }));
}

describe('planRecurring, upcomingRecurringTotal and nextPayments (refactored wrappers)', () => {
  it('behave exactly as the code they replaced, for 2000 random rule sets and days', { timeout: 30_000 }, () => {
    const rng = mulberry32(2024);
    const wrong: string[] = [];
    for (let n = 0; n < 2000; n++) {
      const today = addDays('2023-01-01', int(rng, 0, 1800));
      const rules = randomRules(rng, today);
      const label = JSON.stringify({ today, rules });
      const now = planRecurring(rules, today);
      const old = legacy.plan(rules, today);
      if (JSON.stringify(now) !== JSON.stringify(old)) wrong.push(`plan ${label}`);
      now.rules.forEach((r, i) => {
        if ((r === rules[i]) !== (old.rules[i] === rules[i])) wrong.push(`identity ${label}`);
      });
      if (upcomingRecurringTotal(rules, today) !== legacy.upcoming(rules, today)) wrong.push(`upcoming ${label}`);
      if (JSON.stringify(nextPayments(rules, today)) !== JSON.stringify(legacy.next(rules, today))) wrong.push(`next ${label}`);
    }
    expect(wrong).toEqual([]);
  });
});

// ---- randomized properties: month sums and the schedule ---------------------------------

function randomIncomes(rng: () => number, count: number, months: string[], distinctAmounts = false): Income[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `i${i}`, amount: distinctAmounts ? int(rng, 1, 400_000) * 64 + i : int(rng, 1, 900_000), sourceId: pick(rng, INCOME_SOURCE_IDS), note: '',
    date: dateInMonth(pick(rng, months), int(rng, 1, 31)), createdAt: int(rng, 0, 50), updatedAt: 0, ...(rng() < 0.25 ? { ruleId: `r${int(rng, 1, 3)}` } : {}),
  }));
}

describe('computeMonthIncome properties (3000 random months)', () => {
  it('keeps its books balanced, ignores other months and does not depend on the order of the input', { timeout: 30_000 }, () => {
    const rng = mulberry32(11);
    const months = ['2026-12', '2027-01', '2027-02', '2028-02', '2028-03'];
    const bad: string[] = [];
    for (let n = 0; n < 3000; n++) {
      const list = randomIncomes(rng, int(rng, 0, 18), months, true);
      const month = pick(rng, months);
      const m = computeMonthIncome(list, month);
      const mine = list.filter((i) => i.date.startsWith(month));
      const total = mine.reduce((s, i) => s + i.amount, 0);
      const fixed = mine.filter((i) => i.ruleId).reduce((s, i) => s + i.amount, 0);
      const label = `case ${n}`;
      if (m.total !== total || m.count !== mine.length || m.fixed !== fixed || m.fixed + m.variable !== m.total || m.variable < 0) bad.push(`${label}: totals`);
      if (m.bySource.reduce((s, x) => s + x.total, 0) !== total || m.bySource.reduce((s, x) => s + x.count, 0) !== mine.length) bad.push(`${label}: bySource sums`);
      if (total > 0 && Math.abs(m.bySource.reduce((s, x) => s + x.share, 0) - 1) > 1e-9) bad.push(`${label}: shares`);
      if (total === 0 && (m.bySource.length !== 0 || m.biggest !== null)) bad.push(`${label}: empty month`);
      if (m.bySource.some((x) => !(x.share > 0 && x.share <= 1))) bad.push(`${label}: share range`);
      if (new Set(m.bySource.map((x) => x.sourceId)).size !== m.bySource.length) bad.push(`${label}: source listed twice`);
      for (let k = 1; k < m.bySource.length; k++) {
        const [a, b] = [m.bySource[k - 1]!, m.bySource[k]!];
        if (!(a.total > b.total || (a.total === b.total && a.count >= b.count))) bad.push(`${label}: source order`);
      }
      if (mine.length > 0 && (!m.biggest || m.biggest.amount !== Math.max(...mine.map((i) => i.amount)) || !mine.includes(m.biggest))) bad.push(`${label}: biggest`);
      const again = computeMonthIncome(shuffled(rng, list), month);
      const key = (x: typeof m) => JSON.stringify({ ...x, bySource: [...x.bySource].sort((p, q) => p.sourceId.localeCompare(q.sourceId)) });
      if (key(again) !== key(m)) bad.push(`${label}: order of input`);
    }
    expect(bad).toEqual([]);
  });
});

describe('expectedIncome properties (4000 random situations)', () => {
  const idx = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

  /** The rules of the feature written out again, with month arithmetic on plain numbers. */
  function oracle(o: { incomes: Income[]; rules: IncomeRule[]; estimate: number | null; today: string }): ExpectedIncome {
    const current = idx(o.today);
    const active = o.rules.filter((r) => r.active);
    const fixed = active.reduce((s, r) => s + r.amount, 0);
    const coveredFrom = new Map<string, number>();
    for (const r of active) coveredFrom.set(r.sourceId, Math.min(coveredFrom.get(r.sourceId) ?? Infinity, idx(r.startMonth)));
    const mine = o.incomes.filter((i) => !i.ruleId && idx(i.date) >= (coveredFrom.get(i.sourceId) ?? -Infinity));
    let variable: number | null = null;
    if (mine.length > 0) {
      const first = Math.min(...mine.map((i) => idx(i.date)));
      if (first < current) {
        const firstDay = Math.min(...mine.filter((i) => idx(i.date) === first).map((i) => Number(i.date.slice(8, 10))));
        const usable: number[] = [];
        for (let m = current - 1; m >= first && usable.length < 3; m--) if (!(m === first && firstDay > 7)) usable.push(m);
        if (usable.length > 0) {
          const sum = usable.reduce((s, m) => s + mine.filter((i) => idx(i.date) === m).reduce((t, i) => t + i.amount, 0), 0);
          variable = Math.round(sum / usable.length);
        }
      }
    }
    const onTop = variable !== null && variable > 0 ? variable : null; // an empty stretch is not an income of zero
    if (fixed > 0 || onTop !== null) return { amount: fixed + (onTop ?? 0), basis: fixed > 0 && onTop !== null ? 'mixed' : fixed > 0 ? 'fixed' : 'history', fixed, variable };
    if (o.estimate !== null && o.estimate > 0) return { amount: o.estimate, basis: 'estimate', fixed, variable };
    return { amount: null, basis: 'none', fixed, variable };
  }

  function scenario(rng: () => number) {
    const today = addDays('2024-01-01', int(rng, 0, 1500));
    const current = monthKeyOf(today);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 9));
    const incomes = randomIncomes(rng, int(rng, 0, 14), months);
    const rules = Array.from({ length: int(rng, 0, 3) }, (_, i) =>
      rule({ id: `r${i}`, amount: int(rng, 1, 900_000), sourceId: pick(rng, INCOME_SOURCE_IDS), active: rng() < 0.7, startMonth: addMonths(current, int(rng, -6, 3)) }),
    );
    return { today, incomes, rules, estimate: rng() < 0.4 ? null : int(rng, 1, 900_000) };
  }

  it('agrees with an independent statement of the rules, and is never negative, NaN or fractional', { timeout: 30_000 }, () => {
    const rng = mulberry32(21);
    const bad: string[] = [];
    const seen: Record<string, number> = {};
    for (let n = 0; n < 4000; n++) {
      const s = scenario(rng);
      const got = expectedIncome(s);
      seen[got.basis] = (seen[got.basis] ?? 0) + 1;
      if (JSON.stringify(got) !== JSON.stringify(oracle(s))) bad.push(`${n}: ${JSON.stringify(got)} vs ${JSON.stringify(oracle(s))} for ${JSON.stringify(s)}`);
      if (got.amount !== null && !(Number.isInteger(got.amount) && got.amount >= 0)) bad.push(`${n}: amount ${got.amount}`);
      if (got.variable !== null && !(Number.isInteger(got.variable) && got.variable >= 0)) bad.push(`${n}: variable ${got.variable}`);
      if ((got.basis === 'none') !== (got.amount === null)) bad.push(`${n}: basis vs amount`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    for (const basis of ['none', 'estimate', 'fixed', 'history', 'mixed']) expect(seen[basis] ?? 0, `scenarios with basis ${basis}`).toBeGreaterThan(50);
  });

  it('does not depend on the order of incomes or rules, and does not mutate frozen input', () => {
    const rng = mulberry32(22);
    const bad: string[] = [];
    for (let n = 0; n < 1500; n++) {
      const s = scenario(rng);
      const base = JSON.stringify(expectedIncome(s));
      if (JSON.stringify(expectedIncome({ ...s, incomes: shuffled(rng, s.incomes), rules: shuffled(rng, s.rules) })) !== base) bad.push(`${n}: order`);
      const frozen = deepFreeze(JSON.parse(JSON.stringify(s)) as typeof s);
      if (JSON.stringify(expectedIncome(frozen)) !== base) bad.push(`${n}: frozen`);
      if (JSON.stringify(frozen) !== JSON.stringify(s)) bad.push(`${n}: mutated`);
    }
    expect(bad).toEqual([]);
  });

  it('adding a fixed income that hides nothing raises the expected amount by exactly its amount, and a paused one changes nothing', () => {
    const rng = mulberry32(23);
    const bad: string[] = [];
    let tried = 0;
    for (let n = 0; n < 2500; n++) {
      const s = { ...scenario(rng), estimate: null };
      const startMonth = addMonths(monthKeyOf(s.today), int(rng, -10, 3));
      // nothing is hidden when no fixed income covers the source yet and nothing of it was recorded before the new start
      const free = INCOME_SOURCE_IDS.filter((id) => !s.rules.some((r) => r.active && r.sourceId === id) && !s.incomes.some((i) => !i.ruleId && i.sourceId === id && monthKeyOf(i.date) < startMonth));
      if (free.length === 0) continue;
      tried++;
      const added = rule({ id: 'added', amount: int(rng, 1, 900_000), sourceId: pick(rng, free), startMonth });
      const before = expectedIncome(s);
      const after = expectedIncome({ ...s, rules: [...s.rules, added] });
      if (after.amount !== (before.amount ?? 0) + added.amount || after.fixed !== before.fixed + added.amount || after.variable !== before.variable) bad.push(`${n}`);
      if (JSON.stringify(expectedIncome({ ...s, rules: [...s.rules, { ...added, active: false }] })) !== JSON.stringify(before)) bad.push(`${n}: paused rule changed something`);
    }
    expect(bad).toEqual([]);
    expect(tried).toBeGreaterThan(1000);
  });

  it('adding any fixed income never lowers the expected amount, unless it replaces the rough figure or starts covering entries that were already there', () => {
    const rng = mulberry32(24);
    const bad: string[] = [];
    for (let n = 0; n < 2500; n++) {
      const s = { ...scenario(rng), estimate: null };
      const added = rule({ id: 'added', amount: int(rng, 1, 900_000), sourceId: pick(rng, INCOME_SOURCE_IDS), startMonth: addMonths(monthKeyOf(s.today), int(rng, -10, 3)) });
      const hides = !s.rules.some((r) => r.active && r.sourceId === added.sourceId) && s.incomes.some((i) => !i.ruleId && i.sourceId === added.sourceId && monthKeyOf(i.date) < added.startMonth);
      const before = expectedIncome(s);
      const after = expectedIncome({ ...s, rules: [...s.rules, added] });
      if (!hides && (after.amount ?? 0) < (before.amount ?? 0)) bad.push(`${n}: ${before.amount} -> ${after.amount}`);
    }
    expect(bad).toEqual([]);
  });

  it('only the last three complete months matter: nothing older than them (once the history reaches further back), nothing in the current month or later changes the result', () => {
    const rng = mulberry32(25);
    const bad: string[] = [];
    for (let n = 0; n < 1500; n++) {
      const s = scenario(rng);
      const current = monthKeyOf(s.today);
      const free = INCOME_SOURCE_IDS.filter((id) => !s.rules.some((r) => r.active && r.sourceId === id));
      // an income of a source no fixed income covers, eight months back: the history certainly starts before the window
      const anchor = income({ id: 'anchor', amount: int(rng, 1, 999_999), sourceId: pick(rng, free), date: dateInMonth(addMonths(current, -8), int(rng, 1, 28)) });
      const base = { ...s, incomes: [...s.incomes, anchor] };
      const before = JSON.stringify(expectedIncome(base));
      const noise = (k: number): Income => income({ id: `n${n}-${k}`, amount: int(rng, 1, 999_999), sourceId: pick(rng, INCOME_SOURCE_IDS), date: dateInMonth(addMonths(current, k), int(rng, 1, 28)) });
      if (JSON.stringify(expectedIncome({ ...base, incomes: [...base.incomes, noise(0), noise(1), noise(7)] })) !== before) bad.push(`${n}: later months`);
      if (JSON.stringify(expectedIncome({ ...base, incomes: [...base.incomes, noise(-8), noise(-7), noise(-6), noise(-5), noise(-4)] })) !== before) bad.push(`${n}: older months`);
    }
    expect(bad).toEqual([]);
  });

  it('is the same wherever the calendar is: shifting every date by whole months, across year ends and leap years, changes nothing', () => {
    const rng = mulberry32(27);
    const bad: string[] = [];
    for (let n = 0; n < 1500; n++) {
      const s = scenario(rng);
      const k = int(rng, -30, 30);
      const shift = (date: string): string => dateInMonth(addMonths(monthKeyOf(date), k), Number(date.slice(8, 10)));
      const moved = expectedIncome({ ...s, today: shift(s.today), incomes: s.incomes.map((i) => ({ ...i, date: shift(i.date) })), rules: s.rules.map((r) => ({ ...r, startMonth: addMonths(r.startMonth, k) })) });
      if (s.incomes.some((i) => Number(i.date.slice(8, 10)) > 28)) continue; // clamping a 29th-31st may legitimately move its day, never its month
      if (JSON.stringify(moved) !== JSON.stringify(expectedIncome(s))) bad.push(`${n}: shift ${k}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('schedule properties on fixed incomes (2000 random rule sets)', () => {
  it('records each month once, never in the future or before the start, is idempotent and splits "now" from "upcoming" cleanly', { timeout: 30_000 }, () => {
    const rng = mulberry32(31);
    const bad: string[] = [];
    for (let n = 0; n < 2000; n++) {
      const today = addDays('2024-01-01', int(rng, 0, 1500));
      const month = monthKeyOf(today);
      const rules = randomRules(rng, today, 30).map((r) => rule({ ...r, sourceId: pick(rng, INCOME_SOURCE_IDS) }));
      const label = `${n} ${today}`;
      const once = planSchedule(rules, today);
      const twice = planSchedule(once.rules, today);
      if (twice.due.length !== 0) bad.push(`${label}: second run recorded something`);
      const frozen = deepFreeze(clone(rules)); // planning, listing and totalling must work on frozen rules and give the same answers
      if (JSON.stringify(planSchedule(frozen, today)) !== JSON.stringify(once) || JSON.stringify(nextDates(frozen, today)) !== JSON.stringify(nextDates(rules, today)) || upcomingTotal(frozen, today) !== upcomingTotal(rules, today)) bad.push(`${label}: frozen`);
      const seen = new Set<string>();
      for (const { rule: r, date } of once.due) {
        const key = `${r.id}@${monthKeyOf(date)}`;
        if (seen.has(key)) bad.push(`${label}: ${key} twice`);
        seen.add(key);
        if (date > today || !isValidDateStr(date) || monthKeyOf(date) < r.startMonth) bad.push(`${label}: bad date ${date}`);
      }
      once.rules.forEach((r, i) => {
        const original = rules[i]!;
        if (r !== original && (r.lastGenerated === original.lastGenerated || r.id !== original.id || r.amount !== original.amount)) bad.push(`${label}: rule rewritten wrongly`);
        // each active rule's amount for this month is either recorded now, already recorded, or still upcoming, never two of them
        const recordedNow = once.due.some((d) => d.rule.id === r.id && monthKeyOf(d.date) === month);
        const upcoming = upcomingTotal([original], today) > 0;
        if (recordedNow && upcoming) bad.push(`${label}: ${r.id} both recorded and upcoming`);
      });
      for (const p of nextDates(once.rules, today)) if (!isValidDateStr(p.date) || p.date < today) bad.push(`${label}: next date ${p.date}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// ---- income sources -------------------------------------------------------------------

describe('income sources', () => {
  it('isIncomeSourceId is true for the ids only, and resolveIncomeSource turns anything else into "otros" without trimming or case folding', () => {
    for (const id of INCOME_SOURCE_IDS) expect([isIncomeSourceId(id), resolveIncomeSource(id)]).toEqual([true, id]);
    for (const v of ['nope', ' sueldo ', 'SUELDO', 'ventas', '', undefined, null, 0, 5, true, {}, ['sueldo'], new String('sueldo'), '__proto__', 'constructor', 'toString']) {
      expect([isIncomeSourceId(v), resolveIncomeSource(v)]).toEqual([false, 'otros']);
    }
  });

  it('has the seven fixed sources, "otros" last and as the fallback; incomeSource gives the display data of each, and "otros" for an unknown one', () => {
    expect([...INCOME_SOURCE_IDS, FALLBACK_INCOME_SOURCE_ID]).toEqual(['sueldo', 'freelance', 'venta', 'regalo', 'reintegro', 'inversiones', 'otros', 'otros']);
    expect(INCOME_SOURCE_IDS.map((id) => incomeSource(id).name)).toEqual(['Sueldo', 'Freelance', 'Ventas', 'Regalo', 'Reintegro', 'Inversiones', 'Otros']);
    expect(incomeSource('sueldo')).toEqual({ id: 'sueldo', name: 'Sueldo', emoji: '💼', color: 'green' });
    for (const bad of ['', 'nope', '__proto__', 'constructor', 'Sueldo']) expect(incomeSource(bad)).toEqual(incomeSource('otros'));
    expect(Object.keys(incomeSource('venta')).sort()).toEqual(['color', 'emoji', 'id', 'name']);
  });

  it('incomeSourceFolders are folder-shaped, in order, with valid and distinct colors, agree with incomeSource, and are fresh objects every time', () => {
    const folders = incomeSourceFolders();
    expect(folders.map((f) => f.id)).toEqual([...INCOME_SOURCE_IDS]);
    for (const f of folders) {
      expect(f).toEqual({ id: f.id, name: incomeSource(f.id).name, emoji: incomeSource(f.id).emoji, color: incomeSource(f.id).color, kind: f.id, flexible: false, limit: null, archived: false });
      expect(isColorKey(f.color)).toBe(true);
      expect(f.emoji.length).toBeGreaterThan(0);
    }
    expect(new Set(folders.map((f) => f.color)).size).toBe(folders.length);
    folders[0]!.name = 'tampered';
    folders.length = 0;
    expect([incomeSourceFolders()[0]!.name, incomeSource('sueldo').name]).toEqual(['Sueldo', 'Sueldo']);
  });

});

// ---- guessing the source ----------------------------------------------------------------

describe('createIncomeSuggester: keywords', () => {
  const s = createIncomeSuggester([]);
  const guess = (text: string) => s.suggest(text)?.sourceId ?? null;

  it.each<[string, string]>([
    ['Sueldo', 'sueldo'], ['SUELDO de octubre', 'sueldo'], ['salario', 'sueldo'], ['Haberes', 'sueldo'], ['Quincena', 'sueldo'], ['Aguinaldo', 'sueldo'], ['bono', 'sueldo'],
    ['Premio', 'sueldo'], ['Jubilación', 'sueldo'], ['pensión', 'sueldo'], ['beca', 'sueldo'], ['subsidio', 'sueldo'], ['Recibo de sueldo', 'sueldo'], ['pago mensual', 'sueldo'],
    ['freelance', 'freelance'], ['Free lance', 'freelance'], ['free-lance', 'freelance'], ['Cliente Martín', 'freelance'], ['proyecto web', 'freelance'], ['Factura 0001', 'freelance'],
    ['honorarios', 'freelance'], ['changa', 'freelance'], ['trabajito', 'freelance'], ['Consultoría', 'freelance'], ['Diseño de flyer', 'freelance'], ['desarrollo', 'freelance'],
    ['programación', 'freelance'], ['clase particular', 'freelance'], ['Edición de video', 'freelance'], ['Traducción', 'freelance'], ['fotografía', 'freelance'], ['sesión', 'freelance'],
    ['comisión', 'freelance'], ['presupuesto', 'freelance'],
    ['Venta', 'venta'], ['Vendí la bici', 'venta'], ['vendido', 'venta'], ['Mercado Libre', 'venta'], ['mercadolibre', 'venta'], ['marketplace', 'venta'], ['usado', 'venta'], ['OLX', 'venta'], ['wallapop', 'venta'],
    ['Regalo', 'regalo'], ['me regalaron', 'regalo'], ['Cumple', 'regalo'], ['cumpleaños', 'regalo'], ['mesada', 'regalo'], ['me dieron plata', 'regalo'], ['mamá', 'regalo'], ['papá', 'regalo'],
    ['abuela', 'regalo'], ['abuelo', 'regalo'], ['padres', 'regalo'],
    ['Reintegro', 'reintegro'], ['devolución', 'reintegro'], ['devolvieron', 'reintegro'], ['devolvió', 'reintegro'], ['reembolso', 'reintegro'], ['cashback', 'reintegro'], ['nota de crédito', 'reintegro'],
    ['me pagaron lo que me debían', 'reintegro'],
    ['Interés', 'inversiones'], ['dividendos', 'inversiones'], ['plazo fijo', 'inversiones'], ['rendimiento', 'inversiones'], ['ganancia', 'inversiones'], ['cripto', 'inversiones'],
    ['acciones', 'inversiones'], ['inversión', 'inversiones'], ['alquiler', 'inversiones'], ['renta', 'inversiones'], ['Airbnb', 'inversiones'], ['FCI', 'inversiones'],
    ['sueldos', 'sueldo'], ['bonos', 'sueldo'], ['becas', 'sueldo'], ['clases', 'freelance'], ['diseños', 'freelance'], ['consultorías', 'freelance'], ['usados', 'venta'], ['rentas', 'inversiones'],
  ])('reads %j as %s', (text, expected) => {
    expect(guess(text)).toBe(expected);
  });

  it('says what it read and where the guess came from', () => {
    expect(s.suggest('Vendí la bici')).toEqual({ sourceId: 'venta', matched: 'vendi', source: 'keyword' });
    expect(s.suggest('  Plazo   FIJO ')).toEqual({ sourceId: 'inversiones', matched: 'plazo fijo', source: 'keyword' });
    expect(s.suggest('Cumpleaños de Ana')).toEqual({ sourceId: 'regalo', matched: 'cumpleanos', source: 'keyword' });
    expect(s.suggest('Sueldos')).toEqual({ sourceId: 'sueldo', matched: 'sueldos', source: 'keyword' });
  });

  it('does not care about case, accents, surrounding blanks, punctuation or numbers', () => {
    for (const text of ['SUELDO', 'sueldo', 'SuElDo', ' sueldo ', 'sueldo.', '¡sueldo!', '(sueldo)', 'sueldo 2026', '2026 sueldo', 'sueldo #3', 'sueldó', '💰 sueldo 💰', '\u200bsueldo', '\uD800 sueldo']) {
      expect(guess(text)).toBe('sueldo');
    }
    expect(guess('İNTERÉS')).toBe('inversiones');
  });

  // BUG: Spanish plurals of words ending in -ión are -iones, but only a trailing "s" is folded, so
  // "sesiones" / "ediciones" / "pensiones" are never recognised although "sesión" / "edición" / "pensión" are.
  it.each<[string, string]>([
    ['sesiones de fotos', 'freelance'], ['3 sesiones', 'freelance'], ['ediciones de video', 'freelance'], ['traducciones', 'freelance'], ['programaciones', 'freelance'],
    ['pensiones', 'sueldo'], ['jubilaciones', 'sueldo'],
  ])('reads the plural %j as %s', (text, expected) => {
    expect(guess(text)).toBe(expected);
  });

  // BUG: the singular of a listed plural ("acciones") is not recognised.
  it('reads "acción" like "acciones"', () => {
    expect(guess('acción')).toBe('inversiones');
  });

  // BUG: multi-word phrases are matched literally, so their plurals are missed ("plazo fijo" works, "plazos fijos" does not).
  it.each<[string, string]>([['plazos fijos', 'inversiones'], ['notas de crédito', 'reintegro'], ['pagos mensuales', 'sueldo']])('reads the plural phrase %j as %s', (text, expected) => {
    expect(guess(text)).toBe(expected);
  });

  it('gives up (null, never "otros") on text it has no idea about', () => {
    for (const text of ['', '   ', '\n\t', '2026', '12.500,50', 'de la', 'xyzzy', 'hola que tal', '💰', '給料', 'שלום', '!!!', '...', '___']) expect(s.suggest(text)).toBeNull();
  });

  it('matches stems by prefix, but never a keyword that is only part of a word or of a phrase', () => {
    for (const [text, expected] of [['vendedor', 'venta'], ['vendiendo', 'venta'], ['facturado', 'freelance'], ['facturación', 'freelance'], ['criptomonedas', 'inversiones'], ['reintegros', 'reintegro'], ['reintegraron', 'reintegro'], ['regalito', 'regalo']] as const) expect(guess(text)).toBe(expected);
    // words that only start like a keyword are not that keyword: most keywords are whole words (plurals count), only a few are stems
    for (const text of ['sueldosity', 'presueldo', 'abonó', 'inventario', 'cumplir', 'clasificar', 'rentable', 'plazo fijoxyz', 'xplazo fijo', 'pagoxmensual', 'mercado libreria', 'nota de creditos2', 'ventana', 'ventaja', 'ventanilla', 'interesante', 'cumplen', 'clientela', 'clasecita']) expect(guess(text)).toBeNull();
    // the everyday words people use for work are covered
    for (const text of ['freelancer', 'laburo', 'laburito', 'un cliente', 'changas', 'honorarios', 'clases particulares']) expect(guess(text)).toBe('freelance');
  });

  // documents current behaviour (spec silent): the first source in the list that matches wins
  it('when a text names several sources, the earlier source in the list wins', () => {
    expect(guess('Venta del sueldo')).toBe('sueldo');
    expect(guess('cliente que me devolvió plata')).toBe('freelance');
    expect(guess('regalo de alquiler')).toBe('regalo');
  });

  it('survives hostile text without throwing, however long', { timeout: 60_000 }, () => {
    for (const text of ['\u0000', '\uD83D', '\uDE00\uD83D', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '\u202e sueldo', 'a'.repeat(1_000_000), 'sueldo '.repeat(200_000), '😀'.repeat(100_000), ' '.repeat(1_000_000), 'é'.repeat(300_000)]) {
      expect(() => s.suggest(text)).not.toThrow();
    }
    expect(s.suggest('sueldo '.repeat(200_000))?.sourceId).toBe('sueldo');
    expect(s.suggest('xyz '.repeat(200_000))).toBeNull();
    expect(s.suggest(`${'x '.repeat(50_000)}vendi`)?.sourceId).toBe('venta');
  });
});

describe('createIncomeSuggester: learning from past incomes', () => {
  const past = (note: string, sourceId: string, createdAt: number, o: Partial<Income> = {}): Income => income({ id: `p${createdAt}-${note}`, note, sourceId, createdAt, ...o });

  it('answers with what the same words were filed under before, ahead of any keyword, but needs all the words in the same order', () => {
    const s = createIncomeSuggester([past('Cliente Martín', 'venta', 1)]);
    expect(s.suggest('cliente martin')).toEqual({ sourceId: 'venta', matched: 'cliente martin', source: 'history' });
    expect(s.suggest('  CLIENTE   MARTÍN  ')).toEqual({ sourceId: 'venta', matched: 'CLIENTE   MARTÍN', source: 'history' });
    for (const text of ['Cliente', 'Martín cliente', 'Cliente Martín López']) expect(s.suggest(text)).toMatchObject({ source: 'keyword' });
  });

  it('matches on the content words: case, accents, plurals, numbers and filler words do not matter', () => {
    const s = createIncomeSuggester([past('Clase de piano', 'regalo', 1)]);
    for (const text of ['clase piano', 'CLASES de PIANO', 'la clase del piano 3', 'clásé  piáno 2026']) expect(s.suggest(text)).toMatchObject({ sourceId: 'regalo', source: 'history' });
  });

  it('the latest income wins, whatever order the list comes in', () => {
    const list = [past('Trabajo X', 'venta', 1), past('trabajo x', 'regalo', 2), past('TRABAJO X', 'reintegro', 3)];
    expect(createIncomeSuggester(list).suggest('trabajo x')?.sourceId).toBe('reintegro');
    expect(createIncomeSuggester([...list].reverse()).suggest('trabajo x')?.sourceId).toBe('reintegro');
    expect(createIncomeSuggester([list[2]!, list[0]!, list[1]!]).suggest('trabajo x')?.sourceId).toBe('reintegro');
  });

  // documents current behaviour (spec silent): with the same createdAt the one later in the list wins
  it('with the same creation time, the later one in the list wins', () => {
    expect(createIncomeSuggester([past('Obra', 'venta', 5), past('obra', 'regalo', 5)]).suggest('obra')?.sourceId).toBe('regalo');
    expect(createIncomeSuggester([past('obra', 'regalo', 5), past('Obra', 'venta', 5)]).suggest('obra')?.sourceId).toBe('venta');
  });

  it('learns from incomes that came from a rule or from demo data too, and from "otros"; a source that is not one of ours is learned as "otros"', () => {
    expect(createIncomeSuggester([past('Bonus raro', 'sueldo', 1, { ruleId: 'r' })]).suggest('bonus raro')?.sourceId).toBe('sueldo');
    expect(createIncomeSuggester([past('Cliente fijo', 'otros', 1, { demo: true })]).suggest('cliente fijo')).toMatchObject({ sourceId: 'otros', source: 'history' });
    expect(createIncomeSuggester([past('Algo raro', 'zzz', 1)]).suggest('algo raro')?.sourceId).toBe('otros');
  });

  it('ignores incomes without a note, and notes made only of filler or numbers', () => {
    const s = createIncomeSuggester([past('', 'venta', 1), past('   ', 'venta', 2), past('de la', 'venta', 3), past('2026', 'venta', 4), past('!!!', 'venta', 5)]);
    for (const text of ['', '   ', 'de la', '2026', '!!!']) expect(s.suggest(text)).toBeNull();
  });

  it('is a snapshot: later changes to the list do not change what it knows, and the list is left alone', () => {
    const list = [past('Cliente Martín', 'venta', 2), past('Cliente Martín', 'regalo', 1)];
    const s = createIncomeSuggester(list);
    list.push(past('Cliente Martín', 'sueldo', 9));
    list[0]!.sourceId = 'otros';
    expect(s.suggest('cliente martin')?.sourceId).toBe('venta');
    const frozen = deepFreeze([past('a b c', 'venta', 2), past('x y z', 'regalo', 1)]);
    expect(() => createIncomeSuggester(frozen)).not.toThrow();
    expect(frozen.map((i) => i.createdAt)).toEqual([2, 1]);
  });
});

describe('createIncomeSuggester: random text (3000 strings)', () => {
  const pieces = [
    'sueldo', 'cliente', 'venta', 'vendi', 'regalo', 'devolución', 'interés', 'plazo fijo', 'diseño', 'clases', 'mamá', 'xyz', 'hola', 'de', 'la', '12', '2026', '$', '¡', '!', '-', '_', '😀', '💰',
    '\u200b', 'ñandú', 'Ünï', 'mercado libre', 'free lance', 'nota de crédito', '\n', '\t', '  ', '__proto__', 'constructor',
  ];

  it('never throws, answers null or a real source, repeats itself, and ignores case, accents and numbers around the text', { timeout: 30_000 }, () => {
    const rng = mulberry32(41);
    const s = createIncomeSuggester([income({ id: 'h', note: 'Trabajo X', sourceId: 'regalo', createdAt: 1 })]);
    const stripAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const bad: string[] = [];
    for (let n = 0; n < 3000; n++) {
      const text = Array.from({ length: int(rng, 0, 7) }, () => pick(rng, pieces)).join(pick(rng, [' ', '', '  ', ', ']));
      const label = JSON.stringify(text);
      const got = s.suggest(text);
      if (got !== null && !isIncomeSourceId(got.sourceId)) bad.push(`${label}: odd source ${got.sourceId}`);
      if (JSON.stringify(s.suggest(text)) !== JSON.stringify(got)) bad.push(`${label}: not repeatable`);
      if (s.suggest(text.toUpperCase())?.sourceId !== got?.sourceId) bad.push(`${label}: case matters`);
      if (s.suggest(stripAccents(text))?.sourceId !== got?.sourceId) bad.push(`${label}: accents matter`);
      if (s.suggest(`  ${text}\n`)?.sourceId !== got?.sourceId) bad.push(`${label}: surrounding blanks matter`);
      if (s.suggest(`${int(rng, 0, 999)} ${text}`)?.sourceId !== got?.sourceId) bad.push(`${label}: a leading number matters`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
