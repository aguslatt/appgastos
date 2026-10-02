import { defaultCategories, FALLBACK_CATEGORY_ID, isColorKey } from './categories';
import { isValidDateStr, isValidMonthKey, monthKeyOf, todayStr } from './dates';
import { detectLocaleAndCurrency, isSupportedCurrency } from './money';
import type { AppData, Category, Expense, Goal, GoalKind, MovePlan, Recurring, Settings, ThemePref, TripPlan } from './types';

export const DATA_VERSION = 1 as const;
export const MAX_NOTE_LENGTH = 80;
export const MAX_NAME_LENGTH = 30;

export function createInitialData(language?: string): AppData {
  const { locale, currency } = detectLocaleAndCurrency(language);
  return {
    version: DATA_VERSION,
    expenses: [],
    categories: defaultCategories(),
    recurring: [],
    goals: [],
    settings: { currency, locale, monthlyBudget: null, monthlyIncome: null, fxRate: null, theme: 'system', haptics: true, onboarded: false },
  };
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Cuts to at most `max` visible characters without splitting an emoji, then trims what is left. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const parts = segmenter ? Array.from(segmenter.segment(value), (x) => x.segment) : Array.from(value);
  return parts.slice(0, max).join('');
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? truncate(v.trim(), max).trim() : '');
const positiveCents = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const THEMES: readonly ThemePref[] = ['system', 'light', 'dark'];
const GOAL_KINDS: readonly GoalKind[] = ['trip', 'move', 'saving'];
const TRIP_STYLES = ['budget', 'mid', 'comfort'] as const;

const nonNegativeCents = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.round(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const boundedInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function normalizeTrip(raw: unknown): TripPlan | undefined {
  if (!isRecord(raw)) return undefined;
  const stops = (Array.isArray(raw.stops) ? raw.stops : [])
    .filter(isRecord)
    .slice(0, 20)
    .map((s) => ({ place: text(s.place, 60), days: boundedInt(s.days, 0, 365, 0) }));
  const plan: TripPlan = {
    stops,
    people: boundedInt(raw.people, 1, 20, 1),
    style: TRIP_STYLES.includes(raw.style as (typeof TRIP_STYLES)[number]) ? (raw.style as TripPlan['style']) : 'mid',
  };
  if (typeof raw.fx === 'number' && Number.isFinite(raw.fx) && raw.fx > 0) plan.fx = raw.fx;
  const flightEach = nonNegativeCents(raw.flightEach);
  if (flightEach > 0) plan.flightEach = flightEach;
  const extras = nonNegativeCents(raw.extras);
  if (extras > 0) plan.extras = extras;
  return plan;
}

function normalizeMove(raw: unknown): MovePlan | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    zone: text(raw.zone, 60),
    rent: nonNegativeCents(raw.rent),
    monthlyExtras: nonNegativeCents(raw.monthlyExtras),
    depositMonths: boundedInt(raw.depositMonths, 0, 12, 1),
    commissionMonths: boundedInt(raw.commissionMonths, 0, 12, 1),
    advanceMonths: boundedInt(raw.advanceMonths, 0, 12, 1),
    setup: nonNegativeCents(raw.setup),
    currentMonthly: nonNegativeCents(raw.currentMonthly),
  };
}

function isUsableLocale(v: unknown): v is string {
  if (typeof v !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)) return false;
  try {
    new Intl.NumberFormat(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns anything (saved state, an imported backup) into valid `AppData`, repairing
 * what it can and dropping what it can't. Returns `null` when the input isn't
 * recognizably a backup at all, so callers can refuse it instead of wiping data.
 */
export function normalizeData(
  raw: unknown,
  { makeId, today = todayStr(), language }: { makeId: () => string; today?: string; language?: string },
): AppData | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.expenses) && !isRecord(raw.settings) && !Array.isArray(raw.categories)) return null;

  const now = Date.now();
  const fresh = createInitialData(language);

  // ---- categories
  const categories: Category[] = [];
  const categoryIds = new Set<string>();
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    if (!isRecord(item)) continue;
    const id = text(item.id, 60);
    if (!id || categoryIds.has(id)) continue;
    categoryIds.add(id);
    const category: Category = {
      id,
      name: text(item.name, MAX_NAME_LENGTH) || 'Sin nombre',
      emoji: text(item.emoji, 8) || '📦',
      color: isColorKey(item.color) ? item.color : 'slate',
      flexible: item.flexible === true,
      limit: positiveCents(item.limit),
      archived: item.archived === true,
    };
    const kind = text(item.kind, 30);
    if (kind) category.kind = kind;
    categories.push(category);
  }
  if (categories.length === 0) {
    categories.push(...fresh.categories);
    fresh.categories.forEach((c) => categoryIds.add(c.id));
  }
  const ensureFallback = () => {
    if (categoryIds.has(FALLBACK_CATEGORY_ID)) return;
    const fallback = defaultCategories().find((c) => c.id === FALLBACK_CATEGORY_ID);
    if (fallback) {
      categories.push(fallback);
      categoryIds.add(fallback.id);
    }
  };
  ensureFallback();
  const resolveCategory = (id: unknown): string => {
    const key = text(id, 60);
    return categoryIds.has(key) ? key : FALLBACK_CATEGORY_ID;
  };

  const explicitIds = (list: unknown): Set<string> =>
    new Set((Array.isArray(list) ? list : []).filter(isRecord).map((item) => text(item.id, 60)).filter(Boolean));
  const freshId = (taken: Set<string>, reserved: Set<string>): string => {
    let id = makeId();
    while (taken.has(id) || reserved.has(id)) id = makeId();
    return id;
  };

  // ---- expenses (ids must be unique; duplicates get a fresh id instead of being dropped)
  const reservedExpenseIds = explicitIds(raw.expenses);
  const expenseIds = new Set<string>();
  const expenses: Expense[] = [];
  for (const item of Array.isArray(raw.expenses) ? raw.expenses : []) {
    if (!isRecord(item)) continue;
    const amount = positiveCents(item.amount);
    if (amount === null || !isValidDateStr(item.date)) continue;
    let id = text(item.id, 60);
    if (!id || expenseIds.has(id)) id = freshId(expenseIds, reservedExpenseIds);
    expenseIds.add(id);
    const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now;
    const expense: Expense = {
      id,
      amount,
      categoryId: resolveCategory(item.categoryId),
      note: text(item.note, MAX_NOTE_LENGTH),
      date: item.date,
      createdAt,
      updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : createdAt,
    };
    const recurringId = text(item.recurringId, 60);
    if (recurringId) expense.recurringId = recurringId;
    if (item.demo === true) expense.demo = true;
    expenses.push(expense);
  }

  // ---- recurring rules
  const reservedRecurringIds = explicitIds(raw.recurring);
  const recurringIds = new Set<string>();
  const recurring: Recurring[] = [];
  for (const item of Array.isArray(raw.recurring) ? raw.recurring : []) {
    if (!isRecord(item)) continue;
    const amount = positiveCents(item.amount);
    if (amount === null) continue;
    let id = text(item.id, 60);
    if (!id || recurringIds.has(id)) id = freshId(recurringIds, reservedRecurringIds);
    recurringIds.add(id);
    const day = typeof item.day === 'number' ? Math.min(31, Math.max(1, Math.trunc(item.day))) : 1;
    recurring.push({
      id,
      amount,
      categoryId: resolveCategory(item.categoryId),
      note: text(item.note, MAX_NOTE_LENGTH),
      day: Number.isFinite(day) ? day : 1,
      startMonth: isValidMonthKey(item.startMonth) ? item.startMonth : monthKeyOf(today),
      lastGenerated: isValidMonthKey(item.lastGenerated) ? item.lastGenerated : null,
      active: item.active !== false,
    });
  }

  // ---- goals
  const reservedGoalIds = explicitIds(raw.goals);
  const goalIds = new Set<string>();
  const goals: Goal[] = [];
  for (const item of Array.isArray(raw.goals) ? raw.goals : []) {
    if (!isRecord(item)) continue;
    const target = positiveCents(item.target);
    if (target === null || !isValidMonthKey(item.deadline)) continue;
    let id = text(item.id, 60);
    if (!id || goalIds.has(id)) id = freshId(goalIds, reservedGoalIds);
    goalIds.add(id);
    const kind = GOAL_KINDS.includes(item.kind as GoalKind) ? (item.kind as GoalKind) : 'saving';
    const goal: Goal = {
      id,
      kind,
      name: text(item.name, MAX_NAME_LENGTH) || 'Mi meta',
      emoji: text(item.emoji, 8) || '🎯',
      target,
      deadline: item.deadline,
      saved: nonNegativeCents(item.saved),
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now,
    };
    const trip = kind === 'trip' ? normalizeTrip(item.trip) : undefined;
    const move = kind === 'move' ? normalizeMove(item.move) : undefined;
    if (trip) goal.trip = trip;
    if (move) goal.move = move;
    goals.push(goal);
  }

  // ---- settings
  const s = isRecord(raw.settings) ? raw.settings : {};
  const settings: Settings = {
    currency: isSupportedCurrency(s.currency) ? s.currency : fresh.settings.currency,
    locale: isUsableLocale(s.locale) ? s.locale : fresh.settings.locale,
    monthlyBudget: positiveCents(s.monthlyBudget),
    monthlyIncome: positiveCents(s.monthlyIncome),
    fxRate: typeof s.fxRate === 'number' && Number.isFinite(s.fxRate) && s.fxRate > 0 ? s.fxRate : null,
    theme: THEMES.includes(s.theme as ThemePref) ? (s.theme as ThemePref) : 'system',
    haptics: s.haptics !== false,
    // Anyone with data has obviously been through onboarding already.
    onboarded: s.onboarded === true || expenses.length > 0,
  };

  return { version: DATA_VERSION, expenses, categories, recurring, goals, settings };
}

export function makeIdGenerator(): () => string {
  return () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
