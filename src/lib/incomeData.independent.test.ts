// Independent tests for how incomes and fixed incomes are repaired on load (normalizeData), backed up and merged,
// exported to CSV, and sampled (generateDemoIncomes), with hostile input throughout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_APP_ID, mergeData, movementsToCsv, parseBackup, serializeBackup } from './backup';
import { MAX_NOTE_LENGTH, cleanText, createInitialData, normalizeData } from './data';
import { addDays, addMonths, daysInMonth, isValidDateStr, monthKeyOf } from './dates';
import { generateDemoIncomes } from './demo';
import { expectedIncome } from './income';
import { INCOME_SOURCE_IDS, incomeSource, isIncomeSourceId } from './incomeSources';
import { getMoneyFormatter, parseAmountText } from './money';
import { firstMonthFor } from './recurring';
import { createStore, type StorageLike } from './store';
import type { AppData, Category, Expense, Income, IncomeRule } from './types';

const TODAY = '2026-10-02';

// ---- helpers ----------------------------------------------------------------

const counter = (prefix = 'gen'): (() => string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const noRepairsExpected = (): string => {
  throw new Error('makeId should not be needed for data that is already valid');
};
type Extra = { today?: string; makeId?: () => string };
const normalize = (raw: unknown, extra: Extra = {}): AppData | null => normalizeData(raw, { makeId: counter(), today: TODAY, ...extra });
const normalized = (raw: unknown, extra: Extra = {}): AppData => {
  const result = normalize(raw, extra);
  if (!result) throw new Error('expected the input to be recognized as a backup');
  return result;
};

const rawIncome = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'i1', amount: 1500, sourceId: 'freelance', note: 'x', date: '2026-10-01', createdAt: 1000, updatedAt: 2000, ...o });
const rawRule = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1', amount: 5000, sourceId: 'sueldo', note: 'Sueldo', day: 5, startMonth: '2026-05', lastGenerated: '2026-09', active: true, ...o,
});
const income = (o: Partial<Income> = {}): Income => ({ id: 'i1', amount: 1500, sourceId: 'freelance', note: '', date: '2026-10-01', createdAt: 1000, updatedAt: 1000, ...o });
const rule = (o: Partial<IncomeRule> = {}): IncomeRule => ({ id: 'r1', amount: 5000, sourceId: 'sueldo', note: 'Sueldo', day: 5, startMonth: '2026-05', lastGenerated: '2026-09', active: true, ...o });
const expense = (o: Partial<Expense> = {}): Expense => ({ id: 'e1', amount: 1500, categoryId: 'super', note: '', date: '2026-10-01', createdAt: 1000, updatedAt: 1000, ...o });
const category = (o: Partial<Category> = {}): Category => ({ id: 'c1', name: 'Gimnasio', emoji: '🏋️', color: 'red', flexible: true, limit: null, archived: false, ...o });
const appData = (o: Partial<AppData> = {}): AppData => ({ ...createInitialData('es-AR'), ...o });

/** A dataset that exercises every field of incomes and fixed incomes. */
function richData(): AppData {
  return appData({
    expenses: [expense({ id: 'a', amount: 1_250_050, note: 'Súper', createdAt: 5 })],
    incomes: [
      income({ id: 'a', amount: 1_200_000_00, sourceId: 'sueldo', note: 'Sueldo', date: '2026-10-05', ruleId: 'r1', createdAt: 5, updatedAt: 9 }),
      income({ id: 'b', amount: 1, sourceId: 'otros', date: '2024-02-29', demo: true, createdAt: 1, updatedAt: 1 }),
      income({ id: 'c', amount: 85_000_00, sourceId: 'freelance', note: 'Logo ☕ "grande"; ok', date: '2026-09-10', createdAt: 3, updatedAt: 3 }),
    ],
    incomeRules: [rule(), rule({ id: 'r2', active: false, lastGenerated: null, day: 31, amount: 99, sourceId: 'venta' })],
    settings: { currency: 'EUR', locale: 'es-ES', monthlyBudget: 500_000_00, monthlyIncome: 1_200_000_00, fxRate: 1050.5, theme: 'dark', haptics: false, onboarded: true },
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
function collectObjects(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value);
    for (const inner of Object.values(value)) collectObjects(inner, into);
  }
  return into;
}
const hasLoneSurrogate = (s: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const graphemes = (s: string): number => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

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

/** Both kinds of record share most of their repairs: run the same tests on each. */
const KINDS = [
  { key: 'incomes', raw: rawIncome, label: 'income' },
  { key: 'incomeRules', raw: rawRule, label: 'fixed income' },
] as const;
type Kind = (typeof KINDS)[number];
const listOf = (kind: Kind, items: unknown, extra: Extra = {}): Array<Income & IncomeRule> => (normalized({ expenses: [], [kind.key]: items }, extra)[kind.key] as unknown as Array<Income & IncomeRule>);

// ---- normalizeData: shared repairs ---------------------------------------------------

describe.each(KINDS)('normalizeData: $label records', (kind) => {
  const one = (o: Record<string, unknown>) => listOf(kind, [kind.raw(o)])[0];
  const many = (items: unknown[], extra: Extra = {}) => listOf(kind, items, extra);

  it('is an empty list when the key is missing or is not a list', () => {
    expect(normalized({ expenses: [] })[kind.key]).toEqual([]);
    for (const value of ['lots', 5, true, null, {}, { 0: kind.raw() }, undefined]) expect(many(value as unknown as unknown[])).toEqual([]);
  });

  it('keeps the original order and drops fields it does not know', () => {
    const list = many([kind.raw({ id: 'z' }), kind.raw({ id: 'a', secret: 'x', categoryId: 'super', recurringId: 'r', __extra: { deep: 1 } }), kind.raw({ id: 'm' })]);
    expect(list.map((x) => x.id)).toEqual(['z', 'a', 'm']);
    for (const x of list) expect(Object.keys(x).every((k) => !['secret', 'categoryId', 'recurringId', '__extra'].includes(k))).toBe(true);
  });

  it('skips entries that are not objects without disturbing the rest, holes included', () => {
    const sparse = [kind.raw({ id: 'a' }), , kind.raw({ id: 'b' })];
    expect(many(sparse).map((x) => x.id)).toEqual(['a', 'b']);
    expect(many([null, 7, 'junk', true, [], [kind.raw()], undefined, kind.raw({ id: 'ok' }), () => 1]).map((x) => x.id)).toEqual(['ok']);
  });

  it.each([
    ['1 cent', 1, 1], ['an ordinary amount', 120_000_00, 120_000_00], ['half a cent rounds up', 0.5, 1], ['1.5', 1.5, 2], ['2.5 (halves go up)', 2.5, 3], ['99.5', 99.5, 100],
    ['the largest safe integer', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], ['1e15', 1e15, 1e15],
  ])('keeps an amount of %s', (_label, amount, expected) => {
    expect(one({ amount })!.amount).toBe(expected);
  });

  it.each([
    ['zero', 0], ['negative', -1], ['negative zero', -0], ['a tiny fraction', 0.4], ['just under half a cent', 0.49999999999999994], ['NaN', Number.NaN], ['Infinity', Infinity], ['-Infinity', -Infinity],
    ['1e21', 1e21], ['2^53', 2 ** 53], ['1e308', 1e308], ['a numeric string', '100'], ['a formatted string', '1.500,00'], ['null', null], ['true', true], ['an array', [100]], ['an object', { valueOf: () => 5 }],
    ['a Number object', Object(5)], ['undefined', undefined],
  ])('drops one whose amount is %s', (_label, amount) => {
    expect(many([kind.raw({ amount })])).toEqual([]);
    expect(many([kind.raw({ id: 'a', amount }), kind.raw({ id: 'b' })]).map((x) => x.id)).toEqual(['b']);
  });

  it('drops one with no amount at all, and reads 1e999 in a JSON file as Infinity (dropped)', () => {
    const noAmount = kind.raw();
    delete noAmount.amount;
    expect(many([noAmount])).toEqual([]);
    expect(many(JSON.parse(`[${JSON.stringify(kind.raw({ id: 'x' })).replace('1500', '1e999').replace('5000', '1e999')}]`) as unknown[])).toEqual([]);
  });

  describe('ids', () => {
    it.each([['missing', undefined], ['empty', ''], ['blank', '   \t'], ['a number', 5], ['null', null], ['an object', {}], ['an array', ['a']], ['true', true]])('gives a fresh id when it is %s', (_label, id) => {
      expect(one({ id })!.id).toBe('gen-1');
    });

    it('trims ids and cuts them at 60 characters, and keeps the original of a unique id untouched', () => {
      expect(many([kind.raw({ id: '  padded  ' }), kind.raw({ id: 'x'.repeat(100) }), kind.raw({ id: 'uuid-1234-5678' })]).map((x) => x.id)).toEqual(['padded', 'x'.repeat(60), 'uuid-1234-5678']);
    });

    it('gives a repeated id a fresh one instead of dropping the record, and the first keeps it', () => {
      const list = many([kind.raw({ id: 'a', amount: 1 }), kind.raw({ id: 'a', amount: 2 }), kind.raw({ id: ' a ', amount: 3 }), kind.raw({ id: 'a'.repeat(70), amount: 4 }), kind.raw({ id: 'a'.repeat(61), amount: 5 })]);
      expect(list.map((x) => x.amount)).toEqual([1, 2, 3, 4, 5]);
      expect(list.map((x) => x.id).slice(0, 1)).toEqual(['a']);
      expect(new Set(list.map((x) => x.id)).size).toBe(5);
    });

    it('still gives every record a unique id when thousands share one', () => {
      const list = many(Array.from({ length: 5000 }, () => kind.raw({ id: 'same' })));
      expect(list).toHaveLength(5000);
      expect(new Set(list.map((x) => x.id)).size).toBe(5000);
    });

    it('never hands out an id that is also written explicitly somewhere in the same list, before or after', () => {
      const list = many([kind.raw({ id: undefined }), kind.raw({ id: 'gen-1' }), kind.raw({ id: undefined }), kind.raw({ id: 'gen-3' }), kind.raw({ id: 'gen-1' }), kind.raw({ id: '' }), kind.raw({ id: 'gen-2' })]);
      expect(new Set(list.map((x) => x.id)).size).toBe(7);
      expect(list.map((x) => x.id).filter((id) => ['gen-1', 'gen-2', 'gen-3'].includes(id))).toHaveLength(3);
      expect(list[1]!.id).toBe('gen-1');
      expect(list[3]!.id).toBe('gen-3');
      expect(list[6]!.id).toBe('gen-2');
    });

    it('skips a generator that repeats itself or hands out a taken id', () => {
      const answers = ['a', 'a', 'b', 'b', 'c'];
      const list = many([kind.raw({ id: 'a' }), kind.raw({ id: 'b' }), kind.raw({ id: undefined }), kind.raw({ id: 'b' })], { makeId: () => answers.shift() ?? `late-${answers.length}` });
      expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c', 'late-0']);
    });

    it('does not use the generator at all when every id is fine, and does not draw ids for dropped records', () => {
      const makeId = vi.fn(counter());
      many([kind.raw({ id: 'a' }), kind.raw({ id: 'b' })], { makeId });
      many([kind.raw({ id: undefined, amount: 0 }), 'junk'], { makeId });
      expect(makeId).not.toHaveBeenCalled();
    });

    it('keeps ids apart from the other lists: the same id on an income, a rule, an expense and a goal is fine', () => {
      const data = normalized({ expenses: [{ id: 'x', amount: 5, date: TODAY }], incomes: [rawIncome({ id: 'x' })], incomeRules: [rawRule({ id: 'x' })], recurring: [{ id: 'x', amount: 5 }] });
      expect([data.expenses[0]!.id, data.incomes[0]!.id, data.incomeRules[0]!.id, data.recurring[0]!.id]).toEqual(['x', 'x', 'x', 'x']);
    });

    it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'])('treats the id %j like any other', (id) => {
      const list = many(JSON.parse(JSON.stringify([kind.raw({ id }), kind.raw({ id })])) as unknown[]);
      expect(list.map((x) => x.id)[0]).toBe(id);
      expect(new Set(list.map((x) => x.id)).size).toBe(2);
    });
  });

  describe('sourceId', () => {
    it.each(INCOME_SOURCE_IDS)('keeps %s', (sourceId) => {
      expect(one({ sourceId })!.sourceId).toBe(sourceId);
    });

    it.each([['unknown', 'nope'], ['padded', ' sueldo '], ['upper case', 'SUELDO'], ['empty', ''], ['a number', 5], ['null', null], ['missing', undefined], ['an array', ['sueldo']], ['__proto__', '__proto__'], ['a huge string', 'x'.repeat(1_000_000)]])(
      'turns a source that is %s into "otros"',
      (_label, sourceId) => {
        expect(one({ sourceId })!.sourceId).toBe('otros');
      },
    );
  });

  describe('note', () => {
    it.each([
      ['trims', '  hola  ', 'hola'], ['keeps inner blanks as they are', 'a   b\tc', 'a   b\tc'], ['keeps accents and emoji', 'Diseño ☕', 'Diseño ☕'], ['becomes empty for blanks', ' \n\t ', ''],
      ['becomes empty for a number', 5, ''], ['becomes empty for null', null, ''], ['becomes empty for an array', ['x'], ''], ['becomes empty when missing', undefined, ''],
    ])('%s', (_label, note, expected) => {
      expect(one({ note })!.note).toBe(expected);
    });

    it('cuts at the maximum, trimming first and again after the cut', () => {
      expect(MAX_NOTE_LENGTH).toBe(80);
      expect(one({ note: 'n'.repeat(500) })!.note).toBe('n'.repeat(80));
      expect(one({ note: `   ${'n'.repeat(80)}` })!.note).toBe('n'.repeat(80));
      expect(one({ note: `${'n'.repeat(79)}   tail` })!.note).toBe('n'.repeat(79));
      expect(one({ note: 'n'.repeat(80) })!.note).toBe('n'.repeat(80));
    });

    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    it.each([
      ['an emoji astride the cut', `${'a'.repeat(79)}😀tail`, `${'a'.repeat(79)}😀`], ['an emoji just past the cut', `${'a'.repeat(80)}😀`, 'a'.repeat(80)],
      ['a family sequence on the cut', `${'a'.repeat(79)}${family}z`, `${'a'.repeat(79)}${family}`], ['a flag on the cut', `${'a'.repeat(79)}🇦🇷🇧🇷`, `${'a'.repeat(79)}🇦🇷`],
      ['a keycap on the cut', `${'a'.repeat(79)}1️⃣9`, `${'a'.repeat(79)}1️⃣`], ['combining accents', 'é'.repeat(100), 'é'.repeat(80)],
      ['only emoji', '😀'.repeat(200), '😀'.repeat(80)], ['a long run of family sequences', family.repeat(500), family.repeat(80)],
    ])('never splits %s', (_label, note, expected) => {
      const got = one({ note })!.note;
      expect(got).toBe(expected);
      expect(hasLoneSurrogate(got)).toBe(false);
      expect(graphemes(got)).toBeLessThanOrEqual(80);
    });
  });

  it('copes with giant strings in every field, quickly', { timeout: 30_000 }, () => {
    const giant = 'g'.repeat(5_000_000);
    const list = many([kind.raw({ id: giant, note: giant, sourceId: giant, ruleId: giant, date: giant, startMonth: giant, lastGenerated: giant }), kind.raw({ id: 'ok' })]);
    expect(list.map((x) => x.id)).toEqual([kind.key === 'incomes' ? 'ok' : 'g'.repeat(60), ...(kind.key === 'incomes' ? [] : ['ok'])]);
    expect(list.every((x) => x.note.length <= 80)).toBe(true);
  });

  it('survives thirty thousand records', { timeout: 60_000 }, () => {
    const list = many(Array.from({ length: 30_000 }, (_, i) => kind.raw({ id: `r${i}`, amount: i + 1, note: 'x'.repeat(200) })));
    expect([list.length, list[29_999]!.amount, list[29_999]!.note.length]).toEqual([30_000, 30_000, 80]);
  });

  it('is idempotent, JSON-safe, shares nothing with its input and never mutates it (frozen)', () => {
    const messy = [kind.raw(), kind.raw({ id: 'x', amount: 20.6, note: '  ñ  ', sourceId: 'ghost' }), kind.raw({ id: undefined }), kind.raw({ id: 'x' }), null, 'junk'];
    const input = JSON.parse(JSON.stringify({ expenses: [], [kind.key]: messy })) as unknown;
    const frozen = deepFreeze(JSON.parse(JSON.stringify(input)) as unknown);
    const once = normalized(frozen);
    expect(frozen).toStrictEqual(input);
    expect(normalized(JSON.parse(JSON.stringify(once)))).toStrictEqual(once);
    expect(normalized(once)).toStrictEqual(once);
    expect(JSON.parse(JSON.stringify(once))).toStrictEqual(once);
    const inputObjects = collectObjects(input);
    expect([...collectObjects(normalized(input))].filter((o) => inputObjects.has(o))).toEqual([]);
  });

  it('survives prototype pollution attempts', () => {
    const json = `{"__proto__":{"polluted":true},"expenses":[],"${kind.key}":[{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"id":"a","amount":100,"date":"2026-10-02"}]}`;
    const result = normalized(JSON.parse(json));
    expect(result[kind.key]).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((result[kind.key][0] as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result[kind.key][0]!)).toBe(Object.prototype);
    const bare = Object.assign(Object.create(null) as object, kind.raw({ id: 'nullproto' }));
    expect(many([bare]).map((x) => x.id)).toEqual(['nullproto']);
  });
});

// ---- normalizeData: incomes only -------------------------------------------------------

describe('normalizeData: incomes', () => {
  const list = (items: unknown[], extra: Extra = {}) => normalized({ expenses: [], incomes: items }, extra).incomes;

  it('keeps a complete income exactly, optional fields included', () => {
    const full = rawIncome({ ruleId: 'r1', demo: true });
    expect(list([full])).toStrictEqual([{ id: 'i1', amount: 1500, sourceId: 'freelance', note: 'x', date: '2026-10-01', createdAt: 1000, updatedAt: 2000, ruleId: 'r1', demo: true }]);
    expect(Object.keys(list([rawIncome()])[0]!).sort()).toEqual(['amount', 'createdAt', 'date', 'id', 'note', 'sourceId', 'updatedAt']);
  });

  it.each(['2026-10-02', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01', '0001-01-01', '9999-12-31'])('keeps the date %s', (date) => {
    expect(list([rawIncome({ date })])[0]!.date).toBe(date);
  });

  it.each([
    ['Feb 30', '2026-02-30'], ['Feb 29 in a common year', '2027-02-29'], ['Feb 29 in 2100', '2100-02-29'], ['Apr 31', '2026-04-31'], ['month 13', '2026-13-01'], ['month 0', '2026-00-10'], ['day 0', '2026-10-00'],
    ['unpadded', '2026-1-1'], ['a timestamp', '2026-10-02T10:00:00Z'], ['a trailing newline', '2026-10-02\n'], ['a leading space', ' 2026-10-02'], ['empty', ''], ['a number', 20_261_002], ['null', null],
    ['undefined', undefined], ['a Date', new Date(2026, 9, 2)], ['an array', ['2026-10-02']], ['a five-digit year', '12026-10-02'],
  ])('drops an income dated %s', (_label, date) => {
    expect(list([rawIncome({ date })])).toEqual([]);
  });

  it('keeps ruleId only when it is a non-empty string (trimmed, at most 60 characters)', () => {
    expect(list([rawIncome({ ruleId: '  r1  ' })])[0]!.ruleId).toBe('r1');
    expect(list([rawIncome({ ruleId: 'r'.repeat(100) })])[0]!.ruleId).toBe('r'.repeat(60));
    for (const ruleId of ['', '   ', 5, null, true, {}, ['r1'], undefined]) expect('ruleId' in list([rawIncome({ ruleId })])[0]!).toBe(false);
  });

  it('keeps demo only when it is exactly true', () => {
    expect(list([rawIncome({ demo: true })])[0]!.demo).toBe(true);
    for (const demo of [false, 'true', 1, null, {}, undefined]) expect('demo' in list([rawIncome({ demo })])[0]!).toBe(false);
  });

  it('keeps finite timestamps, and uses the clock for a missing createdAt and createdAt for a missing updatedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_900_000_000_000);
    const [a, b, c, d] = list([rawIncome({ id: 'a', createdAt: 5, updatedAt: 9 }), rawIncome({ id: 'b', createdAt: undefined, updatedAt: undefined }), rawIncome({ id: 'c', createdAt: 7, updatedAt: 'x' }), rawIncome({ id: 'd', createdAt: Number.NaN, updatedAt: Infinity })]);
    expect([a!.createdAt, a!.updatedAt, b!.createdAt, b!.updatedAt, c!.createdAt, c!.updatedAt, d!.createdAt, d!.updatedAt]).toEqual([5, 9, ...Array(2).fill(1_900_000_000_000), 7, 7, ...Array(2).fill(1_900_000_000_000)]);
  });

  it('counts as being onboarded, but only for incomes that survived', () => {
    expect(normalized({ expenses: [], incomes: [rawIncome()], settings: { onboarded: false } }).settings.onboarded).toBe(true);
    expect(normalized({ expenses: [], incomes: [rawIncome({ amount: 0 })], settings: {} }).settings.onboarded).toBe(false);
    expect(normalized({ expenses: [], incomeRules: [rawRule()], settings: {} }).settings.onboarded).toBe(false);
  });

  it('puts incomes and expenses with the same ids in separate lists without confusing them', () => {
    const data = normalized({ expenses: [{ id: 'same', amount: 5, date: TODAY }], incomes: [rawIncome({ id: 'same', amount: 7 })] });
    expect([data.expenses[0]!.amount, data.incomes[0]!.amount]).toEqual([5, 7]);
  });
});

// ---- normalizeData: fixed incomes only -----------------------------------------------------

describe('normalizeData: fixed income rules', () => {
  const rules = (items: unknown[], extra: Extra = {}) => normalized({ expenses: [], incomeRules: items }, extra).incomeRules;

  it('keeps a complete rule exactly', () => {
    expect(rules([rawRule()])).toStrictEqual([rule()]);
    expect(rules([rawRule({ active: false, lastGenerated: null })])).toStrictEqual([rule({ active: false, lastGenerated: null })]);
  });

  it.each([[0, 1], [-5, 1], [-0, 1], [1, 1], [15, 15], [31, 31], [32, 31], [99, 31], [15.9, 15], [15.1, 15], [0.5, 1], [Number.NaN, 1], [Infinity, 31], [-Infinity, 1], [1e21, 31], ['15', 1], [null, 1], [undefined, 1], [true, 1], [[15], 1]])(
    'turns the day %j into %j',
    (day, expected) => {
      expect(rules([rawRule({ day })])[0]!.day).toBe(expected);
    },
  );

  it('keeps valid month keys, repairs a bad startMonth to the month of today and a bad lastGenerated to null', () => {
    expect(rules([rawRule({ startMonth: '2024-02', lastGenerated: '2024-12' })])[0]).toMatchObject({ startMonth: '2024-02', lastGenerated: '2024-12' });
    for (const bad of ['garbage', '2026-13', '2026-00', '', '2026-1', '2026-10-01', '10000-01', 5, null, undefined, ['2026-01']]) {
      expect(rules([rawRule({ startMonth: bad, lastGenerated: bad })], { today: '2031-07-04' })[0]).toMatchObject({ startMonth: '2031-07', lastGenerated: null });
    }
  });

  it('does not judge lastGenerated against startMonth: that is for the planner', () => {
    expect(rules([rawRule({ startMonth: '2026-05', lastGenerated: '2020-01' })])[0]).toMatchObject({ startMonth: '2026-05', lastGenerated: '2020-01' });
  });

  it('is active unless it is exactly false', () => {
    for (const [active, expected] of [[true, true], [false, false], ['false', true], [0, true], [null, true], [undefined, true], ['no', true]] as const) expect(rules([rawRule({ active })])[0]!.active).toBe(expected);
  });

  it('never carries fields of an income, and an income never carries fields of a rule', () => {
    expect(Object.keys(rules([rawRule({ date: '2026-10-01', ruleId: 'x', demo: true })])[0]!).sort()).toEqual(['active', 'amount', 'day', 'id', 'lastGenerated', 'note', 'sourceId', 'startMonth']);
    expect(Object.keys(normalized({ expenses: [], incomes: [rawIncome({ day: 5, startMonth: '2026-01', active: true })] }).incomes[0]!).sort()).toEqual(['amount', 'createdAt', 'date', 'id', 'note', 'sourceId', 'updatedAt']);
  });
});

// ---- old backups and the whole picture -----------------------------------------------------

describe('backups from before incomes existed', () => {
  const legacy = {
    app: 'appgastos', version: 1, exportedAt: '2026-01-01T00:00:00.000Z',
    categories: [{ id: 'super', name: 'Súper', emoji: '🛒', color: 'green', flexible: false, limit: null, archived: false, kind: 'super' }],
    expenses: [{ id: 'e1', amount: 1500, categoryId: 'super', note: 'x', date: '2026-01-01', createdAt: 1, updatedAt: 1 }],
    recurring: [{ id: 'r1', amount: 5, categoryId: 'super', note: 'Luz', day: 3, startMonth: '2026-01', lastGenerated: null, active: true }],
    goals: [],
    settings: { currency: 'ARS', locale: 'es-AR', monthlyBudget: 100, monthlyIncome: 200_000_00, fxRate: null, theme: 'dark', haptics: true, onboarded: true },
  };

  it('load with empty income lists and keep everything else, including the rough monthly income', () => {
    const data = normalized(legacy);
    expect(data.incomes).toEqual([]);
    expect(data.incomeRules).toEqual([]);
    expect(data.expenses).toHaveLength(1);
    expect(data.recurring).toHaveLength(1);
    expect(data.settings).toMatchObject({ monthlyIncome: 200_000_00, theme: 'dark', onboarded: true });
  });

  it('parse, merge and serialize again without trouble', () => {
    const parsed = parseBackup(JSON.stringify(legacy), counter())!;
    expect(parsed.incomes).toEqual([]);
    const merged = mergeData(appData({ incomes: [income()] }), parsed);
    expect(merged).toMatchObject({ addedIncomes: 0, addedIncomeRules: 0, addedExpenses: 1 });
    expect(merged.data.incomes).toEqual([income()]);
    expect(JSON.parse(serializeBackup(parsed)).incomes).toEqual([]);
  });

  it('a backup with only incomes is not recognised as one of ours (like one with only recurring rules), but one that also lists expenses or settings is', () => {
    expect(parseBackup(JSON.stringify({ incomes: [rawIncome()] }), counter())).toBeNull();
    expect(parseBackup(JSON.stringify({ incomeRules: [rawRule()] }), counter())).toBeNull();
    expect(parseBackup(JSON.stringify({ expenses: [], incomes: [rawIncome()] }), counter())!.incomes).toHaveLength(1);
    expect(parseBackup(JSON.stringify({ settings: {}, incomeRules: [rawRule()] }), counter())!.incomeRules).toHaveLength(1);
  });
});

// ---- serializeBackup / parseBackup ------------------------------------------------------------

describe('serializeBackup and parseBackup with incomes', () => {
  it('writes the incomes and the fixed incomes in full, and the documented top-level keys', () => {
    const data = richData();
    const parsed = JSON.parse(serializeBackup(data, new Date(0))) as Record<string, unknown>;
    expect(parsed.app).toBe(BACKUP_APP_ID);
    expect(parsed.incomes).toEqual(JSON.parse(JSON.stringify(data.incomes)));
    expect(parsed.incomeRules).toEqual(JSON.parse(JSON.stringify(data.incomeRules)));
    expect(Object.keys(parsed).sort()).toEqual(['app', 'categories', 'expenses', 'exportedAt', 'goals', 'incomeRules', 'incomes', 'recurring', 'settings', 'version']);
    const incomes = parsed.incomes as Array<Record<string, unknown>>;
    expect([incomes[0]!.ruleId, incomes[1]!.demo, 'ruleId' in incomes[2]!]).toEqual(['r1', true, false]);
  });

  it.each([['an empty install', () => createInitialData('es-AR')], ['a rich dataset', richData], ['only fixed incomes', () => appData({ incomeRules: [rule()] })]])(
    'round-trips %s unchanged without needing any id repair',
    (_label, make) => {
      const data = make();
      expect(parseBackup(serializeBackup(data, new Date(0)), noRepairsExpected)).toStrictEqual(data);
    },
  );

  it('round-trips a thousand random incomes and two hundred rules, emoji and hostile text included', () => {
    const rng = mulberry32(9);
    const notes = ['', 'Sueldo', 'Logo ☕', '=1+1', '"quoted";', 'línea\nnueva', '😀'.repeat(30), 'é', '__proto__', '\u202e rtl'];
    const incomes = Array.from({ length: 1000 }, (_, i) =>
      income({ id: `i${i}`, amount: 1 + Math.floor(rng() * 1e12), sourceId: INCOME_SOURCE_IDS[Math.floor(rng() * 7)]!, note: notes[Math.floor(rng() * notes.length)]!, date: `2026-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}`, createdAt: i, updatedAt: i + 1, ...(rng() < 0.2 ? { ruleId: `r${i % 5}` } : {}), ...(rng() < 0.1 ? { demo: true } : {}) }),
    );
    const incomeRules = Array.from({ length: 200 }, (_, i) => rule({ id: `r${i}`, amount: 1 + Math.floor(rng() * 1e9), day: 1 + Math.floor(rng() * 31), active: rng() < 0.8, lastGenerated: rng() < 0.5 ? null : '2026-09' }));
    const data = appData({ incomes, incomeRules, settings: { ...createInitialData().settings, onboarded: true } });
    expect(parseBackup(serializeBackup(data), noRepairsExpected)).toStrictEqual(data);
  });

  it('repairs a damaged backup: keeps what is usable, fixes what it can, and asks for new ids only where needed', () => {
    const damaged = JSON.stringify({
      app: 'appgastos',
      expenses: [],
      incomes: [rawIncome({ id: 'a', note: '  hola  ' }), rawIncome({ id: 'a', amount: 2500, sourceId: 'ghost' }), rawIncome({ id: undefined, amount: 3500 }), rawIncome({ id: 'bad', amount: -1 }), rawIncome({ id: 'worse', date: '2026-02-30' }), 'junk', null],
      incomeRules: [rawRule({ id: 'r', day: 99 }), rawRule({ id: 'r', amount: 0 }), rawRule({ id: 'dup', amount: 7, startMonth: 'x' }), rawRule({ id: 'dup', amount: 8, active: 'no' })],
    });
    const makeId = vi.fn(counter('new'));
    const data = parseBackup(damaged, makeId)!;
    expect(data.incomes.map((i) => [i.id, i.amount, i.sourceId, i.note])).toEqual([['a', 1500, 'freelance', 'hola'], ['new-1', 2500, 'otros', 'x'], ['new-2', 3500, 'freelance', 'x']]);
    expect(data.incomeRules.map((r) => [r.id, r.amount, r.day, r.active])).toEqual([['r', 5000, 31, true], ['dup', 7, 5, true], ['new-3', 8, 5, true]]);
    expect(makeId).toHaveBeenCalledTimes(3);
    expect(data.settings.onboarded).toBe(true);
  });
});

// ---- mergeData --------------------------------------------------------------------------------

describe('mergeData with incomes and fixed incomes', () => {
  it('adds what the backup has and the app does not (matched by id), counts it, and keeps the order: here first, then the backup\'s', () => {
    const current = appData({ incomes: [income({ id: 'z' }), income({ id: 'y' })], incomeRules: [rule({ id: 'r1' })] });
    const incoming = appData({ incomes: [income({ id: 'b', amount: 2 }), income({ id: 'z' }), income({ id: 'a', amount: 3 })], incomeRules: [rule({ id: 'r1' }), rule({ id: 'r9' }), rule({ id: 'r8' })] });
    const result = mergeData(current, incoming);
    expect(result).toMatchObject({ addedIncomes: 2, addedIncomeRules: 2, addedExpenses: 0, addedCategories: 0, addedRecurring: 0, addedGoals: 0 });
    expect(result.data.incomes.map((i) => i.id)).toEqual(['z', 'y', 'b', 'a']);
    expect(result.data.incomeRules.map((r) => r.id)).toEqual(['r1', 'r9', 'r8']);
  });

  it('never overwrites: the version already here wins when an id exists on both sides', () => {
    const mine = income({ id: 'a', amount: 111, note: 'mine', sourceId: 'venta' });
    const myRule = rule({ id: 'r1', amount: 5, active: false, lastGenerated: '2026-03' });
    const result = mergeData(appData({ incomes: [mine], incomeRules: [myRule] }), appData({ incomes: [income({ id: 'a', amount: 999 })], incomeRules: [rule({ id: 'r1', amount: 999, lastGenerated: '2026-12' })] }));
    expect(result.data.incomes).toEqual([mine]);
    expect(result.data.incomeRules).toEqual([myRule]);
    expect(result).toMatchObject({ addedIncomes: 0, addedIncomeRules: 0 });
  });

  it('is idempotent, and merging a backup of yourself changes nothing', () => {
    const incoming = richData();
    const once = mergeData(appData({ incomes: [income({ id: 'mine' })] }), incoming);
    const twice = mergeData(once.data, incoming);
    expect(twice.data).toStrictEqual(once.data);
    expect([twice.addedIncomes, twice.addedIncomeRules, twice.addedExpenses]).toEqual([0, 0, 0]);
    const mine = richData();
    const same = mergeData(mine, parseBackup(serializeBackup(mine), noRepairsExpected)!);
    expect(same.data).toStrictEqual(mine);
    expect(same).toMatchObject({ addedIncomes: 0, addedIncomeRules: 0 });
  });

  it('merges into an empty app, bringing everything the backup has, and is a no-op for an empty backup', () => {
    const incoming = richData();
    const result = mergeData(createInitialData('es-AR'), incoming);
    expect(result).toMatchObject({ addedIncomes: 3, addedIncomeRules: 2 });
    expect(result.data.incomes).toEqual(incoming.incomes);
    expect(result.data.incomeRules).toEqual(incoming.incomeRules);
    const mine = richData();
    expect(mergeData(mine, appData({ categories: [], expenses: [], recurring: [], goals: [] })).data).toStrictEqual(mine);
  });

  it('never mutates either side (frozen) and returns new containers', () => {
    const current = deepFreeze(richData());
    const incoming = deepFreeze(appData({ incomes: [income({ id: 'new' })], incomeRules: [rule({ id: 'rn' })] }));
    const result = mergeData(current, incoming);
    expect(result.data.incomes).not.toBe(current.incomes);
    expect(result.data.incomeRules).not.toBe(current.incomeRules);
    expect(current.incomes).toHaveLength(3);
    expect(incoming.incomes).toHaveLength(1);
  });

  describe('onboarded', () => {
    const notOnboarded = (): AppData => appData({ settings: { ...createInitialData().settings, onboarded: false } });
    it('becomes true when the merge brings in an income, stays false for only fixed incomes or nothing, and stays true if it was', () => {
      expect(mergeData(notOnboarded(), appData({ incomes: [income()] })).data.settings.onboarded).toBe(true);
      expect(mergeData(notOnboarded(), appData({ incomeRules: [rule()] })).data.settings.onboarded).toBe(false);
      expect(mergeData(notOnboarded(), appData({ incomes: [] })).data.settings.onboarded).toBe(false);
      expect(mergeData(appData({ settings: { ...createInitialData().settings, onboarded: true } }), appData()).data.settings.onboarded).toBe(true);
    });
  });

  it('gives the same set of ids whichever side goes first, and canonical data', () => {
    const a = appData({ incomes: [income({ id: '1' }), income({ id: '2' })], incomeRules: [rule({ id: 'ra' })] });
    const b = appData({ incomes: [income({ id: '2' }), income({ id: '3' })], incomeRules: [rule({ id: 'rb' }), rule({ id: 'ra' })] });
    const [ab, ba] = [mergeData(a, b).data, mergeData(b, a).data];
    expect(ab.incomes.map((i) => i.id).sort()).toEqual(ba.incomes.map((i) => i.id).sort());
    expect(ab.incomeRules.map((r) => r.id).sort()).toEqual(ba.incomeRules.map((r) => r.id).sort());
    expect(normalizeData(JSON.parse(JSON.stringify(ab)), { makeId: noRepairsExpected, today: TODAY })).toStrictEqual(ab);
  });
});

// ---- movementsToCsv ---------------------------------------------------------------------------

/** A small strict CSV reader (RFC 4180 with ";" as the separator), used to check the writer from the outside. */
function parseCsv(text: string): string[][] {
  const source = text.startsWith('\ufeff') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (source[i + 1] === '"') (cell += '"', i++);
      else quoted = false;
    } else if (ch === '"') {
      if (cell !== '' || wasQuoted) throw new Error(`stray quote at ${i}`);
      quoted = wasQuoted = true;
    } else if (ch === ';') {
      row.push(cell);
      cell = '';
      wasQuoted = false;
    } else if (ch === '\r' && source[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      [row, cell, wasQuoted] = [[], '', false];
      i++;
    } else if (ch === '\n' || ch === '\r') {
      throw new Error(`bare line break at ${i}`);
    } else cell += ch;
  }
  if (quoted) throw new Error('unterminated quote');
  if (cell !== '' || row.length > 0 || wasQuoted) rows.push([...row, cell]);
  return rows;
}

describe('movementsToCsv with incomes', () => {
  const ars = getMoneyFormatter('es-AR', 'ARS');
  const csvOf = (incomes: Income[], extra: Partial<AppData> = {}, f = ars): string => movementsToCsv(appData({ incomes, ...extra }), f);
  const rowsOf = (incomes: Income[], extra: Partial<AppData> = {}, f = ars): string[][] => parseCsv(csvOf(incomes, extra, f)).slice(1);
  const HEADER = ['Fecha', 'Carpeta', 'Concepto', 'Monto', 'Moneda', 'Tipo'];

  it('writes the header, the byte-order mark and CRLF line ends, and nothing else for nothing', () => {
    expect(csvOf([])).toBe('\ufeffFecha;Carpeta;Concepto;Monto;Moneda;Tipo\r\n');
    expect(parseCsv(csvOf([income()]))[0]).toEqual(HEADER);
    const csv = csvOf([income(), income({ id: 'b', note: 'x\ny' })]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.indexOf('\ufeff', 1)).toBe(-1);
  });

  it('writes an income as date, source name, note, amount, currency and "Ingreso"', () => {
    expect(rowsOf([income({ date: '2026-10-05', sourceId: 'sueldo', note: 'Sueldo', amount: 1_200_000_00 })])).toEqual([['2026-10-05', 'Sueldo', 'Sueldo', '1200000', 'ARS', 'Ingreso']]);
    expect(rowsOf([income({ amount: 12_550 })], {}, getMoneyFormatter('en-US', 'USD'))).toEqual([['2026-10-01', 'Freelance', '', '125.50', 'USD', 'Ingreso']]);
  });

  it('shows the source name in the folder column for each of the seven sources', () => {
    const rows = rowsOf(INCOME_SOURCE_IDS.map((sourceId, i) => income({ id: `i${i}`, sourceId, createdAt: i })));
    expect(rows.map((r) => r[1])).toEqual(['Sueldo', 'Freelance', 'Ventas', 'Regalo', 'Reintegro', 'Inversiones', 'Otros']);
    expect(rows.map((r) => r[1])).toEqual(INCOME_SOURCE_IDS.map((id) => incomeSource(id).name));
  });

  it('shows "Otros" for a source it does not know, and never prints a hostile source id', () => {
    const attacks = ['=cmd|\' /C calc\'!A0', '+1', '-1', '@SUM(A1)', 'nope', '', '__proto__'];
    const rows = rowsOf(attacks.map((sourceId, i) => income({ id: `i${i}`, sourceId, createdAt: i })));
    expect(rows.map((r) => r[1])).toEqual(attacks.map(() => 'Otros'));
  });

  it('looks incomes up among the income sources and spending among the folders, never mixing them', () => {
    const categories = [category({ id: 'sueldo', name: 'Carpeta rara' })];
    const data = appData({ categories, expenses: [expense({ id: 'e', categoryId: 'sueldo', createdAt: 1 }), expense({ id: 'f', categoryId: 'venta', createdAt: 2 })], incomes: [income({ id: 'i', sourceId: 'sueldo', createdAt: 3 })] });
    expect(parseCsv(movementsToCsv(data, ars)).slice(1).map((r) => [r[1], r[5]])).toEqual([['Carpeta rara', 'Gasto'], ['', 'Gasto'], ['Sueldo', 'Ingreso']]);
  });

  it('keeps writing expenses exactly as before, with the extra Tipo column', () => {
    const rows = parseCsv(movementsToCsv(appData({ expenses: [expense({ date: '2026-10-02', categoryId: 'super', note: 'Chino', amount: 12_550 })] }), ars)).slice(1);
    expect(rows).toEqual([['2026-10-02', 'Supermercado', 'Chino', '125,50', 'ARS', 'Gasto']]);
  });

  it('sorts spending and incomes together by date, then by when each was entered, and keeps the data it was given as it was', () => {
    const data = appData({
      expenses: [expense({ id: 'e1', date: '2026-10-02', createdAt: 5, note: 'e1' }), expense({ id: 'e2', date: '2026-09-30', createdAt: 9, note: 'e2' })],
      incomes: [income({ id: 'i1', date: '2026-10-02', createdAt: 1, note: 'i1' }), income({ id: 'i2', date: '2026-10-02', createdAt: 7, note: 'i2' }), income({ id: 'i3', date: '2025-12-31', createdAt: 8, note: 'i3' })],
    });
    expect(parseCsv(movementsToCsv(data, ars)).slice(1).map((r) => r[2])).toEqual(['i3', 'e2', 'i1', 'e1', 'i2']);
    expect(data.incomes.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(() => movementsToCsv(deepFreeze(data), ars)).not.toThrow();
  });

  // documents current behaviour (spec silent): same day and same moment of entry, spending comes first
  it('puts spending before an income entered at the very same moment on the same day', () => {
    const data = appData({ expenses: [expense({ date: '2026-10-02', createdAt: 5, note: 'gasto' })], incomes: [income({ date: '2026-10-02', createdAt: 5, note: 'ingreso' })] });
    expect(parseCsv(movementsToCsv(data, ars)).slice(1).map((r) => r[2])).toEqual(['gasto', 'ingreso']);
  });

  it('writes any amount exactly, up to the largest safe integer, and every amount can be read back', () => {
    const rng = mulberry32(61);
    const amounts = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, 1, 5, 99, 100, 101, 150, 100_000_000_000];
    for (let i = 0; i < 3000; i++) amounts.push(Math.floor(rng() * Number.MAX_SAFE_INTEGER) + 1);
    const rows = rowsOf(amounts.map((amount, i) => income({ id: `i${i}`, amount, createdAt: i })));
    const wrong = amounts.filter((cents, i) => {
      const big = BigInt(cents);
      return rows[i]![3] !== (big % 100n === 0n ? `${big / 100n}` : `${big / 100n},${String(big % 100n).padStart(2, '0')}`);
    });
    expect(wrong).toEqual([]);
    expect(amounts.slice(0, 1200).filter((cents, i) => parseAmountText(rows[i]![3]!) !== cents && cents < 1e12)).toEqual([]);
  });

  describe('spreadsheet formula injection', () => {
    it.each(['=', '+', '-', '@', '\t', '\r'])('neutralizes an income note that starts with %j', (lead) => {
      expect(rowsOf([income({ note: `${lead}1+1` })])[0]![2]).toBe(`'${lead}1+1`);
    });

    it('neutralizes the classic attack strings, and leaves everything else exactly as it was', () => {
      const attacks = ['=1+1', '=cmd|\' /C calc\'!A0', '=HYPERLINK("http://evil.example","click")', '+54 11 5555-5555', '-5 de descuento', '@SUM(A1:A9)', '=1;2', '\t=1+1', '\r=1+1', '=', '-', '+', '@'];
      const rows = rowsOf(attacks.map((note, i) => income({ id: `i${i}`, note, createdAt: i })));
      attacks.forEach((attack, i) => expect(rows[i]![2]).toBe(`'${attack}`));
      const safe = ['a=1', '1+1', 'x-y', 'me@home', ' =1', "'=1", '"=1"', 'ñ=1', '1=1', 'a\n=1+1', 'Sueldo', ''];
      expect(rowsOf(safe.map((note, i) => income({ id: `i${i}`, note, createdAt: i }))).map((r) => r[2])).toEqual(safe);
    });

    it('never lets a cell of any row start with a formula character, and never loses the text, whatever it holds', () => {
      const rng = mulberry32(77);
      const alphabet = '=+-@\t\r\n;"\' abcé0';
      const notes = Array.from({ length: 1500 }, () => Array.from({ length: 1 + Math.floor(rng() * 8) }, () => alphabet[Math.floor(rng() * alphabet.length)]!).join(''));
      const rows = rowsOf(notes.map((note, i) => income({ id: `i${i}`, note, sourceId: INCOME_SOURCE_IDS[i % 7]!, createdAt: i })));
      expect(rows).toHaveLength(notes.length);
      rows.forEach((row, i) => {
        expect(row).toHaveLength(6);
        for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
        expect(row[2]).toBe(/^[=+\-@\t\r]/.test(notes[i]!) ? `'${notes[i]}` : notes[i]);
        expect(row[5]).toBe('Ingreso');
      });
    });
  });

  describe('quoting', () => {
    const notes = ['plain', 'con ñ y acentos áéíóú', 'emoji ☕🎉', 'semi;colon', 'both ; and "quotes"', '"', '""', '"leading quote', 'line\nbreak', 'crlf\r\nbreak', 'cr\rbreak', '\n', ';', ';;', 'comma, only', 'tab\tinside', 'a'.repeat(10_000)];

    it('survives a trip through a strict CSV reader, byte for byte, with six fields per row', () => {
      const rows = rowsOf(notes.map((note, i) => income({ id: `i${i}`, note, createdAt: i })));
      expect(rows.map((r) => r[2])).toEqual(notes);
      for (const row of rows) expect(row).toHaveLength(6);
    });

    it('quotes only when it has to, and doubles embedded quotes', () => {
      const csv = csvOf([income({ note: 'plain' }), income({ id: 'b', note: 'has;semicolon' }), income({ id: 'c', note: 'say "hi"' })]);
      expect(csv).toContain(';plain;');
      expect(csv).toContain(';"has;semicolon";');
      expect(csv).toContain(';"say ""hi""";');
    });
  });

  it('handles several thousand rows, in order', () => {
    const incomes = Array.from({ length: 5000 }, (_, i) => income({ id: `i${i}`, date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-15`, createdAt: i, amount: i + 1 }));
    const dates = rowsOf(incomes).map((r) => r[0]!);
    expect(dates).toHaveLength(5000);
    expect([...dates].sort()).toEqual(dates);
  });
});

// ---- merging a backup into the store ----------------------------------------------------------

describe('store.mergeIn with incomes', () => {
  it('adds the incomes and rules it lacks, counts them, never overwrites, is idempotent, and saves', () => {
    const map = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
    let n = 0;
    const store = createStore({ storage, makeId: () => `own-${++n}`, now: () => 1_700_000_000_000 });
    const mine = store.addIncome({ amount: 111, sourceId: 'venta', note: 'mine', date: TODAY });
    const mineRule = store.addIncomeRule({ amount: 5, sourceId: 'sueldo', day: 5, startMonth: '2026-10' });
    const incoming = normalized({
      expenses: [],
      incomes: [rawIncome({ id: mine.id, amount: 999 }), rawIncome({ id: 'n1', amount: 7, date: '2026-09-01', sourceId: 'venta' }), rawIncome({ id: 'n2', amount: 8, ruleId: 'nr' })],
      incomeRules: [rawRule({ id: mineRule.id, amount: 999 }), rawRule({ id: 'nr', amount: 6, day: 2 })],
    });
    expect(store.mergeIn(incoming)).toMatchObject({ addedIncomes: 2, addedIncomeRules: 1, addedExpenses: 0 });
    expect(store.getData().incomes.map((i) => [i.id, i.amount])).toEqual([[mine.id, 111], ['n1', 7], ['n2', 8]]);
    expect(store.getData().incomeRules.map((r) => [r.id, r.amount])).toEqual([[mineRule.id, 5], ['nr', 6]]);
    expect((JSON.parse(map.get('mg:data:v1')!) as AppData).incomes).toHaveLength(3);
    expect(store.mergeIn(incoming)).toMatchObject({ addedIncomes: 0, addedIncomeRules: 0 });
    expect(store.getData().incomes).toHaveLength(3);
  });
});

// ---- a salary typed in by hand, then made a fixed income -----------------------------------------------

describe('from a salary typed in by hand to a fixed income (store + expectedIncome)', () => {
  it('is never counted twice: not by the rule that takes over from it, nor by what the rule records', () => {
    let n = 0;
    const store = createStore({ storage: null, makeId: () => `s-${++n}`, now: () => 1_700_000_000_000 });
    for (const date of ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']) store.addIncome({ amount: 100_000, sourceId: 'sueldo', note: 'Sueldo', date });
    store.addIncome({ amount: 20_000, sourceId: 'freelance', note: 'Logo', date: '2026-09-03' });
    const expected = (today: string) => expectedIncome({ incomes: store.getData().incomes, rules: store.getData().incomeRules, estimate: null, today });

    expect(expected('2026-10-15')).toEqual({ amount: 106_667, basis: 'history', fixed: 0, variable: 106_667 }); // 320,000 over three months
    const rule = store.addIncomeRule({ amount: 100_000, sourceId: 'sueldo', note: 'Sueldo', day: 5, startMonth: firstMonthFor(5, '2026-10-15') });
    expect(rule.startMonth).toBe('2026-11');
    expect(expected('2026-10-15')).toEqual({ amount: 120_000, basis: 'mixed', fixed: 100_000, variable: 20_000 });
    expect(store.runIncomeRules('2026-11-20')).toBe(1);
    expect(expected('2026-11-20')).toEqual({ amount: 110_000, basis: 'mixed', fixed: 100_000, variable: 10_000 });
    store.addIncome({ amount: 30_000, sourceId: 'sueldo', note: 'Horas extra', date: '2026-11-25' });
    expect(expected('2026-12-02').variable).toBe(Math.round((30_000 + 0 + 20_000) / 3));
  });
});

// ---- generateDemoIncomes ------------------------------------------------------------------------

describe('generateDemoIncomes', () => {
  type Options = Parameters<typeof generateDemoIncomes>[0];
  const sample = (o: Partial<Options> = {}) => generateDemoIncomes({ today: '2026-10-20', currency: 'ARS', ...o });

  /** Everything every sample must satisfy, whatever the day it is made on. */
  function problems(today: string, drafts: ReturnType<typeof sample>): string[] {
    const bad: string[] = [];
    const current = monthKeyOf(today);
    const first = `${addMonths(current, -3)}-01`;
    const fromMonth = (m: string) => drafts.filter((d) => d.date.startsWith(m));
    for (const d of drafts) {
      if (Object.keys(d).sort().join() !== 'amount,date,note,sourceId') bad.push(`fields ${Object.keys(d)}`);
      if (!isValidDateStr(d.date) || d.date > today || d.date < first) bad.push(`date ${d.date}`);
      if (!Number.isSafeInteger(d.amount) || d.amount <= 0 || !isIncomeSourceId(d.sourceId)) bad.push(`draft ${JSON.stringify(d)}`);
      if (d.note === '' || cleanText(d.note, 80) !== d.note) bad.push(`note ${d.note}`);
    }
    for (let m = addMonths(current, -3); m <= current; m = addMonths(m, 1)) {
      const last = m === current ? Number(today.slice(8)) : daysInMonth(m);
      const salary = fromMonth(m).filter((d) => d.sourceId === 'sueldo');
      if (salary.length !== (last >= 5 ? 1 : 0) || salary.some((d) => d.date !== `${m}-05` || d.amount !== drafts.find((x) => x.sourceId === 'sueldo')!.amount)) bad.push(`salary ${m}`);
      const jobs = fromMonth(m).filter((d) => d.sourceId === 'freelance');
      if (m !== current && (jobs.length < 1 || jobs.length > 3)) bad.push(`jobs ${m}: ${jobs.length}`);
      if (jobs.some((d) => Number(d.date.slice(8)) < 8 || Number(d.date.slice(8)) > 27)) bad.push(`job day ${m}`);
      for (const id of ['venta', 'regalo']) {
        const extra = fromMonth(m).filter((d) => d.sourceId === id);
        if (extra.length > 1 || extra.some((d) => Number(d.date.slice(8)) < 10 || Number(d.date.slice(8)) > 24)) bad.push(`${id} ${m}`);
      }
    }
    return bad;
  }

  it('is deterministic for the same seed and differs for another', () => {
    expect(sample()).toEqual(sample());
    expect(sample({ seed: 99 })).not.toEqual(sample());
    expect(sample({ seed: 0 })).not.toEqual(sample());
    expect(sample().length).toBeGreaterThan(8);
  });

  it('covers three full months and the current one up to today, with a salary on the 5th', () => {
    const drafts = sample();
    expect([...new Set(drafts.map((d) => d.date.slice(0, 7)))].sort()).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(drafts.filter((d) => d.sourceId === 'sueldo').map((d) => d.date)).toEqual(['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']);
    expect(problems('2026-10-20', drafts)).toEqual([]);
  });

  it.each([['2026-10-02', 0], ['2026-10-04', 0], ['2026-10-05', 1], ['2026-10-07', 1], ['2026-10-08', 1]])('on %s the current month has at least %i entries and nothing later than that day', (today, atLeast) => {
    const current = sample({ today }).filter((d) => d.date.startsWith('2026-10'));
    expect(current.length >= atLeast && current.every((d) => d.date <= today)).toBe(true);
    if (today <= '2026-10-04') expect(current).toEqual([]);
    if (today === '2026-10-07') expect(current.map((d) => d.sourceId)).toEqual(['sueldo']);
  });

  it('scales the amounts to the currency: a salary is 1000 US dollars, 1500 pesos per dollar, and an unknown currency counts as dollars', () => {
    const salary = (currency: string) => sample({ currency }).find((d) => d.sourceId === 'sueldo')!.amount;
    expect([salary('ARS'), salary('USD'), salary('XXX')]).toEqual([150_000_000, 100_000, 100_000]);
    for (const currency of ['constructor', '__proto__', 'toString', '']) expect(sample({ currency }).every((d) => Number.isSafeInteger(d.amount) && d.amount > 0)).toBe(true);
  });

  it('is valid on any day of the calendar, across year ends and leap years (800 random days)', () => {
    const rng = mulberry32(5);
    const bad: string[] = [];
    for (const today of ['2027-01-15', '2028-02-29', '2028-03-01', '2027-03-01', '2026-12-31', '2026-01-01', '2000-02-29']) bad.push(...problems(today, sample({ today })).map((p) => `${today}: ${p}`));
    for (let n = 0; n < 800; n++) {
      const today = addDays('2024-01-01', Math.floor(rng() * 1800));
      const seed = Math.floor(rng() * 1000);
      bad.push(...problems(today, sample({ today, seed, currency: n % 2 ? 'USD' : 'ARS' })).map((p) => `${today} seed ${seed}: ${p}`));
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
