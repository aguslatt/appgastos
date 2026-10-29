import { describe, expect, it } from 'vitest';
import { score, weekStart } from './scoring';
import { buildCrossword, wordCells } from './crossword';
import { buildWordSearch } from './wordsearch';

describe('score', () => {
  it('premia la velocidad', () => {
    expect(score('crossword', 300, 0)).toBeGreaterThan(score('crossword', 1200, 0));
  });
  it('descuenta pistas pero no baja de 10', () => {
    expect(score('wordsearch', 9999, 50)).toBe(10);
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
  it('arma grillas compactas en muchos días', () => {
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

describe('wordsearch', () => {
  it('esconde todas las palabras en su lugar', () => {
    const ws = buildWordSearch('2026-10-29');
    expect(ws.words.length).toBeGreaterThanOrEqual(7);
    for (const w of ws.words) {
      for (let i = 0; i < w.answer.length; i++) {
        expect(ws.grid[w.row + w.dr * i]![w.col + w.dc * i]).toBe(w.answer[i]);
      }
    }
  });
});
