import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_APP_ID, backupFileName, movementsToCsv, mergeData, parseBackup, serializeBackup } from './backup';
import { createInitialData, normalizeData } from './data';
import { getMoneyFormatter, parseAmountText } from './money';
import type { AppData, Category, Expense, Goal, Recurring } from './types';

// ---- fixtures ---------------------------------------------------------------

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'e1',
  amount: 1500,
  categoryId: 'super',
  note: '',
  date: '2026-10-01',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const category = (overrides: Partial<Category> = {}): Category => ({
  id: 'c1',
  name: 'Gimnasio',
  emoji: '🏋️',
  color: 'red',
  flexible: true,
  limit: null,
  archived: false,
  ...overrides,
});

const rule = (overrides: Partial<Recurring> = {}): Recurring => ({
  id: 'r1',
  amount: 5000,
  categoryId: 'servicios',
  note: 'Luz',
  day: 10,
  startMonth: '2026-05',
  lastGenerated: '2026-09',
  active: true,
  ...overrides,
});

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  kind: 'saving',
  name: 'Vacaciones',
  emoji: '🏖️',
  target: 500_000_00,
  deadline: '2027-01',
  saved: 100_000_00,
  createdAt: 10,
  ...overrides,
});

const tripGoal = (overrides: Partial<Goal> = {}): Goal =>
  goal({
    id: 'g2',
    kind: 'trip',
    name: 'Europa',
    emoji: '✈️',
    trip: { stops: [{ place: 'Madrid', days: 5 }, { place: 'Roma', days: 4 }], people: 2, style: 'mid', fx: 1050.5, flightEach: 900_000_00, extras: 50_000_00 },
    ...overrides,
  });

const moveGoal = (overrides: Partial<Goal> = {}): Goal =>
  goal({
    id: 'g3',
    kind: 'move',
    name: 'Mudanza',
    emoji: '🏠',
    move: { zone: 'Palermo', rent: 600_000_00, monthlyExtras: 80_000_00, depositMonths: 1, commissionMonths: 1, advanceMonths: 1, setup: 300_000_00, currentMonthly: 500_000_00 },
    ...overrides,
  });

const appData = (overrides: Partial<AppData> = {}): AppData => ({ ...createInitialData('es-AR'), ...overrides });

/** A dataset that exercises every field the backup has to carry. */
function richData(): AppData {
  const base = createInitialData('es-AR');
  return {
    ...base,
    categories: [...base.categories, category({ id: 'gym', name: 'Gimnasio ñandú', kind: 'ocio', limit: 80_000_00, archived: true })],
    expenses: [
      expense({ id: 'a', amount: 1_250_050, note: 'Súper ☕ "grande"; ok', categoryId: 'super', date: '2026-10-02', createdAt: 5, updatedAt: 9 }),
      expense({ id: 'b', amount: 1, categoryId: 'gym', date: '2024-02-29', createdAt: 1, updatedAt: 1, demo: true }),
      expense({ id: 'c', amount: 45_000_00, categoryId: 'servicios', note: 'Luz', date: '2026-09-10', recurringId: 'r1', createdAt: 3, updatedAt: 3 }),
    ],
    recurring: [rule(), rule({ id: 'r2', active: false, lastGenerated: null, day: 31, amount: 99 })],
    goals: [goal(), tripGoal(), moveGoal()],
    settings: { currency: 'EUR', locale: 'es-ES', monthlyBudget: 500_000_00, monthlyIncome: 1_200_000_00, fxRate: 1050.5, theme: 'dark', haptics: false, onboarded: true },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const counter = (prefix = 'gen'): (() => string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

const noRepairsExpected = (): string => {
  throw new Error('makeId should not be needed for data that is already valid');
};

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

afterEach(() => {
  vi.useRealTimers();
});

// ---- mergeData --------------------------------------------------------------

describe('mergeData', () => {
  it('adds what the backup has and the app does not, matched by id, and counts it', () => {
    const current = appData({ expenses: [expense({ id: 'a' })], recurring: [rule({ id: 'r1' })], goals: [goal({ id: 'g1' })] });
    const incoming = appData({
      expenses: [expense({ id: 'a' }), expense({ id: 'b', amount: 2 }), expense({ id: 'c', amount: 3 })],
      categories: [...createInitialData().categories, category({ id: 'gym' })],
      recurring: [rule({ id: 'r1' }), rule({ id: 'r2' })],
      goals: [goal({ id: 'g1' }), tripGoal({ id: 'g9' })],
    });
    const result = mergeData(current, incoming);
    expect(result.addedExpenses).toBe(2);
    expect(result.addedCategories).toBe(1);
    expect(result.addedRecurring).toBe(1);
    expect(result.addedGoals).toBe(1);
    expect(result.data.goals.map((g) => g.id)).toEqual(['g1', 'g9']);
    expect(result.data.expenses.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(result.data.categories.map((c) => c.id)).toEqual([...current.categories.map((c) => c.id), 'gym']);
    expect(result.data.recurring.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps what is here in front and adds the new ones after, in the backup\'s order', () => {
    const current = appData({ expenses: [expense({ id: 'z' }), expense({ id: 'y' })] });
    const incoming = appData({ expenses: [expense({ id: 'b' }), expense({ id: 'z' }), expense({ id: 'a' })] });
    expect(mergeData(current, incoming).data.expenses.map((e) => e.id)).toEqual(['z', 'y', 'b', 'a']);
  });

  it('lets the version already here win when an id exists on both sides', () => {
    const mine = expense({ id: 'a', amount: 111, note: 'mine', categoryId: 'super' });
    const theirs = expense({ id: 'a', amount: 999, note: 'theirs', categoryId: 'comida' });
    const result = mergeData(appData({ expenses: [mine] }), appData({ expenses: [theirs] }));
    expect(result.data.expenses).toEqual([mine]);
    expect(result.addedExpenses).toBe(0);

    const myFolder = category({ id: 'c1', name: 'Mine' });
    const theirFolder = category({ id: 'c1', name: 'Theirs' });
    const folders = mergeData(appData({ categories: [myFolder] }), appData({ categories: [theirFolder] }));
    expect(folders.data.categories).toEqual([myFolder]);
    expect(folders.addedCategories).toBe(0);

    const myGoal = goal({ id: 'g1', saved: 5 });
    const goals = mergeData(appData({ goals: [myGoal] }), appData({ goals: [goal({ id: 'g1', saved: 999, name: 'Theirs' })] }));
    expect(goals.data.goals).toEqual([myGoal]);
    expect(goals.addedGoals).toBe(0);
  });

  it('never touches the current settings, however different the backup\'s are', () => {
    const current = appData({ settings: { ...createInitialData().settings, currency: 'ARS', theme: 'light', monthlyBudget: 5, onboarded: true } });
    const incoming = appData({
      expenses: [expense({ id: 'n' })],
      settings: { currency: 'EUR', locale: 'es-ES', monthlyBudget: 999, monthlyIncome: 999, fxRate: 1500, theme: 'dark', haptics: false, onboarded: false },
    });
    expect(mergeData(current, incoming).data.settings).toEqual(current.settings);
  });

  it('never removes or changes anything that is already here', () => {
    const current = richData();
    const incoming = appData({ expenses: [expense({ id: 'new' })] });
    const merged = mergeData(current, incoming).data;
    for (const e of current.expenses) expect(merged.expenses).toContainEqual(e);
    for (const c of current.categories) expect(merged.categories).toContainEqual(c);
    for (const r of current.recurring) expect(merged.recurring).toContainEqual(r);
    for (const g of current.goals) expect(merged.goals).toContainEqual(g);
    expect(merged.version).toBe(1);
  });

  describe('onboarded', () => {
    const notOnboarded = (): AppData => appData({ settings: { ...createInitialData().settings, onboarded: false } });

    it('becomes true when the merge brings in at least one expense', () => {
      expect(mergeData(notOnboarded(), appData({ expenses: [expense({ id: 'n' })] })).data.settings.onboarded).toBe(true);
    });

    it('stays false when nothing was added', () => {
      expect(mergeData(notOnboarded(), appData({ expenses: [] })).data.settings.onboarded).toBe(false);
    });

    it('stays false when only folders, rules or goals were added', () => {
      const incoming = appData({ categories: [category({ id: 'gym' })], recurring: [rule()], goals: [goal()] });
      expect(mergeData(notOnboarded(), incoming).data.settings.onboarded).toBe(false);
    });

    it('stays true if it already was, whatever the backup says', () => {
      const current = appData({ settings: { ...createInitialData().settings, onboarded: true } });
      const incoming = appData({ settings: { ...createInitialData().settings, onboarded: false } });
      expect(mergeData(current, incoming).data.settings.onboarded).toBe(true);
    });
  });

  it('is idempotent: merging the same backup again adds nothing and changes nothing', () => {
    const current = appData({ expenses: [expense({ id: 'a' })], settings: { ...createInitialData().settings, onboarded: true } });
    const incoming = richData();
    const once = mergeData(current, incoming);
    const twice = mergeData(once.data, incoming);
    expect(twice.addedExpenses + twice.addedCategories + twice.addedRecurring + twice.addedGoals).toBe(0);
    expect(twice.data).toStrictEqual(once.data);
  });

  it('merging a backup of yourself changes nothing', () => {
    const mine = richData();
    const result = mergeData(mine, parseBackup(serializeBackup(mine), noRepairsExpected)!);
    expect(result).toMatchObject({ addedExpenses: 0, addedCategories: 0, addedRecurring: 0, addedGoals: 0 });
    expect(result.data).toStrictEqual(mine);
  });

  it('merges into an empty app, bringing everything the backup has', () => {
    const incoming = richData();
    const result = mergeData(createInitialData('es-AR'), incoming);
    expect(result.addedExpenses).toBe(3);
    expect(result.addedRecurring).toBe(2);
    expect(result.addedCategories).toBe(1);
    expect(result.addedGoals).toBe(3);
    expect(result.data.expenses).toEqual(incoming.expenses);
    expect(result.data.goals).toEqual(incoming.goals);
  });

  it('is a no-op for an empty backup', () => {
    const current = richData();
    const result = mergeData(current, appData({ categories: [], expenses: [], recurring: [], goals: [] }));
    expect(result).toMatchObject({ addedExpenses: 0, addedCategories: 0, addedRecurring: 0, addedGoals: 0 });
    expect(result.data).toStrictEqual(current);
  });

  it('never mutates either input (which may be frozen) and returns new containers', () => {
    const current = deepFreeze(richData());
    const incoming = deepFreeze(appData({ expenses: [expense({ id: 'new' })], categories: [category({ id: 'fresh' })], recurring: [rule({ id: 'rn' })], goals: [goal({ id: 'gn' })] }));
    const result = mergeData(current, incoming);
    expect(result.data).not.toBe(current);
    expect(result.data.expenses).not.toBe(current.expenses);
    expect(result.data.categories).not.toBe(current.categories);
    expect(result.data.recurring).not.toBe(current.recurring);
    expect(result.data.goals).not.toBe(current.goals);
    expect(result.data.settings).not.toBe(current.settings);
    expect(current.expenses).toHaveLength(3);
    expect(incoming.expenses).toHaveLength(1);
  });

  it('adds the folders an incoming expense needs, so no expense ends up pointing at a missing folder', () => {
    const current = appData();
    const incoming = parseBackup(
      JSON.stringify({
        categories: [{ id: 'gym', name: 'Gimnasio', color: 'red' }],
        expenses: [{ id: 'x', amount: 5000, date: '2026-10-01', categoryId: 'gym' }],
      }),
      counter(),
    )!;
    const merged = mergeData(current, incoming).data;
    const ids = new Set(merged.categories.map((c) => c.id));
    expect(ids.has('gym')).toBe(true);
    for (const e of merged.expenses) expect(ids.has(e.categoryId)).toBe(true);
  });

  it('gives the same set of ids whichever side goes first', () => {
    const a = appData({ expenses: [expense({ id: '1' }), expense({ id: '2' })], recurring: [rule({ id: 'ra' })], goals: [goal({ id: 'ga' })] });
    const b = appData({ expenses: [expense({ id: '2' }), expense({ id: '3' })], recurring: [rule({ id: 'rb' })], categories: [category({ id: 'gym' })], goals: [goal({ id: 'ga' }), goal({ id: 'gb' })] });
    const ab = mergeData(a, b).data;
    const ba = mergeData(b, a).data;
    expect(ab.expenses.map((e) => e.id).sort()).toEqual(ba.expenses.map((e) => e.id).sort());
    expect(ab.recurring.map((r) => r.id).sort()).toEqual(ba.recurring.map((r) => r.id).sort());
    expect(ab.categories.map((c) => c.id).sort()).toEqual(ba.categories.map((c) => c.id).sort());
    expect(ab.goals.map((g) => g.id).sort()).toEqual(ba.goals.map((g) => g.id).sort());
  });

  it('produces data that is already in canonical form', () => {
    const a = richData();
    const b = appData({ expenses: [expense({ id: 'q', amount: 7 })], categories: [category({ id: 'extra' })] });
    const merged = mergeData(a, b).data;
    expect(normalizeData(JSON.parse(JSON.stringify(merged)), { makeId: noRepairsExpected, today: '2026-10-02' })).toStrictEqual(merged);
  });
});

// ---- serializeBackup --------------------------------------------------------

describe('serializeBackup', () => {
  const NOW = new Date('2026-10-02T12:34:56.789Z');

  it('writes valid JSON with the app marker, the export time and all the data', () => {
    const data = richData();
    const parsed = JSON.parse(serializeBackup(data, NOW)) as Record<string, unknown>;
    expect(parsed.app).toBe('appgastos');
    expect(parsed.app).toBe(BACKUP_APP_ID);
    expect(parsed.exportedAt).toBe('2026-10-02T12:34:56.789Z');
    expect(parsed.version).toBe(1);
    expect(parsed.expenses).toEqual(JSON.parse(JSON.stringify(data.expenses)));
    expect(parsed.categories).toEqual(JSON.parse(JSON.stringify(data.categories)));
    expect(parsed.recurring).toEqual(JSON.parse(JSON.stringify(data.recurring)));
    expect(parsed.goals).toEqual(JSON.parse(JSON.stringify(data.goals)));
    expect(parsed.settings).toEqual(JSON.parse(JSON.stringify(data.settings)));
  });

  it('has exactly the documented top-level keys', () => {
    const parsed = JSON.parse(serializeBackup(appData(), NOW)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['app', 'categories', 'expenses', 'exportedAt', 'goals', 'incomeRules', 'incomes', 'recurring', 'settings', 'version']);
  });

  it('is indented with two spaces so a person can read it', () => {
    const text = serializeBackup(appData(), NOW);
    expect(text.startsWith('{\n  "app": "appgastos",\n  "exportedAt": "2026-10-02T12:34:56.789Z",')).toBe(true);
    expect(text).not.toContain('\t');
    expect(text.endsWith('}')).toBe(true);
  });

  it('keeps accents and emoji as they are', () => {
    const text = serializeBackup(richData(), NOW);
    expect(text).toContain('Súper ☕');
    expect(text).toContain('ñandú');
    expect(text).toContain('🏋️');
  });

  it('keeps the optional fields (demo, recurringId, kind)', () => {
    const parsed = JSON.parse(serializeBackup(richData(), NOW)) as { expenses: Array<Record<string, unknown>>; categories: Array<Record<string, unknown>> };
    expect(parsed.expenses.find((e) => e.id === 'b')?.demo).toBe(true);
    expect(parsed.expenses.find((e) => e.id === 'c')?.recurringId).toBe('r1');
    expect(parsed.categories.find((c) => c.id === 'gym')?.kind).toBe('ocio');
  });

  it('keeps the goal plans (trip stops, move costs) and the exchange rate', () => {
    const parsed = JSON.parse(serializeBackup(richData(), NOW)) as { goals: Array<Record<string, unknown>>; settings: Record<string, unknown> };
    expect(parsed.goals.find((g) => g.id === 'g2')?.trip).toEqual(tripGoal().trip);
    expect(parsed.goals.find((g) => g.id === 'g3')?.move).toEqual(moveGoal().move);
    expect(parsed.settings.fxRate).toBe(1050.5);
  });

  it('uses the current clock when no time is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-15T08:00:00.000Z'));
    expect((JSON.parse(serializeBackup(appData())) as { exportedAt: string }).exportedAt).toBe('2027-01-15T08:00:00.000Z');
  });

  it('does not mutate the data and is repeatable', () => {
    const data = deepFreeze(richData());
    expect(serializeBackup(data, NOW)).toBe(serializeBackup(data, NOW));
  });

  it('refuses an invalid time instead of writing a nonsense export date', () => {
    expect(() => serializeBackup(appData(), new Date(Number.NaN))).toThrow(RangeError);
  });
});

// ---- parseBackup ------------------------------------------------------------

describe('parseBackup', () => {
  describe('reading back what serializeBackup wrote', () => {
    it.each([
      ['a fresh install', () => createInitialData('es-AR')],
      ['a fresh install for Mexico', () => createInitialData('es-MX')],
      ['a rich dataset', richData],
      ['an empty dataset with custom settings', () => appData({ settings: { ...createInitialData().settings, theme: 'light', monthlyBudget: 1 } })],
    ])('round-trips %s unchanged, without needing any id repair', (_label, make) => {
      const data = make();
      expect(parseBackup(serializeBackup(data, new Date(0)), noRepairsExpected)).toStrictEqual(data);
    });

    it('round-trips a thousand expenses', () => {
      const rng = mulberry32(9);
      const expenses = Array.from({ length: 1000 }, (_, i) =>
        expense({ id: `e${i}`, amount: 1 + Math.floor(rng() * 1e9), date: `2026-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}`, createdAt: i, updatedAt: i }),
      );
      const data = appData({ expenses, settings: { ...createInitialData().settings, onboarded: true } });
      expect(parseBackup(serializeBackup(data), noRepairsExpected)).toStrictEqual(data);
    });
  });

  describe('refusing what is not a backup', () => {
    it.each([
      ['empty text', ''],
      ['whitespace', '   \n'],
      ['plain words', 'not json'],
      ['single quotes', "{'expenses': []}"],
      ['a trailing comma', '{"expenses": [],}'],
      ['an unterminated object', '{"expenses": ['],
      ['undefined', 'undefined'],
      ['NaN', 'NaN'],
      ['a comment', '{"expenses": [] /* x */}'],
      ['two documents', '{"expenses": []}{"expenses": []}'],
      ['HTML', '<html><body>Hola</body></html>'],
      ['truncated JSON', serializeBackup(richData()).slice(0, 200)],
    ])('returns null for invalid JSON: %s', (_label, text) => {
      expect(parseBackup(text, counter())).toBeNull();
    });

    it.each([
      ['null', 'null'],
      ['a number', '42'],
      ['a string', '"expenses"'],
      ['true', 'true'],
      ['an empty array', '[]'],
      ['an array of backups', '[{"expenses":[]}]'],
      ['an empty object', '{}'],
      ['unrelated keys', '{"hello":"world","items":[1,2,3]}'],
      ['expenses that are not a list', '{"expenses":"lots"}'],
      ['only recurring rules', '{"recurring":[{"id":"r","amount":1,"day":1}]}'],
    ])('returns null for valid JSON that is not a backup: %s', (_label, text) => {
      expect(parseBackup(text, counter())).toBeNull();
    });

    it('returns null for absurdly deep nesting instead of crashing', () => {
      expect(parseBackup('['.repeat(200_000) + ']'.repeat(200_000), counter())).toBeNull();
      expect(parseBackup('{"expenses":' + '['.repeat(200_000), counter())).toBeNull();
    });

    it('never throws, whatever the text', () => {
      const hostile = ['\u0000', '￿', '{"expenses":[null]}', '{"expenses":[{"amount":1e999}]}', '{"expenses":[],"settings":{"locale":"\u0000"}}', '"\\ud800"', '{"__proto__":{"expenses":[]}}', '{"expenses":' + '[]'.repeat(10) + '}'];
      for (const text of hostile) expect(() => parseBackup(text, counter())).not.toThrow();
    });
  });

  describe('repairing a damaged backup', () => {
    const damaged = JSON.stringify({
      app: 'appgastos',
      expenses: [
        { id: 'a', amount: 1500, date: '2026-10-01', categoryId: 'super', note: '  hola  ' },
        { id: 'a', amount: 2500, date: '2026-10-02', categoryId: 'ghost' },
        { amount: 3500, date: '2026-10-03' },
        { id: 'bad', amount: -1, date: '2026-10-04' },
        { id: 'worse', amount: 100, date: '2026-02-30' },
        'junk',
      ],
      goals: [
        { id: 'g', kind: 'trip', name: '  Japón  ', target: 900000, deadline: '2027-06', trip: { people: 99, style: 'luxury', stops: [{ place: 'Tokio', days: 9999 }] } },
        { id: 'g', kind: 'rocket', target: 100, deadline: '2027-06' },
        { id: 'bad-target', target: 0, deadline: '2027-06' },
        { id: 'bad-deadline', target: 100, deadline: '2027-13' },
      ],
      settings: { currency: 'nope', theme: 'neon' },
    });

    it('keeps what is usable, fixes what it can and drops the rest', () => {
      const data = parseBackup(damaged, counter())!;
      expect(data.expenses.map((e) => [e.id, e.amount, e.categoryId, e.note])).toEqual([
        ['a', 1500, 'super', 'hola'],
        ['gen-1', 2500, 'otros', ''],
        ['gen-2', 3500, 'otros', ''],
      ]);
      expect(data.settings.currency).toBe('ARS');
      expect(data.settings.theme).toBe('system');
      expect(data.settings.onboarded).toBe(true);
    });

    it('repairs goals too: plan values are bounded, bad goals are dropped, a repeated id gets a new one', () => {
      const data = parseBackup(damaged, counter('goal'))!;
      expect(data.goals.map((g) => [g.id, g.kind, g.name, g.target])).toEqual([
        ['g', 'trip', 'Japón', 900_000],
        ['goal-3', 'saving', 'Mi meta', 100],
      ]);
      expect(data.goals[0]!.trip).toEqual({ stops: [{ place: 'Tokio', days: 365 }], people: 20, style: 'mid' });
    });

    it('asks for new ids only where something had none or a repeated one, in order', () => {
      const makeId = vi.fn(counter('new'));
      parseBackup(damaged, makeId);
      expect(makeId).toHaveBeenCalledTimes(3);
    });

    it('can be merged straight into what is here', () => {
      const current = appData({ expenses: [expense({ id: 'a', amount: 7 })] });
      const merged = mergeData(current, parseBackup(damaged, counter('imp'))!);
      expect(merged.addedExpenses).toBe(2);
      expect(merged.data.expenses[0]).toEqual(expense({ id: 'a', amount: 7 }));
    });
  });
});

describe('backupFileName', () => {
  it.each([
    ['json', '2026-10-02', 'cuanto-2026-10-02.json'],
    ['csv', '2026-10-02', 'cuanto-2026-10-02.csv'],
    ['json', '2024-02-29', 'cuanto-2024-02-29.json'],
  ] as const)('%s on %s is %s', (kind, today, expected) => {
    expect(backupFileName(kind, today)).toBe(expected);
  });
});

// ---- movementsToCsv ----------------------------------------------------------

/** A small strict CSV reader (RFC 4180 with ";" as the separator), used to check the writer from the outside. */
function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      if (cell !== '' || wasQuoted) throw new Error(`stray quote in an unquoted cell at ${i}`);
      quoted = true;
      wasQuoted = true;
    } else if (ch === ';') {
      row.push(cell);
      cell = '';
      wasQuoted = false;
    } else if (ch === '\r' && source[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      wasQuoted = false;
      i++;
    } else if (ch === '\n' || ch === '\r') {
      throw new Error(`bare line break outside quotes at ${i}`);
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('unterminated quote');
  if (cell !== '' || row.length > 0 || wasQuoted) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('movementsToCsv', () => {
  const ars = getMoneyFormatter('es-AR', 'ARS');
  const csvOf = (expenses: Expense[], categories?: Category[], f = ars): string =>
    movementsToCsv(appData({ expenses, ...(categories ? { categories } : {}) }), f);
  const rowsOf = (expenses: Expense[], categories?: Category[], f = ars): string[][] => parseCsv(csvOf(expenses, categories, f)).slice(1);

  describe('shape', () => {
    it('is just the byte-order mark and the header when there is nothing to export', () => {
      expect(csvOf([])).toBe('﻿Fecha;Carpeta;Concepto;Monto;Moneda;Tipo\r\n');
    });

    it('starts with exactly one UTF-8 byte-order mark so Excel opens it as UTF-8', () => {
      const csv = csvOf([expense({ note: 'ñandú ☕' })]);
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv.indexOf('﻿', 1)).toBe(-1);
    });

    it('writes the Spanish header, semicolon separated', () => {
      expect(parseCsv(csvOf([]))[0]).toEqual(['Fecha', 'Carpeta', 'Concepto', 'Monto', 'Moneda', 'Tipo']);
    });

    it('ends every line, including the last, with CRLF and never uses a bare line break outside quotes', () => {
      const csv = csvOf([expense({ id: 'a' }), expense({ id: 'b', note: 'x\ny' }), expense({ id: 'c' })]);
      expect(csv.endsWith('\r\n')).toBe(true);
      expect(() => parseCsv(csv)).not.toThrow();
      expect(parseCsv(csv)).toHaveLength(4);
    });

    it('writes one row per expense with the date, folder name, note, amount and currency', () => {
      const rows = rowsOf([expense({ date: '2026-10-02', categoryId: 'super', note: 'Chino', amount: 12_550 })]);
      expect(rows).toEqual([['2026-10-02', 'Supermercado', 'Chino', '125,50', 'ARS', 'Gasto']]);
    });

    it('always has six fields per row, whatever the content', () => {
      const notes = ['', ';', ';;;', '"', '""', 'a;b', 'line\nbreak', 'crlf\r\nbreak', '\r', '=SUM(A1)', '"quoted"', ' ', '\t', 'é;ñ"\n'];
      const rows = rowsOf(notes.map((note, i) => expense({ id: `e${i}`, note })));
      expect(rows).toHaveLength(notes.length);
      for (const row of rows) expect(row).toHaveLength(6);
    });

    it('uses the currency of the formatter', () => {
      expect(rowsOf([expense()], undefined, getMoneyFormatter('es-ES', 'EUR'))[0]![4]).toBe('EUR');
      expect(rowsOf([expense()], undefined, getMoneyFormatter('en-US', 'USD'))[0]![4]).toBe('USD');
    });
  });

  describe('amounts', () => {
    it.each([
      [100, '1'],
      [12_550, '125,50'],
      [5, '0,05'],
      [99, '0,99'],
      [150, '1,50'],
      [10_001, '100,01'],
      [100_000, '1000'],
      [1_250_000, '12500'],
      [1_250_001, '12500,01'],
      [123_456_789, '1234567,89'],
      [100_000_000_000, '1000000000'],
    ])('writes %i cents as %s for a decimal-comma locale (es-AR)', (cents, expected) => {
      expect(rowsOf([expense({ amount: cents })])[0]![3]).toBe(expected);
    });

    it('uses the formatter\'s decimal mark: a point for es-MX and en-US', () => {
      for (const f of [getMoneyFormatter('es-MX', 'MXN'), getMoneyFormatter('en-US', 'USD')]) {
        expect(rowsOf([expense({ amount: 12_550 }), expense({ id: 'b', amount: 1_250_000 })], undefined, f).map((r) => r[3])).toEqual(['125.50', '12500']);
      }
    });

    it('never adds thousands separators, which would clash with the decimal mark', () => {
      for (const f of [ars, getMoneyFormatter('es-MX', 'MXN'), getMoneyFormatter('es-ES', 'EUR')]) {
        const cell = rowsOf([expense({ amount: 123_456_789_012 })], undefined, f)[0]![3]!;
        expect(cell).toMatch(/^\d+([.,]\d{2})?$/);
        expect(cell.replace(/[.,]\d{2}$/, '')).toBe('1234567890');
      }
    });

    it('is exact for any amount, up to the largest safe integer', () => {
      const rng = mulberry32(61);
      const amounts = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, 1, 99, 100, 101];
      for (let i = 0; i < 3000; i++) amounts.push(Math.floor(rng() * Number.MAX_SAFE_INTEGER) + 1);
      const rows = rowsOf(amounts.map((amount, i) => expense({ id: `e${i}`, amount, createdAt: i })));
      const wrong: string[] = [];
      amounts.forEach((cents, i) => {
        const big = BigInt(cents);
        const expected = big % 100n === 0n ? `${big / 100n}` : `${big / 100n},${String(big % 100n).padStart(2, '0')}`;
        if (rows[i]![3] !== expected) wrong.push(`${cents}: ${rows[i]![3]} vs ${expected}`);
      });
      expect(wrong).toEqual([]);
    });

    it.each([[ars], [getMoneyFormatter('es-MX', 'MXN')], [getMoneyFormatter('es-ES', 'EUR')]])('can be read back with parseAmountText (%#)', (f) => {
      const rng = mulberry32(5);
      const amounts = [1, 5, 99, 100, 101, 150, 999, 1000, 1234, 99_999, 100_000, 123_450, 1_250_000, 1_250_050];
      for (let i = 0; i < 300; i++) amounts.push(1 + Math.floor(rng() * 1_000_000_000_000));
      const rows = rowsOf(amounts.map((amount, i) => expense({ id: `e${i}`, amount, createdAt: i })), undefined, f);
      const wrong = amounts.filter((cents, i) => parseAmountText(rows[i]![3]!) !== cents);
      expect(wrong).toEqual([]);
    });
  });

  describe('order', () => {
    it('sorts by date, then by when each was entered', () => {
      const rows = rowsOf([
        expense({ id: 'a', date: '2026-10-02', createdAt: 5, note: 'a' }),
        expense({ id: 'b', date: '2026-09-30', createdAt: 9, note: 'b' }),
        expense({ id: 'c', date: '2026-10-02', createdAt: 1, note: 'c' }),
        expense({ id: 'd', date: '2025-12-31', createdAt: 7, note: 'd' }),
        expense({ id: 'e', date: '2026-10-02', createdAt: 3, note: 'e' }),
      ]);
      expect(rows.map((r) => r[2])).toEqual(['d', 'b', 'c', 'e', 'a']);
    });

    it('keeps the input order when date and entry time are both equal', () => {
      const rows = rowsOf(['x', 'y', 'z'].map((note, i) => expense({ id: `e${i}`, note, date: '2026-10-02', createdAt: 5 })));
      expect(rows.map((r) => r[2])).toEqual(['x', 'y', 'z']);
    });

    it('does not reorder the data it was given', () => {
      const data = appData({ expenses: [expense({ id: 'late', date: '2026-12-01' }), expense({ id: 'early', date: '2026-01-01' })] });
      movementsToCsv(data, ars);
      expect(data.expenses.map((e) => e.id)).toEqual(['late', 'early']);
      expect(() => movementsToCsv(deepFreeze(data), ars)).not.toThrow();
    });

    it('handles several thousand rows', () => {
      const expenses = Array.from({ length: 5000 }, (_, i) => expense({ id: `e${i}`, date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-15`, createdAt: i, amount: i + 1 }));
      const rows = rowsOf(expenses);
      expect(rows).toHaveLength(5000);
      const dates = rows.map((r) => r[0]!);
      expect([...dates].sort()).toEqual(dates);
    });
  });

  describe('folder names', () => {
    it('resolves the folder name, including archived and custom folders', () => {
      const categories = [category({ id: 'gym', name: 'Gimnasio' }), category({ id: 'old', name: 'Vieja', archived: true })];
      const rows = rowsOf([expense({ id: 'a', categoryId: 'gym' }), expense({ id: 'b', categoryId: 'old' })], categories);
      expect(rows.map((r) => r[1])).toEqual(['Gimnasio', 'Vieja']);
    });

    it('leaves the folder cell empty when the folder no longer exists', () => {
      expect(rowsOf([expense({ categoryId: 'deleted' })])[0]![1]).toBe('');
    });
  });

  describe('quoting', () => {
    const notes = [
      'plain', 'con ñ y acentos áéíóú', 'emoji ☕🎉', 'semi;colon', 'both ; and "quotes"', 'she said "hi"', '"', '""', '"leading quote',
      'line\nbreak', 'crlf\r\nbreak', 'cr\rbreak', '\n', 'a\n\nb', ';', ';;', 'comma, only', 'tab\tinside', 'a'.repeat(10_000),
    ];

    it('survives a trip through a strict CSV reader, byte for byte', () => {
      const rows = rowsOf(notes.map((note, i) => expense({ id: `e${i}`, note, createdAt: i })));
      expect(rows.map((r) => r[2])).toEqual(notes);
    });

    it('quotes only when it has to', () => {
      const csv = csvOf([expense({ note: 'plain' }), expense({ id: 'b', note: 'has;semicolon' }), expense({ id: 'c', note: 'comma, ok' })]);
      expect(csv).toContain(';plain;');
      expect(csv).toContain(';"has;semicolon";');
      expect(csv).toContain(';comma, ok;');
    });

    it('doubles embedded quotes', () => {
      expect(csvOf([expense({ note: 'say "hi"' })])).toContain(';"say ""hi""";');
    });

    it('quotes folder names too', () => {
      const rows = rowsOf([expense({ categoryId: 'x' })], [category({ id: 'x', name: 'Ropa; "calzado"' })]);
      expect(rows[0]![1]).toBe('Ropa; "calzado"');
    });
  });

  describe('spreadsheet formula injection', () => {
    const LEADING = ['=', '+', '-', '@', '\t', '\r'];

    it.each(LEADING)('neutralizes a note that starts with %j by prefixing an apostrophe', (lead) => {
      const note = `${lead}1+1`;
      expect(rowsOf([expense({ note })])[0]![2]).toBe(`'${note}`);
    });

    it('neutralizes the classic attack strings', () => {
      const attacks = [
        '=1+1',
        '=cmd|\' /C calc\'!A0',
        '=HYPERLINK("http://evil.example","click")',
        '+54 11 5555-5555',
        '-5 de descuento',
        '@SUM(A1:A9)',
        '=IMPORTXML("http://evil.example","//a")',
        '=1;2',
        '\t=1+1',
        '\r=1+1',
      ];
      const rows = rowsOf(attacks.map((note, i) => expense({ id: `e${i}`, note, createdAt: i })));
      attacks.forEach((attack, i) => expect(rows[i]![2]).toBe(`'${attack}`));
      for (const row of rows) expect(row[2]).not.toMatch(/^[=+\-@\t\r]/);
    });

    it('neutralizes a folder name the same way', () => {
      const rows = rowsOf([expense({ categoryId: 'x' })], [category({ id: 'x', name: '=2+2' })]);
      expect(rows[0]![1]).toBe("'=2+2");
    });

    it('leaves everything else exactly as it was', () => {
      const safe = ['a=1', '1+1', 'x-y', 'me@home', ' =1', "'=1", '"=1"', 'ñ=1', '1=1', '=', 'a\n=1+1'];
      const rows = rowsOf(safe.filter((s) => !/^[=+\-@\t\r]/.test(s)).map((note, i) => expense({ id: `e${i}`, note, createdAt: i })));
      expect(rows.map((r) => r[2])).toEqual(safe.filter((s) => !/^[=+\-@\t\r]/.test(s)));
    });

    it('guards a bare dangerous character as well', () => {
      const rows = rowsOf(LEADING.map((note, i) => expense({ id: `e${i}`, note, createdAt: i })));
      LEADING.forEach((lead, i) => expect(rows[i]![2]).toBe(`'${lead}`));
    });

    it('no field of any row can start with a formula character, whatever the content', () => {
      const rng = mulberry32(77);
      const alphabet = '=+-@\t\r\n;"\' abcé0';
      const notes: string[] = [];
      for (let i = 0; i < 1000; i++) {
        let note = '';
        const length = 1 + Math.floor(rng() * 8);
        for (let j = 0; j < length; j++) note += alphabet[Math.floor(rng() * alphabet.length)] ?? '';
        notes.push(note);
      }
      const rows = rowsOf(notes.map((note, i) => expense({ id: `e${i}`, note, createdAt: i })));
      expect(rows).toHaveLength(notes.length);
      for (const row of rows) {
        expect(row).toHaveLength(6);
        for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
      }
      notes.forEach((note, i) => expect(rows[i]![2]).toBe(/^[=+\-@\t\r]/.test(note) ? `'${note}` : note));
    });
  });
});

// ---- regressions: bugs found in review, since fixed --------------------------

describe('regressions', () => {
  // normalizeData is deliberately lenient (it also loads saved state); the strict "is this really our
  // backup" rule lives in parseBackup. Any JSON with an `expenses`, `settings` or `categories` key used
  // to become a blank "backup" that "Reemplazar todo" would restore over the user's real data.
  describe('parseBackup refuses files that are plainly not this app\'s backups', () => {
    it.each([
      ['another app\'s export (different app marker)', JSON.stringify({ app: 'otra-app', expenses: [{ id: '1', amount: 100, date: '2026-10-01' }] })],
      ['a JSON with a category list of its own kind', JSON.stringify({ categories: [{ title: 'Food', total: 12 }], transactions: [{ value: 5 }] })],
    ])('%s', (_label, text) => {
      expect(parseBackup(text, counter())).toBeNull();
    });
  });
});
