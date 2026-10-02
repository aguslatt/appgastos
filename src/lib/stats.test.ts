import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  categoryShifts,
  comparePace,
  completeMonthsBefore,
  computeMonthStats,
  groupByMonth,
  monthlyTotals,
  projectMonthEnd,
  type MonthStats,
} from './stats';
import type { Expense } from './types';

let n = 0;
const e = (date: string, amount: number, categoryId: string, extra: Partial<Expense> = {}): Expense => ({
  id: `x${n++}`,
  amount: amount * 100,
  categoryId,
  note: '',
  date,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

// 2026-10-15 is a Thursday; 2026-10-03 a Saturday.
const TODAY = '2026-10-15';
const sept = [
  e('2026-09-01', 400_000, 'hogar'),
  e('2026-09-05', 30_000, 'super'),
  e('2026-09-10', 5_000, 'transporte'),
  e('2026-09-14', 3_000, 'comida'),
  e('2026-09-20', 25_000, 'super'),
  e('2026-09-25', 8_000, 'ocio'),
  e('2026-09-30', 6_000, 'salud'),
];
const oct = [
  e('2026-10-01', 420_000, 'hogar'),
  e('2026-10-03', 32_000, 'super'),
  e('2026-10-08', 12_000, 'comida'),
  e('2026-10-12', 6_000, 'transporte'),
  e('2026-10-15', 2_500, 'comida'),
];

describe('computeMonthStats (current month)', () => {
  const s = computeMonthStats(oct, '2026-10', TODAY);

  it('totals and averages', () => {
    expect(s.status).toBe('current');
    expect(s.total).toBe(472_500_00);
    expect(s.count).toBe(5);
    expect(s.elapsedDays).toBe(15);
    expect(s.daysLeft).toBe(17); // 16th..31st plus today
    expect(s.dailyAverage).toBe(31_500_00);
    expect(s.todayTotal).toBe(2_500_00);
  });

  it('per day and per folder', () => {
    expect(s.byDay).toHaveLength(31);
    expect(s.byDay[0]).toBe(420_000_00);
    expect(s.byDay[14]).toBe(2_500_00);
    expect(s.byCategory.map((c) => c.categoryId)).toEqual(['hogar', 'super', 'comida', 'transporte']);
    expect(s.byCategory[0]?.share).toBeCloseTo(420_000 / 472_500);
    expect(s.byCategory.find((c) => c.categoryId === 'comida')).toMatchObject({ total: 14_500_00, count: 2 });
  });

  it('finds the biggest expense', () => {
    expect(s.biggest?.amount).toBe(420_000_00);
  });

  it('counts finished days without spending, never today', () => {
    // days 1..14 finished; spending on 1, 3, 8, 12 -> 10 empty days
    expect(s.noSpendDays).toBe(10);
    expect(s.longestNoSpendStreak).toBe(4); // 4th to 7th
  });

  it('splits weekend spending', () => {
    expect(s.weekendTotal).toBe(32_000_00); // the Saturday 3rd
  });

  it('counts weekday occurrences over finished days', () => {
    // 1..14 October 2026 = two full weeks: each weekday twice
    expect(s.weekdayDays).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(s.weekdayTotals[3]).toBe(432_000_00); // Thursdays 1st (rent) and 8th (food); the 15th is today, excluded
    expect(s.weekdayTotals[5]).toBe(32_000_00); // Saturday 3rd
  });
});

describe('computeMonthStats (other months)', () => {
  it('uses the whole month for a past month', () => {
    const s = computeMonthStats(sept, '2026-09', TODAY);
    expect(s.status).toBe('past');
    expect(s.elapsedDays).toBe(30);
    expect(s.daysLeft).toBe(0);
    expect(s.total).toBe(477_000_00);
    expect(s.dailyAverage).toBe(15_900_00);
    expect(s.todayTotal).toBe(0);
    expect(s.noSpendDays).toBe(30 - 7);
  });

  it('is empty and harmless for a future month', () => {
    const s = computeMonthStats([], '2026-11', TODAY);
    expect(s.status).toBe('future');
    expect(s.elapsedDays).toBe(0);
    expect(s.total).toBe(0);
    expect(s.dailyAverage).toBe(0);
    expect(s.noSpendDays).toBe(0);
    expect(s.biggest).toBeNull();
    expect(s.byCategory).toEqual([]);
  });

  it('handles day 1 of the current month', () => {
    const s = computeMonthStats([], '2026-10', '2026-10-01');
    expect(s.elapsedDays).toBe(1);
    expect(s.noSpendDays).toBe(0); // no finished days yet
    expect(s.daysLeft).toBe(31);
  });

  it('marks fixed (recurring) spending', () => {
    const s = computeMonthStats([e('2026-10-01', 1000, 'hogar', { recurringId: 'r1' }), e('2026-10-02', 500, 'super')], '2026-10', TODAY);
    expect(s.fixedTotal).toBe(1000_00);
  });
});

describe('comparePace', () => {
  const cur = computeMonthStats(oct, '2026-10', TODAY);

  it('compares against the same days of the previous month', () => {
    const pace = comparePace(cur, sept);
    // September up to the 15th: 400000 + 30000 + 5000 + 3000
    expect(pace?.previous).toBe(438_000_00);
    expect(pace?.delta).toBe(34_500_00);
    expect(pace?.pct).toBeCloseTo(34_500 / 438_000);
    expect(pace?.toDate).toBe(true);
  });

  it('compares whole months for a closed month', () => {
    const closedSept = computeMonthStats(sept, '2026-09', TODAY);
    const aug = [e('2026-08-10', 100_000, 'hogar')];
    const pace = comparePace(closedSept, aug);
    expect(pace).toMatchObject({ previous: 100_000_00, toDate: false });
    expect(pace?.pct).toBeCloseTo((477_000 - 100_000) / 100_000);
  });

  it('has no percentage when there is nothing to compare against', () => {
    expect(comparePace(cur, [])?.pct).toBeNull();
  });

  it('uses the whole shorter previous month on the 31st', () => {
    const cur31 = computeMonthStats(oct, '2026-10', '2026-10-31');
    expect(comparePace(cur31, sept)?.previous).toBe(477_000_00);
  });

  it('returns null for future months', () => {
    expect(comparePace(computeMonthStats([], '2026-12', TODAY), [])).toBeNull();
  });
});

describe('categoryShifts', () => {
  it('compares folder by folder over the same span', () => {
    const cur = computeMonthStats(oct, '2026-10', TODAY);
    const shifts = categoryShifts(cur, oct, sept);
    expect(shifts.find((s) => s.categoryId === 'super')).toMatchObject({ current: 32_000_00, previous: 30_000_00, delta: 2_000_00 });
    // September's cinema (25th) is outside the first 15 days, so it isn't compared yet
    expect(shifts.find((s) => s.categoryId === 'ocio')).toBeUndefined();
    expect(shifts.find((s) => s.categoryId === 'comida')?.pct).toBeCloseTo((14_500 - 3_000) / 3_000);
  });
});

describe('completeMonthsBefore', () => {
  it('lists earlier months that look fully tracked', () => {
    const by = groupByMonth([...sept, ...oct]);
    expect(completeMonthsBefore(by, '2026-10')).toEqual(['2026-09']);
  });

  it('skips a first month that started late', () => {
    const late = [e('2026-09-20', 1000, 'super'), ...oct];
    expect(completeMonthsBefore(groupByMonth(late), '2026-10')).toEqual([]);
  });

  it('returns the most recent first and at most the requested amount', () => {
    const many = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m) => e(`${m}-02`, 1000, 'super'));
    expect(completeMonthsBefore(groupByMonth([...many, ...oct]), '2026-10', 3)).toEqual(['2026-09', '2026-08', '2026-07']);
  });
});

describe('projectMonthEnd', () => {
  const stats = (list: Expense[], today: string): MonthStats => computeMonthStats(list, '2026-10', today);

  it('uses how earlier months continued after this day', () => {
    const cur = stats(oct, TODAY);
    const p = projectMonthEnd(cur, oct, [sept], 0);
    expect(p?.method).toBe('history');
    // September after the 15th: 25000 + 8000 + 6000 = 39000; this month runs ~7.9% faster -> factor ~1.039
    expect(p?.total).toBeGreaterThan(472_500_00 + 39_000_00);
    expect(p?.total).toBeLessThan(472_500_00 + 42_000_00);
  });

  it('is not fooled by rent paid early when there is history', () => {
    const cur = stats(oct, TODAY);
    const p = projectMonthEnd(cur, oct, [sept], 0);
    // a naive daily-average projection would say ~ 472500/15*31 = 976k
    expect(p?.total).toBeLessThan(600_000_00);
  });

  it('without history ignores one-off big purchases in the daily rate', () => {
    const list = [e('2026-10-01', 420_000, 'hogar'), ...Array.from({ length: 9 }, (_, i) => e(`2026-10-${String(i + 2).padStart(2, '0')}`, 10_000, 'super'))];
    const cur = stats(list, '2026-10-10');
    const p = projectMonthEnd(cur, list, [], 0);
    // rate = 90000 / 10 days; 21 days left; plus what's already spent (510000)
    expect(p).toEqual({ total: 699_000_00, method: 'rate' });
  });

  it('adds fixed expenses that are still due when extrapolating', () => {
    const list = Array.from({ length: 8 }, (_, i) => e(`2026-10-0${i + 1}`, 10_000, 'super'));
    const cur = stats(list, '2026-10-08');
    const p = projectMonthEnd(cur, list, [], 50_000_00);
    expect(p?.total).toBe(80_000_00 + Math.round((80_000_00 / 8) * 23) + 50_000_00);
  });

  it('stays quiet when there is too little data', () => {
    expect(projectMonthEnd(stats([e('2026-10-02', 100, 'super')], '2026-10-03'), [], [], 0)).toBeNull();
    expect(projectMonthEnd(computeMonthStats(sept, '2026-09', TODAY), sept, [], 0)).toBeNull();
  });

  it('is simply the total on the last day', () => {
    const cur = stats(oct, '2026-10-31');
    expect(projectMonthEnd(cur, oct, [sept], 0)?.total).toBe(cur.total);
  });
});

describe('budgetStatus', () => {
  const cur = computeMonthStats(oct, '2026-10', TODAY);

  it('reports what is left and what can be spent per day', () => {
    const b = budgetStatus(500_000_00, cur);
    expect(b?.remaining).toBe(27_500_00);
    expect(b?.pct).toBeCloseTo(0.945);
    expect(b?.level).toBe('close');
    expect(b?.perDay).toBe(1_617_00); // 27500 / 17 = 1617.6, rounded down to whole units
    expect(b?.paceAhead).toBe(true);
  });

  it('flags going over', () => {
    const b = budgetStatus(400_000_00, cur);
    expect(b?.level).toBe('over');
    expect(b?.remaining).toBe(-72_500_00);
    expect(b?.perDay).toBeNull();
  });

  it('is comfortable when well under', () => {
    expect(budgetStatus(2_000_000_00, cur)).toMatchObject({ level: 'ok', paceAhead: false });
  });

  it('is absent without a budget', () => {
    expect(budgetStatus(null, cur)).toBeNull();
    expect(budgetStatus(0, cur)).toBeNull();
  });
});

describe('monthlyTotals', () => {
  it('returns a continuous series, oldest first, with zeros for empty months', () => {
    const series = monthlyTotals(groupByMonth([...sept, ...oct]), '2026-10', 3);
    expect(series.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(series.map((m) => m.total)).toEqual([0, 477_000_00, 472_500_00]);
  });
});
