import { describe, expect, it } from 'vitest';
import { score, weekStart } from './scoring';
import { buildCrossword, wordCells } from './crossword';
import { computeStats } from './stats';

describe('score', () => {
  it('premia la velocidad', () => {
    expect(score('crossword', 300, 0)).toBeGreaterThan(score('crossword', 1200, 0));
  });
  it('descuenta pistas pero no baja de 10', () => {
    expect(score('crossword', 9999, 50)).toBe(10);
  });
});

describe('weekStart', () => {
  it('devuelve el lunes', () => {
    expect(weekStart('2026-10-29')).toBe('2026-10-26');
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
  });
});

describe('crossword', () => {
  it('es determinista por día y consistente', () => {
    const a = buildCrossword('2026-10-29');
    const b = buildCrossword('2026-10-29');
    expect(a).toEqual(b);
    expect(a.words.length).toBeGreaterThanOrEqual(30);
    for (const w of a.words) {
      wordCells(w).forEach(([r, c], i) => expect(a.cells[r]![c]).toBe(w.answer[i]));
    }
  });
  it('arma grillas compactas en muchos días', { timeout: 30000 }, () => {
    for (let d = 1; d <= 28; d++) {
      const x = buildCrossword(`2026-11-${String(d).padStart(2, '0')}`);
      const across = x.words.filter((w) => w.dir === 'across').length;
      expect(x.words.length).toBeGreaterThanOrEqual(30);
      expect(across).toBeGreaterThanOrEqual(13);
      expect(x.words.length - across).toBeGreaterThanOrEqual(13);
      expect(x.size).toBeLessThanOrEqual(19);
    }
  });
});


describe('stats', () => {
  const r = (player: string, day: string, points: number, seconds: number) =>
    ({ room: 'x', player, day, game: 'crossword' as const, seconds, points });
  it('suma la semana, cuenta la racha y ordena', () => {
    const res = [r('Agus', '2026-10-28', 120, 900), r('Agus', '2026-10-29', 150, 800), r('Juli', '2026-10-29', 100, 1000), r('Agus', '2026-10-20', 90, 1200)];
    const s = computeStats(res, ['Juli', 'Nuevo'], '2026-10-29');
    expect(s.map((x) => x.name)).toEqual(['Agus', 'Juli', 'Nuevo']);
    expect(s[0]!.week).toBe(270);
    expect(s[0]!.total).toBe(360);
    expect(s[0]!.streak).toBe(2);
    expect(s[0]!.best).toBe(800);
    expect(s[2]!.played).toBe(0);
    expect(s[0]!.last7.at(-1)!.points).toBe(150);
  });
});
