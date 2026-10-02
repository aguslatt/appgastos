import { describe, expect, it } from 'vitest';
import { resolveEntry } from './entry';
import { describeLive, formatHours, type LiveInput } from './live';
import { getMoneyFormatter } from './money';
import { computeMonthStats } from './stats';
import type { Expense } from './types';

const TODAY = '2026-10-15';
const fmt = getMoneyFormatter('es-AR', 'ARS');
const plain = (s: string | undefined) => (s ?? '').replace(/[  ]/g, ' ');

describe('resolveEntry', () => {
  it('uses the calculator for the amount and the text as a plain note', () => {
    expect(resolveEntry('3500', 'propina', null, TODAY)).toEqual({ amount: 350_000, note: 'propina', date: TODAY });
  });

  it('keeps the note as typed when nothing was understood from it', () => {
    expect(resolveEntry('1000', '  La Nonna ', null, TODAY).note).toBe('La Nonna');
  });

  it('fills the amount from the text when the calculator is empty', () => {
    expect(resolveEntry('', 'uber 4500', null, TODAY)).toEqual({ amount: 450_000, note: 'uber', date: TODAY });
  });

  it('prefers the calculator over a number in the text', () => {
    expect(resolveEntry('2000', 'uber 4500', null, TODAY).amount).toBe(200_000);
  });

  it('takes a date named in the text unless one was chosen explicitly', () => {
    expect(resolveEntry('500', 'kiosco ayer', null, TODAY).date).toBe('2026-10-14');
    expect(resolveEntry('500', 'kiosco ayer', '2026-10-01', TODAY).date).toBe('2026-10-01');
  });

  it('has no amount when nothing positive is available', () => {
    expect(resolveEntry('', 'propina', null, TODAY).amount).toBeNull();
    expect(resolveEntry('5-10', 'propina', null, TODAY).amount).toBeNull();
    expect(resolveEntry('10/0', '', null, TODAY).amount).toBeNull();
  });

  it('evaluates calculator expressions', () => {
    expect(resolveEntry('12500/4', 'cena', null, TODAY).amount).toBe(312_500);
  });
});

const e = (date: string, amount: number): Expense => ({ id: date + amount, amount: amount * 100, categoryId: 'super', note: '', date, createdAt: 0, updatedAt: 0 });
const stats = computeMonthStats([e('2026-10-02', 100_000), e('2026-10-10', 60_000), e('2026-10-15', 20_000)], '2026-10', TODAY);

const live = (over: Partial<LiveInput> = {}) =>
  describeLive({ amount: 10_000_00, date: TODAY, today: TODAY, stats, budget: null, income: null, folder: null, fmt, locale: 'es-AR', ...over });

describe('describeLive', () => {
  it('says nothing without an amount', () => {
    expect(live({ amount: 0 })).toBeNull();
  });

  it('shows what is left per day when there is a budget', () => {
    // budget 300000, spent 180000, +10000 -> 110000 left over 17 days
    const r = live({ budget: 300_000_00 });
    expect(plain(r?.text)).toBe('3% del presupuesto · quedan $ 6.470 por día');
    expect(r?.tone).toBe('neutral');
  });

  it('warns when little is left and flags going over', () => {
    expect(live({ budget: 205_000_00 })?.tone).toBe('warn');
    const over = live({ budget: 185_000_00 });
    expect(plain(over?.text)).toBe('Pasa el presupuesto por $ 5.000');
    expect(over?.tone).toBe('over');
  });

  it('without a budget, tells today\'s total or compares with the daily average', () => {
    // daily average = 180000 / 15 = 12000; 10000 is below 1.5x -> today's total
    expect(plain(live()?.text)).toBe('Hoy llevas $ 30.000');
    // 30000 / 12000 = 2.5x
    expect(plain(live({ amount: 30_000_00 })?.text)).toBe('≈ 2,5 veces tu gasto diario');
  });

  it('turns money into hours of work when income is set', () => {
    // income 160000/month -> 1000 per hour -> 10000 = 10 h
    expect(plain(live({ income: 160_000_00 })?.text)).toBe('Hoy llevas $ 30.000 · 10 h de trabajo');
    expect(formatHours(0.5, 'es-AR')).toBe('30 min de trabajo');
    expect(formatHours(2.5, 'es-AR')).toBe('2,5 h de trabajo');
    expect(formatHours(12, 'es-AR')).toBe('12 h de trabajo');
  });

  it('puts a folder limit warning first', () => {
    const r = live({ budget: 300_000_00, folder: { name: 'Ocio', limit: 20_000_00, spent: 15_000_00 } });
    expect(plain(r?.text)).toBe('Pasa el tope de Ocio por $ 5.000 · 3% del presupuesto · quedan $ 6.470 por día');
    expect(r?.tone).toBe('over');
    const warn = live({ folder: { name: 'Ocio', limit: 20_000_00, spent: 7_000_00 } });
    expect(plain(warn?.text)).toBe('Ocio: 85% de su tope · Hoy llevas $ 30.000');
    expect(warn?.tone).toBe('warn');
  });

  it('notes when the date falls in another month', () => {
    expect(live({ date: '2026-09-28' })).toEqual({ text: 'Se suma a septiembre', tone: 'neutral' });
  });

  it('does not claim "today" for an earlier day of this month', () => {
    expect(plain(live({ date: '2026-10-10' })?.text)).toBe('Se suma a este mes');
  });
});
