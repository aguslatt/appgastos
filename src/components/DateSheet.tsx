import { addDays, formatDayHeading, formatLongDate, capitalize } from '../lib/dates';
import type { DateStr } from '../lib/types';
import { cx } from './cx';
import { Sheet } from './Sheet';

interface DateSheetProps {
  /** Chosen date, or null for "today". */
  value: DateStr | null;
  today: DateStr;
  locale: string;
  onPick: (date: DateStr | null) => void;
  onClose: () => void;
}

export function DateSheet({ value, today, locale, onPick, onClose }: DateSheetProps) {
  const current = value ?? today;
  const choose = (d: DateStr) => {
    onPick(d === today ? null : d);
    onClose();
  };
  return (
    <Sheet title="¿Qué día fue?" onClose={onClose}>
      <div className="stack">
        <div className="date-options">
          {[0, 1, 2].map((back) => {
            const d = addDays(today, -back);
            return (
              <button key={d} className={cx('btn', current !== d && 'btn--soft')} onClick={() => choose(d)}>
                {formatDayHeading(d, today, locale)}
              </button>
            );
          })}
        </div>
        <label className="field">
          <span className="field__label">Otra fecha</span>
          <input
            className="input"
            type="date"
            max={today}
            value={current}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v <= today) choose(v);
            }}
          />
          <span className="field__hint">{capitalize(formatLongDate(current, locale))}</span>
        </label>
      </div>
    </Sheet>
  );
}
