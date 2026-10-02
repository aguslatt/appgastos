import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_KEYS, EMOJI_CHOICES } from './categories';
import { createInitialData, normalizeData } from './data';
import { addMonths, isValidDateStr, isValidMonthKey } from './dates';
import { firstMonthFor } from './recurring';
import { DATA_KEY, THEME_KEY, createStore, type NewExpense, type Store, type StorageLike } from './store';
import type { AppData, Expense, ThemePref } from './types';

const CORRUPT_KEY = 'mg:data:corrupt';
const TODAY = '2026-10-02';

// ---- helpers ----------------------------------------------------------------

interface MemoryStorage extends StorageLike {
  map: Map<string, string>;
  failGet: boolean;
  failSet: boolean;
  writes: string[];
}

function memoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const m: MemoryStorage = {
    map: new Map(Object.entries(seed)),
    failGet: false,
    failSet: false,
    writes: [],
    getItem(key) {
      if (m.failGet) throw new Error('getItem blocked');
      return m.map.get(key) ?? null;
    },
    setItem(key, value) {
      if (m.failSet) throw new Error('quota exceeded');
      m.writes.push(key);
      m.map.set(key, value);
    },
    removeItem(key) {
      m.map.delete(key);
    },
  };
  return m;
}

/** A store with sequential ids (`<prefix>-1`, ...) and a clock that advances one second per reading. */
function setup(options: { storage?: StorageLike | null; language?: string; prefix?: string } = {}): { store: Store; ids: () => number } {
  let n = 0;
  let clock = 1_700_000_000_000;
  const store = createStore({
    storage: options.storage === undefined ? memoryStorage() : options.storage,
    language: options.language,
    makeId: () => `${options.prefix ?? 'id'}-${++n}`,
    now: () => (clock += 1000),
  });
  return { store, ids: () => n };
}

const add = (store: Store, overrides: Partial<NewExpense> = {}): Expense =>
  store.addExpense({ amount: 1500, categoryId: 'super', date: TODAY, ...overrides });

const saved = (storage: MemoryStorage): AppData => JSON.parse(storage.map.get(DATA_KEY) ?? 'null') as AppData;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What a reload would make of the current state: equal to it when nothing needs repairing. */
function canonicalForm(data: AppData): AppData | null {
  return normalizeData(clone(data), {
    makeId: () => {
      throw new Error('a reload would have to repair an id');
    },
    today: TODAY,
  });
}

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

const hasLoneSurrogate = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

afterEach(() => {
  vi.useRealTimers();
});

// ---- creating a store and loading saved data --------------------------------

describe('createStore: starting up', () => {
  it('starts from the defaults and writes nothing until something changes', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    expect(store.getData()).toStrictEqual(createInitialData());
    expect(store.getStatus()).toEqual({ persistent: true, recovered: false });
    expect(storage.writes).toEqual([]);
  });

  it('takes locale and currency for a first launch from the browser language', () => {
    const { store } = setup({ language: 'es-MX' });
    expect(store.getData().settings).toMatchObject({ locale: 'es-MX', currency: 'MXN' });
    expect(store.getData()).toStrictEqual(createInitialData('es-MX'));
  });

  it('works without any storage, in memory, and says it is not persistent', () => {
    for (const storage of [null, undefined]) {
      const store = createStore({ storage, makeId: () => 'x', now: () => 1 });
      expect(store.getStatus()).toEqual({ persistent: false, recovered: false });
      store.addExpense({ amount: 100, categoryId: 'super', date: TODAY });
      expect(store.getData().expenses).toHaveLength(1);
      expect(store.getStatus().persistent).toBe(false);
    }
  });

  it('loads saved data and repairs whatever is off in it', () => {
    const storage = memoryStorage({
      [DATA_KEY]: JSON.stringify({
        expenses: [{ id: 'a', amount: 1500.4, date: '2026-10-01', categoryId: 'ghost', note: '  hi  ' }, { id: 'bad', amount: -1, date: '2026-10-01' }],
        settings: { theme: 'neon', currency: 'EUR' },
      }),
    });
    const { store } = setup({ storage });
    expect(store.getData().expenses.map((e) => [e.id, e.amount, e.categoryId, e.note])).toEqual([['a', 1500, 'otros', 'hi']]);
    expect(store.getData().settings).toMatchObject({ theme: 'system', currency: 'EUR', onboarded: true });
    expect(store.getStatus().recovered).toBe(false);
  });

  it('prefers saved settings over the browser language', () => {
    const storage = memoryStorage({ [DATA_KEY]: JSON.stringify({ settings: { currency: 'USD', locale: 'es-AR' }, expenses: [] }) });
    const { store } = setup({ storage, language: 'es-MX' });
    expect(store.getData().settings).toMatchObject({ currency: 'USD', locale: 'es-AR' });
  });
});

describe('createStore: damaged storage', () => {
  it.each([
    ['invalid JSON', '{not json'],
    ['a truncated file', '{"expenses":[{"id":"a","amount":10'],
    ['empty text', ''],
    ['plain words', 'hola'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
    ['a number', '42'],
    ['an object that is not a backup', '{"foo":"bar"}'],
  ])('recovers from %s: starts fresh and keeps the raw text aside', (_label, raw) => {
    const storage = memoryStorage({ [DATA_KEY]: raw });
    const { store } = setup({ storage });
    expect(store.getStatus()).toEqual({ persistent: true, recovered: true });
    expect(store.getData()).toStrictEqual(createInitialData());
    expect(storage.map.get(CORRUPT_KEY)).toBe(raw);
  });

  it('leaves the damaged text in place until the first save, then replaces it and keeps the copy', () => {
    const storage = memoryStorage({ [DATA_KEY]: '{not json' });
    const { store } = setup({ storage });
    expect(storage.map.get(DATA_KEY)).toBe('{not json');
    add(store);
    expect(saved(storage).expenses).toHaveLength(1);
    expect(storage.map.get(CORRUPT_KEY)).toBe('{not json');
    expect(store.getStatus().recovered).toBe(true);
  });

  it('still starts when the damaged copy cannot even be kept aside', () => {
    const storage = memoryStorage({ [DATA_KEY]: '{not json' });
    storage.failSet = true;
    const { store } = setup({ storage });
    expect(store.getStatus().recovered).toBe(true);
    expect(() => add(store)).not.toThrow();
    expect(store.getData().expenses).toHaveLength(1);
  });

  it('does not flag healthy empty storage as damaged', () => {
    expect(setup({ storage: memoryStorage() }).store.getStatus().recovered).toBe(false);
  });
});

describe('createStore: storage that throws', () => {
  it('starts fresh and reports not persistent when reading fails, and keeps working in memory', () => {
    const storage = memoryStorage();
    storage.failGet = true;
    storage.failSet = true;
    const { store } = setup({ storage });
    expect(store.getStatus().persistent).toBe(false);
    expect(store.getData()).toStrictEqual(createInitialData());
    add(store, { amount: 100 });
    add(store, { amount: 200 });
    expect(store.getData().expenses.map((e) => e.amount)).toEqual([100, 200]);
    expect(store.getStatus()).toEqual({ persistent: false, recovered: false });
  });

  it('reports not persistent after the first failed save, and keeps every change in memory', () => {
    const storage = memoryStorage();
    storage.failSet = true;
    const { store } = setup({ storage });
    expect(store.getStatus().persistent).toBe(true);
    add(store, { amount: 100 });
    expect(store.getStatus().persistent).toBe(false);
    const category = store.addCategory({ name: 'Gym', emoji: '🏋️' });
    store.updateSettings({ theme: 'dark' });
    store.addRecurring({ amount: 5, categoryId: category.id, day: 3, startMonth: '2026-10' });
    expect(store.getData().expenses).toHaveLength(1);
    expect(store.getData().categories.some((c) => c.id === category.id)).toBe(true);
    expect(store.getData().settings.theme).toBe('dark');
    expect(store.getData().recurring).toHaveLength(1);
    expect(storage.map.size).toBe(0);
  });

  it('notifies subscribers even when saving fails', () => {
    const storage = memoryStorage();
    storage.failSet = true;
    const { store } = setup({ storage });
    const listener = vi.fn();
    store.subscribe(listener);
    add(store);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('goes back to persistent as soon as saving works again, and then holds everything', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    add(store, { amount: 100 });
    storage.failSet = true;
    add(store, { amount: 200 });
    expect(store.getStatus().persistent).toBe(false);
    storage.failSet = false;
    add(store, { amount: 300 });
    expect(store.getStatus().persistent).toBe(true);
    expect(saved(storage).expenses.map((e) => e.amount)).toEqual([100, 200, 300]);
  });

  it('keeps the status object stable while nothing about it changes (needed by useSyncExternalStore)', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    const first = store.getStatus();
    add(store);
    add(store);
    expect(store.getStatus()).toBe(first);
    storage.failSet = true;
    add(store);
    const failed = store.getStatus();
    expect(failed).not.toBe(first);
    add(store);
    expect(store.getStatus()).toBe(failed);
  });
});

// ---- persistence ------------------------------------------------------------

describe('persistence', () => {
  it('saves after every change under the data key, and mirrors the theme for the first paint', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    add(store);
    expect(saved(storage)).toStrictEqual(clone(store.getData()));
    expect(storage.map.get(THEME_KEY)).toBe('system');
    store.updateSettings({ theme: 'dark' });
    expect(storage.map.get(THEME_KEY)).toBe('dark');
    store.updateSettings({ theme: 'light' });
    expect(storage.map.get(THEME_KEY)).toBe('light');
  });

  it('a second store on the same storage sees everything the first one did', () => {
    const storage = memoryStorage();
    const first = setup({ storage }).store;
    first.updateSettings({ onboarded: true, monthlyBudget: 500_000_00, theme: 'dark' });
    const gym = first.addCategory({ name: 'Gimnasio', emoji: '🏋️', flexible: true, limit: 80_000_00 });
    const lunch = add(first, { amount: 12_550, categoryId: gym.id, note: '  almuerzo   rico ', date: '2026-09-30' });
    add(first, { amount: 99, categoryId: 'comida' });
    first.updateExpense(lunch.id, { amount: 13_000 });
    first.addRecurring({ amount: 450_000_00, categoryId: 'hogar', note: 'Alquiler', day: 31, startMonth: '2026-08' });
    first.runRecurring(TODAY);
    first.addGoal({ kind: 'saving', name: 'Vacaciones', emoji: '🏖️', target: 900_000_00, deadline: '2027-01', saved: 50_000_00 });
    const removed = add(first, { amount: 5 });
    first.deleteExpense(removed.id);
    first.deleteCategory('mascotas');

    const second = setup({ storage, prefix: 'b' }).store;
    expect(second.getData()).toStrictEqual(first.getData());
    expect(second.getStatus()).toEqual({ persistent: true, recovered: false });
    second.runRecurring(TODAY);
    expect(second.getData()).toStrictEqual(first.getData());
  });

  it('keeps working across several generations of stores', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 5; i++) add(setup({ storage, prefix: `g${i}` }).store, { amount: i + 1 });
    expect(setup({ storage, prefix: 'last' }).store.getData().expenses.map((e) => e.amount)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reload() picks up what another store (another tab) saved, and tells the subscribers', () => {
    const storage = memoryStorage();
    const a = setup({ storage, prefix: 'a' }).store;
    const b = setup({ storage, prefix: 'b' }).store;
    const listener = vi.fn();
    a.subscribe(listener);
    add(b, { amount: 777 });
    expect(a.getData().expenses).toHaveLength(0);
    a.reload();
    expect(a.getData().expenses.map((e) => e.amount)).toEqual([777]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('without a reload, the stale store simply overwrites (last writer wins)', () => {
    const storage = memoryStorage();
    const a = setup({ storage, prefix: 'a' }).store;
    const b = setup({ storage, prefix: 'b' }).store;
    add(a, { amount: 1 });
    add(b, { amount: 2 });
    expect(saved(storage).expenses.map((e) => e.amount)).toEqual([2]);
  });
});

// ---- subscribing and snapshots ----------------------------------------------

describe('subscribe and snapshots', () => {
  it('calls a subscriber once per change and stops after unsubscribing', () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    add(store);
    store.updateSettings({ haptics: false });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    add(store);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('serves several subscribers independently', () => {
    const { store } = setup();
    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    store.subscribe(b);
    add(store);
    offA();
    add(store);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('stays silent, and leaves the snapshot alone, when nothing changed', () => {
    const { store } = setup();
    const kept = add(store);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getData();
    store.deleteExpense('missing');
    store.updateExpense('missing', { amount: 5 });
    store.restoreExpense(kept);
    store.deleteCategory('otros');
    store.removeDemoExpenses();
    store.runRecurring(TODAY);
    store.addToGoal('missing', 5);
    store.deleteGoal('missing');
    expect(() => store.addExpense({ amount: 0, categoryId: 'super', date: TODAY })).toThrow();
    expect(() => store.addGoal({ kind: 'saving', name: 'x', emoji: 'x', target: 0, deadline: '2027-01' })).toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getData()).toBe(before);
  });

  it('hands out a new snapshot per change and never edits an old one', () => {
    const { store } = setup();
    const snapshots: AppData[] = [store.getData()];
    const frozen: string[] = [JSON.stringify(store.getData())];
    const remember = () => {
      snapshots.push(store.getData());
      frozen.push(JSON.stringify(store.getData()));
    };
    const e = add(store);
    remember();
    store.updateExpense(e.id, { amount: 99 });
    remember();
    const c = store.addCategory({ name: 'X', emoji: 'x' });
    remember();
    store.updateCategory(c.id, { archived: true });
    remember();
    store.deleteCategory(c.id);
    remember();
    const r = store.addRecurring({ amount: 5, categoryId: 'super', day: 1, startMonth: '2026-10' });
    remember();
    store.runRecurring(TODAY);
    remember();
    store.updateRecurring(r.id, { active: false });
    remember();
    const g = store.addGoal({ kind: 'saving', name: 'g', emoji: '🎯', target: 10, deadline: '2027-01' });
    remember();
    store.addToGoal(g.id, 5);
    remember();
    store.updateSettings({ theme: 'dark' });
    remember();
    store.deleteExpense(e.id);
    remember();
    store.resetAll();
    remember();
    snapshots.forEach((snap, i) => expect(JSON.stringify(snap)).toBe(frozen[i]));
    expect(new Set(snapshots).size).toBe(snapshots.length);
  });

  it('saves before it notifies, so a subscriber reading storage sees the change', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    let seen = 0;
    store.subscribe(() => {
      seen = saved(storage).expenses.length;
    });
    add(store);
    expect(seen).toBe(1);
  });

  it('commits and saves a change even when a subscriber throws', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    store.subscribe(() => {
      throw new Error('bad subscriber');
    });
    try {
      add(store);
    } catch {
      // propagating the subscriber's error is allowed; losing the data is not
    }
    expect(store.getData().expenses).toHaveLength(1);
    expect(saved(storage).expenses).toHaveLength(1);
  });
});

// ---- expenses ---------------------------------------------------------------

describe('addExpense', () => {
  it('creates and returns the expense with an id from makeId and timestamps from the clock', () => {
    const { store } = setup();
    const e = add(store, { amount: 12_550, categoryId: 'comida', note: 'Pizza', date: '2026-09-30' });
    expect(e).toStrictEqual({
      id: 'id-1', amount: 12_550, categoryId: 'comida', note: 'Pizza', date: '2026-09-30', createdAt: 1_700_000_001_000, updatedAt: 1_700_000_001_000,
    });
    expect(store.getData().expenses).toEqual([e]);
  });

  it('allows identical expenses, each with its own id', () => {
    const { store } = setup();
    const a = add(store);
    const b = add(store);
    expect(a.id).not.toBe(b.id);
    expect(store.getData().expenses).toHaveLength(2);
  });

  it.each([
    ['trims', '  almuerzo  ', 'almuerzo'],
    ['collapses runs of blanks', 'a    b', 'a b'],
    ['turns tabs and line breaks into single spaces', 'a\t\n\r\n b', 'a b'],
    ['keeps accents and emoji', 'café ☕ ñandú', 'café ☕ ñandú'],
    ['becomes empty for blanks', ' \n\t ', ''],
    ['becomes empty when missing', undefined, ''],
  ])('note: %s', (_label, note, expected) => {
    const { store } = setup();
    expect(add(store, { note }).note).toBe(expected);
  });

  it('cuts an extremely long note and still saves it', () => {
    const { store } = setup();
    const e = add(store, { note: 'palabra '.repeat(50_000) });
    expect(e.note.length).toBeLessThanOrEqual(80);
    expect(e.note.length).toBeGreaterThan(0);
  });

  it('puts an unknown or missing folder into "otros", and keeps an archived folder', () => {
    const { store } = setup();
    const old = store.addCategory({ name: 'Vieja', emoji: '📦' });
    store.updateCategory(old.id, { archived: true });
    expect(add(store, { categoryId: 'nope' }).categoryId).toBe('otros');
    expect(add(store, { categoryId: '' }).categoryId).toBe('otros');
    expect(add(store, { categoryId: undefined as unknown as string }).categoryId).toBe('otros');
    expect(add(store, { categoryId: old.id }).categoryId).toBe(old.id);
  });

  it.each([
    ['zero', 0], ['negative', -1], ['a decimal', 1.5], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '100'], ['null', null], ['undefined', undefined], ['beyond the safe integers', 2 ** 53],
  ])('refuses an amount that is %s, leaving no trace', (_label, amount) => {
    const storage = memoryStorage();
    const { store, ids } = setup({ storage });
    const before = store.getData();
    expect(() => add(store, { amount: amount as number })).toThrow('Invalid amount');
    expect(store.getData()).toBe(before);
    expect(storage.writes).toEqual([]);
    expect(ids()).toBe(0);
  });

  it.each([
    ['Feb 30', '2026-02-30'], ['month 13', '2026-13-01'], ['unpadded', '2026-1-1'], ['empty', ''], ['a timestamp', '2026-10-02T10:00:00Z'],
    ['a number', 20_261_002], ['null', null], ['undefined', undefined], ['a Date', new Date(2026, 9, 2)], ['a trailing newline', '2026-10-02\n'],
  ])('refuses a date that is %s, leaving no trace', (_label, date) => {
    const { store } = setup();
    const before = store.getData();
    expect(() => add(store, { date: date as string })).toThrow('Invalid date');
    expect(store.getData()).toBe(before);
  });

  it('accepts the extremes: one cent, the largest safe amount, a leap day', () => {
    const { store } = setup();
    expect(add(store, { amount: 1 }).amount).toBe(1);
    expect(add(store, { amount: Number.MAX_SAFE_INTEGER }).amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(add(store, { date: '2024-02-29' }).date).toBe('2024-02-29');
  });

  it('uses the real clock when no `now` is injected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const store = createStore({ storage: null, makeId: () => 'x' });
    expect(store.addExpense({ amount: 1, categoryId: 'super', date: TODAY }).createdAt).toBe(1_800_000_000_000);
  });

  it('generates distinct ids by default', () => {
    const store = createStore({ storage: null });
    const ids = Array.from({ length: 200 }, () => store.addExpense({ amount: 1, categoryId: 'super', date: TODAY }).id);
    expect(new Set(ids).size).toBe(200);
  });
});

describe('updateExpense', () => {
  it('changes only the fields given, bumps updatedAt and keeps the rest', () => {
    const { store } = setup();
    const original = add(store, { note: 'x', date: '2026-09-01' });
    const updated = store.updateExpense(original.id, { amount: 2000, note: '  nuevo   texto ' })!;
    expect(updated).toStrictEqual({ ...original, amount: 2000, note: 'nuevo texto', updatedAt: 1_700_000_002_000 });
    expect(updated.createdAt).toBe(original.createdAt);
    expect(store.getData().expenses).toEqual([updated]);
  });

  it('can move an expense to another date and folder, and falls back to "otros" for an unknown folder', () => {
    const { store } = setup();
    const e = add(store);
    expect(store.updateExpense(e.id, { date: '2024-02-29', categoryId: 'comida' })).toMatchObject({ date: '2024-02-29', categoryId: 'comida' });
    expect(store.updateExpense(e.id, { categoryId: 'ghost' })!.categoryId).toBe('otros');
  });

  it('keeps recurringId and demo, and ignores undefined fields in the patch', () => {
    const { store } = setup();
    store.addRecurring({ amount: 500, categoryId: 'hogar', day: 1, startMonth: '2026-10' });
    store.runRecurring(TODAY);
    const generated = store.getData().expenses[0]!;
    const patched = store.updateExpense(generated.id, { note: 'editado', amount: undefined })!;
    expect(patched.recurringId).toBe(generated.recurringId);
    expect(patched.amount).toBe(500);
    store.addDemoExpenses([{ amount: 5, categoryId: 'super', note: '', date: TODAY }]);
    const demo = store.getData().expenses.find((e) => e.demo)!;
    expect(store.updateExpense(demo.id, { amount: 6 })!.demo).toBe(true);
  });

  it('returns null for an unknown id, without a trace', () => {
    const { store } = setup();
    const before = store.getData();
    expect(store.updateExpense('nope', { amount: 5 })).toBeNull();
    expect(store.getData()).toBe(before);
  });

  it('is all-or-nothing: a bad part of the patch leaves the expense untouched', () => {
    const { store } = setup();
    const e = add(store);
    const before = store.getData();
    expect(() => store.updateExpense(e.id, { amount: 99, date: 'garbage' })).toThrow('Invalid date');
    expect(() => store.updateExpense(e.id, { note: 'x', amount: 0 })).toThrow('Invalid amount');
    expect(() => store.updateExpense(e.id, { amount: 1.5 })).toThrow('Invalid amount');
    expect(store.getData()).toBe(before);
  });

  it('an empty patch only touches updatedAt', () => {
    const { store } = setup();
    const e = add(store);
    const updated = store.updateExpense(e.id, {})!;
    expect({ ...updated, updatedAt: 0 }).toEqual({ ...e, updatedAt: 0 });
    expect(updated.updatedAt).toBeGreaterThan(e.updatedAt);
  });
});

describe('deleteExpense and restoreExpense (undo)', () => {
  it('removes the expense and returns it', () => {
    const { store } = setup();
    const a = add(store, { amount: 1 });
    const b = add(store, { amount: 2 });
    expect(store.deleteExpense(a.id)).toBe(a);
    expect(store.getData().expenses).toEqual([b]);
    expect(store.deleteExpense(a.id)).toBeNull();
  });

  it('undo puts back exactly what was removed', () => {
    const { store } = setup();
    const e = add(store, { note: 'importante' });
    const removed = store.deleteExpense(e.id)!;
    store.restoreExpense(removed);
    expect(store.getData().expenses).toEqual([e]);
  });

  it('is idempotent: restoring twice, or restoring something that is already there, changes nothing', () => {
    const { store } = setup();
    const e = add(store);
    const removed = store.deleteExpense(e.id)!;
    store.restoreExpense(removed);
    const after = store.getData();
    const listener = vi.fn();
    store.subscribe(listener);
    store.restoreExpense(removed);
    store.restoreExpense({ ...removed, amount: 999 });
    expect(store.getData()).toBe(after);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getData().expenses).toHaveLength(1);
    expect(store.getData().expenses[0]!.amount).toBe(e.amount);
  });

  it('undoing one deletion among many restores that one only', () => {
    const { store } = setup();
    const [a, b, c] = [add(store, { amount: 1 }), add(store, { amount: 2 }), add(store, { amount: 3 })];
    const removedB = store.deleteExpense(b.id)!;
    store.deleteExpense(c.id);
    store.restoreExpense(removedB);
    expect(store.getData().expenses.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('survives a reload', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    const removed = store.deleteExpense(add(store).id)!;
    store.restoreExpense(removed);
    expect(setup({ storage, prefix: 'b' }).store.getData().expenses).toEqual([removed]);
  });
});

// ---- folders ----------------------------------------------------------------

describe('folders', () => {
  it('addCategory fills in sensible defaults', () => {
    const { store } = setup();
    const c = store.addCategory({ name: '  Gimnasio  ', emoji: '🏋️' });
    expect(c).toStrictEqual({ id: 'id-1', name: 'Gimnasio', emoji: '🏋️', color: 'blue', flexible: false, limit: null, archived: false });
    expect(store.getData().categories.at(-1)).toBe(c);
  });

  it('addCategory keeps what it is given, including the semantic kind', () => {
    const { store } = setup();
    const c = store.addCategory({ name: 'Cine', emoji: '🎬', kind: 'ocio', color: 'red', flexible: true, limit: 50_000_00 });
    expect(c).toStrictEqual({ id: 'id-1', name: 'Cine', emoji: '🎬', color: 'red', flexible: true, limit: 50_000_00, archived: false, kind: 'ocio' });
    expect('kind' in store.addCategory({ name: 'Sin kind', emoji: 'x' })).toBe(false);
  });

  it.each([
    ['blank', '   ', 'Sin nombre'],
    ['empty', '', 'Sin nombre'],
    ['long', 'x'.repeat(100), 'x'.repeat(30)],
  ])('addCategory with a %s name', (_label, name, expected) => {
    const { store } = setup();
    expect(store.addCategory({ name, emoji: 'x' }).name).toBe(expected);
  });

  it('addCategory uses the placeholder emoji when none is given', () => {
    const { store } = setup();
    expect(store.addCategory({ name: 'x', emoji: '' }).emoji).toBe('📦');
  });

  it('updateCategory changes only the fields given', () => {
    const { store } = setup();
    const c = store.addCategory({ name: 'Cine', emoji: '🎬' });
    store.updateCategory(c.id, { limit: 10_000, flexible: true });
    store.updateCategory(c.id, { archived: true, color: 'lime' });
    expect(store.getData().categories.find((x) => x.id === c.id)).toMatchObject({ name: 'Cine', emoji: '🎬', limit: 10_000, flexible: true, archived: true, color: 'lime' });
    store.updateCategory(c.id, { archived: false, limit: null });
    expect(store.getData().categories.find((x) => x.id === c.id)).toMatchObject({ archived: false, limit: null });
  });

  it('updateCategory trims and cuts a new name and keeps the old one when the new one is blank', () => {
    const { store } = setup();
    const c = store.addCategory({ name: 'Cine', emoji: '🎬' });
    store.updateCategory(c.id, { name: '  Teatro  ' });
    expect(store.getData().categories.find((x) => x.id === c.id)!.name).toBe('Teatro');
    store.updateCategory(c.id, { name: '    ' });
    expect(store.getData().categories.find((x) => x.id === c.id)!.name).toBe('Teatro');
    store.updateCategory(c.id, { name: 'n'.repeat(80) });
    expect(store.getData().categories.find((x) => x.id === c.id)!.name).toBe('n'.repeat(30));
  });

  it('updateCategory on an unknown id changes nothing', () => {
    const { store } = setup();
    const before = clone(store.getData());
    store.updateCategory('ghost', { name: 'x', archived: true });
    expect(clone(store.getData())).toStrictEqual(before);
  });

  describe('deleteCategory', () => {
    it('refuses to delete the fallback folder, without a trace', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      add(store, { categoryId: 'otros' });
      const before = store.getData();
      const writes = storage.writes.length;
      const listener = vi.fn();
      store.subscribe(listener);
      store.deleteCategory('otros');
      expect(store.getData()).toBe(before);
      expect(store.getData().categories.some((c) => c.id === 'otros')).toBe(true);
      expect(storage.writes).toHaveLength(writes);
      expect(listener).not.toHaveBeenCalled();
    });

    it('moves the folder\'s expenses and rules to "otros" and leaves everything else alone', () => {
      const { store } = setup();
      const keep = add(store, { categoryId: 'comida' });
      const moved = add(store, { categoryId: 'mascotas', amount: 7 });
      const rule = store.addRecurring({ amount: 5, categoryId: 'mascotas', day: 1, startMonth: '2026-11' });
      const otherRule = store.addRecurring({ amount: 6, categoryId: 'hogar', day: 1, startMonth: '2026-11' });
      store.deleteCategory('mascotas');
      const data = store.getData();
      expect(data.categories.some((c) => c.id === 'mascotas')).toBe(false);
      expect(data.expenses.find((e) => e.id === moved.id)).toMatchObject({ categoryId: 'otros', amount: 7 });
      expect(data.expenses.find((e) => e.id === moved.id)!.updatedAt).toBeGreaterThan(moved.updatedAt);
      expect(data.expenses.find((e) => e.id === keep.id)).toBe(keep);
      expect(data.recurring.find((r) => r.id === rule.id)!.categoryId).toBe('otros');
      expect(data.recurring.find((r) => r.id === otherRule.id)!.categoryId).toBe('hogar');
    });

    it('can delete a custom or archived folder, and survives deleting the same one twice', () => {
      const { store } = setup();
      const c = store.addCategory({ name: 'Vieja', emoji: 'x' });
      store.updateCategory(c.id, { archived: true });
      add(store, { categoryId: c.id });
      store.deleteCategory(c.id);
      store.deleteCategory(c.id);
      expect(store.getData().categories.some((x) => x.id === c.id)).toBe(false);
      expect(store.getData().expenses[0]!.categoryId).toBe('otros');
    });

    it('a deleted folder id does not come back through the fallback when new expenses use it', () => {
      const { store } = setup();
      store.deleteCategory('mascotas');
      expect(add(store, { categoryId: 'mascotas' }).categoryId).toBe('otros');
    });
  });

  it('archived folders keep their expenses', () => {
    const { store } = setup();
    const c = store.addCategory({ name: 'X', emoji: 'x' });
    const e = add(store, { categoryId: c.id });
    store.updateCategory(c.id, { archived: true });
    expect(store.getData().expenses.find((x) => x.id === e.id)!.categoryId).toBe(c.id);
  });
});

// ---- fixed expenses ---------------------------------------------------------

describe('recurring rules', () => {
  const rule = (store: Store, overrides: Partial<Parameters<Store['addRecurring']>[0]> = {}) =>
    store.addRecurring({ amount: 450_000_00, categoryId: 'hogar', note: 'Alquiler', day: 10, startMonth: '2026-10', ...overrides });

  it('addRecurring stores a new active rule that has not generated anything yet', () => {
    const { store } = setup();
    expect(rule(store)).toStrictEqual({
      id: 'id-1', amount: 450_000_00, categoryId: 'hogar', note: 'Alquiler', day: 10, startMonth: '2026-10', lastGenerated: null, active: true,
    });
    expect(store.getData().expenses).toEqual([]);
  });

  it.each([[0, 1], [-5, 1], [1, 1], [15, 15], [31, 31], [32, 31], [45, 31], [15.9, 15]])('addRecurring clamps day %s to %i', (day, expected) => {
    const { store } = setup();
    expect(rule(store, { day }).day).toBe(expected);
  });

  it('addRecurring cleans the note and sends an unknown folder to "otros"', () => {
    const { store } = setup();
    const r = rule(store, { note: '  Netflix   HD ', categoryId: 'ghost' });
    expect(r).toMatchObject({ note: 'Netflix HD', categoryId: 'otros' });
  });

  it('updateRecurring changes only what is given, clamps the day and cleans the note', () => {
    const { store } = setup();
    const r = rule(store);
    store.updateRecurring(r.id, { amount: 500_000_00, note: '  Depto  ', day: 99 });
    expect(store.getData().recurring[0]).toMatchObject({ amount: 500_000_00, note: 'Depto', day: 31, categoryId: 'hogar', active: true, lastGenerated: null });
    store.updateRecurring(r.id, { day: 0, active: false });
    expect(store.getData().recurring[0]).toMatchObject({ day: 1, active: false });
  });

  it('deleteRecurring stops the rule but keeps what it already recorded', () => {
    const { store } = setup();
    const r = rule(store, { day: 1, startMonth: '2026-09' });
    store.runRecurring(TODAY);
    expect(store.getData().expenses).toHaveLength(2);
    store.deleteRecurring(r.id);
    store.runRecurring('2027-03-01');
    expect(store.getData().recurring).toEqual([]);
    expect(store.getData().expenses).toHaveLength(2);
  });

  describe('runRecurring', () => {
    it('records what came due, dated on the due day, tagged with its rule, and says how many', () => {
      const { store } = setup();
      const r = rule(store, { day: 5, startMonth: '2026-08' });
      expect(store.runRecurring(TODAY)).toBe(2);
      const generated = store.getData().expenses;
      expect(generated.map((e) => e.date)).toEqual(['2026-08-05', '2026-09-05']);
      expect(generated.every((e) => e.recurringId === r.id && e.amount === 450_000_00 && e.categoryId === 'hogar' && e.note === 'Alquiler')).toBe(true);
      expect(store.getData().recurring[0]!.lastGenerated).toBe('2026-09');
    });

    it('is idempotent: running it again changes nothing, notifies nobody and writes nothing', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      rule(store, { day: 1, startMonth: '2026-08' });
      store.runRecurring(TODAY);
      const after = store.getData();
      const writes = storage.writes.length;
      const listener = vi.fn();
      store.subscribe(listener);
      expect(store.runRecurring(TODAY)).toBe(0);
      expect(store.runRecurring(TODAY)).toBe(0);
      expect(store.getData()).toBe(after);
      expect(storage.writes).toHaveLength(writes);
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not resurrect an expense the user deleted', () => {
      const { store } = setup();
      rule(store, { day: 1, startMonth: '2026-10' });
      store.runRecurring(TODAY);
      const generated = store.getData().expenses[0]!;
      store.deleteExpense(generated.id);
      expect(store.runRecurring(TODAY)).toBe(0);
      expect(store.runRecurring('2026-10-31')).toBe(0);
      expect(store.getData().expenses).toEqual([]);
      expect(store.runRecurring('2026-11-01')).toBe(1);
    });

    it('does not regenerate an expense the user edited, and the edit stays', () => {
      const { store } = setup();
      rule(store, { day: 1, startMonth: '2026-10' });
      store.runRecurring(TODAY);
      const generated = store.getData().expenses[0]!;
      store.updateExpense(generated.id, { amount: 123, date: '2026-10-15' });
      expect(store.runRecurring('2026-10-20')).toBe(0);
      expect(store.getData().expenses).toHaveLength(1);
      expect(store.getData().expenses[0]).toMatchObject({ amount: 123, date: '2026-10-15', recurringId: generated.recurringId });
    });

    it('skips inactive rules and does nothing at all when only they exist', () => {
      const { store } = setup();
      const r = rule(store, { day: 1, startMonth: '2026-08' });
      store.updateRecurring(r.id, { active: false });
      const before = store.getData();
      expect(store.runRecurring(TODAY)).toBe(0);
      expect(store.getData()).toBe(before);
    });

    it('waits for a startMonth in the future', () => {
      const { store } = setup();
      rule(store, { startMonth: '2027-01', day: 1 });
      expect(store.runRecurring(TODAY)).toBe(0);
      expect(store.runRecurring('2027-01-01')).toBe(1);
    });

    it('a rule created in the middle of the month starts when its day arrives (see firstMonthFor)', () => {
      const { store } = setup();
      const today = '2026-10-15';
      rule(store, { day: 10, startMonth: firstMonthFor(10, today) });
      expect(store.runRecurring(today)).toBe(0);
      expect(store.runRecurring('2026-10-31')).toBe(0);
      expect(store.runRecurring('2026-11-10')).toBe(1);
      expect(store.getData().expenses[0]!.date).toBe('2026-11-10');

      const later = setup().store;
      later.addRecurring({ amount: 5, categoryId: 'hogar', day: 20, startMonth: firstMonthFor(20, today) });
      expect(later.runRecurring(today)).toBe(0);
      expect(later.runRecurring('2026-10-20')).toBe(1);

      const same = setup().store;
      same.addRecurring({ amount: 5, categoryId: 'hogar', day: 15, startMonth: firstMonthFor(15, today) });
      expect(same.runRecurring(today)).toBe(1);
      expect(same.getData().expenses[0]!.date).toBe(today);
    });

    it('records day 31 on the last day of each month as the days go by, and never drifts', () => {
      const { store } = setup();
      rule(store, { day: 31, startMonth: '2027-01' });
      const seen: string[] = [];
      for (let d = new Date(Date.UTC(2027, 0, 1)); d <= new Date(Date.UTC(2027, 4, 1)); d = new Date(d.getTime() + 86_400_000)) {
        const day = d.toISOString().slice(0, 10);
        if (store.runRecurring(day) > 0) seen.push(`${day}=${store.getData().expenses.at(-1)!.date}`);
      }
      expect(seen).toEqual(['2027-01-31=2027-01-31', '2027-02-28=2027-02-28', '2027-03-31=2027-03-31', '2027-04-30=2027-04-30']);
    });

    it('uses February 29 in a leap year', () => {
      const { store } = setup();
      rule(store, { day: 30, startMonth: '2028-02' });
      expect(store.runRecurring('2028-02-28')).toBe(0);
      expect(store.runRecurring('2028-02-29')).toBe(1);
      expect(store.getData().expenses[0]!.date).toBe('2028-02-29');
    });

    it('catches up several months at once, across a year end', () => {
      const { store } = setup();
      rule(store, { day: 20, startMonth: '2026-11' });
      expect(store.runRecurring('2027-02-25')).toBe(4);
      expect(store.getData().expenses.map((e) => e.date)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20', '2027-02-20']);
    });

    it('caps one run, then finishes on the next, with no gaps or repeats', () => {
      const { store } = setup();
      rule(store, { day: 1, startMonth: '2023-06' });
      const first = store.runRecurring(TODAY);
      expect(first).toBeLessThan(41);
      expect(first).toBeGreaterThan(12);
      expect(store.runRecurring(TODAY)).toBe(41 - first);
      expect(store.runRecurring(TODAY)).toBe(0);
      const months = store.getData().expenses.map((e) => e.date.slice(0, 7));
      expect(new Set(months).size).toBe(41);
      expect([...months].sort()).toEqual(months);
    });

    it('creates expenses stamped with the clock, one id each, in the folder the rule has now', () => {
      const { store, ids } = setup();
      rule(store, { day: 1, startMonth: '2026-08', categoryId: 'mascotas' });
      store.deleteCategory('mascotas');
      const idsBefore = ids();
      store.runRecurring(TODAY);
      const created = store.getData().expenses;
      expect(ids() - idsBefore).toBe(created.length);
      expect(new Set(created.map((e) => e.id)).size).toBe(created.length);
      expect(new Set(created.map((e) => e.createdAt)).size).toBe(1);
      expect(created.every((e) => e.categoryId === 'otros' && e.createdAt === e.updatedAt)).toBe(true);
    });

    it('records into "otros" when the rule points at a folder that does not exist, instead of leaving the expense orphaned', () => {
      const { store } = setup();
      const r = rule(store, { day: 1, startMonth: '2026-10' });
      store.updateRecurring(r.id, { categoryId: 'ghost' });
      store.runRecurring(TODAY);
      expect(store.getData().expenses[0]!.categoryId).toBe('otros');
    });

    it('changing the rule\'s day after the month was recorded does not record it again', () => {
      const { store } = setup();
      const r = rule(store, { day: 10, startMonth: '2026-10' });
      store.runRecurring('2026-10-20');
      store.updateRecurring(r.id, { day: 3 });
      expect(store.runRecurring('2026-10-25')).toBe(0);
      expect(store.runRecurring('2026-11-03')).toBe(1);
    });

    it('is saved: a second store neither repeats nor forgets', () => {
      const storage = memoryStorage();
      const first = setup({ storage }).store;
      first.addRecurring({ amount: 5, categoryId: 'hogar', day: 1, startMonth: '2026-08' });
      first.runRecurring(TODAY);
      const second = setup({ storage, prefix: 'b' }).store;
      expect(second.runRecurring(TODAY)).toBe(0);
      expect(second.getData().expenses).toHaveLength(first.getData().expenses.length);
      expect(second.runRecurring('2026-11-01')).toBe(1);
    });

    it('defaults to today\'s date (frozen here)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 2, 12));
      const store = createStore({ storage: null, makeId: counterId(), now: () => 1 });
      store.addRecurring({ amount: 5, categoryId: 'hogar', day: 2, startMonth: '2026-10' });
      expect(store.runRecurring()).toBe(1);
      expect(store.getData().expenses[0]!.date).toBe('2026-10-02');
    });
  });
});

function counterId(): () => string {
  let n = 0;
  return () => `c-${++n}`;
}

// ---- goals ------------------------------------------------------------------

describe('goals', () => {
  const goalInput = { kind: 'saving' as const, name: 'Vacaciones', emoji: '🏖️', target: 900_000_00, deadline: '2027-01' };

  it('addGoal creates and returns a goal with defaults', () => {
    const { store } = setup();
    expect(store.addGoal(goalInput)).toStrictEqual({ id: 'id-1', ...goalInput, saved: 0, createdAt: 1_700_000_001_000 });
    expect(store.getData().goals).toHaveLength(1);
  });

  it('addGoal cleans the name, defaults the emoji, rounds what is already saved, and keeps plans', () => {
    const { store } = setup();
    const trip = { stops: [{ place: 'Madrid', days: 5 }], people: 2, style: 'mid' as const };
    const g = store.addGoal({ ...goalInput, kind: 'trip', name: '  ', emoji: '', saved: 1000.6, trip });
    expect(g).toMatchObject({ name: 'Mi meta', emoji: '🎯', saved: 1001, trip });
    expect(store.addGoal({ ...goalInput, saved: -50 }).saved).toBe(0);
    expect('trip' in store.addGoal(goalInput)).toBe(false);
  });

  it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53], ['100']])('addGoal refuses a target of %j', (target) => {
    const { store } = setup();
    expect(() => store.addGoal({ ...goalInput, target: target as number })).toThrow('Invalid target');
    expect(store.getData().goals).toEqual([]);
  });

  it('addToGoal adds, takes out, rounds, never goes below zero, and returns the goal', () => {
    const { store } = setup();
    const g = store.addGoal({ ...goalInput, saved: 100 });
    expect(store.addToGoal(g.id, 50)!.saved).toBe(150);
    expect(store.addToGoal(g.id, -20)!.saved).toBe(130);
    expect(store.addToGoal(g.id, 10.6)!.saved).toBe(141);
    expect(store.addToGoal(g.id, -1_000_000)!.saved).toBe(0);
    expect(store.getData().goals[0]!.saved).toBe(0);
    expect(store.addToGoal('ghost', 5)).toBeNull();
  });

  it('updateGoal patches fields, cleans the name and clamps what is saved', () => {
    const { store } = setup();
    const g = store.addGoal(goalInput);
    store.updateGoal(g.id, { name: '  Europa  ', deadline: '2027-06', saved: -5 });
    expect(store.getData().goals[0]).toMatchObject({ name: 'Europa', deadline: '2027-06', saved: 0, target: 900_000_00 });
    store.updateGoal(g.id, { name: '   ', saved: 99.5 });
    expect(store.getData().goals[0]).toMatchObject({ name: 'Europa', saved: 100 });
    expect(store.getData().goals[0]!.createdAt).toBe(g.createdAt);
  });

  it('deleteGoal removes and returns the goal, and restoreGoal puts it back once', () => {
    const { store } = setup();
    const g = store.addGoal(goalInput);
    const removed = store.deleteGoal(g.id)!;
    expect(store.deleteGoal(g.id)).toBeNull();
    expect(store.getData().goals).toEqual([]);
    store.restoreGoal(removed);
    store.restoreGoal(removed);
    expect(store.getData().goals).toEqual([g]);
  });

  it('goals are saved and survive a reload', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    const g = store.addGoal({ ...goalInput, saved: 5 });
    store.addToGoal(g.id, 10);
    expect(setup({ storage, prefix: 'b' }).store.getData().goals[0]).toMatchObject({ saved: 15, name: 'Vacaciones' });
  });
});

// ---- settings and whole-data operations -------------------------------------

describe('settings and whole-data operations', () => {
  it('updateSettings merges into the current settings', () => {
    const { store } = setup();
    store.updateSettings({ monthlyBudget: 500_000_00 });
    store.updateSettings({ theme: 'dark', haptics: false });
    expect(store.getData().settings).toMatchObject({ monthlyBudget: 500_000_00, theme: 'dark', haptics: false, currency: 'ARS' });
  });

  it('replaceAll swaps everything and saves it', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    add(store);
    const other = createInitialData('es-MX');
    other.expenses = [{ id: 'z', amount: 9, categoryId: 'otros', note: '', date: TODAY, createdAt: 1, updatedAt: 1 }];
    store.replaceAll(other);
    expect(store.getData()).toBe(other);
    expect(saved(storage).expenses.map((e) => e.id)).toEqual(['z']);
  });

  it('resetAll goes back to a brand-new install (in the browser\'s language) and saves it', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage, language: 'es-MX' });
    add(store);
    store.addCategory({ name: 'X', emoji: 'x' });
    store.addRecurring({ amount: 5, categoryId: 'hogar', day: 1, startMonth: '2026-10' });
    store.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 5, deadline: '2027-01' });
    store.updateSettings({ theme: 'dark', onboarded: true });
    store.resetAll();
    expect(store.getData()).toStrictEqual(createInitialData('es-MX'));
    expect(saved(storage)).toStrictEqual(clone(createInitialData('es-MX')));
    expect(storage.map.get(THEME_KEY)).toBe('system');
  });

  describe('mergeIn', () => {
    it('adds what is missing, counts it, keeps the current settings and is idempotent', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      store.updateSettings({ theme: 'dark', onboarded: false });
      const incoming = createInitialData('es-MX');
      incoming.categories.push({ id: 'gym', name: 'Gym', emoji: 'x', color: 'red', flexible: false, limit: null, archived: false });
      incoming.expenses = [
        { id: 'a', amount: 1, categoryId: 'gym', note: '', date: TODAY, createdAt: 1, updatedAt: 1 },
        { id: 'b', amount: 2, categoryId: 'super', note: '', date: TODAY, createdAt: 2, updatedAt: 2 },
      ];
      incoming.goals = [{ id: 'g', kind: 'saving', name: 'g', emoji: 'g', target: 5, deadline: '2027-01', saved: 0, createdAt: 1 }];
      const result = store.mergeIn(incoming);
      expect(result).toMatchObject({ addedExpenses: 2, addedCategories: 1, addedRecurring: 0, addedGoals: 1 });
      expect(store.getData().expenses.map((e) => e.id)).toEqual(['a', 'b']);
      expect(store.getData().settings).toMatchObject({ theme: 'dark', currency: 'ARS', onboarded: true });
      expect(saved(storage).expenses).toHaveLength(2);
      expect(store.mergeIn(incoming)).toMatchObject({ addedExpenses: 0, addedCategories: 0, addedRecurring: 0, addedGoals: 0 });
      expect(store.getData().expenses).toHaveLength(2);
    });
  });

  describe('demo data', () => {
    const drafts = [
      { amount: 100, categoryId: 'super', note: 'a', date: '2026-10-01' },
      { amount: 200, categoryId: 'comida', note: 'b', date: '2026-10-02' },
    ];

    it('addDemoExpenses marks them as demo, orders their timestamps, marks the user as onboarded and returns the count', () => {
      const { store } = setup();
      expect(store.addDemoExpenses(drafts)).toBe(2);
      const [a, b] = store.getData().expenses;
      expect([a!.demo, b!.demo]).toEqual([true, true]);
      expect(b!.createdAt).toBe(a!.createdAt + 1);
      expect(store.getData().settings.onboarded).toBe(true);
      expect(new Set([a!.id, b!.id]).size).toBe(2);
    });

    it('removeDemoExpenses removes only the demo ones and says how many', () => {
      const { store } = setup();
      const real = add(store, { amount: 999 });
      store.addDemoExpenses(drafts);
      expect(store.removeDemoExpenses()).toBe(2);
      expect(store.getData().expenses).toEqual([real]);
      expect(store.removeDemoExpenses()).toBe(0);
    });

    it('addDemoExpenses cleans each draft the way a reload would, and leaves out what cannot be an expense', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      const created = store.addDemoExpenses([
        { amount: 0, categoryId: 'super', note: 'zero', date: '2026-10-01' },
        { amount: 12.4, categoryId: 'super', note: 'fraction', date: '2026-10-01' },
        { amount: 100, categoryId: 'super', note: 'impossible day', date: '2026-02-30' },
        { amount: 300, categoryId: 'ghost', note: `  ${'long '.repeat(40)}  `, date: '2026-10-01', extra: 'stray' } as never,
      ]);
      // The zero and the impossible date are left out; a fraction of a cent is rounded, as a reload would.
      expect(created).toBe(2);
      const [rounded, only] = store.getData().expenses;
      expect(rounded).toMatchObject({ amount: 12, note: 'fraction', demo: true });
      expect(only).toMatchObject({ amount: 300, categoryId: 'otros', demo: true });
      expect(only!.note.length).toBeLessThanOrEqual(80);
      expect(only).not.toHaveProperty('extra');
      expect(setup({ storage, prefix: 'b' }).store.getData()).toEqual(store.getData());
    });

    it('the day-by-day runners ignore a day that is not a date', () => {
      const { store } = setup();
      store.addRecurring({ amount: 500, categoryId: 'hogar', day: 1, startMonth: '2026-09' });
      for (const bad of ['garbage', '2026-13-01', '2026-9-1', '']) expect(store.runRecurring(bad)).toBe(0);
      expect(store.getData().expenses).toEqual([]);
      expect(store.getData().recurring[0]?.lastGenerated).toBeNull();
    });

    it('removing demo data leaves no demo data behind after a reload', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      store.addDemoExpenses(drafts);
      store.removeDemoExpenses();
      expect(setup({ storage, prefix: 'b' }).store.getData().expenses).toEqual([]);
    });
  });
});

// ---- randomized sequences ---------------------------------------------------

describe('randomized operation sequences (seeded)', () => {
  function checkInvariants(store: Store, storage: MemoryStorage, label: string): void {
    const data = store.getData();
    const categoryIds = new Set(data.categories.map((c) => c.id));
    const fail = (why: string) => {
      throw new Error(`${label}: ${why}`);
    };
    for (const [name, items] of [['expenses', data.expenses], ['categories', data.categories], ['recurring', data.recurring], ['goals', data.goals]] as const) {
      if (new Set(items.map((x) => x.id)).size !== items.length) fail(`duplicate ids in ${name}`);
    }
    if (!categoryIds.has('otros')) fail('the fallback folder is gone');
    for (const e of data.expenses) {
      if (!Number.isSafeInteger(e.amount) || e.amount <= 0) fail(`bad amount ${e.amount}`);
      if (!isValidDateStr(e.date)) fail(`bad date ${e.date}`);
      if (!categoryIds.has(e.categoryId)) fail(`expense points at missing folder ${e.categoryId}`);
    }
    for (const r of data.recurring) {
      if (!categoryIds.has(r.categoryId)) fail(`rule points at missing folder ${r.categoryId}`);
      if (r.day < 1 || r.day > 31 || !Number.isInteger(r.day)) fail(`bad day ${r.day}`);
      if (r.lastGenerated !== null && r.lastGenerated < r.startMonth) fail('lastGenerated before startMonth');
    }
    for (const g of data.goals) {
      if (!isValidMonthKey(g.deadline) || g.saved < 0 || !Number.isSafeInteger(g.saved)) fail(`bad goal ${JSON.stringify(g)}`);
    }
    const perRuleMonth = data.expenses.filter((e) => e.recurringId).map((e) => `${e.recurringId}@${e.date.slice(0, 7)}`);
    if (new Set(perRuleMonth).size !== perRuleMonth.length) fail('a rule recorded the same month twice');
    expect(canonicalForm(data), `${label}: state differs from what a reload would produce`).toStrictEqual(data);
    expect(saved(storage), `${label}: storage is behind memory`).toStrictEqual(clone(data));
    expect(storage.map.get(THEME_KEY)).toBe(data.settings.theme);
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('keeps every invariant after every step (seed %i)', (seed) => {
    const rng = mulberry32(seed);
    const storage = memoryStorage();
    const { store } = setup({ storage });
    store.updateSettings({ onboarded: true });
    let today = '2026-01-15';
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
    const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
    const folderIds = (): string[] => store.getData().categories.map((c) => c.id);
    const dayOf = (offset: number): string => {
      const d = new Date(Date.UTC(2026, 0, 1 + offset));
      return d.toISOString().slice(0, 10);
    };

    for (let step = 0; step < 220; step++) {
      const label = `seed ${seed} step ${step}`;
      const roll = rng();
      const data = store.getData();
      if (roll < 0.22) {
        add(store, { amount: int(1, 5_000_000), categoryId: rng() < 0.1 ? 'unknown' : pick(folderIds()), note: rng() < 0.5 ? `n${int(0, 99)}  x` : undefined, date: dayOf(int(0, 400)) });
      } else if (roll < 0.30 && data.expenses.length > 0) {
        const e = pick(data.expenses);
        store.updateExpense(e.id, e.recurringId ? { amount: int(1, 9999), note: 'edit' } : { amount: int(1, 9999), categoryId: pick(folderIds()), date: dayOf(int(0, 400)) });
      } else if (roll < 0.38 && data.expenses.length > 0) {
        const removed = store.deleteExpense(pick(data.expenses).id)!;
        if (rng() < 0.5) store.restoreExpense(removed);
      } else if (roll < 0.43) {
        store.addCategory({ name: `Carpeta ${int(0, 99)}`, emoji: pick(EMOJI_CHOICES), color: rng() < 0.5 ? pick(COLOR_KEYS) : undefined, flexible: rng() < 0.5, limit: rng() < 0.5 ? int(1, 900_000) : null });
      } else if (roll < 0.47) {
        store.deleteCategory(pick(folderIds().concat('otros', 'ghost')));
      } else if (roll < 0.50) {
        store.updateCategory(pick(folderIds()), { archived: rng() < 0.5, limit: rng() < 0.5 ? int(1, 900_000) : null, name: `Renombrada ${int(0, 9)}` });
      } else if (roll < 0.58) {
        const day = int(1, 31);
        store.addRecurring({ amount: int(1, 900_000), categoryId: rng() < 0.1 ? 'ghost' : pick(folderIds()), note: `fijo ${int(0, 9)}`, day, startMonth: firstMonthFor(day, today) });
      } else if (roll < 0.63 && data.recurring.length > 0) {
        store.updateRecurring(pick(data.recurring).id, { amount: int(1, 900_000), day: int(0, 40), active: rng() < 0.7 });
      } else if (roll < 0.65 && data.recurring.length > 0) {
        store.deleteRecurring(pick(data.recurring).id);
      } else if (roll < 0.78) {
        today = dayOf(Math.min(400, Math.max(0, Math.floor((Date.parse(today) - Date.UTC(2026, 0, 1)) / 86_400_000) + int(1, 45))));
        store.runRecurring(today);
      } else if (roll < 0.83) {
        store.addGoal({ kind: pick(['trip', 'move', 'saving'] as const), name: `Meta ${int(0, 9)}`, emoji: '🎯', target: int(1, 9_000_000), deadline: addMonths('2026-01', int(0, 24)), saved: int(0, 1000) });
      } else if (roll < 0.88 && data.goals.length > 0) {
        store.addToGoal(pick(data.goals).id, int(-5000, 5000));
      } else if (roll < 0.90 && data.goals.length > 0) {
        const g = store.deleteGoal(pick(data.goals).id)!;
        if (rng() < 0.5) store.restoreGoal(g);
      } else if (roll < 0.94) {
        store.updateSettings({ theme: pick<ThemePref>(['system', 'light', 'dark']), monthlyBudget: rng() < 0.5 ? int(1, 9_000_000) : null, haptics: rng() < 0.5 });
      } else if (roll < 0.97) {
        store.reload();
      } else {
        store.addDemoExpenses([{ amount: int(1, 999), categoryId: pick(folderIds()), note: 'demo', date: dayOf(int(0, 400)) }]);
        if (rng() < 0.5) store.removeDemoExpenses();
      }
      checkInvariants(store, storage, label);
    }

    const second = setup({ storage, prefix: 'next' }).store;
    expect(second.getData()).toStrictEqual(store.getData());
  });
});

// ---- regressions found by mutation testing ----------------------------------

describe('regressions', () => {
  // `reload()` is wired to the browser's `storage` event. It replaces the in-memory data with
  // whatever `load()` returns, and `load()` returns an EMPTY dataset when there is no storage or
  // reading fails, so the data the user has in this tab is thrown away.
  describe('reload() must not discard data it could not re-read', () => {
    it('with no storage at all, it is a no-op', () => {
      const store = createStore({ storage: null, makeId: counterId(), now: () => 1 });
      add(store);
      store.reload();
      expect(store.getData().expenses).toHaveLength(1);
    });

    it('when reading fails, it keeps what is in memory', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      add(store, { amount: 1 });
      add(store, { amount: 2 });
      storage.failGet = true;
      store.reload();
      expect(store.getData().expenses).toHaveLength(2);
    });

    it('and the next change does not overwrite the saved data with a nearly empty copy', () => {
      const storage = memoryStorage();
      const { store } = setup({ storage });
      add(store, { amount: 1 });
      add(store, { amount: 2 });
      storage.failGet = true;
      store.reload();
      storage.failGet = false;
      add(store, { amount: 3 });
      expect(saved(storage).expenses.map((e) => e.amount)).toEqual([1, 2, 3]);
    });
  });

  // If the first read fails there may be real data in storage; starting empty is fine, overwriting it is not.
  describe('data that could not be read when the app started', () => {
    const unreadableStart = () => {
      const storage = memoryStorage();
      const first = setup({ storage }).store;
      add(first, { amount: 1 });
      add(first, { amount: 2 });
      const stored = storage.map.get(DATA_KEY);
      storage.failGet = true;
      const { store } = setup({ storage, prefix: 'b' });
      storage.failGet = false;
      return { storage, store, stored };
    };

    it('is never written over by what is entered meanwhile', () => {
      const { storage, store, stored } = unreadableStart();
      add(store, { amount: 3 });
      expect(store.getData().expenses.map((e) => e.amount)).toEqual([3]);
      expect(storage.map.get(DATA_KEY)).toBe(stored);
      expect(store.getStatus().persistent).toBe(false);
    });

    it('is picked up by a later reload, and saving works again from there', () => {
      const { storage, store } = unreadableStart();
      store.reload();
      expect(store.getData().expenses.map((e) => e.amount)).toEqual([1, 2]);
      add(store, { amount: 4 });
      expect(saved(storage).expenses.map((e) => e.amount)).toEqual([1, 2, 4]);
      expect(store.getStatus().persistent).toBe(true);
    });
  });

  // The sheet says "Pausa para que no se anote por un tiempo": resuming picks up from the current
  // month instead of recording every month that passed while the rule was paused.
  describe('resuming a paused rule', () => {
    const paused = () => {
      const { store } = setup();
      const r = store.addRecurring({ amount: 5000, categoryId: 'servicios', note: 'Luz', day: 10, startMonth: '2026-05' });
      store.runRecurring('2026-05-15');
      store.updateRecurring(r.id, { active: false });
      store.runRecurring('2026-08-15');
      return { store, id: r.id };
    };
    const dates = (store: Store) => store.getData().expenses.map((e) => e.date);

    it('does not record the months it was paused', () => {
      const { store, id } = paused();
      store.updateRecurring(id, { active: true }, '2026-10-12');
      store.runRecurring('2026-10-12');
      expect(dates(store)).toEqual(['2026-05-10', '2026-10-10']);
    });

    it('still records this month when its day has not come yet', () => {
      const { store, id } = paused();
      store.updateRecurring(id, { active: true }, '2026-10-05');
      store.runRecurring('2026-10-05');
      expect(dates(store)).toEqual(['2026-05-10']);
      store.runRecurring('2026-10-10');
      expect(dates(store)).toEqual(['2026-05-10', '2026-10-10']);
    });

    it('never moves the rule back over months it already recorded', () => {
      const { store, id } = paused();
      store.updateRecurring(id, { active: true }, '2026-06-20');
      expect(store.getData().recurring[0]?.lastGenerated).toBe('2026-05');
    });

    it('leaves a rule that has not started yet to start when it was meant to', () => {
      const { store } = setup();
      const r = store.addRecurring({ amount: 5000, categoryId: 'servicios', note: 'Gym', day: 10, startMonth: '2026-12' });
      store.updateRecurring(r.id, { active: false });
      store.updateRecurring(r.id, { active: true }, '2026-10-05');
      expect(store.getData().recurring[0]?.lastGenerated).toBeNull();
      store.runRecurring('2026-12-11');
      expect(dates(store)).toEqual(['2026-12-10']);
    });

    it('does nothing special to a rule that was not paused', () => {
      const { store } = setup();
      const r = store.addRecurring({ amount: 5000, categoryId: 'servicios', note: 'Luz', day: 10, startMonth: '2026-05' });
      store.updateRecurring(r.id, { active: true }, '2026-10-12');
      store.runRecurring('2026-10-12');
      expect(dates(store)).toEqual(['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10']);
    });
  });

  // `restoreExpense` puts the expense back as it was, without checking that its folder still exists.
  it('undoing a deletion after the expense\'s folder was deleted does not point at a missing folder', () => {
    const { store } = setup();
    const removed = store.deleteExpense(add(store, { categoryId: 'mascotas' }).id)!;
    store.deleteCategory('mascotas');
    store.restoreExpense(removed);
    const ids = new Set(store.getData().categories.map((c) => c.id));
    expect(ids.has(store.getData().expenses[0]!.categoryId)).toBe(true);
  });

  // cleanNote cuts with `slice` after trimming: it can leave trailing blanks or half an emoji.
  describe('cleanNote on a long note', () => {
    it('does not leave trailing whitespace after cutting', () => {
      const { store } = setup();
      const note = add(store, { note: `${'a'.repeat(79)} bbbbbbb` }).note;
      expect(note).toBe(note.trim());
    });

    it('does not cut an emoji in half', () => {
      const { store } = setup();
      expect(hasLoneSurrogate(add(store, { note: `a${'😀'.repeat(60)}` }).note)).toBe(false);
      expect(hasLoneSurrogate(store.addRecurring({ amount: 5, categoryId: 'hogar', note: `a${'😀'.repeat(60)}`, day: 1, startMonth: '2026-10' }).note)).toBe(false);
    });
  });

  // The setters below store what they are given. A reload runs the same data through normalizeData,
  // which drops or rewrites such values (and drops whole goals and rules), so what the user sees now
  // is not what they will have after reopening the app. Refusing the input would be fine too.
  describe('what is in memory must be what a reload would give back', () => {
    const NOT_VALIDATED: Array<[string, (s: Store) => void]> = [
      ['addRecurring with amount 0', (s) => void s.addRecurring({ amount: 0, categoryId: 'hogar', day: 5, startMonth: '2026-10' })],
      ['addRecurring with a negative amount', (s) => void s.addRecurring({ amount: -5, categoryId: 'hogar', day: 5, startMonth: '2026-10' })],
      ['addRecurring with a fractional amount', (s) => void s.addRecurring({ amount: 12.5, categoryId: 'hogar', day: 5, startMonth: '2026-10' })],
      ['addRecurring with a NaN amount', (s) => void s.addRecurring({ amount: Number.NaN, categoryId: 'hogar', day: 5, startMonth: '2026-10' })],
      ['addRecurring with a NaN day', (s) => void s.addRecurring({ amount: 5, categoryId: 'hogar', day: Number.NaN, startMonth: '2026-10' })],
      ['addRecurring with startMonth "garbage"', (s) => void s.addRecurring({ amount: 5, categoryId: 'hogar', day: 5, startMonth: 'garbage' })],
      ['addRecurring with startMonth "2026-13"', (s) => void s.addRecurring({ amount: 5, categoryId: 'hogar', day: 5, startMonth: '2026-13' })],
      ['addRecurring with startMonth "2026-00"', (s) => void s.addRecurring({ amount: 5, categoryId: 'hogar', day: 5, startMonth: '2026-00' })],
      ['addRecurring with an empty startMonth', (s) => void s.addRecurring({ amount: 5, categoryId: 'hogar', day: 5, startMonth: '' })],
      ['updateRecurring to amount 0', (s) => s.updateRecurring(s.addRecurring({ amount: 5, categoryId: 'hogar', day: 5, startMonth: '2026-10' }).id, { amount: 0 })],
      ['updateRecurring to an unknown folder', (s) => s.updateRecurring(s.addRecurring({ amount: 5, categoryId: 'hogar', day: 5, startMonth: '2026-10' }).id, { categoryId: 'ghost' })],
      ['addCategory with an unknown color', (s) => void s.addCategory({ name: 'X', emoji: 'x', color: 'purple' })],
      ['addCategory with a negative limit', (s) => void s.addCategory({ name: 'X', emoji: 'x', limit: -5 })],
      ['addCategory with limit 0', (s) => void s.addCategory({ name: 'X', emoji: 'x', limit: 0 })],
      ['addCategory with a long emoji string', (s) => void s.addCategory({ name: 'X', emoji: '🍕'.repeat(8) })],
      ['addCategory with a blank emoji', (s) => void s.addCategory({ name: 'X', emoji: '   ' })],
      ['addCategory with a padded kind', (s) => void s.addCategory({ name: 'X', emoji: 'x', kind: '  ocio  ' })],
      ['updateCategory to an unknown color', (s) => s.updateCategory('super', { color: 'nope' })],
      ['updateCategory to a NaN limit', (s) => s.updateCategory('super', { limit: Number.NaN })],
      ['updateSettings with a negative budget', (s) => s.updateSettings({ monthlyBudget: -5 })],
      ['updateSettings with an invalid currency', (s) => s.updateSettings({ currency: 'xx' })],
      ['updateSettings with an invalid locale', (s) => s.updateSettings({ locale: 'garbage' })],
      ['updateSettings with a negative fxRate', (s) => s.updateSettings({ fxRate: -1 })],
      ['updateSettings with an unknown theme', (s) => s.updateSettings({ theme: 'neon' as ThemePref })],
      ['addGoal with an invalid deadline', (s) => void s.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 100, deadline: 'garbage' })],
      ['addGoal with NaN saved', (s) => void s.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 100, deadline: '2027-01', saved: Number.NaN })],
      ['addGoal with an unknown kind', (s) => void s.addGoal({ kind: 'rocket' as 'trip', name: 'g', emoji: 'g', target: 100, deadline: '2027-01' })],
      ['addGoal with a trip plan on a saving goal', (s) => void s.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 100, deadline: '2027-01', trip: { stops: [], people: 2, style: 'mid' } })],
      ['addGoal with 99 travellers', (s) => void s.addGoal({ kind: 'trip', name: 'g', emoji: 'g', target: 100, deadline: '2027-01', trip: { stops: [], people: 99, style: 'mid' } })],
      ['updateGoal to target 0', (s) => s.updateGoal(s.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 100, deadline: '2027-01' }).id, { target: 0 })],
      ['updateGoal to an invalid deadline', (s) => s.updateGoal(s.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 100, deadline: '2027-01' }).id, { deadline: '2027-13' })],
      ['addToGoal with NaN', (s) => void s.addToGoal(s.addGoal({ kind: 'saving', name: 'g', emoji: 'g', target: 100, deadline: '2027-01' }).id, Number.NaN)],
    ];

    it.each(NOT_VALIDATED)('%s', (_label, act) => {
      const { store } = setup();
      store.updateSettings({ onboarded: true });
      try {
        act(store);
      } catch {
        // refusing the input is a fine answer
      }
      store.runRecurring('2026-12-31');
      expect(canonicalForm(store.getData())).toStrictEqual(store.getData());
    });
  });
});
