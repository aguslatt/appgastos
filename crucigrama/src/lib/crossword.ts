import { BANK, type Entry } from './bank';
import { hash, mulberry32, shuffle } from './rng';

export type Dir = 'across' | 'down';

export interface Placed {
  n: number; // número de pista
  dir: Dir;
  row: number;
  col: number;
  answer: string;
  clue: string;
}

export interface Crossword {
  size: number;
  cells: (string | null)[][]; // letra correcta o null (casillero negro)
  numbers: (number | null)[][];
  words: Placed[];
}

const SIZE = 19;
const ATTEMPTS = 60;
const TARGET = 30; // ~15 horizontales y ~15 verticales
const MAX_WORDS = 32;

interface Draft {
  letters: (string | null)[][];
  dirs: (Dir | 'both' | null)[][];
  words: Omit<Placed, 'n'>[];
}

function emptyDraft(): Draft {
  return {
    letters: Array.from({ length: SIZE }, () => Array<string | null>(SIZE).fill(null)),
    dirs: Array.from({ length: SIZE }, () => Array<Dir | 'both' | null>(SIZE).fill(null)),
    words: [],
  };
}

const at = (d: Draft, r: number, c: number): string | null =>
  r < 0 || c < 0 || r >= SIZE || c >= SIZE ? null : d.letters[r]![c]!;

/** Devuelve cuántos cruces tiene la colocación, o -1 si no es válida. */
function check(d: Draft, word: string, row: number, col: number, dir: Dir): number {
  const dr = dir === 'down' ? 1 : 0;
  const dc = dir === 'across' ? 1 : 0;
  const endR = row + dr * (word.length - 1);
  const endC = col + dc * (word.length - 1);
  if (row < 0 || col < 0 || endR >= SIZE || endC >= SIZE) return -1;
  if (at(d, row - dr, col - dc) || at(d, endR + dr, endC + dc)) return -1;
  let crosses = 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const cur = d.letters[r]![c]!;
    if (cur) {
      if (cur !== word[i] || d.dirs[r]![c] === dir || d.dirs[r]![c] === 'both') return -1;
      crosses++;
    } else if (at(d, r + dc, c + dr) || at(d, r - dc, c - dr)) {
      return -1; // quedaría pegada a otra palabra
    }
  }
  return crosses;
}

function place(d: Draft, e: Entry, row: number, col: number, dir: Dir) {
  const dr = dir === 'down' ? 1 : 0;
  const dc = dir === 'across' ? 1 : 0;
  for (let i = 0; i < e.a.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    d.letters[r]![c] = e.a[i]!;
    d.dirs[r]![c] = d.dirs[r]![c] ? 'both' : dir;
  }
  d.words.push({ dir, row, col, answer: e.a, clue: e.c });
}

function attempt(pool: Entry[], rnd: () => number): Draft {
  const d = emptyDraft();
  const queue = shuffle(pool, rnd).sort((a, b) => b.a.length - a.a.length + (rnd() - 0.5) * 4);
  const first = queue.find((e) => e.a.length >= 7 && e.a.length <= SIZE) ?? queue[0]!;
  place(d, first, Math.floor(SIZE / 2), Math.floor((SIZE - first.a.length) / 2), 'across');
  // Dos pasadas: lo que no entró al principio puede entrar cuando hay más cruces.
  for (const e of [...queue, ...queue]) {
    if (d.words.length >= MAX_WORDS) break;
    if (d.words.some((w) => w.answer === e.a)) continue;
    const options: [number, number, Dir, number][] = [];
    for (const dir of ['across', 'down'] as const) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const x = check(d, e.a, r, c, dir);
          if (x >= 1) options.push([r, c, dir, x]);
        }
      }
    }
    if (!options.length) continue;
    const across = d.words.filter((w) => w.dir === 'across').length;
    const down = d.words.length - across;
    const want: Dir = across > down ? 'down' : 'across';
    options.sort(
      (a, b) => b[3] + (b[2] === want ? 1.5 : 0) - (a[3] + (a[2] === want ? 1.5 : 0)) + (rnd() - 0.5) * 1.5,
    );
    const [r, c, dir] = options[0]!;
    place(d, e, r, c, dir);
  }
  return d;
}

/** Cantidad de palabras, premiando que haya parecidas horizontales y verticales. */
function balanced(d: Draft): number {
  const across = d.words.filter((w) => w.dir === 'across').length;
  return d.words.length - Math.abs(across - (d.words.length - across)) * 0.5;
}

export function buildCrossword(seed: string, bank: Entry[] = BANK): Crossword {
  const rnd = mulberry32(hash(seed));
  // Elegimos un grupo de ~70 entradas por día para tener variedad.
  // Cada día sortea un subconjunto distinto del banco.
  const pool = shuffle(bank.filter((e) => e.a.length >= 3), rnd).slice(0, 170);
  let best = attempt(pool, rnd);
  for (let i = 1; i < ATTEMPTS; i++) {
    const d = attempt(pool, rnd);
    if (balanced(d) > balanced(best)) best = d;
    if (best.words.length >= TARGET && balanced(best) >= TARGET + 2) break;
  }

  // Recortamos a la caja que ocupa para que la grilla sea compacta.
  let minR = SIZE, minC = SIZE, maxR = 0, maxC = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (best.letters[r]![c]) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  const size = Math.max(rows, cols);
  const cells = Array.from({ length: size }, () => Array<string | null>(size).fill(null));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells[r]![c] = best.letters[minR + r]![minC + c]!;
  }

  const words = best.words
    .map((w) => ({ ...w, row: w.row - minR, col: w.col - minC }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const numbers = Array.from({ length: size }, () => Array<number | null>(size).fill(null));
  let n = 0;
  const numAt = new Map<string, number>();
  const placed: Placed[] = words.map((w) => {
    const k = `${w.row},${w.col}`;
    if (!numAt.has(k)) numAt.set(k, ++n);
    numbers[w.row]![w.col] = numAt.get(k)!;
    return { ...w, n: numAt.get(k)! };
  });
  return { size, cells, numbers, words: placed };
}

/** Casilleros (fila, col) que ocupa una palabra. */
export function wordCells(w: Placed): [number, number][] {
  return Array.from({ length: w.answer.length }, (_, i) =>
    w.dir === 'across' ? ([w.row, w.col + i] as [number, number]) : ([w.row + i, w.col] as [number, number]),
  );
}
