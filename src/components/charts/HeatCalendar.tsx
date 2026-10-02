import { useMemo } from 'react';
import { dateInMonth, monthName, weekdayInitial, weekdayMon0 } from '../../lib/dates';
import { heatLevels } from '../../lib/heat';
import type { MoneyFormatter } from '../../lib/money';
import type { Cents, DateStr, MonthKey } from '../../lib/types';
import { cx } from '../cx';

interface HeatCalendarProps {
  month: MonthKey;
  /** Total per day, index 0 = day 1. */
  byDay: readonly Cents[];
  today: DateStr;
  locale: string;
  fmt: MoneyFormatter;
  onPick: (date: DateStr) => void;
}

/** One circle per day, darker the more was spent. Tap a day to see what it was. */
export function HeatCalendar({ month, byDay, today, locale, fmt, onPick }: HeatCalendarProps) {
  const levels = useMemo(() => heatLevels(byDay), [byDay]);
  const offset = weekdayMon0(`${month}-01`);
  const name = monthName(month, locale);

  return (
    <div className="cal">
      <div className="cal__head" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i}>{weekdayInitial(i, locale)}</span>
        ))}
      </div>
      <div className="cal__grid">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {byDay.map((total, i) => {
          const day = i + 1;
          const date = dateInMonth(month, day);
          const future = date > today;
          return (
            <button
              key={day}
              type="button"
              className={cx('cal__cell', date === today && 'is-today')}
              data-l={future ? 'f' : levels[i]}
              disabled={future}
              aria-label={`${day} de ${name}: ${total > 0 ? fmt.formatRounded(total) : 'sin gastos'}`}
              onClick={() => onPick(date)}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="cal__legend" aria-hidden="true">
        <span>Menos</span>
        {[1, 2, 3, 4, 5].map((l) => (
          <i key={l} data-l={l} />
        ))}
        <span>Más</span>
      </div>
    </div>
  );
}
