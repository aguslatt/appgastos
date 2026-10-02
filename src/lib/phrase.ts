import { addDays, weekdayMon0 } from './dates';
import { normalize } from './classifier';
import { parseAmountText } from './money';
import type { Cents, DateStr } from './types';

/*
 * Understands one-line entries typed or dictated: "gasté 3500 en propina ayer",
 * "uber 4500", "tres mil quinientos farmacia", "2 lucas el super".
 */

export interface ParsedPhrase {
  /** Amount in cents, when the text contains one. */
  amount: Cents | null;
  /** What's left once amount, date and filler are removed. */
  concept: string;
  /** A date named in the text (hoy, ayer, anteayer, el lunes...), else null. */
  date: DateStr | null;
}

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const THOUSAND_WORDS = new Set(['mil', 'luca', 'lucas', 'luquita', 'luquitas']);
const MILLION_WORDS = new Set(['millon', 'millones', 'palo', 'palos']);

/** Reads a spelled-out number starting at `start`; returns its value and the index after it. */
function readNumberWords(words: string[], start: number): { value: number; end: number } | null {
  let total = 0;
  let group = 0;
  let i = start;
  let any = false;
  while (i < words.length) {
    const w = words[i] as string;
    if (w === 'y' && any && i + 1 < words.length && (UNITS[words[i + 1] as string] ?? 99) < 10 && group % 10 === 0 && group >= 30) {
      i++;
      continue;
    }
    if (w in UNITS) group += UNITS[w] as number;
    else if (w in TENS) group += TENS[w] as number;
    else if (w in HUNDREDS) group += HUNDREDS[w] as number;
    else if (THOUSAND_WORDS.has(w)) {
      total += (group === 0 ? 1 : group) * 1000;
      group = 0;
    } else if (MILLION_WORDS.has(w)) {
      total += (group === 0 ? 1 : group) * 1_000_000;
      group = 0;
    } else break;
    any = true;
    i++;
  }
  return any ? { value: total + group, end: i } : null;
}

const CURRENCY_WORDS = new Set(['peso', 'pesos', 'ars', 'usd', 'dolar', 'dolares', 'eur', 'euro', 'euros', 'mxn', 'clp']);
const FILLER_WORDS = new Set([
  'gaste', 'gasto', 'gastamos', 'pague', 'pago', 'compre', 'compra', 'puse', 'anota', 'anote', 'agrega', 'agregar',
  'registra', 'registrar', 'sume', 'cargue', 'fueron', 'fue', 'salio', 'costo', 'cuesta', 'cuestan', 'me', 'sali',
]);
const CONNECTORS = new Set(['de', 'del', 'en', 'por', 'para', 'a', 'al', 'el', 'la', 'los', 'las', 'un', 'una', 'y', 'con', 'que']);
const WEEKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

interface Token {
  raw: string;
  norm: string;
  used: boolean;
}

const stripEdges = (s: string): string => s.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');

export function parseExpensePhrase(text: string, today: DateStr): ParsedPhrase {
  const tokens: Token[] = text
    .split(/\s+/)
    .map((raw) => stripEdges(raw))
    .filter((raw) => raw !== '')
    .map((raw) => ({ raw, norm: normalize(raw), used: false }));

  // ---- date words
  let date: DateStr | null = null;
  tokens.forEach((t, i) => {
    if (date) return;
    const next = tokens[i + 1];
    if (t.norm === 'hoy') {
      date = today;
      t.used = true;
    } else if (t.norm === 'ayer' || t.norm === 'anoche') {
      date = addDays(today, -1);
      t.used = true;
      if (tokens[i - 1]?.norm === 'de' && tokens[i - 2]?.norm === 'antes') {
        date = addDays(today, -2);
        tokens[i - 1]!.used = true;
        tokens[i - 2]!.used = true;
      }
    } else if (t.norm === 'anteayer' || t.norm === 'antier' || t.norm === 'antes' && next?.norm === 'de' && tokens[i + 2]?.norm === 'ayer') {
      date = addDays(today, -2);
      t.used = true;
      if (t.norm === 'antes') {
        next!.used = true;
        tokens[i + 2]!.used = true;
      }
    } else {
      const day = WEEKDAYS.indexOf(t.norm);
      if (day >= 0) {
        date = addDays(today, -((weekdayMon0(today) - day + 7) % 7));
        t.used = true;
        if (tokens[i - 1]?.norm === 'el' || tokens[i - 1]?.norm === 'del' || tokens[i - 1]?.norm === 'este') tokens[i - 1]!.used = true;
      }
    }
  });

  // ---- amount: digits first ("$3.500", "3,5k", "2 lucas", "3 mil 500")
  interface Candidate {
    cents: Cents;
    from: number;
    to: number; // inclusive
  }
  const candidates: Candidate[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.used) continue;
    const m = /^\$?(\d[\d.,]*)(k)?$/i.exec(t.raw);
    if (!m) continue;
    let cents = parseAmountText(m[1] as string);
    if (cents === null) continue;
    let to = i;
    if (m[2]) cents *= 1000;
    const nextNorm = tokens[i + 1]?.norm ?? '';
    if (!m[2] && THOUSAND_WORDS.has(nextNorm)) {
      cents *= 1000;
      to = i + 1;
      // "3 mil 500"
      const tail = /^\d{1,3}$/.exec(tokens[i + 2]?.raw ?? '');
      if (tail && nextNorm === 'mil') {
        cents += Number(tail[0]) * 100;
        to = i + 2;
      }
    } else if (!m[2] && MILLION_WORDS.has(nextNorm)) {
      cents *= 1_000_000;
      to = i + 1;
    }
    if (Number.isSafeInteger(cents) && cents > 0) candidates.push({ cents, from: i, to });
  }

  // ---- amount: spelled out ("tres mil quinientos"), only when there are no digits
  if (candidates.length === 0) {
    const norms = tokens.map((t) => t.norm);
    for (let i = 0; i < norms.length; i++) {
      if (tokens[i]?.used) continue;
      const read = readNumberWords(norms, i);
      if (read && read.value >= 10) {
        candidates.push({ cents: read.value * 100, from: i, to: read.end - 1 });
        i = read.end - 1;
      }
    }
  }

  let amount: Cents | null = null;
  const best = candidates.reduce<Candidate | null>((a, c) => (a === null || c.cents > a.cents ? c : a), null);
  if (best) {
    amount = best.cents;
    for (let i = best.from; i <= best.to; i++) (tokens[i] as Token).used = true;
    const after = tokens[best.to + 1];
    if (after && CURRENCY_WORDS.has(after.norm)) after.used = true;
  }
  for (const t of tokens) {
    if (t.raw === '$' || (CURRENCY_WORDS.has(t.norm) && amount !== null) || FILLER_WORDS.has(t.norm)) t.used = true;
  }

  // ---- what remains is the concept; trim dangling connectors at both ends
  const rest = tokens.filter((t) => !t.used);
  while (rest.length > 0 && CONNECTORS.has((rest[0] as Token).norm)) rest.shift();
  while (rest.length > 0 && CONNECTORS.has((rest[rest.length - 1] as Token).norm)) rest.pop();

  return { amount, concept: rest.map((t) => t.raw).join(' '), date };
}
