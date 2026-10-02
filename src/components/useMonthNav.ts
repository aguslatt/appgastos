import { addMonths, monthKeyOf } from '../lib/dates';
import type { MonthKey } from '../lib/types';
import { useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';

/**
 * Stepping between months: back as far as the first thing ever recorded, forward up to the current month.
 * `prev` / `next` are null when there is nowhere to go that way.
 */
export function useMonthNav(): { prev: (() => void) | null; next: (() => void) | null } {
  const { month, setMonth, haptic } = useUi();
  const { expenses, incomes } = useData();
  const today = useToday();
  const current = monthKeyOf(today);
  const earliestOf = (list: ReadonlyArray<{ date: string }>, from: MonthKey): MonthKey => list.reduce<MonthKey>((min, e) => (e.date.slice(0, 7) < min ? e.date.slice(0, 7) : min), from);
  const earliest = earliestOf(incomes, earliestOf(expenses, current));

  const go = (to: MonthKey) => () => {
    haptic('tap');
    setMonth(to);
  };
  return { prev: month > earliest ? go(addMonths(month, -1)) : null, next: month < current ? go(addMonths(month, 1)) : null };
}
