// Tests for the income side of the store: incomes, fixed incomes, demo data, and what a reload gives back.
// A test marked "BUG:" was written against a defect found in the source: the comment says what the right behaviour is.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeData } from './data';
import { addMonths, isValidDateStr, isValidMonthKey } from './dates';
import { generateDemoIncomes } from './demo';
import { INCOME_SOURCE_IDS, isIncomeSourceId } from './incomeSources';
import { firstMonthFor } from './recurring';
import { DATA_KEY, createStore, type NewIncomeRule, type Store, type StorageLike } from './store';
import type { AppData, Income } from './types';

const TODAY = '2026-10-02';

// ---- helpers (same conventions as store.test.ts) ----------------------------------

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

const seqIds = (prefix = 'id'): (() => string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

/** A store with sequential ids (`<prefix>-1`, ...) and a clock that advances one second per reading. */
function setup(options: { storage?: StorageLike | null; prefix?: string } = {}): { store: Store; ids: () => number } {
  let n = 0;
  let clock = 1_700_000_000_000;
  const store = createStore({
    storage: options.storage === undefined ? memoryStorage() : options.storage,
    makeId: () => `${options.prefix ?? 'id'}-${++n}`,
    now: () => (clock += 1000),
  });
  return { store, ids: () => n };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const saved = (storage: MemoryStorage): AppData => JSON.parse(storage.map.get(DATA_KEY) ?? 'null') as AppData;
const hasLoneSurrogate = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

/** What a reload would make of the current state: equal to it when nothing needs repairing. */
const canonicalForm = (data: AppData): AppData | null =>
  normalizeData(clone(data), {
    makeId: () => {
      throw new Error('a reload would have to repair an id');
    },
    today: TODAY,
  });

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

const earn = (store: Store, o: Partial<Parameters<Store['addIncome']>[0]> = {}): Income => store.addIncome({ amount: 150_000, sourceId: 'freelance', date: TODAY, ...o });
const fixed = (store: Store, o: Partial<NewIncomeRule> = {}) => store.addIncomeRule({ amount: 1_200_000_00, sourceId: 'sueldo', note: 'Sueldo', day: 5, startMonth: '2026-10', ...o });
const dates = (store: Store): string[] => store.getData().incomes.map((i) => i.date);
const demoDraft = { amount: 5, sourceId: 'venta', note: '', date: TODAY };

/** Runs `act` on a fresh store and checks that a refusal leaves nothing behind. */
function expectRefusal(act: (store: Store) => unknown, message: string): void {
  const storage = memoryStorage();
  const { store, ids } = setup({ storage });
  const listener = vi.fn();
  store.subscribe(listener);
  const before = store.getData();
  expect(() => act(store)).toThrow(message);
  expect(store.getData()).toBe(before);
  expect(storage.writes).toEqual([]);
  expect(ids()).toBe(0);
  expect(listener).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.useRealTimers();
});

// ---- addIncome -------------------------------------------------------------------

describe('addIncome', () => {
  it('creates and returns the income with an id from makeId and timestamps from the clock, and nothing else', () => {
    const { store } = setup();
    const i = store.addIncome({ amount: 1_200_000_00, sourceId: 'sueldo', note: 'Sueldo', date: '2026-10-05' });
    expect(i).toStrictEqual({ id: 'id-1', amount: 1_200_000_00, sourceId: 'sueldo', note: 'Sueldo', date: '2026-10-05', createdAt: 1_700_000_001_000, updatedAt: 1_700_000_001_000 });
    expect(store.getData().incomes).toEqual([i]);
    expect(store.getData().expenses).toEqual([]);
  });

  it('allows identical incomes, each with its own id, in the order they came, and ignores fields it does not own', () => {
    const { store } = setup();
    const [a, b] = [earn(store), earn(store)];
    expect(a.id).not.toBe(b.id);
    const sneaky = store.addIncome({ amount: 5, sourceId: 'venta', date: TODAY, id: 'evil', createdAt: 1, updatedAt: 2, ruleId: 'r', demo: true, secret: 1 } as unknown as Parameters<Store['addIncome']>[0]);
    expect(Object.keys(sneaky).sort()).toEqual(['amount', 'createdAt', 'date', 'id', 'note', 'sourceId', 'updatedAt']);
    expect([sneaky.id, sneaky.createdAt > 1]).toEqual(['id-3', true]);
    expect(store.getData().incomes.map((i) => i.id)).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it.each([
    ['trims', '  Cliente  ', 'Cliente'], ['collapses runs of blanks', 'a    b', 'a b'], ['turns tabs and line breaks into single spaces', 'a\t\n\r\n b', 'a b'],
    ['keeps accents and emoji', 'Diseño ☕ ñandú', 'Diseño ☕ ñandú'], ['becomes empty for blanks', ' \n\t ', ''], ['becomes empty when missing', undefined, ''],
  ])('note: %s', (_label, note, expected) => {
    expect(earn(setup().store, { note }).note).toBe(expected);
  });

  it('cuts a huge note, never in the middle of an emoji, and leaves no trailing blank', () => {
    const { store } = setup();
    const huge = earn(store, { note: 'palabra '.repeat(50_000) }).note;
    expect([huge.length > 0, huge.length <= 80, huge === huge.trim()]).toEqual([true, true, true]);
    expect(hasLoneSurrogate(earn(store, { note: `a${'😀'.repeat(100)}` }).note)).toBe(false);
    expect(earn(store, { note: `${'a'.repeat(79)} bbbbbbb` }).note).toBe('a'.repeat(79));
  });

  it('keeps each of the seven sources and sends an unknown or missing one to "otros", without trimming or case folding', () => {
    const { store } = setup();
    for (const id of INCOME_SOURCE_IDS) expect(earn(store, { sourceId: id }).sourceId).toBe(id);
    for (const id of ['', 'nope', ' sueldo ', 'SUELDO', '__proto__', undefined, null]) expect(earn(store, { sourceId: id as string }).sourceId).toBe('otros');
  });

  it.each([
    ['zero', 0], ['negative', -1], ['negative zero', -0], ['a decimal', 1.5], ['half a cent', 0.5], ['NaN', Number.NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['a numeric string', '100'],
    ['null', null], ['undefined', undefined], ['2^53', 2 ** 53], ['1e21', 1e21], ['the largest double', Number.MAX_VALUE], ['an object', {}], ['true', true],
  ])('refuses an amount that is %s, leaving no trace', (_label, amount) => {
    expectRefusal((s) => earn(s, { amount: amount as number }), 'Invalid amount');
  });

  it.each([
    ['Feb 30', '2026-02-30'], ['Apr 31', '2026-04-31'], ['Feb 29 in a common year', '2027-02-29'], ['Feb 29 in 2100', '2100-02-29'], ['month 13', '2026-13-01'], ['month 0', '2026-00-10'],
    ['day 0', '2026-10-00'], ['day 32', '2026-10-32'], ['unpadded', '2026-1-1'], ['empty', ''], ['a timestamp', '2026-10-02T10:00:00Z'], ['a trailing newline', '2026-10-02\n'], ['slashes', '2026/10/02'],
    ['a five-digit year', '12026-10-02'], ['a number', 20_261_002], ['null', null], ['undefined', undefined], ['a Date', new Date(2026, 9, 2)],
  ])('refuses a date that is %s, leaving no trace', (_label, date) => {
    expectRefusal((s) => earn(s, { date: date as string }), 'Invalid date');
  });

  it('accepts the extremes: one cent, the largest safe amount, leap days, the first and last day the calendar has', () => {
    const { store } = setup();
    for (const amount of [1, Number.MAX_SAFE_INTEGER]) expect(earn(store, { amount }).amount).toBe(amount);
    for (const date of ['2024-02-29', '2000-02-29', '9999-12-31', '0001-01-01', '2026-12-31', '2027-01-01']) expect(earn(store, { date }).date).toBe(date);
  });
});

// ---- updateIncome, deleteIncome, restoreIncome -------------------------------------

describe('updateIncome', () => {
  it('changes only the fields given, bumps updatedAt, keeps the rest, and ignores fields it does not own', () => {
    const { store } = setup();
    const original = earn(store, { note: 'x', date: '2026-09-01' });
    const updated = store.updateIncome(original.id, { amount: 2000, note: '  nuevo   texto ', id: 'other', createdAt: 0, ruleId: 'r', demo: true } as never)!;
    expect(updated).toStrictEqual({ ...original, amount: 2000, note: 'nuevo texto', updatedAt: 1_700_000_002_000 });
    expect(store.getData().incomes).toEqual([updated]);
  });

  it('can change the source (an unknown one becomes "otros") and the date, even into another month or year', () => {
    const { store } = setup();
    const i = earn(store);
    expect(store.updateIncome(i.id, { sourceId: 'venta', date: '2024-02-29' })).toMatchObject({ sourceId: 'venta', date: '2024-02-29' });
    expect(store.updateIncome(i.id, { sourceId: 'ghost' })!.sourceId).toBe('otros');
    expect(store.updateIncome(i.id, { date: '2027-01-01' })!.date).toBe('2027-01-01');
  });

  it('keeps ruleId and demo, and ignores undefined fields', () => {
    const { store } = setup();
    fixed(store, { startMonth: '2026-10', day: 1 });
    store.runIncomeRules(TODAY);
    const generated = store.getData().incomes[0]!;
    expect(store.updateIncome(generated.id, { note: 'editado', amount: undefined, date: undefined })).toMatchObject({ ruleId: generated.ruleId, amount: generated.amount, date: generated.date, note: 'editado' });
    store.addDemoIncomes([demoDraft]);
    expect(store.updateIncome(store.getData().incomes.find((i) => i.demo)!.id, { amount: 6 })!.demo).toBe(true);
  });

  it('returns null for an unknown id, without a trace', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    const before = store.getData();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.updateIncome('nope', { amount: 5 })).toBeNull();
    expect([store.getData() === before, storage.writes, listener.mock.calls.length]).toEqual([true, [], 0]);
  });

  it('is all-or-nothing: a bad part of the patch leaves the income untouched', () => {
    const { store } = setup();
    const i = earn(store);
    const before = store.getData();
    expect(() => store.updateIncome(i.id, { amount: 99, date: 'garbage' })).toThrow('Invalid date');
    expect(() => store.updateIncome(i.id, { note: 'x', amount: 0 })).toThrow('Invalid amount');
    for (const amount of [1.5, Number.NaN, Infinity, -3, 2 ** 53, null as unknown as number, '5' as unknown as number]) expect(() => store.updateIncome(i.id, { amount })).toThrow('Invalid amount');
    expect(store.getData()).toBe(before);
  });
});

describe('deleteIncome and restoreIncome (undo)', () => {
  it('delete removes the income and returns it, once; undo puts back exactly that at the end, once, silently when it is already there', () => {
    const { store } = setup();
    const [a, b, c] = [earn(store, { amount: 1 }), earn(store, { amount: 2, note: 'importante' }), earn(store, { amount: 3 })];
    const removed = store.deleteIncome(b.id)!;
    expect([removed, store.deleteIncome(b.id)]).toEqual([b, null]);
    store.deleteIncome(c.id);
    store.restoreIncome(removed);
    const listener = vi.fn();
    store.subscribe(listener);
    const after = store.getData();
    store.restoreIncome(removed);
    store.restoreIncome({ ...removed, amount: 999 });
    expect([store.getData() === after, listener.mock.calls.length]).toEqual([true, 0]);
    expect(store.getData().incomes).toEqual([a, b]);
  });
});

// ---- fixed incomes: creating and editing -----------------------------------------------

describe('addIncomeRule', () => {
  it('stores a new active rule that has not recorded anything yet, and records nothing by itself', () => {
    const { store } = setup();
    const r = fixed(store);
    expect(r).toStrictEqual({ id: 'id-1', amount: 1_200_000_00, sourceId: 'sueldo', note: 'Sueldo', day: 5, startMonth: '2026-10', lastGenerated: null, active: true });
    expect([store.getData().incomes, store.getData().incomeRules]).toEqual([[], [r]]);
  });

  it.each([[0, 1], [-5, 1], [1, 1], [15, 15], [31, 31], [32, 31], [45, 31], [15.9, 15], [Number.NaN, 1], [Infinity, 31], [-Infinity, 1], [1e21, 31]])('clamps day %s to %s', (day, expected) => {
    expect(fixed(setup().store, { day }).day).toBe(expected);
  });

  it('cleans the note, sends an unknown source to "otros", and ignores fields it does not own', () => {
    expect(fixed(setup().store, { note: '  Cliente   fijo ', sourceId: 'ghost' })).toMatchObject({ note: 'Cliente fijo', sourceId: 'otros' });
    expect(hasLoneSurrogate(fixed(setup().store, { note: `a${'😀'.repeat(60)}` }).note)).toBe(false);
    expect(fixed(setup().store, { active: false, lastGenerated: '2020-01', id: 'x' } as never)).toMatchObject({ active: true, lastGenerated: null, id: 'id-1' });
  });

  it.each([['zero', 0], ['negative', -5], ['NaN', Number.NaN], ['Infinity', Infinity], ['a string', '100'], ['null', null], ['2^53', 2 ** 53], ['1e21', 1e21], ['a tiny fraction', 0.4]])(
    'refuses an amount that is %s, leaving no trace',
    (_label, amount) => {
      expectRefusal((s) => fixed(s, { amount: amount as number }), 'Invalid amount');
    },
  );

  it.each([['garbage', 'garbage'], ['month 13', '2026-13'], ['month 0', '2026-00'], ['empty', ''], ['unpadded', '2026-1'], ['a date', '2026-10-01'], ['five digits', '10000-01'], ['null', null], ['a number', 202_610]])(
    'refuses a start month that is %s, leaving no trace',
    (_label, startMonth) => {
      expectRefusal((s) => fixed(s, { startMonth: startMonth as string }), 'Invalid month');
    },
  );
});

describe('updateIncomeRule and deleteIncomeRule', () => {
  it('changes only what is given, clamps the day, cleans the note, resolves the source, and ignores fields it does not own', () => {
    const { store } = setup();
    const r = fixed(store);
    store.updateIncomeRule(r.id, { amount: 1_500_000_00, note: '  Depto  ', day: 99, sourceId: 'ghost', startMonth: '2000-01', lastGenerated: '1999-01', id: 'x' } as never, TODAY);
    expect(store.getData().incomeRules[0]).toStrictEqual({ ...r, amount: 1_500_000_00, note: 'Depto', day: 31, sourceId: 'otros' });
    store.updateIncomeRule(r.id, { day: 0, active: false }, TODAY);
    expect(store.getData().incomeRules[0]).toMatchObject({ day: 1, active: false, lastGenerated: null, startMonth: '2026-10' });
  });

  it('refuses a bad amount without a trace, even for a rule that does not exist, and only touches the rule asked for', () => {
    for (const amount of [0, -1, Number.NaN, Infinity, 2 ** 53, '5' as unknown as number]) expectRefusal((s) => s.updateIncomeRule('anything', { amount }, TODAY), 'Invalid amount');
    const { store } = setup();
    const [a, b] = [fixed(store, { note: 'A' }), fixed(store, { note: 'B' })];
    store.updateIncomeRule(a.id, { amount: 7 }, TODAY);
    expect(store.getData().incomeRules[1]).toBe(b);
  });

  // BUG (low): for an id that does not exist nothing changes, yet the store commits anyway: it hands out a new
  // snapshot, notifies every subscriber and rewrites the storage. updateIncome / deleteIncome stay silent in that case.
  it('stay silent, and leave the snapshot alone, for an unknown rule', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    fixed(store);
    const before = store.getData();
    const writes = storage.writes.length;
    const listener = vi.fn();
    store.subscribe(listener);
    store.updateIncomeRule('ghost', { note: 'x' }, TODAY);
    store.deleteIncomeRule('ghost');
    expect([listener.mock.calls.length, storage.writes.length - writes, store.getData() === before]).toEqual([0, 0, true]);
  });

  it('deleting a rule removes only that rule and keeps what it already recorded, which later runs never bring back or add to', () => {
    const { store } = setup();
    const r = fixed(store, { day: 1, startMonth: '2026-09' });
    const other = fixed(store, { day: 2, startMonth: '2026-09', note: 'Otra' });
    store.runIncomeRules(TODAY);
    expect(store.getData().incomes).toHaveLength(4);
    store.deleteIncomeRule(r.id);
    expect(store.runIncomeRules('2027-03-01')).toBeGreaterThan(0);
    expect(store.getData().incomeRules.map((x) => x.id)).toEqual([other.id]);
    expect(store.getData().incomes.filter((i) => i.ruleId === r.id)).toHaveLength(2);
    expect(store.getData().incomes.filter((i) => i.ruleId === other.id).length).toBeGreaterThan(2);
  });
});

describe('resuming a paused fixed income', () => {
  const paused = () => {
    const { store } = setup();
    const r = fixed(store, { day: 10, startMonth: '2026-05', amount: 5000 });
    store.runIncomeRules('2026-05-15');
    store.updateIncomeRule(r.id, { active: false }, '2026-05-20');
    store.runIncomeRules('2026-08-15');
    return { store, id: r.id };
  };

  it('does not record the months it was paused, but still records this month once its day comes', () => {
    const { store, id } = paused();
    store.updateIncomeRule(id, { active: true }, '2026-10-05');
    expect([store.runIncomeRules('2026-10-05'), store.runIncomeRules('2026-10-10')]).toEqual([0, 1]);
    expect(dates(store)).toEqual(['2026-05-10', '2026-10-10']);
    const late = paused();
    late.store.updateIncomeRule(late.id, { active: true }, '2026-10-12');
    expect(late.store.runIncomeRules('2026-10-12')).toBe(1);
    expect(dates(late.store)).toEqual(['2026-05-10', '2026-10-10']);
    const newYear = paused();
    newYear.store.updateIncomeRule(newYear.id, { active: true }, '2027-01-03');
    expect(newYear.store.getData().incomeRules[0]!.lastGenerated).toBe('2026-12');
  });

  it('never moves the rule back over months it already recorded, nor forward when it was not paused', () => {
    const { store, id } = paused();
    store.updateIncomeRule(id, { active: true }, '2026-06-20');
    expect(store.getData().incomeRules[0]!.lastGenerated).toBe('2026-05');
    const other = setup().store;
    const r = fixed(other, { day: 10, startMonth: '2026-05' });
    other.updateIncomeRule(r.id, { active: true, note: 'x' }, '2026-10-12');
    other.runIncomeRules('2026-10-12');
    expect(dates(other)).toEqual(['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10']);
  });

  it('leaves a rule that has not started yet to start when it was meant to, and one paused before it ever ran skips the paused months', () => {
    const { store } = setup();
    const r = fixed(store, { day: 10, startMonth: '2026-12' });
    store.updateIncomeRule(r.id, { active: false }, '2026-10-05');
    store.updateIncomeRule(r.id, { active: true }, '2026-10-05');
    expect(store.getData().incomeRules[0]!.lastGenerated).toBeNull();
    store.runIncomeRules('2026-12-11');
    expect(dates(store)).toEqual(['2026-12-10']);
    const never = setup().store;
    const q = fixed(never, { day: 10, startMonth: '2026-05' });
    never.updateIncomeRule(q.id, { active: false }, '2026-05-01');
    never.updateIncomeRule(q.id, { active: true, day: 3 }, '2026-10-12');
    expect(never.getData().incomeRules[0]).toMatchObject({ lastGenerated: '2026-09', day: 3 });
    const edge = setup().store; // paused through its whole first month: that month is not paid back either
    const e = fixed(edge, { day: 3, startMonth: '2026-10' });
    edge.updateIncomeRule(e.id, { active: false }, '2026-10-01');
    edge.updateIncomeRule(e.id, { active: true }, '2026-11-05');
    expect([edge.runIncomeRules('2026-11-05'), dates(edge)]).toEqual([1, ['2026-11-03']]);
  });

  it('resumes from the month the clock says when no day is given', () => {
    const store = createStore({ storage: null, makeId: seqIds('r'), now: () => new Date(2026, 9, 12, 12).getTime() });
    const r = store.addIncomeRule({ amount: 5, sourceId: 'sueldo', day: 10, startMonth: '2026-05' });
    store.updateIncomeRule(r.id, { active: false });
    store.updateIncomeRule(r.id, { active: true });
    expect(store.getData().incomeRules[0]!.lastGenerated).toBe('2026-09');
  });

  it('does the same when the day it is given is not a date, without throwing', () => {
    for (const junk of ['garbage', '2026-13-45', '2026-10', '']) {
      const store = createStore({ storage: null, makeId: seqIds('r'), now: () => new Date(2026, 9, 12, 12).getTime() });
      const r = store.addIncomeRule({ amount: 5, sourceId: 'sueldo', day: 10, startMonth: '2026-05' });
      store.updateIncomeRule(r.id, { active: false });
      expect(() => store.updateIncomeRule(r.id, { active: true }, junk)).not.toThrow();
      expect(store.getData().incomeRules[0]).toMatchObject({ active: true, lastGenerated: '2026-09' });
      expect([store.runIncomeRules('2026-10-12'), dates(store)]).toEqual([1, ['2026-10-10']]);
    }
  });
});

// ---- runIncomeRules --------------------------------------------------------------

describe('runIncomeRules', () => {
  it('records what came due, dated on its day, tagged with its rule, copying the rule, and says how many', () => {
    const { store } = setup();
    const r = fixed(store, { day: 5, startMonth: '2026-08' });
    expect(store.runIncomeRules(TODAY)).toBe(2);
    const made = store.getData().incomes;
    expect(made.map((i) => i.date)).toEqual(['2026-08-05', '2026-09-05']);
    expect(made.every((i) => i.ruleId === r.id && i.amount === 1_200_000_00 && i.note === 'Sueldo' && i.sourceId === 'sueldo' && i.demo === undefined)).toBe(true);
    expect(store.getData().incomeRules[0]!.lastGenerated).toBe('2026-09');
    expect(store.runIncomeRules('2026-10-05')).toBe(1);
    expect(dates(store).at(-1)).toBe('2026-10-05');
  });

  it('stamps every income of a run with the clock once, gives each its own id, and creates exactly the keys an income has', () => {
    const { store, ids } = setup();
    fixed(store, { day: 1, startMonth: '2026-08' });
    const before = ids();
    store.runIncomeRules(TODAY);
    const made = store.getData().incomes;
    expect([ids() - before, new Set(made.map((i) => i.id)).size, new Set(made.map((i) => i.createdAt)).size, made.every((i) => i.createdAt === i.updatedAt)]).toEqual([3, 3, 1, true]);
    expect(Object.keys(made[0]!).sort()).toEqual(['amount', 'createdAt', 'date', 'id', 'note', 'ruleId', 'sourceId', 'updatedAt']);
  });

  it('is idempotent: running it again changes nothing, notifies nobody and writes nothing', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    fixed(store, { day: 1, startMonth: '2026-08' });
    store.runIncomeRules(TODAY);
    const after = store.getData();
    const writes = storage.writes.length;
    const listener = vi.fn();
    store.subscribe(listener);
    expect([store.runIncomeRules(TODAY), store.runIncomeRules(TODAY), store.runIncomeRules('2026-10-01'), store.runIncomeRules('2026-08-15')]).toEqual([0, 0, 0, 0]);
    expect([store.getData() === after, storage.writes.length - writes, listener.mock.calls.length]).toEqual([true, 0, 0]);
  });

  it('notifies once for a whole catch-up, however many incomes it made, and saves it', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    fixed(store, { day: 1, startMonth: '2026-01' });
    fixed(store, { day: 2, startMonth: '2026-06' });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.runIncomeRules(TODAY)).toBe(10 + 5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(saved(storage).incomes).toHaveLength(15);
  });

  it('does not resurrect an income the user deleted, nor regenerate one the user edited', () => {
    const { store } = setup();
    fixed(store, { day: 1, startMonth: '2026-10' });
    store.runIncomeRules(TODAY);
    store.deleteIncome(store.getData().incomes[0]!.id);
    expect([store.runIncomeRules(TODAY), store.runIncomeRules('2026-10-31'), store.getData().incomes.length]).toEqual([0, 0, 0]);
    expect(store.runIncomeRules('2026-11-01')).toBe(1);
    const made = store.getData().incomes[0]!;
    store.updateIncome(made.id, { amount: 123, date: '2026-11-15' });
    expect(store.runIncomeRules('2026-11-20')).toBe(0);
    expect(store.getData().incomes[0]).toMatchObject({ amount: 123, date: '2026-11-15', ruleId: made.ruleId });
  });

  it('skips paused rules and does nothing at all when only they exist; waits for a start month in the future', () => {
    const { store } = setup();
    store.updateIncomeRule(fixed(store, { day: 1, startMonth: '2026-08' }).id, { active: false }, TODAY);
    fixed(store, { startMonth: '2027-01', day: 1 });
    const before = store.getData();
    expect(store.runIncomeRules(TODAY)).toBe(0);
    expect(store.getData()).toBe(before);
    expect(store.runIncomeRules('2027-01-01')).toBe(1);
  });

  it('a rule created in the middle of the month starts when its day arrives (see firstMonthFor)', () => {
    const today = '2026-10-15';
    const [later, same] = [setup().store, setup().store];
    fixed(later, { day: 10, startMonth: firstMonthFor(10, today) });
    fixed(same, { day: 15, startMonth: firstMonthFor(15, today) });
    expect([later.runIncomeRules(today), later.runIncomeRules('2026-10-31'), later.runIncomeRules('2026-11-10'), same.runIncomeRules(today)]).toEqual([0, 0, 1, 1]);
    expect([dates(later), dates(same)]).toEqual([['2026-11-10'], [today]]);
  });

  describe('month ends', () => {
    it('records day 31 on the last day of each month as the days go by, and never drifts', () => {
      const { store } = setup();
      fixed(store, { day: 31, startMonth: '2027-01' });
      const seen: string[] = [];
      for (let d = new Date(Date.UTC(2027, 0, 1)); d <= new Date(Date.UTC(2027, 5, 1)); d = new Date(d.getTime() + 86_400_000)) {
        const day = d.toISOString().slice(0, 10);
        if (store.runIncomeRules(day) > 0) seen.push(`${day}=${store.getData().incomes.at(-1)!.date}`);
      }
      expect(seen).toEqual(['2027-01-31=2027-01-31', '2027-02-28=2027-02-28', '2027-03-31=2027-03-31', '2027-04-30=2027-04-30', '2027-05-31=2027-05-31']);
    });

    it.each([[31, '2026-04', 30], [31, '2026-06', 30], [31, '2026-09', 30], [31, '2026-11', 30], [31, '2026-02', 28], [31, '2028-02', 29], [31, '2100-02', 28], [31, '2000-02', 29], [31, '2026-12', 31], [30, '2028-02', 29], [30, '2027-02', 28], [29, '2028-02', 29], [29, '2027-02', 28]])(
      'day %i in %s is recorded on day %i, never a day early',
      (day, month, last) => {
        const { store } = setup();
        fixed(store, { day, startMonth: month });
        expect(store.runIncomeRules(`${month}-${String(last - 1).padStart(2, '0')}`)).toBe(0);
        expect(store.runIncomeRules(`${month}-${last}`)).toBe(1);
        expect(dates(store)).toEqual([`${month}-${last}`]);
      },
    );

    it('catches up a run of months at once, across a year end, each on its own clamped day', () => {
      const { store } = setup();
      fixed(store, { day: 31, startMonth: '2026-11' });
      expect(store.runIncomeRules('2027-03-31')).toBe(5);
      expect(dates(store)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
    });
  });

  describe('catching up after a long absence', () => {
    it('caps one run at 36 months and finishes on the next without repeating or skipping a month; it takes as many runs as it needs, and caps each rule on its own, in rule order', () => {
      const { store } = setup();
      fixed(store, { day: 1, startMonth: '2023-06' });
      expect([store.runIncomeRules(TODAY), store.runIncomeRules(TODAY), store.runIncomeRules(TODAY)]).toEqual([36, 5, 0]);
      expect(dates(store).map((d) => d.slice(0, 7))).toEqual(Array.from({ length: 41 }, (_, i) => addMonths('2023-06', i)));
      const long = setup().store;
      fixed(long, { day: 15, startMonth: '2018-06' });
      expect(Array.from({ length: 6 }, () => long.runIncomeRules(TODAY))).toEqual([36, 36, 28, 0, 0, 0]);
      expect(new Set(dates(long)).size).toBe(100);
      const two = setup().store;
      const old = fixed(two, { day: 1, startMonth: '2010-01' });
      const young = fixed(two, { day: 1, startMonth: '2026-09' });
      expect(two.runIncomeRules(TODAY)).toBe(36 + 2);
      expect(two.getData().incomes.filter((i) => i.ruleId === young.id).map((i) => i.date)).toEqual(['2026-09-01', '2026-10-01']);
      expect(two.getData().incomes.slice(0, 36).every((i) => i.ruleId === old.id)).toBe(true);
    });
  });

  it('later changes to a rule apply to the months still to come only', () => {
    const { store } = setup();
    const r = fixed(store, { day: 10, startMonth: '2026-10', amount: 100 });
    store.runIncomeRules('2026-10-20');
    store.updateIncomeRule(r.id, { day: 3, amount: 300, sourceId: 'otros', note: 'Nuevo' }, '2026-10-21');
    expect([store.runIncomeRules('2026-10-25'), store.runIncomeRules('2026-11-03')]).toEqual([0, 1]);
    expect(store.getData().incomes.map((i) => [i.date, i.amount, i.sourceId, i.note])).toEqual([['2026-10-10', 100, 'sueldo', 'Sueldo'], ['2026-11-03', 300, 'otros', 'Nuevo']]);
  });

  it('defaults to today\'s date from the local clock: the last second of the 31st is still that day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 59));
    const store = createStore({ storage: null, makeId: seqIds('c'), now: () => 1 });
    store.addIncomeRule({ amount: 5, sourceId: 'sueldo', day: 31, startMonth: '2026-10' });
    expect(store.runIncomeRules()).toBe(1);
    vi.setSystemTime(new Date(2026, 10, 1, 0, 0, 1));
    expect(store.runIncomeRules()).toBe(0);
    vi.setSystemTime(new Date(2026, 10, 30, 12));
    expect(store.runIncomeRules()).toBe(1);
    expect(dates(store)).toEqual(['2026-10-31', '2026-11-30']);
  });

  // BUG (low): `today` is not checked. A nonsense date makes the planner compare month keys as text
  // and record up to three years of incomes, some of them dated after any real "today".
  it.each([['garbage', 'garbage'], ['a month 13', '2026-13-45'], ['unpadded', '2026-1-1']])('records nothing for a nonsense "today" (%s)', (_label, today) => {
    const { store } = setup();
    fixed(store, { day: 5, startMonth: '2026-01' });
    try {
      store.runIncomeRules(today);
    } catch {
      // refusing a nonsense date is a fine answer
    }
    expect(dates(store)).toEqual([]);
  });
});

// ---- subscribers ----------------------------------------------------------------------

describe('subscribers and snapshots (incomes)', () => {
  /** Each action returns the one change to watch, so setting up does not count as a notification. */
  const ACTIONS: Array<[string, (s: Store) => () => void]> = [
    ['addIncome', (s) => () => void earn(s)],
    ['updateIncome', (s) => ((i) => () => void s.updateIncome(i.id, { amount: 9 }))(earn(s))],
    ['deleteIncome', (s) => ((i) => () => void s.deleteIncome(i.id))(earn(s))],
    ['restoreIncome', (s) => ((i) => () => s.restoreIncome({ ...i, id: 'elsewhere' }))(earn(s))],
    ['addIncomeRule', (s) => () => void fixed(s)],
    ['updateIncomeRule', (s) => ((r) => () => s.updateIncomeRule(r.id, { amount: 9 }, TODAY))(fixed(s))],
    ['deleteIncomeRule', (s) => ((r) => () => s.deleteIncomeRule(r.id))(fixed(s))],
    ['runIncomeRules', (s) => (fixed(s, { startMonth: '2026-01' }), () => void s.runIncomeRules(TODAY))],
    ['addDemoIncomes', (s) => () => void s.addDemoIncomes([demoDraft])],
    ['removeDemoIncomes', (s) => (s.addDemoIncomes([demoDraft]), () => void s.removeDemoIncomes())],
  ];

  it.each(ACTIONS)('%s saves first and then notifies exactly once', (_name, prepare) => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    const act = prepare(store);
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(JSON.stringify(saved(storage)) === JSON.stringify(store.getData())));
    act();
    expect(seen).toEqual([true]);
  });

  it('stays silent, and keeps the very same snapshot, when nothing changed or the call is refused', () => {
    const { store } = setup();
    const kept = earn(store);
    fixed(store, { startMonth: '2027-01' });
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getData();
    store.deleteIncome('missing');
    store.updateIncome('missing', { amount: 5 });
    store.restoreIncome(kept);
    store.removeDemoIncomes();
    store.runIncomeRules(TODAY);
    expect(() => store.addIncome({ amount: 0, sourceId: 'venta', date: TODAY })).toThrow();
    expect(() => store.addIncome({ amount: 5, sourceId: 'venta', date: '2026-02-30' })).toThrow();
    expect(() => store.updateIncome(kept.id, { amount: -1 })).toThrow();
    expect(() => store.addIncomeRule({ amount: 5, sourceId: 'venta', day: 1, startMonth: 'x' })).toThrow();
    expect([listener.mock.calls.length, store.getData() === before]).toEqual([0, true]);
  });

  it('hands out a new snapshot per change and never edits an old one', () => {
    const { store } = setup();
    const steps: Array<(s: Store) => unknown> = [
      (s) => earn(s), (s) => s.updateIncome(s.getData().incomes[0]!.id, { amount: 99 }), (s) => fixed(s, { startMonth: '2026-08', day: 1 }), (s) => s.runIncomeRules(TODAY),
      (s) => s.updateIncomeRule(s.getData().incomeRules[0]!.id, { active: false }, TODAY), (s) => s.addDemoIncomes([demoDraft]), (s) => s.removeDemoIncomes(),
      (s) => s.deleteIncome(s.getData().incomes[0]!.id), (s) => s.deleteIncomeRule(s.getData().incomeRules[0]!.id),
    ];
    const snapshots = [store.getData()];
    const frozen = [JSON.stringify(store.getData())];
    for (const step of steps) {
      step(store);
      snapshots.push(store.getData());
      frozen.push(JSON.stringify(store.getData()));
    }
    snapshots.forEach((snap, n) => expect(JSON.stringify(snap)).toBe(frozen[n]));
    expect(new Set(snapshots).size).toBe(snapshots.length);
  });

  it('resetAll empties incomes and fixed incomes and saves that; replaceAll swaps them in', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    earn(store);
    fixed(store);
    const other = clone(store.getData());
    store.resetAll();
    expect(saved(storage)).toMatchObject({ incomes: [], incomeRules: [] });
    store.replaceAll(other);
    expect([saved(storage).incomes, store.getData().incomeRules]).toEqual([other.incomes, other.incomeRules]);
  });
});

// ---- what is in memory must be what a reload gives back ------------------------------------

describe('state after a call equals state after a reload', () => {
  const rule = (s: Store, o: Partial<NewIncomeRule> = {}) => fixed(s, { startMonth: '2026-10', ...o });
  const BAD_INPUTS: Array<[string, (s: Store) => void]> = [
    ['addIncome with an unknown source', (s) => void earn(s, { sourceId: 'ghost' })],
    ['addIncome with a messy note', (s) => void earn(s, { note: ' \n a\t\tb   ' })],
    ['addIncome with a note of emoji', (s) => void earn(s, { note: `${'😀'.repeat(79)}👨‍👩‍👧‍👦👨‍👩‍👧‍👦` })],
    ['addIncome with a note that ends in blanks after the cut', (s) => void earn(s, { note: `${'a'.repeat(79)}  ${'b'.repeat(9)}` })],
    ['addIncome with a note of combining marks', (s) => void earn(s, { note: 'é'.repeat(100) })],
    ['updateIncome to an unknown source', (s) => void s.updateIncome(earn(s).id, { sourceId: 'ghost' })],
    ['updateIncome to a messy note', (s) => void s.updateIncome(earn(s).id, { note: `  ${'x '.repeat(100)}` })],
    ['restoreIncome with an unknown source', (s) => s.restoreIncome({ ...earn(s), id: 'z', sourceId: 'ghost' })],
    ['addIncomeRule with a fractional amount', (s) => void rule(s, { amount: 12.5 })],
    ['addIncomeRule with a NaN day', (s) => void rule(s, { day: Number.NaN })],
    ['addIncomeRule with a string day', (s) => void rule(s, { day: '15' as unknown as number })],
    ['addIncomeRule with an unknown source', (s) => void rule(s, { sourceId: 'ghost' })],
    ['addIncomeRule with a huge note', (s) => void rule(s, { note: 'n'.repeat(100_000) })],
    ['addIncomeRule with startMonth "garbage"', (s) => void rule(s, { startMonth: 'garbage' })],
    ['updateIncomeRule to amount 0', (s) => s.updateIncomeRule(rule(s).id, { amount: 0 }, TODAY)],
    ['updateIncomeRule to an unknown source', (s) => s.updateIncomeRule(rule(s).id, { sourceId: 'ghost' }, TODAY)],
    ['updateIncomeRule to day NaN', (s) => s.updateIncomeRule(rule(s).id, { day: Number.NaN }, TODAY)],
    ['updateIncomeRule to a messy note', (s) => s.updateIncomeRule(rule(s).id, { note: ' a \n\n b ' }, TODAY)],
    ['a rule resumed from a long pause', (s) => (s.updateIncomeRule(rule(s, { startMonth: '2026-01' }).id, { active: false }, TODAY), s.updateIncomeRule(s.getData().incomeRules[0]!.id, { active: true }, '2027-03-09'))],
    ['addDemoIncomes with an unknown source', (s) => void s.addDemoIncomes([{ ...demoDraft, sourceId: 'ghost', note: 'demo' }])],
  ];

  it.each(BAD_INPUTS)('%s', (_label, act) => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    store.updateSettings({ onboarded: true });
    try {
      act(store);
    } catch {
      // refusing the input is a fine answer
    }
    store.runIncomeRules('2027-12-31');
    expect(canonicalForm(store.getData())).toStrictEqual(store.getData());
    expect(setup({ storage, prefix: 'again' }).store.getData()).toStrictEqual(store.getData());
  });

  // BUG (low): addDemoIncomes stores its drafts as they are. A draft with a zero amount, an impossible date, a long
  // note or stray fields is kept in memory, and a reload drops or rewrites it (a setter must sanitize like a reload).
  it.each([
    ['a zero amount', { amount: 0 }], ['a fractional amount', { amount: 12.5 }], ['an impossible date', { date: '2026-02-30' }], ['a long, messy note', { note: `  ${'x  '.repeat(100)}` }],
    ['stray fields', { ruleId: 'r-1', secret: 1 }],
  ])('addDemoIncomes with %s', (_label, overrides) => {
    const { store } = setup();
    store.updateSettings({ onboarded: true });
    store.addDemoIncomes([{ ...demoDraft, note: 'ok', ...overrides }]);
    expect(canonicalForm(store.getData())).toStrictEqual(store.getData());
  });

  it('a long scripted session reloads to exactly the same data, and the reloaded store carries on', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    store.updateSettings({ onboarded: true });
    const sueldo = fixed(store, { day: 31, startMonth: '2026-06' });
    const retainer = fixed(store, { day: 15, startMonth: '2026-08', sourceId: 'freelance', note: '  Cliente   fijo ', amount: 350_000_00 });
    store.runIncomeRules('2026-10-20');
    const job = earn(store, { amount: 80_000_00, note: 'Logo para un café ☕', date: '2026-10-12' });
    earn(store, { amount: 5, date: '2024-02-29', sourceId: 'regalo' });
    store.updateIncome(job.id, { amount: 85_000_00 });
    store.updateIncomeRule(retainer.id, { active: false }, '2026-10-21');
    store.deleteIncome(store.getData().incomes[0]!.id);
    store.addDemoIncomes(generateDemoIncomes({ today: '2026-10-20', currency: 'ARS' }).slice(0, 5));
    store.updateIncomeRule(retainer.id, { active: true, amount: 400_000_00 }, '2026-11-02');
    store.runIncomeRules('2026-11-30');
    store.deleteIncomeRule(sueldo.id);
    const reloaded = setup({ storage, prefix: 'b' }).store;
    expect(reloaded.getData()).toStrictEqual(store.getData());
    expect([reloaded.runIncomeRules('2026-11-30'), reloaded.runIncomeRules('2026-12-15')]).toEqual([0, 1]);
    expect(reloaded.getData().incomes.at(-1)).toMatchObject({ ruleId: retainer.id, amount: 400_000_00, date: '2026-12-15', note: 'Cliente fijo' });
  });
});

// ---- randomized operation sequences -----------------------------------------------------

describe('randomized operation sequences on incomes (seeded)', () => {
  function check(store: Store, storage: MemoryStorage, label: string): void {
    const data = store.getData();
    const fail = (why: string): never => {
      throw new Error(`${label}: ${why}`);
    };
    if (new Set(data.incomes.map((x) => x.id)).size !== data.incomes.length || new Set(data.incomeRules.map((x) => x.id)).size !== data.incomeRules.length) fail('duplicate ids');
    for (const i of data.incomes) {
      if (!Number.isSafeInteger(i.amount) || i.amount <= 0 || !isValidDateStr(i.date) || !isIncomeSourceId(i.sourceId)) fail(`bad income ${JSON.stringify(i)}`);
      if (i.note !== i.note.trim() || [...new Intl.Segmenter().segment(i.note)].length > 80) fail(`bad note ${JSON.stringify(i.note)}`);
    }
    for (const r of data.incomeRules) {
      if (!Number.isInteger(r.day) || r.day < 1 || r.day > 31) fail(`bad day ${r.day}`);
      if (!isValidMonthKey(r.startMonth) || (r.lastGenerated !== null && (!isValidMonthKey(r.lastGenerated) || r.lastGenerated < r.startMonth))) fail(`bad months ${JSON.stringify(r)}`);
    }
    const perRuleMonth = data.incomes.filter((i) => i.ruleId).map((i) => `${i.ruleId}@${i.date.slice(0, 7)}`);
    if (new Set(perRuleMonth).size !== perRuleMonth.length) fail('a rule recorded the same month twice');
    expect(canonicalForm(data), `${label}: state differs from what a reload would produce`).toStrictEqual(data);
    expect(saved(storage), `${label}: storage is behind memory`).toStrictEqual(clone(data));
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('keeps every invariant after every step (seed %i)', { timeout: 60_000 }, (seed) => {
    const rng = mulberry32(seed * 101);
    const storage = memoryStorage();
    const { store } = setup({ storage });
    store.updateSettings({ onboarded: true });
    let today = '2026-01-15';
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
    const int = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
    const dayOf = (offset: number): string => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
    const note = (): string => pick(['', `  n${int(0, 99)}   x `, '😀'.repeat(int(0, 100)), 'Cliente\tfijo', 'a'.repeat(int(1, 200))]);

    for (let step = 0; step < 220; step++) {
      const data = store.getData();
      const roll = rng();
      if (roll < 0.22) {
        earn(store, { amount: int(1, 5_000_000), sourceId: rng() < 0.1 ? 'ghost' : pick(INCOME_SOURCE_IDS), note: note(), date: dayOf(int(0, 400)) });
      } else if (roll < 0.3 && data.incomes.length > 0) {
        const i = pick(data.incomes);
        store.updateIncome(i.id, i.ruleId ? { amount: int(1, 9999), note: note() } : { amount: int(1, 9999), sourceId: pick(INCOME_SOURCE_IDS), date: dayOf(int(0, 400)) });
      } else if (roll < 0.38 && data.incomes.length > 0) {
        const removed = store.deleteIncome(pick(data.incomes).id)!;
        if (rng() < 0.5) store.restoreIncome(removed);
      } else if (roll < 0.48) {
        const day = int(1, 31);
        fixed(store, { amount: int(1, 900_000), sourceId: pick(INCOME_SOURCE_IDS), note: note(), day, startMonth: firstMonthFor(day, today) });
      } else if (roll < 0.56 && data.incomeRules.length > 0) {
        store.updateIncomeRule(pick(data.incomeRules).id, { amount: int(1, 900_000), day: int(0, 40), active: rng() < 0.7, note: note() }, today);
      } else if (roll < 0.59 && data.incomeRules.length > 0) {
        store.deleteIncomeRule(pick(data.incomeRules).id);
      } else if (roll < 0.76) {
        today = dayOf(Math.min(400, Math.floor((Date.parse(today) - Date.UTC(2026, 0, 1)) / 86_400_000) + int(1, 45)));
        store.runIncomeRules(today);
      } else if (roll < 0.82) {
        store.reload();
      } else if (roll < 0.88) {
        store.addDemoIncomes([{ amount: int(1, 999), sourceId: pick(INCOME_SOURCE_IDS), note: 'demo', date: dayOf(int(0, 400)) }]);
        if (rng() < 0.5) store.removeDemoIncomes();
      } else if (roll < 0.94) {
        const raw = { expenses: [], incomes: [{ id: `m${step}`, amount: int(1, 99), date: dayOf(int(0, 400)), createdAt: step }], incomeRules: [{ id: `mr${step}`, amount: 5, day: int(1, 31), startMonth: '2026-06', lastGenerated: null }] };
        store.mergeIn(normalizeData(raw, { makeId: () => `x${step}`, today })!);
      } else {
        store.updateSettings({ monthlyIncome: rng() < 0.5 ? int(1, 9_000_000) : null });
      }
      check(store, storage, `seed ${seed} step ${step}`);
    }
    expect(setup({ storage, prefix: 'next' }).store.getData()).toStrictEqual(store.getData());
  });
});

// ---- storage that cannot be read or written -------------------------------------------------

describe('storage trouble with incomes', () => {
  const populated = () => {
    const storage = memoryStorage();
    const first = setup({ storage }).store;
    earn(first, { amount: 1 });
    earn(first, { amount: 2 });
    fixed(first, { day: 1, startMonth: '2026-09' });
    first.runIncomeRules(TODAY);
    return { storage, stored: storage.map.get(DATA_KEY)!, keys: storage.writes.length };
  };

  describe('when the first read fails, nothing is ever written over what is there', () => {
    const unreadable = () => {
      const world = populated();
      world.storage.failGet = true;
      const { store } = setup({ storage: world.storage, prefix: 'b' });
      world.storage.failGet = false;
      return { ...world, store };
    };

    it.each<[string, (s: Store) => void]>([
      ['addIncome', (s) => void earn(s, { amount: 3 })],
      ['updateIncome', (s) => void s.updateIncome(earn(s).id, { amount: 9 })],
      ['deleteIncome', (s) => void s.deleteIncome(earn(s).id)],
      ['restoreIncome', (s) => s.restoreIncome({ ...earn(s), id: 'zz' })],
      ['addIncomeRule', (s) => void fixed(s)],
      ['updateIncomeRule', (s) => s.updateIncomeRule(fixed(s).id, { amount: 9, active: false }, TODAY)],
      ['deleteIncomeRule', (s) => s.deleteIncomeRule(fixed(s).id)],
      ['runIncomeRules', (s) => void (fixed(s, { startMonth: '2026-01' }), s.runIncomeRules(TODAY))],
      ['addDemoIncomes', (s) => void s.addDemoIncomes(generateDemoIncomes({ today: TODAY, currency: 'ARS' }))],
      ['removeDemoIncomes', (s) => void (s.addDemoIncomes([demoDraft]), s.removeDemoIncomes())],
      ['updateSettings', (s) => s.updateSettings({ monthlyIncome: 500 })],
      ['mergeIn', (s) => void s.mergeIn(normalizeData({ expenses: [], incomes: [{ id: 'q', amount: 5, date: TODAY }] }, { makeId: () => 'x' })!)],
      ['resetAll', (s) => s.resetAll()],
    ])('%s works in memory but writes nothing', (_name, act) => {
      const { storage, store, stored, keys } = unreadable();
      expect([store.getStatus().persistent, store.getData().incomes]).toEqual([false, []]);
      act(store);
      expect([storage.map.get(DATA_KEY) === stored, storage.writes.length, store.getStatus().persistent]).toEqual([true, keys, false]);
    });

    it('a later successful reload brings the saved incomes and rules back, and saving works again from there', () => {
      const { storage, store } = unreadable();
      store.reload();
      expect(store.getData().incomes.map((i) => i.amount)).toEqual([1, 2, 1_200_000_00, 1_200_000_00]);
      expect(store.getData().incomeRules).toHaveLength(1);
      earn(store, { amount: 4 });
      expect(saved(storage).incomes.map((i) => i.amount)).toEqual([1, 2, 1_200_000_00, 1_200_000_00, 4]);
      expect([saved(storage).incomeRules.length, store.getStatus().persistent]).toEqual([1, true]);
    });
  });

  it('keeps every income change in memory while saving fails, and goes back to persistent with everything once it works again', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    earn(store, { amount: 1 });
    storage.failSet = true;
    earn(store, { amount: 2 });
    fixed(store, { day: 1, startMonth: '2026-10' });
    store.runIncomeRules(TODAY);
    expect([store.getStatus().persistent, store.getData().incomes.length]).toEqual([false, 3]);
    storage.failSet = false;
    earn(store, { amount: 3 });
    expect([store.getStatus().persistent, saved(storage).incomes.map((i) => i.amount), saved(storage).incomeRules.length]).toEqual([true, [1, 2, 1_200_000_00, 3], 1]);
  });
});

// ---- demo incomes ------------------------------------------------------------------

describe('demo incomes', () => {
  const drafts = [{ amount: 100, sourceId: 'sueldo', note: 'a', date: '2026-10-01' }, { amount: 200, sourceId: 'ghost', note: 'b', date: '2026-10-02' }];

  it('addDemoIncomes marks them as demo, orders their timestamps, sets onboarded, resolves the source and says how many', () => {
    const { store } = setup();
    expect(store.addDemoIncomes(drafts)).toBe(2);
    const [a, b] = store.getData().incomes;
    expect([a!.demo, b!.demo, a!.sourceId, b!.sourceId, a!.ruleId, store.getData().settings.onboarded]).toEqual([true, true, 'sueldo', 'otros', undefined, true]);
    expect(b!.createdAt).toBe(a!.createdAt + 1);
    expect(store.addDemoIncomes([])).toBe(0);
  });

  it('removeDemoIncomes removes only the demo ones, and leaves real, generated and manual incomes, rules and demo expenses alone', () => {
    const { store } = setup();
    const real = earn(store, { amount: 999 });
    fixed(store, { day: 1, startMonth: '2026-10' });
    store.runIncomeRules(TODAY);
    store.addDemoExpenses([{ amount: 5, categoryId: 'super', note: '', date: TODAY }]);
    const generated = store.getData().incomes[1]!;
    store.addDemoIncomes(drafts);
    const rulesBefore = store.getData().incomeRules;
    expect(store.removeDemoIncomes()).toBe(2);
    expect(store.getData().incomes).toEqual([real, generated]);
    expect([store.getData().incomeRules === rulesBefore, store.getData().expenses.length, store.removeDemoIncomes()]).toEqual([true, 1, 0]);
  });

  it('removing demo expenses does not touch demo incomes and the other way round, and an edited demo income is still removed with the rest', () => {
    const { store } = setup();
    store.addDemoExpenses([{ amount: 5, categoryId: 'super', note: '', date: TODAY }]);
    store.addDemoIncomes(drafts);
    expect([store.removeDemoExpenses(), store.getData().incomes.length]).toEqual([1, 2]);
    store.updateIncome(store.getData().incomes[0]!.id, { amount: 5, note: 'mine' });
    expect([store.getData().incomes[0]!.demo, store.removeDemoIncomes()]).toEqual([true, 2]);
  });

  it('the generated sample can be added in full and removed in full, leaving no demo data after a reload', () => {
    const storage = memoryStorage();
    const { store } = setup({ storage });
    store.updateSettings({ onboarded: true });
    const sample = generateDemoIncomes({ today: '2026-10-20', currency: 'ARS' });
    expect(store.addDemoIncomes(sample)).toBe(sample.length);
    expect(canonicalForm(store.getData())).toStrictEqual(store.getData());
    expect(store.getData().incomes.every((i) => i.demo === true && i.date <= '2026-10-20')).toBe(true);
    expect(store.removeDemoIncomes()).toBe(sample.length);
    expect(setup({ storage, prefix: 'b' }).store.getData().incomes).toEqual([]);
  });
});
