import { addMonths, dayOf, monthKeyOf } from '../lib/dates';
import type { DateStr, Expense, MonthKey } from '../lib/types';

const key = (month: MonthKey) => `mg:story:${month}`;

export function markStorySeen(month: MonthKey): void {
  try {
    localStorage.setItem(key(month), '1');
  } catch {
    // not critical
  }
}

export function hasSeenStory(month: MonthKey): boolean {
  try {
    return localStorage.getItem(key(month)) === '1';
  } catch {
    return false;
  }
}

/**
 * The month whose summary should be promoted right now: the one that just ended during
 * the first week of a new month, or the current one in its last two days. Only when it
 * has some movements and hasn't been opened yet.
 */
export function storyToPromote(today: DateStr, expenses: readonly Expense[], daysInCurrent: number): MonthKey | null {
  const current = monthKeyOf(today);
  const candidates: MonthKey[] = [];
  if (dayOf(today) <= 7) candidates.push(addMonths(current, -1));
  if (dayOf(today) >= daysInCurrent - 1) candidates.push(current);
  for (const month of candidates) {
    const count = expenses.reduce((n, e) => (e.date.startsWith(month) ? n + 1 : n), 0);
    if (count >= 3 && !hasSeenStory(month)) return month;
  }
  return null;
}
