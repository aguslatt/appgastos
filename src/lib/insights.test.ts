import { describe, expect, it } from 'vitest';
import { defaultCategories } from './categories';
import { analyzeMonth, buildFacts, buildStory, plainTitle, shareText, verdictFor, type AnalysisInput } from './insights';
import { getMoneyFormatter } from './money';
import type { Expense, Recurring } from './types';

const fmt = getMoneyFormatter('es-AR', 'ARS');
const LOCALE = 'es-AR';
const plain = (s: string | undefined) => (s ?? '').replace(/[  ]/g, ' ');

let n = 0;
const e = (date: string, amount: number, categoryId: string, note = '', extra: Partial<Expense> = {}): Expense => ({
  id: `i${n++}`,
  amount: amount * 100,
  categoryId,
  note,
  date,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

// August: a quiet month. September (closed): rent on a Tuesday, expensive Fridays, a coffee habit.
const aug = [e('2026-08-01', 300_000, 'hogar', 'Alquiler'), e('2026-08-10', 40_000, 'super', 'Coto'), e('2026-08-20', 10_000, 'comida', 'Cena')];
const sept = [
  e('2026-09-01', 300_000, 'hogar', 'Alquiler'),
  e('2026-09-04', 25_000, 'comida', 'Cena'),
  e('2026-09-05', 40_000, 'super', 'Coto'),
  e('2026-09-11', 30_000, 'comida', 'Cena'),
  e('2026-09-18', 28_000, 'comida', 'Sushi'),
  e('2026-09-19', 45_000, 'super', 'Coto'),
  e('2026-09-25', 32_000, 'comida', 'Cena'),
  ...['02', '09', '16', '23', '30'].map((d) => e(`2026-09-${d}`, 2_500, 'comida', 'Café')),
];
const TODAY = '2026-10-15';

const input = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  month: '2026-09',
  today: TODAY,
  expenses: [...aug, ...sept],
  categories: defaultCategories(),
  recurring: [] as Recurring[],
  budget: null,
  ...over,
});
const ctx = (over: Partial<AnalysisInput> = {}) => ({ analysis: analyzeMonth(input(over)), fmt, locale: LOCALE });

describe('analyzeMonth (closed month)', () => {
  const a = analyzeMonth(input());

  it('ranks folders by spending', () => {
    expect(a.folders.map((f) => f.categoryId)).toEqual(['hogar', 'comida', 'super']);
    expect(a.folders[0]?.share).toBeCloseTo(300_000 / 512_500);
  });

  it('compares with the previous month', () => {
    expect(a.previousTotal).toBe(350_000_00);
    expect(a.pace?.pct).toBeCloseTo((512_500 - 350_000) / 350_000);
    expect(a.pace?.toDate).toBe(false);
  });

  it('finds the folder that rose the most', () => {
    expect(a.up?.categoryId).toBe('comida');
    expect(a.up?.previous).toBe(10_000_00);
    expect(a.down).toBeNull();
  });

  it('finds the biggest expense', () => {
    expect(a.biggest?.expense.note).toBe('Alquiler');
  });

  it('spots the repeated concept', () => {
    expect(a.habit).toEqual({ concept: 'Café', count: 5, total: 12_500_00 });
  });

  it('finds the expensive weekday without letting the rent skew it', () => {
    expect(a.weekday?.index).toBe(4); // Friday
    expect(a.weekday?.avg).toBe(28_750_00);
    expect(a.weekday?.extra).toBeGreaterThan(2);
  });

  it('suggests trimming the biggest flexible folder', () => {
    expect(a.tip?.category.id).toBe('comida');
    expect(a.tip?.monthly).toBe(12_750_00);
  });

  it('has no projection for a closed month', () => {
    expect(a.projection).toBeNull();
  });
});

describe('verdictFor', () => {
  it('judges against the budget when there is one', () => {
    const v = (budget: number) => verdictFor(analyzeMonth(input({ budget: budget * 100 })), fmt, LOCALE);
    expect(v(600_000)).toMatchObject({ id: 'saver', label: 'Mes de ahorro' });
    expect(plain(v(600_000)?.reason)).toBe('Cerró en el 85% del presupuesto: sobraron $ 87.500.');
    expect(v(520_000)).toMatchObject({ id: 'balanced' });
    expect(v(400_000)).toMatchObject({ id: 'over' });
    expect(plain(v(400_000)?.reason)).toBe('Se pasó del presupuesto por $ 112.500 (128%).');
  });

  it('falls back to the previous month without a budget', () => {
    const v = verdictFor(analyzeMonth(input()), fmt, LOCALE);
    expect(v).toMatchObject({ id: 'over', reason: '46% más que agosto.' });
  });

  it('calls a flat month balanced and a cheaper one a saver', () => {
    const flat = analyzeMonth(input({ expenses: [...aug, e('2026-09-03', 350_000, 'hogar')] }));
    expect(verdictFor(flat, fmt, LOCALE)?.id).toBe('balanced');
    const cheaper = analyzeMonth(input({ expenses: [...aug, e('2026-09-03', 200_000, 'hogar')] }));
    expect(verdictFor(cheaper, fmt, LOCALE)?.id).toBe('saver');
  });

  it('has no verdict without anything to compare against, or without data', () => {
    expect(verdictFor(analyzeMonth(input({ expenses: sept })), fmt, LOCALE)).toBeNull();
    expect(verdictFor(analyzeMonth(input({ month: '2026-11', expenses: sept })), fmt, LOCALE)).toBeNull();
  });
});

describe('buildStory (closed month)', () => {
  const slides = buildStory(ctx({ budget: 600_000_00 }));

  it('tells the month as a sequence of slides', () => {
    expect(slides.map((s) => s.id)).toEqual(['intro', 'verdict', 'top-folder', 'shift', 'biggest', 'habit', 'weekday', 'no-spend', 'tip', 'end']);
  });

  it('opens with the total', () => {
    const intro = slides[0];
    expect(intro).toMatchObject({ theme: 'green', kicker: 'SEPTIEMBRE EN NÚMEROS', title: 'Así cerró *tu mes*' });
    expect(plain(intro?.big)).toBe('$ 512.500');
    expect(intro?.caption).toContain('12 movimientos');
  });

  it('asks the question and answers it', () => {
    const v = slides.find((s) => s.id === 'verdict');
    expect(v).toMatchObject({ kicker: '¿AHORRANDO O SABOTÁNDOSE?', title: 'Mes de *ahorro*', theme: 'lime' });
  });

  it('lists the top folders', () => {
    const top = slides.find((s) => s.id === 'top-folder');
    expect(top?.title).toBe('Hogar');
    expect(top?.big).toBe('59%');
    expect(top?.items?.map((i) => i.label)).toEqual(['Hogar', 'Comida afuera', 'Supermercado']);
  });

  it('highlights the weekday with bars', () => {
    const w = slides.find((s) => s.id === 'weekday');
    expect(w?.title).toBe('Los *viernes*');
    expect(w?.weekdayBars?.highlight).toBe(4);
    expect(w?.weekdayBars?.values).toHaveLength(7);
  });

  it('names the habit', () => {
    expect(slides.find((s) => s.id === 'habit')).toMatchObject({ title: 'Café ×5' });
  });

  it('closes with the month name', () => {
    expect(slides.at(-1)).toMatchObject({ id: 'end', title: 'Eso fue *septiembre*' });
    expect(plainTitle(slides.at(-1)?.title ?? '')).toBe('Eso fue septiembre');
  });
});

describe('buildStory (current month)', () => {
  const octExpenses = [
    e('2026-10-01', 320_000, 'hogar', 'Alquiler'),
    e('2026-10-03', 38_000, 'super', 'Coto'),
    e('2026-10-09', 27_000, 'comida', 'Cena'),
    e('2026-10-12', 2_500, 'comida', 'Café'),
  ];

  it('looks ahead instead of giving tips', () => {
    const slides = buildStory(ctx({ month: '2026-10', expenses: [...aug, ...sept, ...octExpenses] }));
    const ids = slides.map((s) => s.id);
    expect(ids).toContain('projection');
    expect(ids).not.toContain('tip');
    expect(slides[0]).toMatchObject({ kicker: 'OCTUBRE HASTA HOY', title: 'Así viene *tu mes*' });
    expect(slides.at(-1)?.title).toBe('Hasta acá, *por ahora*');
  });

  it('compares the projection with the budget', () => {
    const slides = buildStory(ctx({ month: '2026-10', expenses: [...aug, ...sept, ...octExpenses], budget: 1_000_000_00 }));
    const projection = slides.find((s) => s.id === 'projection');
    expect(projection?.big).toMatch(/^≈ /);
    expect(plain(projection?.caption)).toContain('Entraría en el presupuesto de $ 1.000.000.');
  });
});

describe('buildStory (no data)', () => {
  it('shows one friendly slide', () => {
    const empty = buildStory(ctx({ month: '2026-07' }));
    expect(empty).toHaveLength(1);
    expect(empty[0]?.title).toBe('Sin gastos registrados en este mes');
    const future = buildStory(ctx({ month: '2026-12' }));
    expect(future[0]?.title).toBe('Este mes todavía no empezó');
  });
});

describe('buildFacts', () => {
  it('summarizes the month in short pills', () => {
    const facts = buildFacts(ctx());
    expect(facts.map((f) => f.id)).toEqual(['pace', 'weekday', 'habit', 'no-spend', 'biggest']);
    expect(facts[0]).toMatchObject({ tone: 'warn', text: '46% más que agosto' });
    expect(facts.find((f) => f.id === 'no-spend')?.tone).toBe('good');
  });

  it('is empty for a month without data', () => {
    expect(buildFacts(ctx({ month: '2026-07' }))).toEqual([]);
  });
});

describe('shareText', () => {
  it('writes a short recap', () => {
    const c = ctx({ budget: 600_000_00 });
    const text = plain(shareText(c, verdictFor(c.analysis, fmt, LOCALE)));
    expect(text).toContain('Mi septiembre: $ 512.500 en 12 movimientos.');
    expect(text).toContain('🌱 Mes de ahorro');
    expect(text).toContain('Carpeta estrella: 🏠 Hogar (59%).');
  });
});
