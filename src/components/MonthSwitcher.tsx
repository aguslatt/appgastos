import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, formatMonthLabel, monthKeyOf } from '../lib/dates';
import type { MonthKey } from '../lib/types';
import { useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';

/** Previous / next month arrows around the month name. Can't go past the current month or before the first expense. */
export function MonthSwitcher({ tone = 'plain' }: { tone?: 'plain' | 'on-card' }) {
  const { month, setMonth, haptic } = useUi();
  const { expenses, settings } = useData();
  const today = useToday();
  const current = monthKeyOf(today);
  const earliest = expenses.reduce<MonthKey>((min, e) => (e.date.slice(0, 7) < min ? e.date.slice(0, 7) : min), current);

  const go = (to: MonthKey) => {
    haptic('tap');
    setMonth(to);
  };

  return (
    <div className="mswitch" data-tone={tone}>
      <button type="button" className="icon-btn" aria-label="Mes anterior" disabled={month <= earliest} onClick={() => go(addMonths(month, -1))}>
        <ChevronLeft size={22} />
      </button>
      <h1 className="mswitch__label" aria-live="polite">
        {formatMonthLabel(month, settings.locale)}
      </h1>
      <button type="button" className="icon-btn" aria-label="Mes siguiente" disabled={month >= current} onClick={() => go(addMonths(month, 1))}>
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
