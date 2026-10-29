import { BANK } from './bank';
import { hash, mulberry32, shuffle } from './rng';

export interface WordSearch {
  size: number;
  grid: string[][];
  words: { answer: string; clue: string; row: number; col: number; dr: number; dc: number }[];
}

const SIZE = 14;
const WORD_COUNT = 12;
const DIRS: [number, number][] = [
  [0, 1], [1, 0], [1, 1], [-1, 1], // adelante
  [0, -1], [-1, 0], [-1, -1], [1, -1], // al revés (más difícil)
];
const ALPHABET = 'AEIOSRNDLCTUMPBGVFHQJZXYK';

export function buildWordSearch(seed: string): WordSearch {
  const rnd = mulberry32(hash(seed));
  const pool = shuffle(
    BANK.filter((e) => e.a.length >= 5 && e.a.length <= 10),
    rnd,
  );
  const grid: (string | null)[][] = Array.from({ length: SIZE }, () => Array<string | null>(SIZE).fill(null));
  const words: WordSearch['words'] = [];

  for (const e of pool) {
    if (words.length >= WORD_COUNT) break;
    for (let tries = 0; tries < 80; tries++) {
      const [dr, dc] = DIRS[Math.floor(rnd() * DIRS.length)]!;
      const row = Math.floor(rnd() * SIZE);
      const col = Math.floor(rnd() * SIZE);
      const endR = row + dr * (e.a.length - 1);
      const endC = col + dc * (e.a.length - 1);
      if (endR < 0 || endC < 0 || endR >= SIZE || endC >= SIZE) continue;
      let ok = true;
      for (let i = 0; i < e.a.length && ok; i++) {
        const cur = grid[row + dr * i]![col + dc * i];
        ok = cur === null || cur === e.a[i];
      }
      if (!ok) continue;
      for (let i = 0; i < e.a.length; i++) grid[row + dr * i]![col + dc * i] = e.a[i]!;
      words.push({ answer: e.a, clue: e.c, row, col, dr, dc });
      break;
    }
  }
  const full = grid.map((row) => row.map((ch) => ch ?? ALPHABET[Math.floor(rnd() * ALPHABET.length)]!));
  return { size: SIZE, grid: full, words };
}
