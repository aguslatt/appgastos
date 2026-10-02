import { addMonths, dayOf, daysInMonth, monthKeyOf, weekdayMon0, weekdayOccurrences } from './dates';
import type { Cents, DateStr, Expense, MonthKey } from './types';

export function groupByMonth(expenses: readonly Expense[]): Map<MonthKey, Expense[]> {
  const map = new Map<MonthKey, Expense[]>();
  for (const e of expenses) {
    const key = monthKeyOf(e.date);
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  }
  return map;
}

export const sumAmounts = (list: readonly Expense[]): Cents => list.reduce((acc, e) => acc + e.amount, 0);

export interface CategoryTotal {
  categoryId: string;
  total: Cents;
  count: number;
  /** 0..1 of the month's total. */
  share: number;
}

export type MonthStatus = 'past' | 'current' | 'future';

export interface MonthStats {
  month: MonthKey;
  status: MonthStatus;
  daysInMonth: number;
  /** Days that count for averages: all of a past month, up to today for the current one. */
  elapsedDays: number;
  /** Days left including today (current month only). */
  daysLeft: number;
  total: Cents;
  count: number;
  /** Total per day of the month, index 0 = day 1. */
  byDay: Cents[];
  countByDay: number[];
  byCategory: CategoryTotal[];
  dailyAverage: Cents;
  todayTotal: Cents;
  biggest: Expense | null;
  /** Finished days without any expense (today never counts: it isn't over). */
  noSpendDays: number;
  longestNoSpendStreak: number;
  /** Monday-first; finished days only, without fixed charges or one-off big purchases. */
  weekdayTotals: Cents[];
  weekdayDays: number[];
  weekendTotal: Cents;
  /** Total from fixed-expense rules. */
  fixedTotal: Cents;
}

export function monthStatus(month: MonthKey, today: DateStr): MonthStatus {
  const current = monthKeyOf(today);
  return month < current ? 'past' : month === current ? 'current' : 'future';
}

/**
 * Expenses that would distort a month's daily pattern: fixed charges, and single
 * purchases far above the usual (rent paid on the 1st, a new TV...).
 */
export function findOneOffs(expenses: readonly Expense[], total: Cents): Set<string> {
  const typical = expenses.length >= 6 ? median(expenses.map((e) => e.amount)) : Infinity;
  const ids = new Set<string>();
  for (const e of expenses) {
    if (e.recurringId || (e.amount > typical * 5 && e.amount >= total * 0.1)) ids.add(e.id);
  }
  return ids;
}

export function computeMonthStats(monthExpenses: readonly Expense[], month: MonthKey, today: DateStr): MonthStats {
  const status = monthStatus(month, today);
  const dim = daysInMonth(month);
  const elapsedDays = status === 'past' ? dim : status === 'current' ? dayOf(today) : 0;
  const finishedDays = status === 'current' ? elapsedDays - 1 : elapsedDays;

  const byDay = new Array<number>(dim).fill(0);
  const countByDay = new Array<number>(dim).fill(0);
  const categories = new Map<string, { total: Cents; count: number }>();
  let total = 0;
  let count = 0;
  let biggest: Expense | null = null;
  let weekendTotal = 0;
  let fixedTotal = 0;
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];

  for (const e of monthExpenses) {
    const day = dayOf(e.date);
    if (day < 1 || day > dim) continue;
    total += e.amount;
    count += 1;
    byDay[day - 1] = (byDay[day - 1] ?? 0) + e.amount;
    countByDay[day - 1] = (countByDay[day - 1] ?? 0) + 1;
    const cat = categories.get(e.categoryId) ?? { total: 0, count: 0 };
    categories.set(e.categoryId, { total: cat.total + e.amount, count: cat.count + 1 });
    if (!biggest || e.amount > biggest.amount || (e.amount === biggest.amount && e.date > biggest.date)) biggest = e;
    if (weekdayMon0(e.date) >= 5) weekendTotal += e.amount;
    if (e.recurringId) fixedTotal += e.amount;
  }

  // Weekday pattern: finished days only, without one-offs.
  const oneOffs = findOneOffs(monthExpenses, total);
  for (const e of monthExpenses) {
    const day = dayOf(e.date);
    if (day < 1 || day > finishedDays || oneOffs.has(e.id)) continue;
    const weekday = weekdayMon0(e.date);
    weekdayTotals[weekday] = (weekdayTotals[weekday] ?? 0) + e.amount;
  }

  let noSpendDays = 0;
  let longest = 0;
  let run = 0;
  for (let d = 1; d <= finishedDays; d++) {
    if ((countByDay[d - 1] ?? 0) === 0) {
      noSpendDays++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  const byCategory: CategoryTotal[] = [...categories.entries()]
    .map(([categoryId, v]) => ({ categoryId, total: v.total, count: v.count, share: total > 0 ? v.total / total : 0 }))
    .sort((a, b) => b.total - a.total || b.count - a.count);

  return {
    month,
    status,
    daysInMonth: dim,
    elapsedDays,
    daysLeft: status === 'current' ? dim - elapsedDays + 1 : 0,
    total,
    count,
    byDay,
    countByDay,
    byCategory,
    dailyAverage: elapsedDays > 0 ? Math.round(total / elapsedDays) : 0,
    todayTotal: status === 'current' ? (byDay[elapsedDays - 1] ?? 0) : 0,
    biggest,
    noSpendDays,
    longestNoSpendStreak: longest,
    weekdayTotals,
    weekdayDays:
      finishedDays > 0 ? weekdayOccurrences(`${month}-01`, `${month}-${String(finishedDays).padStart(2, '0')}`) : [0, 0, 0, 0, 0, 0, 0],
    weekendTotal,
    fixedTotal,
  };
}

// ---- comparison with the previous month --------------------------------------

export interface PaceComparison {
  current: Cents;
  previous: Cents;
  delta: Cents;
  /** (current - previous) / previous, or null when there's nothing to compare against. */
  pct: number | null;
  /** True when "previous" only covers the same days of the month as "current". */
  toDate: boolean;
}

/** Compares this month with the previous one over the same span of days (apples to apples). */
export function comparePace(cur: MonthStats, previousMonthExpenses: readonly Expense[]): PaceComparison | null {
  if (cur.status === 'future') return null;
  const prevDays = daysInMonth(addMonths(cur.month, -1));
  const cutoff = cur.status === 'current' ? Math.min(cur.elapsedDays, prevDays) : prevDays;
  const previous = sumAmounts(previousMonthExpenses.filter((e) => dayOf(e.date) <= cutoff));
  return {
    current: cur.total,
    previous,
    delta: cur.total - previous,
    pct: previous > 0 ? (cur.total - previous) / previous : null,
    toDate: cur.status === 'current',
  };
}

export interface CategoryShift {
  categoryId: string;
  current: Cents;
  previous: Cents;
  delta: Cents;
  pct: number | null;
}

/** Folder-by-folder change against the previous month, over the same span of days. */
export function categoryShifts(cur: MonthStats, currentExpenses: readonly Expense[], previousExpenses: readonly Expense[]): CategoryShift[] {
  const prevDays = daysInMonth(addMonths(cur.month, -1));
  const cutoff = cur.status === 'current' ? Math.min(cur.elapsedDays, prevDays) : prevDays;
  const prev = new Map<string, number>();
  for (const e of previousExpenses) if (dayOf(e.date) <= cutoff) prev.set(e.categoryId, (prev.get(e.categoryId) ?? 0) + e.amount);
  const now = new Map<string, number>();
  for (const e of currentExpenses) now.set(e.categoryId, (now.get(e.categoryId) ?? 0) + e.amount);
  const ids = new Set([...prev.keys(), ...now.keys()]);
  return [...ids].map((categoryId) => {
    const current = now.get(categoryId) ?? 0;
    const previous = prev.get(categoryId) ?? 0;
    return { categoryId, current, previous, delta: current - previous, pct: previous > 0 ? (current - previous) / previous : null };
  });
}

// ---- projection ------------------------------------------------------------------

export interface Projection {
  total: Cents;
  /** "history": from how earlier months continued after this day. "rate": from this month's pace. */
  method: 'history' | 'rate';
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Months before `month` that look fully tracked: every month after the first
 * expense ever logged, and the first month only if tracking began in its first week.
 */
export function completeMonthsBefore(byMonth: Map<MonthKey, Expense[]>, month: MonthKey, max = 3): MonthKey[] {
  const months = [...byMonth.keys()].sort();
  const first = months[0];
  if (!first) return [];
  const firstDay = Math.min(...(byMonth.get(first) ?? []).map((e) => dayOf(e.date)));
  const out: MonthKey[] = [];
  for (let m = addMonths(month, -1), i = 0; i < 12 && out.length < max && m >= first; m = addMonths(m, -1), i++) {
    if (!byMonth.has(m)) continue;
    if (m === first && firstDay > 7) continue;
    out.push(m);
  }
  return out;
}

/**
 * Estimates where the current month will end. With history it asks "how much did
 * earlier months spend after this day?", which handles a rent paid on day 1. Without
 * history it extrapolates this month's daily pace, ignoring one-off big purchases
 * and fixed charges (the latter are added back from what's still due).
 */
export function projectMonthEnd(
  cur: MonthStats,
  currentExpenses: readonly Expense[],
  priorMonths: ReadonlyArray<readonly Expense[]>,
  upcomingFixed: Cents,
): Projection | null {
  if (cur.status !== 'current') return null;
  const daysAfterToday = cur.daysInMonth - cur.elapsedDays;
  if (daysAfterToday === 0) return { total: cur.total, method: 'rate' };

  const usable = priorMonths.filter((m) => m.length > 0);
  if (usable.length > 0 && cur.elapsedDays >= 3 && cur.count >= 3) {
    const remainders = usable.map((m) => {
      const month = monthKeyOf((m[0] as Expense).date);
      const cutoff = Math.min(cur.elapsedDays, daysInMonth(month));
      return { toDate: sumAmounts(m.filter((e) => dayOf(e.date) <= cutoff)), remaining: sumAmounts(m.filter((e) => dayOf(e.date) > cutoff)) };
    });
    const avgRemaining = remainders.reduce((a, r) => a + r.remaining, 0) / remainders.length;
    const avgToDate = remainders.reduce((a, r) => a + r.toDate, 0) / remainders.length;
    // If this month started faster or slower than usual, lean half-way that way.
    const ratio = avgToDate > 0 ? cur.total / avgToDate : 1;
    const factor = clamp(1 + 0.5 * (ratio - 1), 0.6, 1.8);
    return { total: Math.round(cur.total + avgRemaining * factor), method: 'history' };
  }

  if (cur.elapsedDays >= 7 && cur.count >= 6) {
    const oneOffs = findOneOffs(currentExpenses, cur.total);
    const variable = cur.total - sumAmounts(currentExpenses.filter((e) => oneOffs.has(e.id)));
    const rate = Math.max(0, variable) / cur.elapsedDays;
    return { total: Math.round(cur.total + rate * daysAfterToday + upcomingFixed), method: 'rate' };
  }
  return null;
}

// ---- budget ----------------------------------------------------------------------

export type BudgetLevel = 'ok' | 'close' | 'over';

export interface BudgetStatus {
  budget: Cents;
  spent: Cents;
  remaining: Cents;
  /** spent / budget (can exceed 1). */
  pct: number;
  level: BudgetLevel;
  /** What can still be spent per day, including today, in whole currency units rounded down (current month, budget not exhausted). */
  perDay: Cents | null;
  /** Spending a clearly bigger share of the budget than the share of the month that has passed. */
  paceAhead: boolean;
}

export const levelFor = (pct: number): BudgetLevel => (pct > 1 ? 'over' : pct >= 0.8 ? 'close' : 'ok');

export function budgetStatus(budget: Cents | null, cur: MonthStats): BudgetStatus | null {
  if (budget === null || budget <= 0) return null;
  const pct = cur.total / budget;
  const remaining = budget - cur.total;
  const timeShare = cur.daysInMonth > 0 ? cur.elapsedDays / cur.daysInMonth : 0;
  return {
    budget,
    spent: cur.total,
    remaining,
    pct,
    level: levelFor(pct),
    perDay: cur.status === 'current' && remaining > 0 && cur.daysLeft > 0 ? Math.floor(remaining / cur.daysLeft / 100) * 100 : null,
    paceAhead: cur.status === 'current' && pct > timeShare + 0.1,
  };
}

// ---- series ------------------------------------------------------------------------

export interface MonthTotal {
  month: MonthKey;
  total: Cents;
}

/** Totals for the `count` months ending at `endMonth` (oldest first). */
export function monthlyTotals(byMonth: Map<MonthKey, Expense[]>, endMonth: MonthKey, count: number): MonthTotal[] {
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(endMonth, i - (count - 1));
    return { month, total: sumAmounts(byMonth.get(month) ?? []) };
  });
}
