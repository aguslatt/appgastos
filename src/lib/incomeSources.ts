import { contentKey, normalize } from './classifier';
import type { Category, Income } from './types';

/*
 * Where money comes from. Unlike expense folders these are a fixed short list: the interesting
 * detail of an income (which client, which sale) goes in its note, and the sources only exist to
 * tell a salary from the odd job, a sale or a gift when summing up the month.
 */

export const INCOME_SOURCE_IDS = ['sueldo', 'freelance', 'venta', 'regalo', 'reintegro', 'inversiones', 'otros'] as const;
export type IncomeSourceId = (typeof INCOME_SOURCE_IDS)[number];

export const FALLBACK_INCOME_SOURCE_ID: IncomeSourceId = 'otros';

interface SourceDef {
  id: IncomeSourceId;
  name: string;
  emoji: string;
  /** Key into the category palette (see `categories.ts`). */
  color: string;
  /** Words that point at this source; a trailing `*` matches any ending ("vend*" = vendí, vendido...). */
  words: string;
}

const SOURCES: readonly SourceDef[] = [
  {
    id: 'sueldo',
    name: 'Sueldo',
    emoji: '💼',
    color: 'green',
    words: 'sueldo, salario, haberes, quincena, aguinaldo, bono, premio, jubilacion, pension, beca, subsidio, recibo de sueldo, pago mensual',
  },
  {
    id: 'freelance',
    name: 'Freelance',
    emoji: '💻',
    color: 'blue',
    words:
      'freelance, free lance, cliente*, proyecto*, factura*, honorario*, changa*, trabajito*, consultoria, diseno, desarrollo, programacion, clase*, edicion, traduccion, fotografia, sesion, comision*, presupuesto',
  },
  {
    id: 'venta',
    name: 'Ventas',
    emoji: '🏷️',
    color: 'orange',
    words: 'venta*, vend*, mercado libre, mercadolibre, marketplace, usado*, olx, wallapop',
  },
  {
    id: 'regalo',
    name: 'Regalo',
    emoji: '🎁',
    color: 'magenta',
    words: 'regalo*, regalaron, cumple*, cumpleanos, mesada, me dieron, mama, papa, abuela, abuelo, padres',
  },
  {
    id: 'reintegro',
    name: 'Reintegro',
    emoji: '↩️',
    color: 'sky',
    words: 'reintegro*, devolucion*, devolvieron, devolvio, reembolso*, cashback, nota de credito, me pagaron lo que',
  },
  {
    id: 'inversiones',
    name: 'Inversiones',
    emoji: '📈',
    color: 'violet',
    words: 'interes*, dividendo*, plazo fijo, rendimiento*, ganancia*, cripto*, acciones, inversion*, alquiler*, renta, airbnb, fci',
  },
  { id: 'otros', name: 'Otros', emoji: '✨', color: 'slate', words: '' },
];

export const isIncomeSourceId = (v: unknown): v is IncomeSourceId => typeof v === 'string' && (INCOME_SOURCE_IDS as readonly string[]).includes(v);

/** A stored source id, or the fallback for anything that isn't one (an old backup, a typo). */
export const resolveIncomeSource = (v: unknown): IncomeSourceId => (isIncomeSourceId(v) ? v : FALLBACK_INCOME_SOURCE_ID);

/** The sources in the shape of a folder, so the same pills and badges can show them. */
export function incomeSourceFolders(): Category[] {
  return SOURCES.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, kind: s.id, flexible: false, limit: null, archived: false }));
}

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function incomeSource(id: string): { id: IncomeSourceId; name: string; emoji: string; color: string } {
  const s = BY_ID.get(resolveIncomeSource(id)) as SourceDef;
  return { id: s.id, name: s.name, emoji: s.emoji, color: s.color };
}

// ---- guessing the source from a few words -----------------------------------------------------

export interface IncomeSuggestion {
  sourceId: IncomeSourceId;
  /** What in the text pointed at it, for "I read «cliente»". */
  matched: string;
  source: 'history' | 'keyword';
}

export interface IncomeSuggester {
  suggest(text: string): IncomeSuggestion | null;
}

interface Matcher {
  sourceId: IncomeSourceId;
  /** Whole words, in every form they can take ("sesion" also stands for "sesiones"). */
  words: Set<string>;
  prefixes: string[];
  /** Phrases as lists of normalized words. */
  phrases: string[][];
}

/** A word and its likely singulars: "sesiones" -> sesiones, sesione, sesion. Two words are the same when they share a form. */
function forms(word: string): string[] {
  const out = [word];
  if (word.length > 3 && word.endsWith('s')) out.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith('es')) out.push(word.slice(0, -2));
  return out;
}

const sameWord = (a: string, b: string): boolean => a === b || forms(a).some((f) => forms(b).includes(f));

const MATCHERS: Matcher[] = SOURCES.filter((s) => s.words !== '').map((s) => {
  const matcher: Matcher = { sourceId: s.id, words: new Set(), prefixes: [], phrases: [] };
  for (const raw of s.words.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.endsWith('*')) {
      const stem = normalize(entry.slice(0, -1));
      if (stem.length >= 3) matcher.prefixes.push(stem);
    } else if (entry.includes(' ')) {
      matcher.phrases.push(normalize(entry).split(' '));
    } else {
      for (const form of forms(normalize(entry))) matcher.words.add(form);
    }
  }
  return matcher;
});

function keywordMatch(text: string): IncomeSuggestion | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  const all = normalized.split(' ');
  const tokens = all.filter((t) => !/^\d+$/.test(t));
  for (const m of MATCHERS) {
    for (const phrase of m.phrases) {
      for (let i = 0; i + phrase.length <= all.length; i++) {
        if (phrase.every((word, k) => sameWord(all[i + k] as string, word))) return { sourceId: m.sourceId, matched: phrase.join(' '), source: 'keyword' };
      }
    }
    for (const token of tokens) {
      if (forms(token).some((f) => m.words.has(f))) return { sourceId: m.sourceId, matched: token, source: 'keyword' };
      if (m.prefixes.some((p) => token.startsWith(p))) return { sourceId: m.sourceId, matched: token, source: 'keyword' };
    }
  }
  return null;
}

/** Learns from the incomes already filed: the same words go to the same source as last time. */
export function createIncomeSuggester(incomes: readonly Income[]): IncomeSuggester {
  const learned = new Map<string, IncomeSourceId>();
  for (const income of [...incomes].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = contentKey(income.note);
    if (key) learned.set(key, resolveIncomeSource(income.sourceId));
  }
  return {
    suggest(text) {
      const key = contentKey(text);
      if (!key) return null;
      const known = learned.get(key);
      if (known) return { sourceId: known, matched: text.trim(), source: 'history' };
      return keywordMatch(text);
    },
  };
}
