import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthLabel } from '../lib/dates';
import { useData } from '../state/store';
import { useUi } from '../state/ui';
import { useMonthNav } from './useMonthNav';

/** Previous / next month arrows around the month name. Can't go past the current month or before the first movement. */
export function MonthSwitcher({ tone = 'plain' }: { tone?: 'plain' | 'on-card' }) {
  const { month } = useUi();
  const { settings } = useData();
  const { prev, next } = useMonthNav();

  return (
    <div className="mswitch" data-tone={tone}>
      <button type="button" className="icon-btn" aria-label="Mes anterior" disabled={!prev} onClick={() => prev?.()}>
        <ChevronLeft size={22} />
      </button>
      <h1 className="mswitch__label" aria-live="polite">
        {formatMonthLabel(month, settings.locale)}
      </h1>
      <button type="button" className="icon-btn" aria-label="Mes siguiente" disabled={!next} onClick={() => next?.()}>
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
