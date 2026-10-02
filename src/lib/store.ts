import { FALLBACK_CATEGORY_ID, pickNewCategoryColor } from './categories';
import {
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  createInitialData,
  makeIdGenerator,
  normalizeData,
} from './data';
import { isValidDateStr, todayStr } from './dates';
import { mergeData, type MergeResult } from './backup';
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

const cleanNote = (note: string | undefined): string => (note ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE_LENGTH);

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

  function load(): AppData {
    const fresh = () => createInitialData(options.language);
    if (!storage) return fresh();
    let raw: string | null = null;
    try {
      raw = storage.getItem(DATA_KEY);
    } catch {
      setStatus({ persistent: false });
      return fresh();
    }
    if (raw === null) return fresh();
    try {
      const normalized = normalizeData(JSON.parse(raw), { makeId, language: options.language });
      if (normalized) return normalized;
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

  let data: AppData = load();

  function save() {
    if (!storage) return;
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

    /** Re-reads storage (another tab changed it). */
    reload() {
      data = load();
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
      commit({ ...data, expenses: [...data.expenses, expense] });
    },

    // ---- folders
    addCategory(input: NewCategory): Category {
      const category: Category = {
        id: makeId(),
        name: input.name.trim().slice(0, MAX_NAME_LENGTH) || 'Sin nombre',
        emoji: input.emoji || '📦',
        color: input.color ?? pickNewCategoryColor(data.categories),
        flexible: input.flexible ?? false,
        limit: input.limit ?? null,
        archived: false,
        ...(input.kind && { kind: input.kind }),
      };
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
                ...patch,
                ...(patch.name !== undefined && { name: patch.name.trim().slice(0, MAX_NAME_LENGTH) || c.name }),
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
      const rule: Recurring = {
        id: makeId(),
        amount: input.amount,
        categoryId: categoryIdOrFallback(input.categoryId),
        note: cleanNote(input.note),
        day: Math.min(31, Math.max(1, Math.trunc(input.day))),
        startMonth: input.startMonth,
        lastGenerated: null,
        active: true,
      };
      commit({ ...data, recurring: [...data.recurring, rule] });
      return rule;
    },

    updateRecurring(id: string, patch: Partial<Pick<Recurring, 'amount' | 'categoryId' | 'note' | 'day' | 'active'>>) {
      commit({
        ...data,
        recurring: data.recurring.map((r) =>
          r.id === id
            ? {
                ...r,
                ...patch,
                ...(patch.note !== undefined && { note: cleanNote(patch.note) }),
                ...(patch.day !== undefined && { day: Math.min(31, Math.max(1, Math.trunc(patch.day))) }),
              }
            : r,
        ),
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
      const goal: Goal = {
        id: makeId(),
        kind: input.kind,
        name: input.name.trim().slice(0, MAX_NAME_LENGTH) || 'Mi meta',
        emoji: input.emoji || '🎯',
        target: input.target,
        deadline: input.deadline,
        saved: Math.max(0, Math.round(input.saved ?? 0)),
        createdAt: now(),
        ...(input.trip && { trip: input.trip }),
        ...(input.move && { move: input.move }),
      };
      commit({ ...data, goals: [...data.goals, goal] });
      return goal;
    },

    updateGoal(id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>) {
      commit({
        ...data,
        goals: data.goals.map((g) =>
          g.id === id
            ? {
                ...g,
                ...patch,
                ...(patch.name !== undefined && { name: patch.name.trim().slice(0, MAX_NAME_LENGTH) || g.name }),
                ...(patch.saved !== undefined && { saved: Math.max(0, Math.round(patch.saved)) }),
              }
            : g,
        ),
      });
    },

    /** Adds (or, when negative, takes out) money set aside for a goal. */
    addToGoal(id: string, delta: Cents): Goal | null {
      const current = data.goals.find((g) => g.id === id);
      if (!current) return null;
      const updated = { ...current, saved: Math.max(0, current.saved + Math.round(delta)) };
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
    updateSettings(patch: Partial<Settings>) {
      commit({ ...data, settings: { ...data.settings, ...patch } });
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

