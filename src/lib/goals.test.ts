import { describe, expect, it } from 'vitest';
import { defaultCategories } from './categories';
import {
  computeCapacity,
  expectedSaved,
  extendOptions,
  goalStatus,
  isDone,
  monthDiff,
  monthsLeft,
  moveCosts,
  monthSignal,
  moveImpact,
  progress,
  remaining,
  requiredPerMonth,
  suggestCuts,
  totalRequired,
  type Goal,
  type MovePlan,
} from './goals';
import type { Expense } from './types';

const TODAY = '2026-10-02';
let n = 0;
const spend = (date: string, amount: number, categoryId = 'super'): Expense => ({
  id: `g${n++}`, amount: amount * 100, categoryId, note: '', date, createdAt: 0, updatedAt: 0,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  kind: 'trip',
  name: 'Europa',
  emoji: '✈️',
  target: 3_000_000_00,
  deadline: '2027-03',
  saved: 600_000_00,
  createdAt: new Date(2026, 6, 15, 12).getTime(), // 15 July 2026, local
  ...over,
});

// Three complete months of 1,000,000 each.
const history = ['2026-07', '2026-08', '2026-09'].flatMap((m) => [spend(`${m}-01`, 600_000, 'super'), spend(`${m}-10`, 200_000, 'comida'), spend(`${m}-20`, 100_000, 'ocio'), spend(`${m}-25`, 100_000, 'transporte')]);

describe('time and progress', () => {
  it('counts months between month keys', () => {
    expect(monthDiff('2026-10', '2027-03')).toBe(5);
    expect(monthDiff('2026-12', '2027-01')).toBe(1);
    expect(monthDiff('2027-03', '2026-10')).toBe(-5);
  });

  it('counts the months left to save, never negative', () => {
    expect(monthsLeft('2027-03', TODAY)).toBe(5);
    expect(monthsLeft('2026-11', TODAY)).toBe(1);
    expect(monthsLeft('2026-10', TODAY)).toBe(0);
    expect(monthsLeft('2026-01', TODAY)).toBe(0);
  });

  it('computes what is left and how far along it is', () => {
    const g = goal();
    expect(remaining(g)).toBe(2_400_000_00);
    expect(progress(g)).toBeCloseTo(0.2);
    expect(isDone(g)).toBe(false);
    expect(isDone(goal({ saved: 3_000_000_00 }))).toBe(true);
    expect(remaining(goal({ saved: 4_000_000_00 }))).toBe(0);
    expect(progress(goal({ saved: 4_000_000_00 }))).toBe(1);
  });

  it('splits the remainder over the months left, rounding up', () => {
    expect(requiredPerMonth(goal(), TODAY)).toBe(480_000_00);
    expect(requiredPerMonth(goal({ target: 1_000_00, saved: 0, deadline: '2026-12' }), TODAY)).toBe(50_000);
    expect(requiredPerMonth(goal({ saved: 3_000_000_00 }), TODAY)).toBe(0);
  });

  it('asks for everything at once when the date is here or has passed', () => {
    expect(requiredPerMonth(goal({ deadline: '2026-10' }), TODAY)).toBe(2_400_000_00);
    expect(requiredPerMonth(goal({ deadline: '2026-05' }), TODAY)).toBe(2_400_000_00);
  });

  it('expects equal steps since the goal was created', () => {
    // created July, deadline March: 8 months, 3 elapsed
    expect(expectedSaved(goal(), TODAY)).toBe(1_125_000_00);
    expect(expectedSaved(goal({ createdAt: new Date(2026, 9, 1).getTime() }), TODAY)).toBe(0);
    expect(expectedSaved(goal({ deadline: '2026-09' }), TODAY)).toBe(3_000_000_00);
  });
});

describe('computeCapacity', () => {
  it('learns typical spending from the last complete months', () => {
    const c = computeCapacity({ expenses: history, today: TODAY, income: 1_600_000_00, projection: null });
    expect(c.basis).toBe('history');
    expect(c.avgSpend).toBe(1_000_000_00);
    expect(c.free).toBe(600_000_00);
    expect(c.perFolder.get('comida')).toBe(200_000_00);
    expect(c.perFolder.get('super')).toBe(600_000_00);
  });

  it('falls back to this month\'s projection when there is no history', () => {
    const c = computeCapacity({ expenses: [], today: TODAY, income: 1_600_000_00, projection: 900_000_00 });
    expect(c).toMatchObject({ basis: 'projection', avgSpend: 900_000_00, free: 700_000_00 });
  });

  it('does not know the free room without income or without any spending data', () => {
    expect(computeCapacity({ expenses: history, today: TODAY, income: null, projection: null }).free).toBeNull();
    expect(computeCapacity({ expenses: [], today: TODAY, income: 1_000_00, projection: null })).toMatchObject({ basis: 'none', avgSpend: null, free: null });
  });
});

describe('goalStatus', () => {
  const cap = computeCapacity({ expenses: history, today: TODAY, income: 1_600_000_00, projection: null });

  it('is ok when the monthly effort fits comfortably', () => {
    const s = goalStatus(goal(), cap, 0, TODAY);
    expect(s).toMatchObject({ level: 'ok', requiredPerMonth: 480_000_00, monthsLeft: 5, shortfall: 0 });
    expect(s.shareOfFree).toBeCloseTo(0.8);
  });

  it('is tight when it takes nearly all the free room', () => {
    expect(goalStatus(goal(), cap, 100_000_00, TODAY).level).toBe('tight');
  });

  it('is off, with the missing amount, when it does not fit', () => {
    const s = goalStatus(goal(), cap, 300_000_00, TODAY);
    expect(s.level).toBe('off');
    expect(s.shortfall).toBe(180_000_00);
  });

  it('is off when nothing is left over at all', () => {
    const broke = computeCapacity({ expenses: history, today: TODAY, income: 900_000_00, projection: null });
    const s = goalStatus(goal(), broke, 0, TODAY);
    expect(s.level).toBe('off');
    expect(s.shortfall).toBe(480_000_00);
  });

  it('is unknown without income, and done when reached', () => {
    const noIncome = computeCapacity({ expenses: history, today: TODAY, income: null, projection: null });
    expect(goalStatus(goal(), noIncome, 0, TODAY).level).toBe('unknown');
    expect(goalStatus(goal({ saved: 3_000_000_00 }), cap, 0, TODAY)).toMatchObject({ level: 'done', requiredPerMonth: 0 });
  });

  it('reports how far behind the equal-steps schedule it is', () => {
    expect(goalStatus(goal(), cap, 0, TODAY).behindBy).toBe(525_000_00);
    expect(goalStatus(goal({ saved: 2_000_000_00 }), cap, 0, TODAY).behindBy).toBe(0);
  });
});

describe('totalRequired', () => {
  it('adds up the active goals only', () => {
    const goals = [goal(), goal({ id: 'g2', target: 600_000_00, saved: 0, deadline: '2026-12' }), goal({ id: 'g3', saved: 3_000_000_00 })];
    expect(totalRequired(goals, TODAY)).toBe(480_000_00 + 300_000_00);
  });
});

describe('suggestCuts', () => {
  const cats = defaultCategories();
  const perFolder = new Map([['comida', 200_000_00], ['ocio', 100_000_00], ['super', 300_000_00]]);

  it('trims the biggest trimmable folders first and ignores essentials', () => {
    const plan = suggestCuts(50_000_00, perFolder, cats);
    expect(plan.cuts.map((c) => c.categoryId)).toEqual(['comida', 'ocio']);
    expect(plan.cuts[0]).toMatchObject({ pct: 0.3, monthly: 60_000_00 });
    expect(plan.cuts[1]).toMatchObject({ pct: 0.15, monthly: 15_000_00 });
    expect(plan.covered).toBe(75_000_00);
    expect(plan.gap).toBe(0);
  });

  it('stops at a small trim when that is enough', () => {
    const plan = suggestCuts(20_000_00, perFolder, cats);
    expect(plan.cuts).toEqual([{ categoryId: 'comida', pct: 0.15, monthly: 30_000_00 }]);
  });

  it('says what is still missing when trimming is not enough', () => {
    const plan = suggestCuts(500_000_00, perFolder, cats);
    expect(plan.covered).toBe(90_000_00);
    expect(plan.gap).toBe(410_000_00);
  });

  it('suggests nothing when nothing is needed or nothing is trimmable', () => {
    expect(suggestCuts(0, perFolder, cats)).toEqual({ cuts: [], covered: 0, gap: 0 });
    expect(suggestCuts(10_000_00, new Map([['super', 100_00]]), cats).cuts).toEqual([]);
  });
});

describe('extendOptions', () => {
  it('shows what pushing the date back does to the monthly effort', () => {
    const options = extendOptions(goal(), TODAY);
    expect(options.map((o) => o.deadline)).toEqual(['2027-05', '2027-07', '2027-09']);
    expect(options.map((o) => o.perMonth)).toEqual([Math.ceil(2_400_000_00 / 7), Math.ceil(2_400_000_00 / 9), Math.ceil(2_400_000_00 / 11)]);
  });

  it('has nothing to offer for a finished goal', () => {
    expect(extendOptions(goal({ saved: 3_000_000_00 }), TODAY)).toEqual([]);
  });
});

describe('moving', () => {
  const plan: MovePlan = { zone: 'Caballito', rent: 400_000_00, monthlyExtras: 80_000_00, depositMonths: 1, commissionMonths: 1, advanceMonths: 1, setup: 300_000_00, currentMonthly: 350_000_00 };

  it('adds up what is needed up front and what changes every month', () => {
    expect(moveCosts(plan)).toEqual({ upfront: 1_500_000_00, newMonthly: 480_000_00, monthlyChange: 130_000_00 });
  });

  it('shows the share of income and how much the rest of the spending must shrink', () => {
    const cap = computeCapacity({ expenses: history, today: TODAY, income: 1_600_000_00, projection: null });
    const easy = moveImpact(plan, cap, 300_000_00);
    expect(easy.newSpend).toBe(1_130_000_00);
    expect(easy.housingShare).toBeCloseTo(0.3);
    expect(easy.cutNeeded).toBe(0);
    expect(moveImpact(plan, cap, 600_000_00).cutNeeded).toBe(130_000_00);
  });

  it('falls back to the plain monthly increase without income', () => {
    const cap = computeCapacity({ expenses: [], today: TODAY, income: null, projection: null });
    expect(moveImpact(plan, cap, 0)).toEqual({ newSpend: null, housingShare: null, cutNeeded: 130_000_00 });
    const cheaper = moveImpact({ ...plan, currentMonthly: 900_000_00 }, cap, 0);
    expect(cheaper.cutNeeded).toBe(0);
  });
});

describe('monthSignal', () => {
  const goals = [goal()]; // asks 480,000 per month
  const income = 1_600_000_00;

  it('is ok when the month is heading under what the goals allow', () => {
    // allowed = 1,600,000 - 480,000 = 1,120,000
    const s = monthSignal(income, goals, 1_000_000_00, TODAY);
    expect(s).toMatchObject({ level: 'ok', allowed: 1_120_000_00, diff: -120_000_00 });
  });

  it('is tight within 5% either way', () => {
    expect(monthSignal(income, goals, 1_120_000_00, TODAY).level).toBe('tight');
    expect(monthSignal(income, goals, 1_170_000_00, TODAY).level).toBe('tight');
  });

  it('is over, with how much, when the month would eat the saving', () => {
    const s = monthSignal(income, goals, 1_300_000_00, TODAY);
    expect(s).toMatchObject({ level: 'over', diff: 180_000_00 });
  });

  it('is over when the goals alone take all the income', () => {
    expect(monthSignal(400_000_00, goals, 100_000_00, TODAY).level).toBe('over');
  });

  it('is unknown without income, without a forecast, or with nothing to save for', () => {
    expect(monthSignal(null, goals, 1_000_000_00, TODAY).level).toBe('unknown');
    expect(monthSignal(income, goals, null, TODAY).level).toBe('unknown');
    expect(monthSignal(income, [goal({ saved: 3_000_000_00 })], 1_000_000_00, TODAY).level).toBe('unknown');
    expect(monthSignal(income, [], 1_000_000_00, TODAY).level).toBe('unknown');
  });
});
