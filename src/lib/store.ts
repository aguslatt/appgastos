import { FALLBACK_CATEGORY_ID, isColorKey, pickNewCategoryColor } from './categories';
import {
  GOAL_KINDS,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  THEMES,
  cleanText,
  clampDay,
  createInitialData,
  isUsableLocale,
  makeIdGenerator,
  nonNegativeCents,
  normalizeData,
  normalizeMove,
  normalizeTrip,
  positiveCents,
} from './data';
import { addMonths, isValidDateStr, isValidMonthKey, monthKeyOf, todayStr } from './dates';
import { mergeData, type MergeResult } from './backup';
import { isSupportedCurrency } from './money';
import { planRecurring } from './recurring';
import type { AppData, Category, Cents, DateStr, Expense, Goal, GoalKind, MonthKey, MovePlan, Recurring, Settings, TripPlan } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DATA_KEY = 'mg:data:v1';
export const THEME_KEY = 'mg:theme';
const CORRUPT_KEY = 'mg:data:corrupt';

export interface StoreStatus {
  /** False when the browser refuses to save (private mode, full disk...): data lives only until the tab closes. */
  persistent: boolean;
  /** Set when saved data couldn't be read and a copy was kept aside. */
  recovered: boolean;
}

export interface NewExpense {
  amount: Cents;
  categoryId: string;
  note?: string;
  date: DateStr;
}

export interface NewRecurring {
  amount: Cents;
  categoryId: string;
  note?: string;
  day: number;
  startMonth: MonthKey;
}

export interface NewCategory {
  name: string;
  emoji: string;
  kind?: string;
  color?: string;
  flexible?: boolean;
  limit?: Cents | null;
}

export interface NewGoal {
  kind: GoalKind;
  name: string;
  emoji: string;
  target: Cents;
  deadline: MonthKey;
  saved?: Cents;
  trip?: TripPlan;
  move?: MovePlan;
}

export interface StoreOptions {
  storage?: StorageLike | null;
  language?: string;
  makeId?: () => string;
  now?: () => number;
}

export type Store = ReturnType<typeof createStore>;

const cleanNote = (note: string | undefined): string => cleanText((note ?? '').replace(/\s+/g, ' '), MAX_NOTE_LENGTH);

interface GoalFields {
  id: string;
  kind: GoalKind;
  name: string;
  emoji: string;
  target: Cents;
  deadline: MonthKey;
  saved: Cents | undefined;
  createdAt: number;
  trip: TripPlan | undefined;
  move: MovePlan | undefined;
}

/** A goal in the shape a reload would give back: clean text, a plan only on the kind it belongs to. */
function shapeGoal(f: GoalFields): Goal {
  const kind = GOAL_KINDS.includes(f.kind) ? f.kind : 'saving';
  const goal: Goal = {
    id: f.id,
    kind,
    name: cleanText(f.name, MAX_NAME_LENGTH) || 'Mi meta',
    emoji: cleanText(f.emoji, 8) || '🎯',
    target: f.target,
    deadline: f.deadline,
    saved: nonNegativeCents(f.saved),
    createdAt: f.createdAt,
  };
  const trip = kind === 'trip' ? normalizeTrip(f.trip) : undefined;
  const move = kind === 'move' ? normalizeMove(f.move) : undefined;
  if (trip) goal.trip = trip;
  if (move) goal.move = move;
  return goal;
}

/** The later of two months; `null` counts as "never". */
const laterMonth = (a: MonthKey | null, b: MonthKey): MonthKey => (a !== null && a > b ? a : b);

export function createStore(options: StoreOptions = {}) {
  const storage = options.storage ?? null;
  const makeId = options.makeId ?? makeIdGenerator();
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let status: StoreStatus = { persistent: storage !== null, recovered: false };

  const setStatus = (patch: Partial<StoreStatus>) => {
    if (Object.entries(patch).every(([k, v]) => status[k as keyof StoreStatus] === v)) return;
    status = { ...status, ...patch };
  };

  /** What storage holds, or `failed` when it couldn't be read at all (which is not the same as empty). */
  function read(): { data: AppData } | { failed: true } {
    const fresh = () => ({ data: createInitialData(options.language) });
    if (!storage) return fresh();
    let raw: string | null = null;
    try {
      raw = storage.getItem(DATA_KEY);
    } catch {
      return { failed: true };
    }
    if (raw === null) return fresh();
    try {
      const normalized = normalizeData(JSON.parse(raw), { makeId, language: options.language });
      if (normalized) return { data: normalized };
    } catch {
      // fall through: unreadable
    }
    try {
      storage.setItem(CORRUPT_KEY, raw);
    } catch {
      // nothing more we can do
    }
    setStatus({ recovered: true });
    return fresh();
  }

  // If the very first read fails there may be real data in there. Starting empty is fine, but
  // saving over it would destroy it, so nothing is written until a later read succeeds.
  let unreadable = false;
  let data: AppData;
  {
    const first = read();
    if ('failed' in first) {
      unreadable = true;
      setStatus({ persistent: false });
      data = createInitialData(options.language);
    } else {
      data = first.data;
    }
  }

  function save() {
    if (!storage || unreadable) return;
    try {
      storage.setItem(DATA_KEY, JSON.stringify(data));
      storage.setItem(THEME_KEY, data.settings.theme);
      setStatus({ persistent: true });
    } catch {
      setStatus({ persistent: false });
    }
  }

  function commit(next: AppData) {
    data = next;
    save();
    listeners.forEach((l) => l());
  }

  const categoryIdOrFallback = (id: string): string =>
    data.categories.some((c) => c.id === id) ? id : FALLBACK_CATEGORY_ID;

  const store = {
    getData: (): AppData => data,
    getStatus: (): StoreStatus => status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Re-reads storage (another tab changed it). When it can't be read, what is in memory is kept. */
    reload() {
      if (!storage) return;
      const next = read();
      if ('failed' in next) return;
      unreadable = false;
      data = next.data;
      listeners.forEach((l) => l());
    },

    // ---- expenses
    addExpense(input: NewExpense): Expense {
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Invalid amount');
      if (!isValidDateStr(input.date)) throw new Error('Invalid date');
      const t = now();
      const expense: Expense = {
        id: makeId(),
        amount: input.amount,
        categoryId: categoryIdOrFallback(input.categoryId),
        note: cleanNote(input.note),
        date: input.date,
        createdAt: t,
        updatedAt: t,
      };
      commit({ ...data, expenses: [...data.expenses, expense] });
      return expense;
    },

    updateExpense(id: string, patch: Partial<Pick<Expense, 'amount' | 'categoryId' | 'note' | 'date'>>): Expense | null {
      const current = data.expenses.find((e) => e.id === id);
      if (!current) return null;
      if (patch.amount !== undefined && (!Number.isSafeInteger(patch.amount) || patch.amount <= 0)) throw new Error('Invalid amount');
      if (patch.date !== undefined && !isValidDateStr(patch.date)) throw new Error('Invalid date');
      const updated: Expense = {
        ...current,
        ...(patch.amount !== undefined && { amount: patch.amount }),
        ...(patch.categoryId !== undefined && { categoryId: categoryIdOrFallback(patch.categoryId) }),
        ...(patch.note !== undefined && { note: cleanNote(patch.note) }),
        ...(patch.date !== undefined && { date: patch.date }),
        updatedAt: now(),
      };
      commit({ ...data, expenses: data.expenses.map((e) => (e.id === id ? updated : e)) });
      return updated;
    },

    deleteExpense(id: string): Expense | null {
      const current = data.expenses.find((e) => e.id === id);
      if (!current) return null;
      commit({ ...data, expenses: data.expenses.filter((e) => e.id !== id) });
      return current;
    },

    /** Puts back an expense removed by `deleteExpense` (undo). */
    restoreExpense(expense: Expense) {
      if (data.expenses.some((e) => e.id === expense.id)) return;
      commit({ ...data, expenses: [...data.expenses, { ...expense, categoryId: categoryIdOrFallback(expense.categoryId) }] });
    },

    // ---- folders
    addCategory(input: NewCategory): Category {
      const category: Category = {
        id: makeId(),
        name: cleanText(input.name, MAX_NAME_LENGTH) || 'Sin nombre',
        emoji: cleanText(input.emoji, 8) || '📦',
        color: isColorKey(input.color) ? input.color : pickNewCategoryColor(data.categories),
        flexible: input.flexible === true,
        limit: positiveCents(input.limit),
        archived: false,
      };
      const kind = cleanText(input.kind, 30);
      if (kind) category.kind = kind;
      commit({ ...data, categories: [...data.categories, category] });
      return category;
    },

    updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'emoji' | 'color' | 'flexible' | 'limit' | 'archived'>>) {
      commit({
        ...data,
        categories: data.categories.map((c) =>
          c.id === id
            ? {
                ...c,
                ...(patch.name !== undefined && { name: cleanText(patch.name, MAX_NAME_LENGTH) || c.name }),
                ...(patch.emoji !== undefined && { emoji: cleanText(patch.emoji, 8) || c.emoji }),
                ...(isColorKey(patch.color) && { color: patch.color }),
                ...(patch.flexible !== undefined && { flexible: patch.flexible === true }),
                ...(patch.limit !== undefined && { limit: positiveCents(patch.limit) }),
                ...(patch.archived !== undefined && { archived: patch.archived === true }),
              }
            : c,
        ),
      });
    },

    /** Removes a folder; its expenses move to "Otros". The fallback folder can't be deleted. */
    deleteCategory(id: string) {
      if (id === FALLBACK_CATEGORY_ID) return;
      commit({
        ...data,
        categories: data.categories.filter((c) => c.id !== id),
        expenses: data.expenses.map((e) => (e.categoryId === id ? { ...e, categoryId: FALLBACK_CATEGORY_ID, updatedAt: now() } : e)),
        recurring: data.recurring.map((r) => (r.categoryId === id ? { ...r, categoryId: FALLBACK_CATEGORY_ID } : r)),
      });
    },

    // ---- recurring ("próximos pagos")
    addRecurring(input: NewRecurring): Recurring {
      const amount = positiveCents(input.amount);
      if (amount === null) throw new Error('Invalid amount');
      if (!isValidMonthKey(input.startMonth)) throw new Error('Invalid month');
      const rule: Recurring = {
        id: makeId(),
        amount,
        categoryId: categoryIdOrFallback(input.categoryId),
        note: cleanNote(input.note),
        day: clampDay(input.day),
        startMonth: input.startMonth,
        lastGenerated: null,
        active: true,
      };
      commit({ ...data, recurring: [...data.recurring, rule] });
      return rule;
    },

    /** `today` is only used when a paused rule is resumed (it defaults to the clock's day). */
    updateRecurring(id: string, patch: Partial<Pick<Recurring, 'amount' | 'categoryId' | 'note' | 'day' | 'active'>>, today?: DateStr) {
      const amount = patch.amount === undefined ? undefined : positiveCents(patch.amount);
      if (amount === null) throw new Error('Invalid amount');
      const resumeFrom = addMonths(monthKeyOf(today ?? todayStr(new Date(now()))), -1);
      commit({
        ...data,
        recurring: data.recurring.map((r) => {
          if (r.id !== id) return r;
          // A paused rule picks up from this month: the months it was paused are not paid back.
          const resumed = patch.active === true && !r.active;
          return {
            ...r,
            ...(patch.active !== undefined && { active: patch.active === true }),
            ...(amount !== undefined && { amount }),
            ...(patch.categoryId !== undefined && { categoryId: categoryIdOrFallback(patch.categoryId) }),
            ...(patch.note !== undefined && { note: cleanNote(patch.note) }),
            ...(patch.day !== undefined && { day: clampDay(patch.day) }),
            ...(resumed && resumeFrom >= r.startMonth && { lastGenerated: laterMonth(r.lastGenerated, resumeFrom) }),
          };
        }),
      });
    },

    deleteRecurring(id: string) {
      commit({ ...data, recurring: data.recurring.filter((r) => r.id !== id) });
    },

    /** Creates the fixed expenses that came due; safe to call as often as you like. Returns how many were created. */
    runRecurring(today: DateStr = todayStr()): number {
      const plan = planRecurring(data.recurring, today);
      const changed = plan.rules.some((r, i) => r !== data.recurring[i]);
      if (!changed) return 0;
      const t = now();
      const created: Expense[] = plan.drafts.map((d) => ({
        id: makeId(),
        amount: d.amount,
        categoryId: categoryIdOrFallback(d.categoryId),
        note: d.note,
        date: d.date,
        createdAt: t,
        updatedAt: t,
        recurringId: d.ruleId,
      }));
      commit({ ...data, recurring: plan.rules, expenses: [...data.expenses, ...created] });
      return created.length;
    },

    // ---- goals
    addGoal(input: NewGoal): Goal {
      if (!Number.isSafeInteger(input.target) || input.target <= 0) throw new Error('Invalid target');
      if (!isValidMonthKey(input.deadline)) throw new Error('Invalid deadline');
      const goal = shapeGoal({
        id: makeId(),
        kind: input.kind,
        name: input.name,
        emoji: input.emoji,
        target: input.target,
        deadline: input.deadline,
        saved: input.saved,
        createdAt: now(),
        trip: input.trip,
        move: input.move,
      });
      commit({ ...data, goals: [...data.goals, goal] });
      return goal;
    },

    updateGoal(id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>) {
      if (patch.target !== undefined && positiveCents(patch.target) === null) throw new Error('Invalid target');
      if (patch.deadline !== undefined && !isValidMonthKey(patch.deadline)) throw new Error('Invalid deadline');
      commit({
        ...data,
        goals: data.goals.map((g) =>
          g.id === id
            ? shapeGoal({
                id: g.id,
                createdAt: g.createdAt,
                kind: GOAL_KINDS.includes(patch.kind as GoalKind) ? (patch.kind as GoalKind) : g.kind,
                name: patch.name !== undefined ? cleanText(patch.name, MAX_NAME_LENGTH) || g.name : g.name,
                emoji: patch.emoji !== undefined ? cleanText(patch.emoji, 8) || g.emoji : g.emoji,
                target: patch.target !== undefined ? (positiveCents(patch.target) ?? g.target) : g.target,
                deadline: patch.deadline ?? g.deadline,
                saved: patch.saved !== undefined ? patch.saved : g.saved,
                // `trip` and `move` are replaced when the patch names them (even with `undefined`), kept otherwise.
                trip: 'trip' in patch ? patch.trip : g.trip,
                move: 'move' in patch ? patch.move : g.move,
              })
            : g,
        ),
      });
    },

    /** Adds (or, when negative, takes out) money set aside for a goal. */
    addToGoal(id: string, delta: Cents): Goal | null {
      const current = data.goals.find((g) => g.id === id);
      if (!current) return null;
      const updated = { ...current, saved: Math.max(0, current.saved + (Number.isFinite(delta) ? Math.round(delta) : 0)) };
      commit({ ...data, goals: data.goals.map((g) => (g.id === id ? updated : g)) });
      return updated;
    },

    deleteGoal(id: string): Goal | null {
      const current = data.goals.find((g) => g.id === id);
      if (!current) return null;
      commit({ ...data, goals: data.goals.filter((g) => g.id !== id) });
      return current;
    },

    restoreGoal(goal: Goal) {
      if (data.goals.some((g) => g.id === goal.id)) return;
      commit({ ...data, goals: [...data.goals, goal] });
    },

    // ---- settings & whole-data operations
    /** Values a reload would repair or drop (a negative budget, an unknown theme...) are refused or cleaned here too. */
    updateSettings(patch: Partial<Settings>) {
      const next: Settings = { ...data.settings };
      if (patch.currency !== undefined && isSupportedCurrency(patch.currency)) next.currency = patch.currency;
      if (patch.locale !== undefined && isUsableLocale(patch.locale)) next.locale = patch.locale;
      if (patch.monthlyBudget !== undefined) next.monthlyBudget = positiveCents(patch.monthlyBudget);
      if (patch.monthlyIncome !== undefined) next.monthlyIncome = positiveCents(patch.monthlyIncome);
      if (patch.fxRate !== undefined) next.fxRate = typeof patch.fxRate === 'number' && Number.isFinite(patch.fxRate) && patch.fxRate > 0 ? patch.fxRate : null;
      if (patch.theme !== undefined && THEMES.includes(patch.theme)) next.theme = patch.theme;
      if (patch.haptics !== undefined) next.haptics = patch.haptics !== false;
      if (patch.onboarded !== undefined) next.onboarded = patch.onboarded === true;
      commit({ ...data, settings: next });
    },

    replaceAll(next: AppData) {
      commit(next);
    },

    mergeIn(incoming: AppData): MergeResult {
      const result = mergeData(data, incoming);
      commit(result.data);
      return result;
    },

    addDemoExpenses(drafts: Array<Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'demo'>>): number {
      const t = now();
      const created: Expense[] = drafts.map((d, i) => ({ ...d, id: makeId(), createdAt: t + i, updatedAt: t + i, demo: true }));
      commit({ ...data, expenses: [...data.expenses, ...created], settings: { ...data.settings, onboarded: true } });
      return created.length;
    },

    removeDemoExpenses(): number {
      const kept = data.expenses.filter((e) => !e.demo);
      const removed = data.expenses.length - kept.length;
      if (removed > 0) commit({ ...data, expenses: kept });
      return removed;
    },

    resetAll() {
      commit(createInitialData(options.language));
    },
  };

  return store;
}

