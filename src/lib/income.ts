import { addMonths, dayOf, monthKeyOf } from './dates';
import { nextDates, upcomingTotal, type UpcomingPayment } from './recurring';
import { sumAmounts } from './stats';
import type { Cents, DateStr, Expense, Income, IncomeRule, MonthKey } from './types';

export const sumIncomes = (list: readonly Income[]): Cents => list.reduce((acc, i) => acc + i.amount, 0);

export function groupIncomesByMonth(incomes: readonly Income[]): Map<MonthKey, Income[]> {
  const map = new Map<MonthKey, Income[]>();
  for (const income of incomes) {
    const key = monthKeyOf(income.date);
    const list = map.get(key);
    if (list) list.push(income);
    else map.set(key, [income]);
  }
  return map;
}

// ---- one month ----------------------------------------------------------------------------------

export interface IncomeSourceTotal {
  sourceId: string;
  total: Cents;
  count: number;
  /** 0..1 of the month's income. */
  share: number;
}

export interface MonthIncome {
  month: MonthKey;
  total: Cents;
  count: number;
  /** What came from fixed-income rules (a salary). */
  fixed: Cents;
  /** Everything else: what came in as it came. */
  variable: Cents;
  bySource: IncomeSourceTotal[];
  biggest: Income | null;
}

/** The bigger of two incomes; for equal amounts the later one, then the one entered later, then by id: never a toss-up. */
function isBigger(a: Income, b: Income): boolean {
  if (a.amount !== b.amount) return a.amount > b.amount;
  if (a.date !== b.date) return a.date > b.date;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

export function computeMonthIncome(list: readonly Income[], month: MonthKey): MonthIncome {
  const sources = new Map<string, { total: Cents; count: number }>();
  let total = 0;
  let count = 0;
  let fixed = 0;
  let biggest: Income | null = null;

  for (const income of list) {
    if (monthKeyOf(income.date) !== month) continue;
    total += income.amount;
    count += 1;
    if (income.ruleId) fixed += income.amount;
    const source = sources.get(income.sourceId) ?? { total: 0, count: 0 };
    sources.set(income.sourceId, { total: source.total + income.amount, count: source.count + 1 });
    if (!biggest || isBigger(income, biggest)) biggest = income;
  }

  // Ties are settled by name, so the same month reads the same whatever order its incomes arrive in.
  const bySource: IncomeSourceTotal[] = [...sources.entries()]
    .map(([sourceId, v]) => ({ sourceId, total: v.total, count: v.count, share: total > 0 ? v.total / total : 0 }))
    .sort((a, b) => b.total - a.total || b.count - a.count || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));

  return { month, total, count, fixed, variable: total - fixed, bySource, biggest };
}

export interface MonthBalance {
  income: Cents;
  spent: Cents;
  /** What is left: income minus spending (negative when the month cost more than it brought in). */
  balance: Cents;
  /** Share of the income that was kept, or null when nothing came in. Can be negative. */
  keptShare: number | null;
}

export function monthBalance(income: Cents, spent: Cents): MonthBalance {
  return { income, spent, balance: income - spent, keptShare: income > 0 ? (income - spent) / income : null };
}

// ---- income against spending, month after month ---------------------------------------------------

export interface FlowPoint {
  month: MonthKey;
  income: Cents;
  spent: Cents;
}

/** Income and spending for the `count` months ending at `endMonth` (oldest first). */
export function flowSeries(
  incomesByMonth: ReadonlyMap<MonthKey, readonly Income[]>,
  expensesByMonth: ReadonlyMap<MonthKey, readonly Expense[]>,
  endMonth: MonthKey,
  count: number,
): FlowPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(endMonth, i - (count - 1));
    return { month, income: sumIncomes(incomesByMonth.get(month) ?? []), spent: sumAmounts(expensesByMonth.get(month) ?? []) };
  });
}

// ---- what to expect ------------------------------------------------------------------------------------

export type IncomeBasis =
  /** Nothing to go on. */
  | 'none'
  /** Only the rough monthly figure the person typed in. */
  | 'estimate'
  /** Fixed incomes (a salary) alone. */
  | 'fixed'
  /** What came in over earlier months, alone. */
  | 'history'
  /** Fixed incomes plus what usually comes on top. */
  | 'mixed';

export interface ExpectedIncome {
  /** A typical month's income, or null when there is nothing to base it on. */
  amount: Cents | null;
  basis: IncomeBasis;
  /** What the active fixed incomes bring each month. */
  fixed: Cents;
  /** What usually comes on top, from earlier months; null while there isn't a whole month to look at, 0 when those months were empty. */
  variable: Cents | null;
}

const HISTORY_MONTHS = 3;

/**
 * A typical month's income: the fixed incomes plus the average of what else came in over the last
 * months. Months before the first recorded income are unknown (not zero), and the month in
 * progress never counts because it isn't over. A month without income after that does count, as
 * zero: for someone who works by the job, a dry month is real. Without any of it the rough figure
 * typed in settings is used.
 */
export function expectedIncome(opts: {
  incomes: readonly Income[];
  rules: readonly IncomeRule[];
  estimate: Cents | null;
  today: DateStr;
}): ExpectedIncome {
  const current = monthKeyOf(opts.today);
  const active = opts.rules.filter((r) => r.active);
  const fixed = active.reduce((acc, r) => acc + r.amount, 0);

  // A salary recorded by hand before it became a fixed income must not be counted twice: what a fixed
  // income already covers is its own source, from the month it starts. Anything of that source from
  // before then was probably that same income, so it stays out; what comes in on top of it later
  // (extra jobs for a client who also pays a monthly fee) is variable income like any other.
  const coveredBefore = new Map<string, MonthKey>();
  for (const r of active) {
    const earlier = coveredBefore.get(r.sourceId);
    if (earlier === undefined || r.startMonth < earlier) coveredBefore.set(r.sourceId, r.startMonth);
  }
  const variableOnly = opts.incomes.filter((i) => {
    if (i.ruleId) return false;
    const cutoff = coveredBefore.get(i.sourceId);
    return cutoff === undefined || monthKeyOf(i.date) >= cutoff;
  });
  const byMonth = groupIncomesByMonth(variableOnly);

  let variable: Cents | null = null;
  const first = [...byMonth.keys()].sort()[0];
  if (first !== undefined && first < current) {
    // The first month only counts when it was tracked from its first week: otherwise it is probably partial.
    let firstDay = 31;
    for (const i of byMonth.get(first) ?? []) firstDay = Math.min(firstDay, dayOf(i.date));
    const months: MonthKey[] = [];
    for (let m = addMonths(current, -1); m >= first && months.length < HISTORY_MONTHS; m = addMonths(m, -1)) {
      if (m === first && firstDay > 7) continue;
      months.push(m);
    }
    if (months.length > 0) variable = Math.round(months.reduce((acc, m) => acc + sumIncomes(byMonth.get(m) ?? []), 0) / months.length);
  }

  // Months with nothing recorded at all say nothing about what is typical (the app may simply not have been
  // used): they don't make an income of zero, so the rough figure, or nothing, takes over.
  const onTop = variable !== null && variable > 0 ? variable : null;
  if (fixed > 0 || onTop !== null) {
    const basis: IncomeBasis = fixed > 0 && onTop !== null ? 'mixed' : fixed > 0 ? 'fixed' : 'history';
    return { amount: fixed + (onTop ?? 0), basis, fixed, variable };
  }
  if (opts.estimate !== null && opts.estimate > 0) return { amount: opts.estimate, basis: 'estimate', fixed, variable };
  return { amount: null, basis: 'none', fixed, variable };
}

/** What the fixed incomes still have to bring this month (not yet recorded, due after today). */
export const upcomingFixedIncome = (rules: readonly IncomeRule[], today: DateStr): Cents => upcomingTotal(rules, today);

/** The next date each active fixed income will be recorded, soonest first. */
export const nextPaydays = (rules: readonly IncomeRule[], today: DateStr): Array<UpcomingPayment<IncomeRule>> => nextDates(rules, today);
