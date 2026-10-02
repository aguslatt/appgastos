import { exprToCents } from './calc';
import { parseExpensePhrase } from './phrase';
import type { Cents, DateStr } from './types';

export interface ResolvedEntry {
  /** Amount in cents, or null when there is no usable (positive) amount yet. */
  amount: Cents | null;
  /** The concept without the amount/date words that were understood from it. */
  note: string;
  date: DateStr;
}

/**
 * Combines what was typed on the calculator with what can be understood from the
 * concept text ("uber 4500 ayer"). The calculator wins for the amount; an explicit
 * date choice wins over a date mentioned in the text.
 */
export function resolveEntry(expr: string, concept: string, dateOverride: DateStr | null, today: DateStr): ResolvedEntry {
  const parsed = parseExpensePhrase(concept, today);
  const understood = parsed.amount !== null || parsed.date !== null;
  const typed = exprToCents(expr);
  return {
    amount: typed !== null && typed > 0 ? typed : parsed.amount,
    note: understood ? parsed.concept : concept.trim(),
    date: dateOverride ?? parsed.date ?? today,
  };
}
