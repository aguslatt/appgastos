import { describe, expect, it } from 'vitest';
import { goalStatus, computeCapacity, type Goal } from './goals';
import { describeGoal } from './goalText';
import { getMoneyFormatter } from './money';
import type { Expense } from './types';

const TODAY = '2026-10-02';
const fmt = getMoneyFormatter('es-AR', 'ARS');
const plain = (s: string) => s.replace(/[  ]/g, ' ');
let n = 0;
const spend = (date: string, amount: number): Expense => ({ id: `t${n++}`, amount: amount * 100, categoryId: 'super', note: '', date, createdAt: 0, updatedAt: 0 });
const history = ['2026-07', '2026-08', '2026-09'].map((m) => spend(`${m}-05`, 1_000_000));
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g', kind: 'trip', name: 'Europa', emoji: '✈️', target: 3_000_000_00, deadline: '2027-03', saved: 600_000_00,
  createdAt: new Date(2026, 6, 15, 12).getTime(), ...over,
});
const say = (g: Goal, income: number | null, committed = 0) => {
  const cap = computeCapacity({ expenses: history, today: TODAY, income: income === null ? null : income * 100, projection: null });
  return describeGoal(g, goalStatus(g, cap, committed * 100, TODAY), cap, committed * 100, fmt, 'es-AR');
};

describe('describeGoal', () => {
  it('celebrates a finished goal', () => {
    expect(say(goal({ saved: 3_000_000_00 }), 1_600_000)).toMatchObject({ tone: 'done', label: 'Cumplida' });
  });

  it('says it is going well and how much room there is', () => {
    const m = say(goal(), 1_600_000);
    expect(m.tone).toBe('ok');
    expect(plain(m.headline)).toBe('Con $ 480.000 por mes llegas a Marzo 2027.');
    expect(plain(m.detail)).toContain('Hoy te sobran ≈ $ 600.000 por mes');
    expect(plain(m.detail)).toContain('Va atrasada por $ 525.000');
  });

  it('warns when it is tight', () => {
    const m = say(goal(), 1_600_000, 100_000);
    expect(m.tone).toBe('tight');
    expect(plain(m.detail)).toContain('casi todo lo que te sobra ($ 500.000)');
  });

  it('says how much is missing when it does not fit', () => {
    const m = say(goal(), 1_600_000, 300_000);
    expect(m.tone).toBe('off');
    expect(plain(m.headline)).toBe('Necesitas $ 480.000 por mes y hoy te sobran $ 300.000.');
    expect(plain(m.detail)).toContain('Faltan $ 180.000 por mes');
  });

  it('asks for the income when it cannot judge', () => {
    const m = say(goal(), null);
    expect(m.tone).toBe('unknown');
    expect(m.label).toBe('Falta tu ingreso');
    expect(plain(m.detail)).toContain('Es el 48% de lo que gastas por mes');
  });

  it('flags a deadline that has arrived', () => {
    expect(say(goal({ deadline: '2026-10' }), 1_600_000)).toMatchObject({ tone: 'late', label: 'Vencida' });
  });
});
