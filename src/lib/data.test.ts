import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLOR_KEYS,
  FALLBACK_CATEGORY_ID,
  colorVar,
  defaultCategories,
  isColorKey,
  pickNewCategoryColor,
} from './categories';
import { DATA_VERSION, MAX_NAME_LENGTH, MAX_NOTE_LENGTH, cleanText, createInitialData, makeIdGenerator, normalizeData } from './data';
import type { AppData, Category } from './types';

const TODAY = '2026-10-02';

/** Sequential ids: gen-1, gen-2, ... */
function counter(prefix = 'gen'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function normalize(raw: unknown, extra: { language?: string; today?: string; makeId?: () => string } = {}): AppData | null {
  return normalizeData(raw, { makeId: counter(), today: TODAY, ...extra });
}

function normalized(raw: unknown, extra: { language?: string; today?: string; makeId?: () => string } = {}): AppData {
  const result = normalize(raw, extra);
  if (!result) throw new Error('expected the input to be recognized as a backup');
  return result;
}

const rawExpense = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'e1',
  amount: 1500,
  categoryId: 'super',
  note: 'x',
  date: '2026-10-01',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

const rawRule = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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

const rawCategory = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1',
  name: 'Gym',
  emoji: '🏋️',
  color: 'red',
  flexible: true,
  limit: 5000,
  archived: false,
  kind: 'ocio',
  ...overrides,
});

const rawGoal = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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

const rawTrip = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  stops: [{ place: 'Madrid', days: 5 }, { place: 'Roma', days: 4 }],
  people: 2,
  style: 'mid',
  fx: 1050.5,
  flightEach: 900_000_00,
  extras: 50_000_00,
  ...overrides,
});

const rawMove = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  zone: 'Palermo',
  rent: 600_000_00,
  monthlyExtras: 80_000_00,
  depositMonths: 1,
  commissionMonths: 1,
  advanceMonths: 1,
  setup: 300_000_00,
  currentMonthly: 500_000_00,
  ...overrides,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Every object and array reachable from `value`. */
function collectObjects(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value);
    for (const inner of Object.values(value)) collectObjects(inner, into);
  }
  return into;
}

const hasLoneSurrogate = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- createInitialData & defaults -------------------------------------------

describe('createInitialData', () => {
  it('starts empty, with the default folders and not onboarded', () => {
    const data = createInitialData();
    expect(data.version).toBe(DATA_VERSION);
    expect(data.version).toBe(1);
    expect(data.expenses).toEqual([]);
    expect(data.recurring).toEqual([]);
    expect(data.goals).toEqual([]);
    expect(data.categories).toEqual(defaultCategories());
    expect(data.settings).toEqual({
      currency: 'ARS',
      locale: 'es-AR',
      monthlyBudget: null,
      monthlyIncome: null,
      fxRate: null,
      theme: 'system',
      haptics: true,
      onboarded: false,
    });
  });

  it.each([
    ['es-MX', 'es-MX', 'MXN'],
    ['es-ES', 'es-ES', 'EUR'],
    ['es_CL', 'es-CL', 'CLP'],
    ['en-US', 'es-AR', 'USD'],
    ['fr-FR', 'es-AR', 'ARS'],
    ['', 'es-AR', 'ARS'],
    [undefined, 'es-AR', 'ARS'],
  ])('derives locale and currency from the browser language %j', (language, locale, currency) => {
    const { settings } = createInitialData(language);
    expect(settings.locale).toBe(locale);
    expect(settings.currency).toBe(currency);
  });

  it('hands out independent copies each time', () => {
    const a = createInitialData();
    a.categories[0]!.name = 'tampered';
    a.categories.pop();
    a.settings.currency = 'XXX';
    a.expenses.push({ id: 'x', amount: 1, categoryId: 'otros', note: '', date: TODAY, createdAt: 0, updatedAt: 0 });
    const b = createInitialData();
    expect(b.categories).toHaveLength(defaultCategories().length);
    expect(b.categories[0]!.name).toBe('Supermercado');
    expect(b.settings.currency).toBe('ARS');
    expect(b.expenses).toEqual([]);
  });

  it('is already in canonical form (normalizing it changes nothing)', () => {
    for (const language of [undefined, 'es-MX', 'es-ES', 'en-US']) {
      const initial = createInitialData(language);
      expect(normalizeData(JSON.parse(JSON.stringify(initial)), { makeId: counter(), today: TODAY, language })).toStrictEqual(initial);
    }
  });
});

describe('default categories', () => {
  const defaults = defaultCategories();

  it('has unique ids, the fallback folder, and a name and emoji each', () => {
    const ids = defaults.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(FALLBACK_CATEGORY_ID);
    expect(FALLBACK_CATEGORY_ID).toBe('otros');
    for (const c of defaults) {
      expect(c.name.trim().length).toBeGreaterThan(0);
      expect(c.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(c.emoji.length).toBeGreaterThan(0);
      expect(c.emoji.length).toBeLessThanOrEqual(8);
    }
  });

  it('only uses known palette colors, has no limits and nothing archived', () => {
    for (const c of defaults) {
      expect(isColorKey(c.color)).toBe(true);
      expect(c.limit).toBeNull();
      expect(c.archived).toBe(false);
      expect(typeof c.flexible).toBe('boolean');
    }
  });

  it('uses its id as the semantic kind the folder-guessing AI understands', () => {
    for (const c of defaults) expect(c.kind).toBe(c.id);
  });

  it('gives every folder its own color, so charts can tell them apart', () => {
    const colors = defaults.map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('survives a normalizeData round trip untouched', () => {
    expect(normalized({ categories: defaults }).categories).toStrictEqual(defaults);
  });

  it('returns fresh objects on every call', () => {
    const a = defaultCategories();
    a[0]!.name = 'tampered';
    expect(defaultCategories()[0]!.name).toBe('Supermercado');
  });
});

describe('color helpers', () => {
  it.each([...COLOR_KEYS])('recognizes the palette key %s', (key) => {
    expect(isColorKey(key)).toBe(true);
    expect(colorVar(key)).toBe(`var(--c-${key})`);
  });

  it.each([['purple'], ['BLUE'], [' blue'], [''], ['#fff'], ['constructor'], ['__proto__']])('does not recognize %j', (value) => {
    expect(isColorKey(value)).toBe(false);
    expect(colorVar(value)).toBe('var(--c-slate)');
  });

  it.each([[undefined], [null], [5], [{}], [['blue']]])('does not recognize the non-string %j', (value) => {
    expect(isColorKey(value)).toBe(false);
  });

  const folder = (color: string): Category => ({ id: color, name: color, emoji: '📦', color, flexible: false, limit: null, archived: false });

  it('pickNewCategoryColor offers the first palette color nobody uses yet', () => {
    expect(pickNewCategoryColor([])).toBe('blue');
    expect(pickNewCategoryColor([folder('blue')])).toBe('orange');
    expect(pickNewCategoryColor([folder('blue'), folder('orange')])).toBe('aqua');
    expect(pickNewCategoryColor([folder('orange')])).toBe('blue');
  });

  it('never offers the neutral gray while a real color is free', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 300; i++) {
      const used = COLOR_KEYS.filter(() => rng() < 0.6);
      const picked = pickNewCategoryColor(used.map(folder));
      expect(COLOR_KEYS).toContain(picked);
      const free = COLOR_KEYS.filter((k) => !used.includes(k) && k !== 'slate');
      if (free.length > 0) {
        expect(picked).not.toBe('slate');
        expect(free).toContain(picked);
      }
    }
  });

  it('falls back to blue once the whole palette is taken (so with the 12 default folders every new one is blue)', () => {
    expect(pickNewCategoryColor(defaultCategories())).toBe('blue');
    expect(pickNewCategoryColor(COLOR_KEYS.map(folder))).toBe('blue');
  });

  it('prefers blue over the unused neutral gray when every real color is taken', () => {
    expect(pickNewCategoryColor(COLOR_KEYS.filter((k) => k !== 'slate').map(folder))).toBe('blue');
  });
});

// ---- normalizeData: recognizing a backup ------------------------------------

describe('normalizeData: what counts as a backup', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', '{"expenses":[]}'],
    ['true', true],
    ['an empty array', []],
    ['an array of backups', [{ expenses: [] }]],
    ['a function', () => ({ expenses: [] })],
    ['a Symbol', Symbol('x')],
  ])('refuses %s', (_label, raw) => {
    expect(normalize(raw)).toBeNull();
  });

  it.each([
    ['an empty object', {}],
    ['only unrelated keys', { foo: 1, bar: [] }],
    ['only recurring rules', { recurring: [rawRule()] }],
    ['only goals', { goals: [rawGoal()] }],
    ['expenses that are not an array', { expenses: 'x' }],
    ['expenses as an object', { expenses: {} }],
    ['expenses as a number', { expenses: 3 }],
    ['settings as an array', { settings: [] }],
    ['settings as null', { settings: null }],
    ['settings as a string', { settings: 'dark' }],
    ['categories as a number', { categories: 5 }],
    ['categories as an object', { categories: {} }],
  ])('refuses an object with %s, so the caller can refuse it instead of wiping data', (_label, raw) => {
    expect(normalize(raw)).toBeNull();
  });

  it.each([
    ['only an empty expenses array', { expenses: [] }],
    ['only a settings object', { settings: {} }],
    ['only a categories array', { categories: [] }],
    ['a Date-less minimal backup', { version: 1, expenses: [] }],
  ])('accepts %s and fills in everything else', (_label, raw) => {
    const data = normalized(raw);
    expect(data.version).toBe(1);
    expect(data.expenses).toEqual([]);
    expect(data.recurring).toEqual([]);
    expect(data.goals).toEqual([]);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.settings.currency).toBe('ARS');
  });

  it('ignores the exportedAt, app and version fields and always reports version 1', () => {
    const data = normalized({ app: 'appgastos', exportedAt: '2026-10-02T12:00:00.000Z', version: 99, expenses: [] });
    expect(Object.keys(data).sort()).toEqual(['categories', 'expenses', 'goals', 'recurring', 'settings', 'version']);
    expect(data.version).toBe(1);
  });

  it('only ever returns the known top-level keys', () => {
    const data = normalized({ expenses: [], secret: 'x', __proto__: { polluted: true }, extra: [1, 2, 3] });
    expect(Object.keys(data).sort()).toEqual(['categories', 'expenses', 'goals', 'recurring', 'settings', 'version']);
  });
});

// ---- normalizeData: categories ----------------------------------------------

describe('normalizeData: categories', () => {
  it('keeps a complete category as it is and appends the fallback folder', () => {
    const data = normalized({ categories: [rawCategory()] });
    expect(data.categories).toHaveLength(2);
    expect(data.categories[0]).toStrictEqual({
      id: 'c1', name: 'Gym', emoji: '🏋️', color: 'red', flexible: true, limit: 5000, archived: false, kind: 'ocio',
    });
    expect(data.categories[1]!.id).toBe(FALLBACK_CATEGORY_ID);
  });

  it('does not bring back default folders the backup deliberately lacks', () => {
    const data = normalized({ categories: [rawCategory(), rawCategory({ id: 'c2', name: 'Cine' })] });
    expect(data.categories.map((c) => c.id)).toEqual(['c1', 'c2', 'otros']);
  });

  it.each([
    ['no categories key', { expenses: [] }],
    ['an empty list', { categories: [] }],
    ['only garbage', { categories: [null, 5, 'x', [], {}, { name: 'no id' }, { id: '' }, { id: '   ' }, { id: 7 }] }],
  ])('falls back to the twelve default folders with %s', (_label, raw) => {
    expect(normalized(raw).categories).toStrictEqual(defaultCategories());
  });

  it('keeps the backup\'s own "otros" (renamed, archived...) instead of replacing or duplicating it', () => {
    const data = normalized({ categories: [rawCategory({ id: 'otros', name: 'Varios', archived: true, kind: undefined }), rawCategory()] });
    expect(data.categories.map((c) => c.id)).toEqual(['otros', 'c1']);
    expect(data.categories[0]).toMatchObject({ id: 'otros', name: 'Varios', archived: true });
  });

  it('keeps archived folders and the expenses that point at them', () => {
    const data = normalized({
      categories: [rawCategory({ archived: true })],
      expenses: [rawExpense({ categoryId: 'c1' })],
    });
    expect(data.categories[0]!.archived).toBe(true);
    expect(data.expenses[0]!.categoryId).toBe('c1');
  });

  it('lets the first of two folders with the same id win', () => {
    const data = normalized({ categories: [rawCategory({ name: 'First' }), rawCategory({ name: 'Second', color: 'blue' })] });
    expect(data.categories.filter((c) => c.id === 'c1')).toHaveLength(1);
    expect(data.categories[0]!.name).toBe('First');
  });

  it.each([
    ['trims', '  Gym  ', 'Gym'],
    ['uses a placeholder for nothing', undefined, 'Sin nombre'],
    ['uses a placeholder for ""', '', 'Sin nombre'],
    ['uses a placeholder for blanks', ' \t\n ', 'Sin nombre'],
    ['uses a placeholder for a number', 7, 'Sin nombre'],
    ['uses a placeholder for null', null, 'Sin nombre'],
    ['keeps accents', 'Educación', 'Educación'],
  ])('name: %s', (_label, name, expected) => {
    expect(normalized({ categories: [rawCategory({ name })] }).categories[0]!.name).toBe(expected);
  });

  it('truncates a name to the maximum length', () => {
    const name = normalized({ categories: [rawCategory({ name: 'ñ'.repeat(500) })] }).categories[0]!.name;
    expect(name).toBe('ñ'.repeat(MAX_NAME_LENGTH));
  });

  it.each([
    ['missing', undefined, '📦'],
    ['blank', '   ', '📦'],
    ['not a string', 5, '📦'],
    ['plain text', 'abc', 'abc'],
    ['an emoji', '🐶', '🐶'],
    ['an emoji with a variation selector', '🏋️', '🏋️'],
  ])('emoji: %s', (_label, emoji, expected) => {
    expect(normalized({ categories: [rawCategory({ emoji })] }).categories[0]!.emoji).toBe(expected);
  });

  it('limits the emoji to 8 characters', () => {
    expect(normalized({ categories: [rawCategory({ emoji: 'abcdefghijkl' })] }).categories[0]!.emoji).toBe('abcdefgh');
  });

  it.each([...COLOR_KEYS])('keeps the palette color %s', (color) => {
    expect(normalized({ categories: [rawCategory({ color })] }).categories[0]!.color).toBe(color);
  });

  it.each([['purple'], ['BLUE'], [''], [5], [null], [undefined], ['#ff0000']])('replaces the unknown color %j with slate', (color) => {
    expect(normalized({ categories: [rawCategory({ color })] }).categories[0]!.color).toBe('slate');
  });

  it.each([
    ['true', true, true],
    ['false', false, false],
    ['the string "true"', 'true', false],
    ['1', 1, false],
    ['null', null, false],
    ['missing', undefined, false],
  ])('flexible: %s', (_label, flexible, expected) => {
    expect(normalized({ categories: [rawCategory({ flexible })] }).categories[0]!.flexible).toBe(expected);
  });

  it.each([
    ['true', true, true],
    ['the string "true"', 'true', false],
    ['1', 1, false],
    ['missing', undefined, false],
  ])('archived: %s', (_label, archived, expected) => {
    expect(normalized({ categories: [rawCategory({ archived })] }).categories[0]!.archived).toBe(expected);
  });

  it.each([
    ['a positive integer', 5000, 5000],
    ['a decimal that rounds down', 5000.4, 5000],
    ['a decimal that rounds up', 5000.5, 5001],
    ['zero', 0, null],
    ['negative', -5, null],
    ['NaN', Number.NaN, null],
    ['Infinity', Number.POSITIVE_INFINITY, null],
    ['a numeric string', '5000', null],
    ['null', null, null],
    ['missing', undefined, null],
    ['beyond the safe integers', 2 ** 53, null],
    ['rounding to zero', 0.3, null],
  ])('limit: %s', (_label, limit, expected) => {
    expect(normalized({ categories: [rawCategory({ limit })] }).categories[0]!.limit).toBe(expected);
  });

  it('kind: kept when present (trimmed, at most 30 characters) and absent otherwise', () => {
    const data = normalized({
      categories: [
        rawCategory({ id: 'a', kind: '  ocio  ' }),
        rawCategory({ id: 'b', kind: '' }),
        rawCategory({ id: 'c', kind: 5 }),
        rawCategory({ id: 'd', kind: undefined }),
        rawCategory({ id: 'e', kind: 'k'.repeat(100) }),
      ],
    });
    const byId = new Map(data.categories.map((c) => [c.id, c]));
    expect(byId.get('a')!.kind).toBe('ocio');
    expect(byId.get('e')!.kind).toBe('k'.repeat(30));
    for (const id of ['b', 'c', 'd']) expect('kind' in byId.get(id)!).toBe(false);
  });

  it('skips entries without a usable id', () => {
    const data = normalized({ categories: [rawCategory({ id: undefined }), rawCategory({ id: '' }), rawCategory({ id: '   ' }), rawCategory({ id: 7 }), rawCategory({ id: null }), rawCategory({ id: 'ok' })] });
    expect(data.categories.map((c) => c.id)).toEqual(['ok', 'otros']);
  });

  it('skips entries that are not objects', () => {
    const data = normalized({ categories: [null, 5, 'x', true, [], [rawCategory()], rawCategory({ id: 'ok' })] });
    expect(data.categories.map((c) => c.id)).toEqual(['ok', 'otros']);
  });
});

// ---- normalizeData: expenses ------------------------------------------------

describe('normalizeData: expenses', () => {
  it('keeps a complete expense exactly (and nothing extra)', () => {
    const [expense] = normalized({ expenses: [rawExpense()] }).expenses;
    expect(expense).toStrictEqual({
      id: 'e1', amount: 1500, categoryId: 'super', note: 'x', date: '2026-10-01', createdAt: 1000, updatedAt: 2000,
    });
  });

  it('keeps expenses in their original order', () => {
    const data = normalized({
      expenses: [rawExpense({ id: 'c', date: '2026-10-03' }), rawExpense({ id: 'a', date: '2026-10-01' }), rawExpense({ id: 'b', date: '2026-10-02' })],
    });
    expect(data.expenses.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('drops fields it does not know about', () => {
    const [expense] = normalized({ expenses: [rawExpense({ extra: 1, tags: ['a'], __proto__: { polluted: true } })] }).expenses;
    expect(Object.keys(expense!).sort()).toEqual(['amount', 'categoryId', 'createdAt', 'date', 'id', 'note', 'updatedAt']);
  });

  describe('amount', () => {
    it.each([
      ['an integer', 1500, 1500],
      ['one cent', 1, 1],
      ['a decimal that rounds down', 1500.4, 1500],
      ['a decimal that rounds up', 1500.5, 1501],
      ['the largest safe integer', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ])('keeps %s', (_label, amount, expected) => {
      expect(normalized({ expenses: [rawExpense({ amount })] }).expenses[0]!.amount).toBe(expected);
    });

    it.each([
      ['zero', 0],
      ['negative zero', -0],
      ['negative', -1],
      ['a large negative', -150_000],
      ['a decimal that rounds to zero', 0.4],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['a numeric string', '1500'],
      ['null', null],
      ['undefined', undefined],
      ['true', true],
      ['an array', [1500]],
      ['an object', { value: 1500 }],
      ['2^53 (not a safe integer)', 2 ** 53],
      ['1e21', 1e21],
      ['Number.MAX_VALUE', Number.MAX_VALUE],
    ])('drops the expense when the amount is %s', (_label, amount) => {
      expect(normalized({ expenses: [rawExpense({ amount })] }).expenses).toEqual([]);
    });

    it('drops an expense with no amount at all', () => {
      const { amount: _omitted, ...withoutAmount } = rawExpense();
      expect(normalized({ expenses: [withoutAmount] }).expenses).toEqual([]);
    });
  });

  describe('date', () => {
    it.each(['2026-10-02', '2024-02-29', '2026-12-31', '2000-02-29'])('keeps %s', (date) => {
      expect(normalized({ expenses: [rawExpense({ date })] }).expenses[0]!.date).toBe(date);
    });

    it.each([
      ['Feb 30', '2026-02-30'],
      ['Feb 29 in a common year', '2026-02-29'],
      ['month 13', '2026-13-01'],
      ['unpadded', '2026-1-1'],
      ['a timestamp', '2026-10-02T10:00:00Z'],
      ['a number', 20_261_002],
      ['a Date', new Date(2026, 9, 2)],
      ['empty', ''],
      ['null', null],
      ['missing', undefined],
      ['a trailing newline', '2026-10-02\n'],
    ])('drops the expense when the date is %s', (_label, date) => {
      expect(normalized({ expenses: [rawExpense({ date })] }).expenses).toEqual([]);
    });
  });

  describe('ids', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['blank', '   '],
      ['a number', 5],
      ['null', null],
      ['an object', {}],
    ])('generates one when the id is %s', (_label, id) => {
      const [expense] = normalized({ expenses: [rawExpense({ id })] }).expenses;
      expect(expense!.id).toBe('gen-1');
    });

    it('trims ids and truncates them to 60 characters', () => {
      const data = normalized({ expenses: [rawExpense({ id: '  abc  ' }), rawExpense({ id: 'x'.repeat(61) })] });
      expect(data.expenses[0]!.id).toBe('abc');
      expect(data.expenses[1]!.id).toBe('x'.repeat(60));
    });

    it('gives a duplicate a fresh id instead of dropping the expense', () => {
      const data = normalized({
        expenses: [rawExpense({ id: 'dup', amount: 100 }), rawExpense({ id: 'dup', amount: 200 }), rawExpense({ id: 'dup', amount: 300 })],
      });
      expect(data.expenses.map((e) => e.amount)).toEqual([100, 200, 300]);
      expect(data.expenses[0]!.id).toBe('dup');
      expect(new Set(data.expenses.map((e) => e.id)).size).toBe(3);
    });

    it('treats ids that only differ after trimming as duplicates', () => {
      const data = normalized({ expenses: [rawExpense({ id: 'a' }), rawExpense({ id: ' a ' })] });
      expect(new Set(data.expenses.map((e) => e.id)).size).toBe(2);
    });

    it('still gives every expense a unique id when thousands share one', () => {
      const expenses = Array.from({ length: 3000 }, () => rawExpense({ id: 'same' }));
      const ids = normalized({ expenses }).expenses.map((e) => e.id);
      expect(ids).toHaveLength(3000);
      expect(new Set(ids).size).toBe(3000);
    });

    it('does not touch ids that are already unique', () => {
      const makeId = vi.fn(() => 'never');
      normalized({ expenses: [rawExpense({ id: 'a' }), rawExpense({ id: 'b' })] }, { makeId });
      expect(makeId).not.toHaveBeenCalled();
    });
  });

  describe('category', () => {
    it('keeps a known folder, including an archived one', () => {
      const data = normalized({
        categories: [rawCategory({ id: 'gym' }), rawCategory({ id: 'old', archived: true })],
        expenses: [rawExpense({ categoryId: 'gym' }), rawExpense({ id: 'e2', categoryId: 'old' })],
      });
      expect(data.expenses.map((e) => e.categoryId)).toEqual(['gym', 'old']);
    });

    it.each([
      ['an unknown id', 'nope'],
      ['a different case', 'SUPER'],
      ['empty', ''],
      ['missing', undefined],
      ['a number', 5],
      ['null', null],
      ['an object', {}],
      ['an array', ['super']],
    ])('puts an expense with %s into "otros"', (_label, categoryId) => {
      expect(normalized({ expenses: [rawExpense({ categoryId })] }).expenses[0]!.categoryId).toBe('otros');
    });

    it('resolves against the backup\'s own folders, not the defaults', () => {
      const data = normalized({
        categories: [rawCategory({ id: 'gym' })],
        expenses: [rawExpense({ categoryId: 'super' }), rawExpense({ id: 'e2', categoryId: 'gym' })],
      });
      expect(data.expenses.map((e) => e.categoryId)).toEqual(['otros', 'gym']);
    });

    it('can always point at "otros", even when the backup did not list it', () => {
      const data = normalized({ categories: [rawCategory()], expenses: [rawExpense({ categoryId: 'otros' })] });
      expect(data.expenses[0]!.categoryId).toBe('otros');
      expect(data.categories.map((c) => c.id)).toContain('otros');
    });
  });

  describe('note', () => {
    it.each([
      ['trims', '  almuerzo  ', 'almuerzo'],
      ['keeps accents and emoji', 'café ☕ ñandú', 'café ☕ ñandú'],
      ['is empty when missing', undefined, ''],
      ['is empty when a number', 12, ''],
      ['is empty when null', null, ''],
      ['is empty when an object', { text: 'x' }, ''],
      ['is empty when blank', '   \n\t', ''],
      ['keeps line breaks inside', 'a\nb', 'a\nb'],
    ])('%s', (_label, note, expected) => {
      expect(normalized({ expenses: [rawExpense({ note })] }).expenses[0]!.note).toBe(expected);
    });

    it('cuts an extremely long note down to the maximum', () => {
      const note = normalized({ expenses: [rawExpense({ note: 'ab'.repeat(500_000) })] }).expenses[0]!.note;
      expect(note).toHaveLength(MAX_NOTE_LENGTH);
      expect(note).toBe('ab'.repeat(MAX_NOTE_LENGTH / 2));
    });

    it('keeps a note of exactly the maximum length whole', () => {
      const note = 'n'.repeat(MAX_NOTE_LENGTH);
      expect(normalized({ expenses: [rawExpense({ note })] }).expenses[0]!.note).toBe(note);
    });

    it('trims before cutting, so leading blanks do not eat the budget', () => {
      const note = normalized({ expenses: [rawExpense({ note: `${' '.repeat(500)}${'z'.repeat(MAX_NOTE_LENGTH)}` })] }).expenses[0]!.note;
      expect(note).toBe('z'.repeat(MAX_NOTE_LENGTH));
    });
  });

  describe('timestamps', () => {
    it('keeps finite createdAt and updatedAt as given', () => {
      const [e] = normalized({ expenses: [rawExpense({ createdAt: 5, updatedAt: 10 })] }).expenses;
      expect([e!.createdAt, e!.updatedAt]).toEqual([5, 10]);
    });

    it('uses the clock for a missing or invalid createdAt, and createdAt for a missing updatedAt', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      const bad = [undefined, null, '1000', Number.NaN, Number.POSITIVE_INFINITY, {}];
      const data = normalized({ expenses: bad.map((createdAt, i) => rawExpense({ id: `e${i}`, createdAt, updatedAt: undefined })) });
      for (const e of data.expenses) {
        expect(e.createdAt).toBe(1_800_000_000_000);
        expect(e.updatedAt).toBe(1_800_000_000_000);
      }
    });

    it('falls back to createdAt (not the clock) when only updatedAt is bad', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      for (const updatedAt of [undefined, null, 'x', Number.NaN, Number.NEGATIVE_INFINITY]) {
        const [e] = normalized({ expenses: [rawExpense({ createdAt: 1234, updatedAt })] }).expenses;
        expect(e!.updatedAt).toBe(1234);
      }
    });
  });

  describe('recurringId and demo', () => {
    it('keeps a non-empty recurringId, trimmed and capped at 60 characters, and drops anything else', () => {
      const data = normalized({
        expenses: [
          rawExpense({ id: 'a', recurringId: '  r1  ' }),
          rawExpense({ id: 'b', recurringId: '' }),
          rawExpense({ id: 'c', recurringId: 5 }),
          rawExpense({ id: 'd', recurringId: 'r'.repeat(80) }),
          rawExpense({ id: 'e' }),
        ],
      });
      expect(data.expenses[0]!.recurringId).toBe('r1');
      expect(data.expenses[3]!.recurringId).toBe('r'.repeat(60));
      for (const i of [1, 2, 4]) expect('recurringId' in data.expenses[i]!).toBe(false);
    });

    it('keeps demo only when it is exactly true', () => {
      const data = normalized({
        expenses: [
          rawExpense({ id: 'a', demo: true }),
          rawExpense({ id: 'b', demo: false }),
          rawExpense({ id: 'c', demo: 'true' }),
          rawExpense({ id: 'd', demo: 1 }),
          rawExpense({ id: 'e' }),
        ],
      });
      expect(data.expenses[0]!.demo).toBe(true);
      for (const i of [1, 2, 3, 4]) expect('demo' in data.expenses[i]!).toBe(false);
    });
  });

  it('skips entries that are not objects without disturbing the rest', () => {
    const data = normalized({ expenses: [null, 5, 'x', true, [], [rawExpense()], undefined, rawExpense({ id: 'ok' })] });
    expect(data.expenses.map((e) => e.id)).toEqual(['ok']);
  });
});

// ---- normalizeData: recurring rules -----------------------------------------

describe('normalizeData: recurring rules', () => {
  it('keeps a complete rule exactly', () => {
    const [rule] = normalized({ recurring: [rawRule()], expenses: [] }).recurring;
    expect(rule).toStrictEqual({
      id: 'r1', amount: 5000, categoryId: 'servicios', note: 'Luz', day: 10, startMonth: '2026-05', lastGenerated: '2026-09', active: true,
    });
  });

  it.each([
    ['in range', 15, 15],
    ['the first', 1, 1],
    ['the last', 31, 31],
    ['zero', 0, 1],
    ['negative', -5, 1],
    ['too large', 32, 31],
    ['absurdly large', 45, 31],
    ['fractional', 15.9, 15],
    ['NaN', Number.NaN, 1],
    ['Infinity', Number.POSITIVE_INFINITY, 31],
    ['-Infinity', Number.NEGATIVE_INFINITY, 1],
    ['a numeric string', '15', 1],
    ['null', null, 1],
    ['missing', undefined, 1],
    ['an object', {}, 1],
  ])('day: %s', (_label, day, expected) => {
    expect(normalized({ expenses: [], recurring: [rawRule({ day })] }).recurring[0]!.day).toBe(expected);
  });

  it('repairs a bad startMonth to the month of `today`, and a bad lastGenerated to null', () => {
    const bad = ['2026-13', '2026-00', '2026-1', '2026-10-01', '', 5, null, undefined, 'garbage'];
    const data = normalized(
      { expenses: [], recurring: bad.map((v, i) => rawRule({ id: `r${i}`, startMonth: v, lastGenerated: v })) },
      { today: '2027-03-15' },
    );
    for (const rule of data.recurring) {
      expect(rule.startMonth).toBe('2027-03');
      expect(rule.lastGenerated).toBeNull();
    }
  });

  it('keeps valid month keys', () => {
    const [rule] = normalized({ expenses: [], recurring: [rawRule({ startMonth: '2024-02', lastGenerated: '2024-02' })] }).recurring;
    expect(rule!.startMonth).toBe('2024-02');
    expect(rule!.lastGenerated).toBe('2024-02');
  });

  it('active is on unless it is exactly false', () => {
    const data = normalized({
      expenses: [],
      recurring: [
        rawRule({ id: 'a', active: false }),
        rawRule({ id: 'b', active: true }),
        rawRule({ id: 'c', active: undefined }),
        rawRule({ id: 'd', active: null }),
      ],
    });
    expect(data.recurring.map((r) => r.active)).toEqual([false, true, true, true]);
  });

  it('drops rules with an unusable amount', () => {
    const bad = [0, -5, Number.NaN, '5000', null, undefined, 0.2, 2 ** 60];
    const data = normalized({ expenses: [], recurring: [...bad.map((amount, i) => rawRule({ id: `r${i}`, amount })), rawRule({ id: 'ok' })] });
    expect(data.recurring.map((r) => r.id)).toEqual(['ok']);
  });

  it('gives duplicate or missing ids a fresh one instead of dropping the rule', () => {
    const data = normalized({ expenses: [], recurring: [rawRule({ id: 'dup' }), rawRule({ id: 'dup', amount: 7000 }), rawRule({ id: undefined, amount: 8000 })] });
    expect(data.recurring.map((r) => r.amount)).toEqual([5000, 7000, 8000]);
    expect(data.recurring[0]!.id).toBe('dup');
    expect(new Set(data.recurring.map((r) => r.id)).size).toBe(3);
  });

  it('resolves the folder like an expense does, and cleans the note', () => {
    const data = normalized({
      categories: [rawCategory({ id: 'gym' })],
      recurring: [rawRule({ id: 'a', categoryId: 'gym', note: '  Cuota  ' }), rawRule({ id: 'b', categoryId: 'nope', note: 'n'.repeat(500) })],
    });
    expect(data.recurring[0]).toMatchObject({ categoryId: 'gym', note: 'Cuota' });
    expect(data.recurring[1]!.categoryId).toBe('otros');
    expect(data.recurring[1]!.note).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('skips entries that are not objects', () => {
    const data = normalized({ expenses: [], recurring: [null, 5, 'x', [], rawRule()] });
    expect(data.recurring).toHaveLength(1);
  });

  it('is empty when the key is missing or not an array', () => {
    expect(normalized({ expenses: [] }).recurring).toEqual([]);
    expect(normalized({ expenses: [], recurring: 'x' }).recurring).toEqual([]);
    expect(normalized({ expenses: [], recurring: {} }).recurring).toEqual([]);
  });
});

// ---- normalizeData: settings ------------------------------------------------

describe('normalizeData: settings', () => {
  const settingsOf = (settings: unknown, extra: { language?: string } = {}) => normalized({ settings }, extra).settings;

  it('keeps a complete settings object', () => {
    expect(settingsOf({ currency: 'EUR', locale: 'es-ES', monthlyBudget: 500_000, monthlyIncome: 1_200_000, fxRate: 1050.5, theme: 'dark', haptics: false, onboarded: true })).toStrictEqual({
      currency: 'EUR', locale: 'es-ES', monthlyBudget: 500_000, monthlyIncome: 1_200_000, fxRate: 1050.5, theme: 'dark', haptics: false, onboarded: true,
    });
  });

  it.each([['a string', 'dark'], ['an array', []], ['null', null], ['a number', 5], ['missing', undefined]])(
    'uses the defaults when settings is %s',
    (_label, settings) => {
      expect(normalized({ expenses: [], settings }).settings).toStrictEqual(createInitialData().settings);
    },
  );

  it('takes the fallback currency and locale from the browser language', () => {
    expect(settingsOf({}, { language: 'es-MX' })).toMatchObject({ currency: 'MXN', locale: 'es-MX' });
    expect(settingsOf({ currency: 'nope', locale: 'nope' }, { language: 'es-CL' })).toMatchObject({ currency: 'CLP', locale: 'es-CL' });
    expect(settingsOf({ currency: 'USD', locale: 'es-AR' }, { language: 'es-CL' })).toMatchObject({ currency: 'USD', locale: 'es-AR' });
  });

  describe('currency', () => {
    it.each(['ARS', 'USD', 'EUR', 'JPY', 'GBP'])('keeps %s', (currency) => {
      expect(settingsOf({ currency }).currency).toBe(currency);
    });

    it.each([['lowercase', 'ars'], ['two letters', 'AR'], ['four letters', 'ARSS'], ['empty', ''], ['a number', 840], ['null', null], ['an object', {}], ['padded', ' ARS']])(
      'falls back to the default for %s',
      (_label, currency) => {
        expect(settingsOf({ currency }).currency).toBe('ARS');
      },
    );
  });

  describe('locale', () => {
    it.each(['es-AR', 'es-MX', 'es', 'en-US', 'pt-BR', 'es-419', 'zh-Hans-CN'])('keeps %s', (locale) => {
      expect(settingsOf({ locale }).locale).toBe(locale);
    });

    it.each([
      ['empty', ''],
      ['not a locale', 'garbage'],
      ['an underscore', 'es_AR'],
      ['a dangling hyphen', 'es-'],
      ['one letter', 'e'],
      ['a duplicate region', 'es-AR-AR'],
      ['padded', ' es-AR'],
      ['a trailing newline', 'es-AR\n'],
      ['a number', 123],
      ['null', null],
      ['an object', {}],
    ])('falls back to the default for %s', (_label, locale) => {
      expect(settingsOf({ locale }, { language: 'es-MX' }).locale).toBe('es-MX');
    });
  });

  describe('monthlyBudget and monthlyIncome', () => {
    it.each([
      ['a positive integer', 500_000, 500_000],
      ['a decimal', 500_000.6, 500_001],
      ['zero', 0, null],
      ['negative', -1, null],
      ['NaN', Number.NaN, null],
      ['a string', '500000', null],
      ['null', null, null],
      ['missing', undefined, null],
      ['beyond the safe integers', 2 ** 53, null],
    ])('%s', (_label, value, expected) => {
      const settings = settingsOf({ monthlyBudget: value, monthlyIncome: value });
      expect(settings.monthlyBudget).toBe(expected);
      expect(settings.monthlyIncome).toBe(expected);
    });
  });

  describe('fxRate (units of the app currency per US dollar)', () => {
    it.each([
      ['a typical rate', 1050.5, 1050.5],
      ['a whole rate', 1000, 1000],
      ['a tiny rate', 0.0001, 0.0001],
      ['one', 1, 1],
      ['zero', 0, null],
      ['negative', -1, null],
      ['NaN', Number.NaN, null],
      ['Infinity', Number.POSITIVE_INFINITY, null],
      ['a numeric string', '1050', null],
      ['null', null, null],
      ['missing', undefined, null],
      ['an object', {}, null],
    ])('%s', (_label, fxRate, expected) => {
      expect(settingsOf({ fxRate }).fxRate).toBe(expected);
    });

    it('is not rounded like money is (it is a ratio, not cents)', () => {
      expect(settingsOf({ fxRate: 1050.123456 }).fxRate).toBe(1050.123456);
    });
  });

  it.each([['system', 'system'], ['light', 'light'], ['dark', 'dark'], ['blue', 'system'], ['DARK', 'system'], ['', 'system'], [5, 'system'], [null, 'system'], [undefined, 'system']])(
    'theme %j becomes %s',
    (theme, expected) => {
      expect(settingsOf({ theme }).theme).toBe(expected);
    },
  );

  it.each([[false, false], [true, true], ['no', true], [0, true], [null, true], [undefined, true]])('haptics %j becomes %s (only false turns them off)', (haptics, expected) => {
    expect(settingsOf({ haptics }).haptics).toBe(expected);
  });

  describe('onboarded', () => {
    it.each([[true, true], [false, false], ['yes', false], [1, false], [null, false], [undefined, false]])('%j becomes %s on its own', (onboarded, expected) => {
      expect(settingsOf({ onboarded }).onboarded).toBe(expected);
    });

    it('is true for anyone with at least one valid expense, whatever the flag says', () => {
      expect(normalized({ settings: { onboarded: false }, expenses: [rawExpense()] }).settings.onboarded).toBe(true);
      expect(normalized({ expenses: [rawExpense()] }).settings.onboarded).toBe(true);
    });

    it('is not triggered by expenses that were all dropped', () => {
      expect(normalized({ settings: {}, expenses: [rawExpense({ amount: -1 }), rawExpense({ date: 'x' })] }).settings.onboarded).toBe(false);
    });
  });
});

// ---- normalizeData: goals ---------------------------------------------------

describe('normalizeData: goals', () => {
  const goalsOf = (goals: unknown, extra: { today?: string } = {}) => normalized({ expenses: [], goals }, extra).goals;
  const oneGoal = (overrides: Record<string, unknown> = {}) => goalsOf([rawGoal(overrides)])[0];

  it('keeps a complete saving goal exactly (and nothing extra)', () => {
    expect(goalsOf([rawGoal()])).toStrictEqual([
      { id: 'g1', kind: 'saving', name: 'Vacaciones', emoji: '🏖️', target: 500_000_00, deadline: '2027-01', saved: 100_000_00, createdAt: 10 },
    ]);
  });

  it('is empty when the key is missing or not a list', () => {
    expect(normalized({ expenses: [] }).goals).toEqual([]);
    expect(normalized({ expenses: [], goals: 'x' }).goals).toEqual([]);
    expect(normalized({ expenses: [], goals: {} }).goals).toEqual([]);
    expect(normalized({ expenses: [], goals: null }).goals).toEqual([]);
  });

  it('skips entries that are not objects and keeps the order of the rest', () => {
    const goals = goalsOf([null, 5, 'x', true, [], rawGoal({ id: 'b' }), undefined, rawGoal({ id: 'a' })]);
    expect(goals.map((g) => g.id)).toEqual(['b', 'a']);
  });

  describe('kind', () => {
    it.each(['trip', 'move', 'saving'])('keeps %s', (kind) => {
      expect(oneGoal({ kind })!.kind).toBe(kind);
    });

    it.each([['unknown', 'vacation'], ['wrong case', 'TRIP'], ['empty', ''], ['a number', 3], ['null', null], ['missing', undefined]])(
      'falls back to saving when it is %s',
      (_label, kind) => {
        expect(oneGoal({ kind })!.kind).toBe('saving');
      },
    );
  });

  describe('name and emoji', () => {
    it.each([
      ['trims', '  Europa  ', 'Europa'],
      ['uses a placeholder for nothing', undefined, 'Mi meta'],
      ['uses a placeholder for blanks', '  \t ', 'Mi meta'],
      ['uses a placeholder for a number', 5, 'Mi meta'],
    ])('name: %s', (_label, name, expected) => {
      expect(oneGoal({ name })!.name).toBe(expected);
    });

    it('cuts the name to the maximum length', () => {
      expect(oneGoal({ name: 'n'.repeat(300) })!.name).toBe('n'.repeat(MAX_NAME_LENGTH));
    });

    it.each([
      ['an emoji', '🌴', '🌴'],
      ['missing', undefined, '🎯'],
      ['blank', '   ', '🎯'],
      ['a number', 7, '🎯'],
    ])('emoji: %s', (_label, emoji, expected) => {
      expect(oneGoal({ emoji })!.emoji).toBe(expected);
    });

    it('limits the emoji to 8 characters', () => {
      expect(oneGoal({ emoji: 'abcdefghijkl' })!.emoji).toBe('abcdefgh');
    });
  });

  describe('target', () => {
    it.each([
      ['a positive integer', 500_000_00, 500_000_00],
      ['one cent', 1, 1],
      ['a decimal that rounds down', 1000.4, 1000],
      ['a decimal that rounds up', 1000.5, 1001],
      ['the largest safe integer', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ])('keeps %s', (_label, target, expected) => {
      expect(oneGoal({ target })!.target).toBe(expected);
    });

    it.each([
      ['zero', 0], ['negative', -1], ['rounding to zero', 0.3], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY],
      ['a numeric string', '500000'], ['null', null], ['missing', undefined], ['beyond the safe integers', 2 ** 53],
    ])('drops the goal when the target is %s', (_label, target) => {
      expect(goalsOf([rawGoal({ target })])).toEqual([]);
    });
  });

  describe('deadline', () => {
    it.each(['2027-01', '2026-10', '2030-12', '2024-02'])('keeps %s', (deadline) => {
      expect(oneGoal({ deadline })!.deadline).toBe(deadline);
    });

    it.each([
      ['month 13', '2027-13'], ['month 00', '2027-00'], ['unpadded', '2027-1'], ['a full date', '2027-01-15'], ['empty', ''],
      ['a number', 202_701], ['null', null], ['missing', undefined], ['text', 'next year'],
    ])('drops the goal when the deadline is %s', (_label, deadline) => {
      expect(goalsOf([rawGoal({ deadline })])).toEqual([]);
    });
  });

  describe('saved', () => {
    it.each([
      ['a positive integer', 100_000_00, 100_000_00],
      ['more than the target (allowed)', 900_000_00, 900_000_00],
      ['a decimal that rounds down', 1000.4, 1000],
      ['a decimal that rounds up', 1000.5, 1001],
      ['zero', 0, 0],
      ['negative', -5, 0],
      ['rounding to zero', 0.4, 0],
      ['NaN', Number.NaN, 0],
      ['Infinity', Number.POSITIVE_INFINITY, 0],
      ['a numeric string', '5000', 0],
      ['null', null, 0],
      ['missing', undefined, 0],
      ['beyond the safe integers', 2 ** 53, 0],
    ])('%s', (_label, saved, expected) => {
      expect(oneGoal({ saved })!.saved).toBe(expected);
    });
  });

  describe('id and createdAt', () => {
    it.each([['missing', undefined], ['empty', ''], ['blank', '  '], ['a number', 5], ['null', null]])('generates an id when it is %s', (_label, id) => {
      expect(oneGoal({ id })!.id).toBe('gen-1');
    });

    it('trims ids and cuts them at 60 characters', () => {
      const goals = goalsOf([rawGoal({ id: '  g  ' }), rawGoal({ id: 'x'.repeat(80) })]);
      expect(goals.map((g) => g.id)).toEqual(['g', 'x'.repeat(60)]);
    });

    it('gives a repeated id a fresh one instead of dropping the goal', () => {
      const goals = goalsOf([rawGoal({ id: 'dup', name: 'A' }), rawGoal({ id: 'dup', name: 'B' }), rawGoal({ id: ' dup ', name: 'C' })]);
      expect(goals.map((g) => g.name)).toEqual(['A', 'B', 'C']);
      expect(goals[0]!.id).toBe('dup');
      expect(new Set(goals.map((g) => g.id)).size).toBe(3);
    });

    it('keeps goal ids apart from expense ids (separate namespaces)', () => {
      const data = normalized({ expenses: [rawExpense({ id: 'same' })], goals: [rawGoal({ id: 'same' })] });
      expect(data.expenses[0]!.id).toBe('same');
      expect(data.goals[0]!.id).toBe('same');
    });

    it('keeps a finite createdAt and replaces anything else with the clock', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      expect(oneGoal({ createdAt: 42 })!.createdAt).toBe(42);
      for (const createdAt of [undefined, null, '42', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
        expect(oneGoal({ createdAt })!.createdAt).toBe(1_800_000_000_000);
      }
    });
  });

  describe('trip plans', () => {
    const tripOf = (trip: unknown, kind = 'trip') => oneGoal({ kind, trip })!.trip;

    it('keeps a complete plan exactly', () => {
      expect(tripOf(rawTrip())).toStrictEqual({
        stops: [{ place: 'Madrid', days: 5 }, { place: 'Roma', days: 4 }], people: 2, style: 'mid', fx: 1050.5, flightEach: 900_000_00, extras: 50_000_00,
      });
    });

    it('only belongs to trip goals: it is dropped from any other kind', () => {
      expect(oneGoal({ kind: 'saving', trip: rawTrip() })).not.toHaveProperty('trip');
      expect(oneGoal({ kind: 'move', trip: rawTrip() })).not.toHaveProperty('trip');
      expect(oneGoal({ kind: 'bogus', trip: rawTrip() })).not.toHaveProperty('trip');
    });

    it('is simply absent when a trip goal has no (usable) plan', () => {
      for (const trip of [undefined, null, 'x', 5, [], true]) expect(oneGoal({ kind: 'trip', trip })).not.toHaveProperty('trip');
    });

    it('turns an empty plan object into the defaults', () => {
      expect(tripOf({})).toStrictEqual({ stops: [], people: 1, style: 'mid' });
    });

    describe('stops', () => {
      it('ignores a stops value that is not a list, and entries that are not objects', () => {
        expect(tripOf(rawTrip({ stops: 'Madrid' }))!.stops).toEqual([]);
        expect(tripOf(rawTrip({ stops: { place: 'Madrid', days: 3 } }))!.stops).toEqual([]);
        expect(tripOf(rawTrip({ stops: [null, 5, 'x', [], { place: 'Roma', days: 2 }] }))!.stops).toEqual([{ place: 'Roma', days: 2 }]);
      });

      it('keeps at most 20 stops, the first ones', () => {
        const stops = Array.from({ length: 25 }, (_, i) => ({ place: `P${i}`, days: 1 }));
        const kept = tripOf(rawTrip({ stops }))!.stops;
        expect(kept).toHaveLength(20);
        expect(kept[0]!.place).toBe('P0');
        expect(kept[19]!.place).toBe('P19');
      });

      it('trims the place, cuts it at 60 characters and uses "" for a non-string', () => {
        const stops = tripOf(rawTrip({ stops: [{ place: '  Kioto  ', days: 1 }, { place: 'p'.repeat(100), days: 1 }, { place: 5, days: 1 }, { days: 1 }] }))!.stops;
        expect(stops.map((s) => s.place)).toEqual(['Kioto', 'p'.repeat(60), '', '']);
      });

      it.each([
        ['in range', 5, 5],
        ['zero', 0, 0],
        ['the maximum', 365, 365],
        ['above the maximum', 1000, 365],
        ['negative', -5, 0],
        ['rounded to nearest', 2.4, 2],
        ['rounded up at .5', 2.5, 3],
        ['a tiny negative', -0.4, 0],
        ['NaN', Number.NaN, 0],
        ['Infinity', Number.POSITIVE_INFINITY, 0],
        ['a numeric string', '5', 0],
        ['null', null, 0],
        ['missing', undefined, 0],
      ])('days: %s', (_label, days, expected) => {
        const [stop] = tripOf(rawTrip({ stops: [{ place: 'X', days }] }))!.stops;
        expect(Object.is(stop!.days, expected)).toBe(true);
      });
    });

    describe('people', () => {
      it.each([
        ['one', 1, 1], ['in range', 4, 4], ['the maximum', 20, 20], ['above the maximum', 99, 20], ['zero', 0, 1], ['negative', -3, 1],
        ['rounded', 2.6, 3], ['NaN', Number.NaN, 1], ['Infinity', Number.POSITIVE_INFINITY, 1], ['a string', '4', 1], ['null', null, 1], ['missing', undefined, 1],
      ])('%s', (_label, people, expected) => {
        expect(tripOf(rawTrip({ people }))!.people).toBe(expected);
      });
    });

    describe('style', () => {
      it.each(['budget', 'mid', 'comfort'])('keeps %s', (style) => {
        expect(tripOf(rawTrip({ style }))!.style).toBe(style);
      });

      it.each([['luxury'], ['MID'], [''], [5], [null], [undefined]])('falls back to mid for %j', (style) => {
        expect(tripOf(rawTrip({ style }))!.style).toBe('mid');
      });
    });

    describe('optional numbers', () => {
      it.each([
        ['a rate', 1050.5, 1050.5], ['a tiny rate', 0.001, 0.001], ['zero', 0, undefined], ['negative', -1, undefined],
        ['NaN', Number.NaN, undefined], ['Infinity', Number.POSITIVE_INFINITY, undefined], ['a string', '1050', undefined], ['null', null, undefined],
      ])('fx: %s', (_label, fx, expected) => {
        const trip = tripOf(rawTrip({ fx }))!;
        if (expected === undefined) expect(trip).not.toHaveProperty('fx');
        else expect(trip.fx).toBe(expected);
      });

      it.each(['flightEach', 'extras'] as const)('%s keeps a positive amount, rounded, and is otherwise left out', (field) => {
        expect(tripOf(rawTrip({ [field]: 90_000_00 }))![field]).toBe(90_000_00);
        expect(tripOf(rawTrip({ [field]: 90_000.6 }))![field]).toBe(90_001);
        for (const bad of [0, -5, 0.4, Number.NaN, Number.POSITIVE_INFINITY, '5', null, 2 ** 53]) {
          expect(tripOf(rawTrip({ [field]: bad }))).not.toHaveProperty(field);
        }
      });
    });

    it('drops fields it does not know', () => {
      expect(Object.keys(tripOf(rawTrip({ secret: 1, hotel: 'x' }))!).sort()).toEqual(['extras', 'flightEach', 'fx', 'people', 'stops', 'style']);
    });
  });

  describe('move plans', () => {
    const moveOf = (move: unknown, kind = 'move') => oneGoal({ kind, move })!.move;

    it('keeps a complete plan exactly', () => {
      expect(moveOf(rawMove())).toStrictEqual({
        zone: 'Palermo', rent: 600_000_00, monthlyExtras: 80_000_00, depositMonths: 1, commissionMonths: 1, advanceMonths: 1, setup: 300_000_00, currentMonthly: 500_000_00,
      });
    });

    it('only belongs to move goals: it is dropped from any other kind', () => {
      expect(oneGoal({ kind: 'saving', move: rawMove() })).not.toHaveProperty('move');
      expect(oneGoal({ kind: 'trip', move: rawMove() })).not.toHaveProperty('move');
    });

    it('is simply absent when a move goal has no (usable) plan', () => {
      for (const move of [undefined, null, 'x', 5, [], true]) expect(oneGoal({ kind: 'move', move })).not.toHaveProperty('move');
    });

    it('fills a plan with defaults: no money, and one month each of deposit, commission and advance', () => {
      expect(moveOf({})).toStrictEqual({
        zone: '', rent: 0, monthlyExtras: 0, depositMonths: 1, commissionMonths: 1, advanceMonths: 1, setup: 0, currentMonthly: 0,
      });
    });

    it('zone: trimmed, cut at 60 characters, "" when not a string', () => {
      expect(moveOf(rawMove({ zone: '  Belgrano  ' }))!.zone).toBe('Belgrano');
      expect(moveOf(rawMove({ zone: 'z'.repeat(100) }))!.zone).toBe('z'.repeat(60));
      expect(moveOf(rawMove({ zone: 7 }))!.zone).toBe('');
    });

    it.each(['rent', 'monthlyExtras', 'setup', 'currentMonthly'] as const)('%s: positive amounts kept and rounded, anything else becomes 0', (field) => {
      expect(moveOf(rawMove({ [field]: 123_456 }))![field]).toBe(123_456);
      expect(moveOf(rawMove({ [field]: 1000.6 }))![field]).toBe(1001);
      for (const bad of [0, -5, 0.4, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, 2 ** 53]) {
        expect(moveOf(rawMove({ [field]: bad }))![field]).toBe(0);
      }
    });

    it.each(['depositMonths', 'commissionMonths', 'advanceMonths'] as const)('%s: 0 to 12 months, rounded, default 1', (field) => {
      const check = (value: unknown, expected: number) => expect(moveOf(rawMove({ [field]: value }))![field]).toBe(expected);
      check(0, 0);
      check(3, 3);
      check(12, 12);
      check(13, 12);
      check(50, 12);
      check(-1, 0);
      check(2.6, 3);
      check(Number.NaN, 1);
      check(Number.POSITIVE_INFINITY, 1);
      check('3', 1);
      check(null, 1);
      check(undefined, 1);
    });

    it('drops fields it does not know', () => {
      expect(Object.keys(moveOf(rawMove({ pets: true }))!).sort()).toEqual(
        ['advanceMonths', 'commissionMonths', 'currentMonthly', 'depositMonths', 'monthlyExtras', 'rent', 'setup', 'zone'],
      );
    });
  });

  it('never mutates its input and shares no plan objects with it', () => {
    const input = deepFreeze(JSON.parse(JSON.stringify({ expenses: [], goals: [rawGoal({ kind: 'trip', trip: rawTrip() }), rawGoal({ id: 'm', kind: 'move', move: rawMove() })] })) as unknown);
    const inputObjects = collectObjects(input);
    const result = normalized(input);
    expect([...collectObjects(result.goals)].filter((o) => inputObjects.has(o))).toEqual([]);
  });

  it('is idempotent and JSON-safe, plans included', () => {
    const once = normalized({
      expenses: [],
      goals: [
        rawGoal({ kind: 'trip', trip: rawTrip({ people: 99, style: 'x', stops: [{ place: ' a ', days: 4.6 }, null], fx: -1, extras: 0 }) }),
        rawGoal({ id: 'm', kind: 'move', move: rawMove({ depositMonths: 50, rent: -3 }) }),
        rawGoal({ id: 's', saved: -4, name: '' }),
      ],
    });
    expect(normalized(JSON.parse(JSON.stringify(once)))).toStrictEqual(once);
    expect(JSON.parse(JSON.stringify(once))).toStrictEqual(once);
  });
});

// ---- normalizeData: robustness ----------------------------------------------

describe('normalizeData: robustness', () => {
  const MESSY = {
    app: 'appgastos',
    version: 7,
    categories: [rawCategory(), rawCategory({ id: 'c2', name: '   ', color: 'weird', limit: -3, emoji: 99 }), null, { id: 'c1', name: 'dup' }],
    expenses: [
      rawExpense(),
      rawExpense({ id: 'e1', amount: 20.6, categoryId: 'ghost', note: '   padded   ', createdAt: 'x' }),
      rawExpense({ id: undefined, amount: 0 }),
      rawExpense({ id: 'e3', date: '2026-02-30' }),
      rawExpense({ id: 'e4', demo: true, recurringId: 'r1', categoryId: 'c2' }),
      'junk',
    ],
    recurring: [rawRule({ day: 99, startMonth: 'x' }), rawRule({ id: 'r1', amount: -5 })],
    goals: [
      rawGoal(),
      rawGoal({ id: 'g1', name: 'dup', kind: 'trip', trip: rawTrip({ people: 99, style: 'luxury', stops: [{ place: '  Roma  ', days: 4.6 }, 'junk', null], fx: -1, flightEach: 'x', extras: 0 }) }),
      rawGoal({ id: 'g3', kind: 'move', move: rawMove({ depositMonths: 50, rent: -1, zone: 7 }) }),
      rawGoal({ id: 'g4', target: 0 }),
      rawGoal({ id: 'g5', deadline: '2027-13' }),
      'junk',
    ],
    settings: { currency: 'xx', locale: 'zz zz', theme: 'neon', monthlyBudget: '1000', fxRate: -2 },
  };

  it('is idempotent: normalizing its own output changes nothing', () => {
    const once = normalized(MESSY);
    expect(normalized(JSON.parse(JSON.stringify(once)))).toStrictEqual(once);
    expect(normalized(once)).toStrictEqual(once);
  });

  it('produces plain JSON-safe data (no undefined, NaN or class instances)', () => {
    const once = normalized(MESSY);
    expect(JSON.parse(JSON.stringify(once))).toStrictEqual(once);
  });

  it('never mutates its input (which may be frozen)', () => {
    const input = deepFreeze(JSON.parse(JSON.stringify(MESSY)) as unknown);
    expect(() => normalized(input)).not.toThrow();
    expect(input).toStrictEqual(JSON.parse(JSON.stringify(MESSY)));
  });

  it('returns data that shares no objects with its input', () => {
    const input = JSON.parse(JSON.stringify(MESSY)) as unknown;
    const inputObjects = collectObjects(input);
    const shared = [...collectObjects(normalized(input))].filter((o) => inputObjects.has(o));
    expect(shared).toEqual([]);
  });

  it('returns data that does not share state with the defaults', () => {
    const first = normalized({ expenses: [] });
    first.categories[0]!.name = 'tampered';
    first.categories.length = 0;
    expect(normalized({ expenses: [] }).categories).toStrictEqual(defaultCategories());
  });

  it('survives hostile ids, property names and prototype pollution attempts', () => {
    const hostile = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];
    const data = normalized(
      JSON.parse(
        JSON.stringify({
          categories: hostile.map((id) => ({ id, name: id })),
          expenses: hostile.map((id, i) => ({ id, amount: 100 + i, date: '2026-10-02', categoryId: id })),
        }),
      ),
    );
    expect(data.categories.map((c) => c.id)).toEqual([...hostile, 'otros']);
    expect(data.expenses.map((e) => [e.id, e.categoryId])).toEqual(hostile.map((id) => [id, id]));

    const parsed = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"expenses":[{"__proto__":{"polluted":true},"id":"a","amount":100,"date":"2026-10-02"}]}') as unknown;
    const result = normalized(parsed);
    expect(result.expenses).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.expenses[0]!)).toBe(Object.prototype);
  });

  // Heavy on purpose (a million characters three times, twenty thousand long notes), so it gets room
  // to finish on a slow, busy machine; the cut itself is checked for speed in the next test.
  it('copes with extreme sizes', { timeout: 30_000 }, () => {
    const data = normalized({
      categories: [rawCategory({ name: 'n'.repeat(1_000_000), emoji: 'e'.repeat(1_000_000), kind: 'k'.repeat(1_000_000) })],
      expenses: Array.from({ length: 20_000 }, (_, i) => rawExpense({ id: `e${i}`, note: 'x'.repeat(200) })),
    });
    expect(data.expenses).toHaveLength(20_000);
    expect(data.categories[0]!.name).toHaveLength(MAX_NAME_LENGTH);
    expect(data.expenses[19_999]!.note).toHaveLength(Math.min(200, MAX_NOTE_LENGTH));
  });

  describe('cutting a long text', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;

    it('never cuts in the middle of an emoji', () => {
      const name = normalized({ categories: [rawCategory({ name: family.repeat(MAX_NAME_LENGTH + 20) })], expenses: [] }).categories[0]!.name;
      expect(name).toBe(family.repeat(MAX_NAME_LENGTH));
      expect(graphemes(name)).toBe(MAX_NAME_LENGTH);
    });

    // A corrupt or hostile backup can hold a text of any length. Reading all of it before cutting it
    // took seconds at a million characters; reading only what is kept takes the same as for a short one.
    it('reads only as much of the text as it keeps', () => {
      const original = Intl.Segmenter.prototype.segment;
      let read = 0;
      Intl.Segmenter.prototype.segment = function (this: Intl.Segmenter, input: string) {
        const inner = original.call(this, input);
        return {
          [Symbol.iterator]() {
            const it = inner[Symbol.iterator]();
            return {
              next() {
                const step = it.next();
                if (!step.done) read++;
                return step;
              },
            };
          },
        } as unknown as Intl.Segments;
      };
      try {
        expect(cleanText('x'.repeat(100_000), 30)).toBe('x'.repeat(30));
        expect(read).toBeLessThanOrEqual(31);
        read = 0;
        expect(cleanText(family.repeat(50_000), 30)).toBe(family.repeat(30));
        expect(read).toBeLessThanOrEqual(31);
      } finally {
        Intl.Segmenter.prototype.segment = original;
      }
    });
  });

  it('uses the injected `today` for repairs and the clock only for missing timestamps', () => {
    const data = normalized({ expenses: [], recurring: [rawRule({ startMonth: undefined })] }, { today: '2031-07-04' });
    expect(data.recurring[0]!.startMonth).toBe('2031-07');
  });

  it('repairs a thoroughly broken backup into something usable', () => {
    const data = normalized(MESSY);
    expect(data.version).toBe(1);

    // c1 is kept, the second c1 is a duplicate, c2 is repaired field by field, "otros" is added last.
    expect(data.categories.map((c) => c.id)).toEqual(['c1', 'c2', 'otros']);
    expect(data.categories[1]).toStrictEqual({
      id: 'c2', name: 'Sin nombre', emoji: '📦', color: 'slate', flexible: true, limit: null, archived: false, kind: 'ocio',
    });

    // Kept: e1, the duplicate e1 (new id, amount rounded, unknown folder -> otros, note trimmed) and e4.
    // Dropped: the zero amount, the Feb 30 date and the string.
    expect(data.expenses.map((e) => [e.id, e.amount, e.categoryId, e.note])).toEqual([
      ['e1', 1500, 'otros', 'x'],
      ['gen-1', 21, 'otros', 'padded'],
      ['e4', 1500, 'c2', 'x'],
    ]);
    expect(data.expenses[2]).toMatchObject({ demo: true, recurringId: 'r1' });

    // The rule with a bad day and month is repaired; the second r1 (negative amount) is dropped.
    expect(data.recurring).toStrictEqual([
      { id: 'r1', amount: 5000, categoryId: 'otros', note: 'Luz', day: 31, startMonth: '2026-10', lastGenerated: '2026-09', active: true },
    ]);

    // Goals: the first is kept, the repeated id gets a new one (after the expense repair used gen-1),
    // plan values are bounded, and the zero target and the bad deadline are dropped.
    expect(data.goals.map((g) => [g.id, g.kind, g.name])).toEqual([
      ['g1', 'saving', 'Vacaciones'],
      ['gen-2', 'trip', 'dup'],
      ['g3', 'move', 'Vacaciones'],
    ]);
    expect(data.goals[1]!.trip).toStrictEqual({ stops: [{ place: 'Roma', days: 5 }], people: 20, style: 'mid' });
    expect(data.goals[2]!.move).toStrictEqual({
      zone: '', rent: 0, monthlyExtras: 80_000_00, depositMonths: 12, commissionMonths: 1, advanceMonths: 1, setup: 300_000_00, currentMonthly: 500_000_00,
    });

    expect(data.settings).toStrictEqual({
      currency: 'ARS', locale: 'es-AR', monthlyBudget: null, monthlyIncome: null, fxRate: null, theme: 'system', haptics: true, onboarded: true,
    });
  });
});

// ---- makeIdGenerator --------------------------------------------------------

describe('makeIdGenerator', () => {
  it('returns a function that yields distinct, non-empty ids', () => {
    const makeId = makeIdGenerator();
    const ids = Array.from({ length: 2000 }, () => makeId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('uses random UUIDs when the platform has them', () => {
    const id = makeIdGenerator()();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('keeps separate generators independent', () => {
    expect(makeIdGenerator()()).not.toBe(makeIdGenerator()());
  });

  it.each([
    ['there is no crypto at all', undefined],
    ['crypto lacks randomUUID (insecure context)', {}],
    ['randomUUID is not a function', { randomUUID: 'nope' }],
  ])('falls back to a time-and-random id when %s', (_label, stub) => {
    vi.stubGlobal('crypto', stub);
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(5));
    const makeId = makeIdGenerator();
    const ids = Array.from({ length: 3000 }, () => makeId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
      expect(id.length).toBeLessThanOrEqual(60);
    }
  });

  it('produces ids that survive normalizeData untouched (no truncation or trimming)', () => {
    const makeId = makeIdGenerator();
    const ids = Array.from({ length: 50 }, () => makeId());
    const data = normalized({ expenses: ids.map((id) => rawExpense({ id })) });
    expect(data.expenses.map((e) => e.id)).toEqual(ids);
  });
});

describe('limits', () => {
  it('exports sensible maximum lengths', () => {
    expect(Number.isInteger(MAX_NOTE_LENGTH) && MAX_NOTE_LENGTH > 0).toBe(true);
    expect(Number.isInteger(MAX_NAME_LENGTH) && MAX_NAME_LENGTH > 0).toBe(true);
  });
});

// ---- regressions: bugs found in review, since fixed --------------------------

describe('regressions', () => {
  // A repaired id used to be able to collide with an explicit id elsewhere in the same backup.
  // Harmless with UUIDs, wrong with any sequential generator.
  it('a generated id never collides with an explicit id elsewhere in the same backup', () => {
    const data = normalized({
      expenses: [rawExpense({ id: 'gen-1' }), rawExpense({ id: undefined, amount: 200 })],
    });
    expect(new Set(data.expenses.map((e) => e.id)).size).toBe(2);

    const rules = normalized({ expenses: [], recurring: [rawRule({ id: 'gen-1' }), rawRule({ id: undefined, amount: 200 })] });
    expect(new Set(rules.recurring.map((r) => r.id)).size).toBe(2);

    const goals = normalized({ expenses: [], goals: [rawGoal({ id: 'gen-1' }), rawGoal({ id: undefined, name: 'Otra' })] });
    expect(new Set(goals.goals.map((g) => g.id)).size).toBe(2);
  });

  // Folder ids are trimmed and cut to 60 characters, so the reference an expense holds must be treated
  // the same way, or the two stop matching and the expense silently loses its folder.
  it('an expense still finds its folder when the folder id had to be trimmed or shortened', () => {
    const padded = normalized({
      categories: [rawCategory({ id: ' gym ' })],
      expenses: [rawExpense({ categoryId: ' gym ' })],
    });
    expect(padded.categories[0]!.id).toBe('gym');
    expect(padded.expenses[0]!.categoryId).toBe('gym');

    const long = 'g'.repeat(70);
    const cut = normalized({
      categories: [rawCategory({ id: long })],
      expenses: [rawExpense({ categoryId: long })],
    });
    expect(cut.expenses[0]!.categoryId).toBe(cut.categories[0]!.id);
  });

  // Cutting by UTF-16 units used to split an emoji in half and leave a lone surrogate (rendered as a
  // replacement character, and turned into U+FFFD by any UTF-8 export).
  describe('truncation never splits an emoji', () => {
    const lonely = (build: () => string) => () => expect(hasLoneSurrogate(build())).toBe(false);

    it('expense note', lonely(() => normalized({ expenses: [rawExpense({ note: `a${'😀'.repeat(60)}` })] }).expenses[0]!.note));
    it('recurring note', lonely(() => normalized({ expenses: [], recurring: [rawRule({ note: `a${'😀'.repeat(60)}` })] }).recurring[0]!.note));
    it('folder name', lonely(() => normalized({ categories: [rawCategory({ name: `a${'😀'.repeat(20)}` })] }).categories[0]!.name));
    it('folder emoji', lonely(() => normalized({ categories: [rawCategory({ emoji: 'a😀😀😀😀' })] }).categories[0]!.emoji));
    it('goal name', lonely(() => normalized({ expenses: [], goals: [rawGoal({ name: `a${'😀'.repeat(20)}` })] }).goals[0]!.name));
    it('goal emoji', lonely(() => normalized({ expenses: [], goals: [rawGoal({ emoji: 'a😀😀😀😀' })] }).goals[0]!.emoji));
    it('trip stop place', lonely(() => normalized({ expenses: [], goals: [rawGoal({ kind: 'trip', trip: rawTrip({ stops: [{ place: `a${'😀'.repeat(40)}`, days: 1 }] }) })] }).goals[0]!.trip!.stops[0]!.place));
    it('move zone', lonely(() => normalized({ expenses: [], goals: [rawGoal({ kind: 'move', move: rawMove({ zone: `a${'😀'.repeat(40)}` }) })] }).goals[0]!.move!.zone));
  });

  // Trimming before cutting used to leave trailing whitespace after a cut inside a run of blanks, so
  // normalizeData was not idempotent for such input.
  it('a truncated note does not end in whitespace, so normalizing twice is the same as once', () => {
    const raw = { expenses: [rawExpense({ note: `${'a'.repeat(MAX_NOTE_LENGTH - 1)}   b` })] };
    const once = normalized(raw);
    expect(once.expenses[0]!.note).toBe(once.expenses[0]!.note.trim());
    expect(normalized(JSON.parse(JSON.stringify(once)))).toStrictEqual(once);
  });
});
