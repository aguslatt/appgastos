import { KEYWORDS } from './keywords';
import type { Category, Expense } from './types';

/*
 * Guesses which folder a short text ("propina", "uber eats", "coto") belongs to.
 * It runs entirely on the device and combines four signals:
 *   1. the user's own history  - what they filed the same words under before (learns)
 *   2. folder names            - typing "gimnasio" when a folder is called Gimnasio
 *   3. a Spanish dictionary    - words, brands and slang tied to each kind of folder
 *   4. fuzzy matching          - typos ("farmasia") and half-typed words ("farm")
 * Case, accents and plurals never matter.
 */

export interface Suggestion {
  categoryId: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'history' | 'name' | 'keyword' | 'similar';
  /** The text that triggered it, for "because you wrote ...". */
  matched: string;
}

export interface Classifier {
  suggest(text: string): Suggestion | null;
}

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'e', 'o', 'a', 'al', 'en', 'por',
  'para', 'con', 'sin', 'mi', 'mis', 'tu', 'su', 'que', 'se', 'lo', 'le', 'les', 'me', 'es', 'x',
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Singular forms to try for a word: drop "s" ("cafes" -> "cafe"), or "es" ("bares" -> "bar"). */
function variants(word: string): string[] {
  const out = [word];
  if (word.length > 3 && word.endsWith('s')) out[0] = word.slice(0, -1);
  if (word.length > 4 && word.endsWith('es')) out.push(word.slice(0, -2));
  return out;
}

const canonical = (word: string): string => variants(word)[0] as string;

/** Content words of a text: no numbers, no filler words, plurals folded. */
function contentWords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w !== '' && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

export function contentKey(text: string): string {
  return contentWords(text).map(canonical).join(' ');
}

/** Optimal-string-alignment distance (counts a swapped pair as one edit), giving up beyond `max`. */
function editDistanceAtMost(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (prev2[j - 2] ?? 0) + 1);
      cur[j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

const fuzzyLimit = (len: number): number => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

// ---- dictionary index (built once) ----------------------------------------

const keywordKind = new Map<string, string>();
const singleKeys: Array<{ key: string; kind: string }> = [];
const allKeys: Array<{ key: string; kind: string }> = [];

for (const [kind, list] of Object.entries(KEYWORDS)) {
  for (const raw of list.split(',')) {
    const key = contentWords(raw).map(canonical).join(' ');
    if (!key || keywordKind.has(key)) continue;
    keywordKind.set(key, kind);
    allKeys.push({ key, kind });
    if (!key.includes(' ')) singleKeys.push({ key, kind });
  }
}

/** Exposed for tests: words that appear under more than one kind. */
export function dictionaryConflicts(): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const [kind, list] of Object.entries(KEYWORDS)) {
    for (const raw of list.split(',')) {
      const key = contentWords(raw).map(canonical).join(' ');
      if (!key) continue;
      const other = seen.get(key);
      if (other && other !== kind) conflicts.push(`${key}: ${other} / ${kind}`);
      else seen.set(key, kind);
    }
  }
  return conflicts;
}

const NGRAM_WEIGHT = [0, 1.6, 2.4, 3.0] as const;

/** The kind of expense a name points at ("Restaurantes" -> comida), used so custom folders understand the dictionary too. */
export function guessKind(name: string): string | null {
  const words = contentWords(name).map(variants);
  const tally = new Map<string, number>();
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const combos = words.slice(i, i + n).reduce<string[][]>((acc, vs) => acc.flatMap((prefix) => vs.map((v) => [...prefix, v])), [[]]);
      for (const combo of combos) {
        const kind = keywordKind.get(combo.join(' '));
        if (kind) {
          tally.set(kind, (tally.get(kind) ?? 0) + n);
          break;
        }
      }
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ---- the classifier ----------------------------------------------------------

interface Contribution {
  score: number;
  source: Suggestion['source'];
  matched: string;
}

export function createClassifier(categories: readonly Category[], expenses: readonly Expense[]): Classifier {
  const active = categories.filter((c) => !c.archived);
  const activeIds = new Set(active.map((c) => c.id));

  // Usage and learned associations from the user's own history.
  const usage = new Map<string, number>();
  const phrases = new Map<string, Map<string, { count: number; last: number }>>();
  const wordsToFolders = new Map<string, Map<string, number>>();
  for (const e of expenses) {
    usage.set(e.categoryId, (usage.get(e.categoryId) ?? 0) + 1);
    if (!e.note) continue;
    const words = contentWords(e.note).map(canonical);
    if (words.length === 0) continue;
    const key = words.join(' ');
    const byFolder = phrases.get(key) ?? new Map();
    const seen = byFolder.get(e.categoryId) ?? { count: 0, last: 0 };
    byFolder.set(e.categoryId, { count: seen.count + 1, last: Math.max(seen.last, e.createdAt) });
    phrases.set(key, byFolder);
    for (const w of new Set(words)) {
      if (w.length < 3) continue;
      const m = wordsToFolders.get(w) ?? new Map();
      m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + 1);
      wordsToFolders.set(w, m);
    }
  }

  const foldersByKind = new Map<string, string[]>();
  for (const c of active) {
    if (!c.kind) continue;
    foldersByKind.set(c.kind, [...(foldersByKind.get(c.kind) ?? []), c.id]);
  }
  const folderForKind = (kind: string): string | undefined => {
    const ids = foldersByKind.get(kind);
    if (!ids || ids.length === 0) return undefined;
    return [...ids].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0))[0];
  };

  const nameWords = active.map((c) => ({ id: c.id, words: contentWords(c.name).map(canonical) }));

  return {
    suggest(text: string): Suggestion | null {
      const originals = contentWords(text);
      if (originals.length === 0) return null;
      const words = originals.map(variants); // each word -> its singular candidates
      const last = words.length - 1;
      const contributions = new Map<string, Contribution>();
      const add = (id: string | undefined, score: number, source: Suggestion['source'], matched: string) => {
        if (!id || !activeIds.has(id)) return;
        const cur = contributions.get(id);
        if (!cur) contributions.set(id, { score, source, matched });
        else {
          const stronger = score > cur.score;
          contributions.set(id, { score: cur.score + score, source: stronger ? source : cur.source, matched: stronger ? matched : cur.matched });
        }
      };

      // 1. the same text filed before
      const wholeKey = words.map((v) => v[0]).join(' ');
      const exact = phrases.get(wholeKey);
      if (exact) {
        const ranked = [...exact.entries()]
          .filter(([id]) => activeIds.has(id))
          .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last);
        const top = ranked[0];
        if (top) add(top[0], 3.5 + Math.min(2, Math.log2(top[1].count)), 'history', originals.join(' '));
      }

      // 1b. single words the user has used before
      words.forEach((vs, i) => {
        const w = vs.find((v) => wordsToFolders.has(v));
        if (!w) return;
        const m = wordsToFolders.get(w);
        if (!m) return;
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const strength = Math.min(1, total / 2); // one correction nudges, two consistent ones win
        for (const [id, count] of m) add(id, 2.0 * (count / total) * strength, 'history', originals[i] ?? w);
      });
      const tail = words[last]?.[0];
      if (tail && tail.length >= 3 && !wordsToFolders.has(tail)) {
        for (const [w, m] of wordsToFolders) {
          if (!w.startsWith(tail)) continue;
          const total = [...m.values()].reduce((a, b) => a + b, 0);
          for (const [id, count] of m) add(id, 0.9 * (count / total) * Math.min(1, total / 2), 'history', w);
        }
      }

      // 2. folder names
      for (const folder of nameWords) {
        words.forEach((vs, i) => {
          for (const nw of folder.words) {
            if (vs.includes(nw)) add(folder.id, 2.4, 'name', originals[i] ?? nw);
            else if (nw.length >= 5 && vs.some((v) => editDistanceAtMost(v, nw, fuzzyLimit(nw.length)) <= fuzzyLimit(nw.length)))
              add(folder.id, 1.6, 'name', originals[i] ?? nw);
            else if (i === last && (vs[0]?.length ?? 0) >= 3 && nw.startsWith(vs[0] as string)) add(folder.id, 1.3, 'name', nw);
          }
        });
      }

      // 3. dictionary: longest phrases first, each word used once
      const consumed = new Array<boolean>(words.length).fill(false);
      for (let n = Math.min(3, words.length); n >= 1; n--) {
        for (let i = 0; i + n <= words.length; i++) {
          if (consumed.slice(i, i + n).some(Boolean)) continue;
          let kind: string | undefined;
          let matchedKey = '';
          const combos = words.slice(i, i + n).reduce<string[][]>(
            (acc, vs) => acc.flatMap((prefix) => vs.map((v) => [...prefix, v])),
            [[]],
          );
          for (const combo of combos) {
            const key = combo.join(' ');
            const k = keywordKind.get(key);
            if (k) {
              kind = k;
              matchedKey = key;
              break;
            }
          }
          if (!kind) continue;
          add(folderForKind(kind), NGRAM_WEIGHT[n] ?? 3, 'keyword', originals.slice(i, i + n).join(' ') || matchedKey);
          for (let j = i; j < i + n; j++) consumed[j] = true;
        }
      }

      // 4. typos on remaining words, and the word being typed right now
      words.forEach((vs, i) => {
        if (consumed[i]) return;
        const w = vs[0] as string;
        const limit = fuzzyLimit(w.length);
        if (limit > 0) {
          let best: { kind: string; key: string; d: number } | undefined;
          for (const k of singleKeys) {
            const d = editDistanceAtMost(w, k.key, limit);
            if (d <= limit && (!best || d < best.d)) best = { kind: k.kind, key: k.key, d };
          }
          if (best) {
            add(folderForKind(best.kind), 1.0, 'similar', originals[i] ?? w);
            return;
          }
        }
        if (i === last && w.length >= 3) {
          const perKind = new Map<string, number>();
          for (const k of allKeys) if (k.key.startsWith(w) && k.key !== w) perKind.set(k.kind, (perKind.get(k.kind) ?? 0) + 1);
          for (const [kind, n] of perKind) add(folderForKind(kind), Math.min(0.85, 0.5 + 0.05 * n), 'similar', originals[i] ?? w);
        }
      });

      const ranked = [...contributions.entries()].sort(
        (a, b) => b[1].score - a[1].score || (usage.get(b[0]) ?? 0) - (usage.get(a[0]) ?? 0),
      );
      const best = ranked[0];
      if (!best || best[1].score < 0.5) return null;
      const margin = best[1].score - (ranked[1]?.[1].score ?? 0);
      const confidence: Suggestion['confidence'] =
        best[1].score >= 1.6 && margin >= 0.8 ? 'high' : best[1].score >= 1.0 && margin >= 0.4 ? 'medium' : 'low';
      return { categoryId: best[0], score: best[1].score, confidence, source: best[1].source, matched: best[1].matched };
    },
  };
}
