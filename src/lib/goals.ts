import { addMonths, monthKeyOf, parseMonthKey, toDateStr } from './dates';
import { completeMonthsBefore, groupByMonth, sumAmounts } from './stats';
import type { Category, Cents, DateStr, Expense, Goal, MonthKey, MovePlan } from './types';

export type { Goal, GoalKind, MovePlan, TripPlan } from './types';

// ---- time and progress -----------------------------------------------------------------------

/** Whole months between two month keys (b - a). */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const pa = parseMonthKey(a);
  const pb = parseMonthKey(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

/** Months in which money can still be put aside: this one counts, the deadline month doesn't. At least 1 until it passes. */
export function monthsLeft(deadline: MonthKey, today: DateStr): number {
  const diff = monthDiff(monthKeyOf(today), deadline);
  return diff <= 0 ? 0 : diff;
}

export const remaining = (goal: Goal): Cents => Math.max(0, goal.target - goal.saved);
export const progress = (goal: Goal): number => (goal.target > 0 ? Math.min(1, goal.saved / goal.target) : 0);
export const isDone = (goal: Goal): boolean => goal.target > 0 && goal.saved >= goal.target;

/** What has to be put aside each month to arrive on time; the whole remainder when the deadline is now or past. */
export function requiredPerMonth(goal: Goal, today: DateStr): Cents {
  const left = remaining(goal);
  if (left === 0) return 0;
  const months = monthsLeft(goal.deadline, today);
  return months === 0 ? left : Math.ceil(left / months);
}

/** Where the saved amount should be by now if the goal were saved for in equal steps since it was created. */
export function expectedSaved(goal: Goal, today: DateStr): Cents {
  const start = monthKeyOf(toDateStr(new Date(goal.createdAt)));
  const total = Math.max(1, monthDiff(start, goal.deadline));
  const elapsed = Math.min(total, Math.max(0, monthDiff(start, monthKeyOf(today))));
  return Math.round((goal.target * elapsed) / total);
}

// ---- how much room there is -------------------------------------------------------------------

export interface Capacity {
  income: Cents | null;
  /** Typical monthly spending, from earlier months (or this month's projection when there's no history). */
  avgSpend: Cents | null;
  /** Income minus typical spending: what is left over each month at today's habits. Null without both numbers. */
  free: Cents | null;
  basis: 'history' | 'projection' | 'none';
  /** Typical monthly spending per folder, for suggesting where to trim. */
  perFolder: Map<string, Cents>;
}

export function computeCapacity(opts: {
  expenses: readonly Expense[];
  today: DateStr;
  income: Cents | null;
  /** Projected total of the current month, when known. */
  projection: Cents | null;
}): Capacity {
  const byMonth = groupByMonth(opts.expenses);
  const months = completeMonthsBefore(byMonth, monthKeyOf(opts.today), 3);
  const perFolder = new Map<string, Cents>();
  let avgSpend: Cents | null = null;
  let basis: Capacity['basis'] = 'none';

  if (months.length > 0) {
    const lists = months.map((m) => byMonth.get(m) ?? []);
    avgSpend = Math.round(lists.reduce((a, l) => a + sumAmounts(l), 0) / lists.length);
    for (const list of lists) for (const e of list) perFolder.set(e.categoryId, (perFolder.get(e.categoryId) ?? 0) + e.amount / lists.length);
    for (const [id, v] of perFolder) perFolder.set(id, Math.round(v));
    basis = 'history';
  } else if (opts.projection !== null) {
    avgSpend = opts.projection;
    basis = 'projection';
  }

  return {
    income: opts.income,
    avgSpend,
    free: opts.income !== null && avgSpend !== null ? opts.income - avgSpend : null,
    basis,
    perFolder,
  };
}

// ---- the verdict ----------------------------------------------------------------------------------

export type GoalLevel = 'done' | 'ok' | 'tight' | 'off' | 'unknown';

export interface GoalStatus {
  level: GoalLevel;
  monthsLeft: number;
  remaining: Cents;
  requiredPerMonth: Cents;
  /** requiredPerMonth as a share of the free monthly room (null when the room is unknown). */
  shareOfFree: number | null;
  /** Extra monthly effort needed beyond the room that exists today (0 when it fits). */
  shortfall: Cents;
  /** Positive when behind the equal-steps schedule. */
  behindBy: Cents;
}

/**
 * Judges a goal against the room there is. `committedElsewhere` is what the user's other
 * goals already ask of the same monthly room, so two goals can't both claim all of it.
 */
export function goalStatus(goal: Goal, capacity: Capacity, committedElsewhere: Cents, today: DateStr): GoalStatus {
  const left = remaining(goal);
  const required = requiredPerMonth(goal, today);
  const months = monthsLeft(goal.deadline, today);
  const behindBy = Math.max(0, expectedSaved(goal, today) - goal.saved);
  const base = { monthsLeft: months, remaining: left, requiredPerMonth: required, behindBy };

  if (isDone(goal)) return { ...base, level: 'done', shareOfFree: null, shortfall: 0 };
  if (capacity.free === null) return { ...base, level: 'unknown', shareOfFree: null, shortfall: 0 };

  const room = capacity.free - committedElsewhere;
  const shortfall = Math.max(0, required - Math.max(0, room));
  const shareOfFree = room > 0 ? required / room : Infinity;
  const level: GoalLevel = shareOfFree <= 0.8 ? 'ok' : shareOfFree <= 1.05 ? 'tight' : 'off';
  return { ...base, level, shareOfFree, shortfall };
}

/** What every active goal asks per month, for judging them together. */
export function totalRequired(goals: readonly Goal[], today: DateStr): Cents {
  return goals.filter((g) => !isDone(g)).reduce((a, g) => a + requiredPerMonth(g, today), 0);
}

// ---- how to get there ----------------------------------------------------------------------------

export interface CutSuggestion {
  categoryId: string;
  /** Share of the folder's typical spending to trim (0..1). */
  pct: number;
  monthly: Cents;
}

export interface CutPlan {
  cuts: CutSuggestion[];
  /** What the cuts add up to per month. */
  covered: Cents;
  /** What is still missing after the cuts. */
  gap: Cents;
}

/** Spreads a monthly shortfall over the biggest trimmable folders, 10-30% each, biggest first. */
export function suggestCuts(shortfall: Cents, perFolder: ReadonlyMap<string, Cents>, categories: readonly Category[]): CutPlan {
  if (shortfall <= 0) return { cuts: [], covered: 0, gap: 0 };
  const candidates = categories
    .filter((c) => c.flexible && !c.archived)
    .map((c) => ({ id: c.id, avg: perFolder.get(c.id) ?? 0 }))
    .filter((c) => c.avg > 0)
    .sort((a, b) => b.avg - a.avg);

  const cuts: CutSuggestion[] = [];
  let covered = 0;
  for (const pct of [0.15, 0.3]) {
    for (const c of candidates) {
      if (covered >= shortfall) break;
      const already = cuts.find((x) => x.categoryId === c.id);
      if (already && pct <= already.pct) continue;
      const monthly = Math.round(c.avg * pct);
      const gain = monthly - (already?.monthly ?? 0);
      if (already) {
        already.pct = pct;
        already.monthly = monthly;
      } else cuts.push({ categoryId: c.id, pct, monthly });
      covered += gain;
    }
  }
  return { cuts, covered, gap: Math.max(0, shortfall - covered) };
}

export interface ExtendOption {
  extraMonths: number;
  deadline: MonthKey;
  perMonth: Cents;
}

/** What the monthly effort becomes if the date is pushed back. */
export function extendOptions(goal: Goal, today: DateStr, extras: readonly number[] = [2, 4, 6]): ExtendOption[] {
  const left = remaining(goal);
  if (left === 0) return [];
  const base = Math.max(monthsLeft(goal.deadline, today), 0);
  return extras.map((extraMonths) => ({
    extraMonths,
    deadline: addMonths(goal.deadline, extraMonths),
    perMonth: Math.ceil(left / (base + extraMonths)),
  }));
}

// ---- moving: what it costs up front and every month --------------------------------------------

export interface MoveCosts {
  upfront: Cents;
  newMonthly: Cents;
  /** New monthly housing cost minus the current one (negative = it gets cheaper). */
  monthlyChange: Cents;
}

export function moveCosts(plan: MovePlan): MoveCosts {
  const upfront = plan.rent * (plan.depositMonths + plan.commissionMonths + plan.advanceMonths) + plan.setup;
  const newMonthly = plan.rent + plan.monthlyExtras;
  return { upfront, newMonthly, monthlyChange: newMonthly - plan.currentMonthly };
}

export interface MoveImpact {
  /** Typical monthly spending once housing costs change. */
  newSpend: Cents | null;
  /** Share of income that housing would take, when income is known. */
  housingShare: number | null;
  /** How much the rest of the spending would have to shrink, per month, to keep saving as before. */
  cutNeeded: Cents;
}

/** What the new place does to the monthly budget, judged against income and the usual spending. */
export function moveImpact(plan: MovePlan, capacity: Capacity, savingPerMonth: Cents): MoveImpact {
  const { monthlyChange, newMonthly } = moveCosts(plan);
  const newSpend = capacity.avgSpend === null ? null : capacity.avgSpend + monthlyChange;
  const housingShare = capacity.income ? newMonthly / capacity.income : null;
  const room = capacity.income !== null && newSpend !== null ? capacity.income - newSpend : null;
  const cutNeeded = room === null ? Math.max(0, monthlyChange) : Math.max(0, savingPerMonth - room);
  return { newSpend, housingShare, cutNeeded };
}

// ---- the monthly signal -----------------------------------------------------------------------------

export type SignalLevel = 'ok' | 'tight' | 'over' | 'unknown';

export interface MonthSignal {
  level: SignalLevel;
  /** What can be spent this month while still saving what the goals ask for. */
  allowed: Cents | null;
  /** Where the month is expected to end. */
  expected: Cents | null;
  /** expected - allowed: positive means overspending against the goals. */
  diff: Cents | null;
}

/**
 * "Am I spending too much for my goals?": income minus what the active goals need each
 * month is the spending the goals allow; compare it with where this month is heading.
 */
export function monthSignal(income: Cents | null, goals: readonly Goal[], expected: Cents | null, today: DateStr): MonthSignal {
  if (income === null || expected === null || goals.every(isDone)) return { level: 'unknown', allowed: null, expected, diff: null };
  const allowed = income - totalRequired(goals, today);
  const diff = expected - allowed;
  if (allowed <= 0) return { level: 'over', allowed, expected, diff };
  const level: SignalLevel = diff <= -0.05 * allowed ? 'ok' : diff <= 0.05 * allowed ? 'tight' : 'over';
  return { level, allowed, expected, diff };
}
