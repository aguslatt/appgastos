import { useState } from 'react';
import { capitalize, formatMonthLabel, monthShort } from '../../lib/dates';
import type { FlowPoint } from '../../lib/income';
import type { MoneyFormatter } from '../../lib/money';
import type { MonthKey } from '../../lib/types';
import { cx } from '../cx';

interface FlowBarsProps {
  /** Oldest first; the last one is the month being looked at. */
  series: readonly FlowPoint[];
  fmt: MoneyFormatter;
  locale: string;
}

/**
 * What came in against what went out, month after month: two thin bars per month, blue for income
 * and green for spending. Each month is a button; the one chosen is spelled out underneath, so the
 * numbers are never left to be guessed from bar heights.
 */
export function FlowBars({ series, fmt, locale }: FlowBarsProps) {
  const lastMonth = series[series.length - 1]?.month;
  const [picked, setPicked] = useState<MonthKey | null>(null);
  const active = series.find((p) => p.month === (picked ?? lastMonth)) ?? series[series.length - 1];
  const max = Math.max(1, ...series.flatMap((p) => [p.income, p.spent]));
  const height = (v: number): string => (v <= 0 ? '0%' : `${Math.max(4, (v / max) * 100)}%`);
  const left = active ? active.income - active.spent : 0;

  return (
    <div className="flow">
      <ul className="flow__legend" aria-hidden="true">
        <li>
          <i data-s="in" /> Entró
        </li>
        <li>
          <i data-s="out" /> Salió
        </li>
      </ul>
      <div className="flow__cols" role="group" aria-label="Lo que entró y lo que salió, mes a mes">
        {series.map((p, k) => (
          <button
            key={p.month}
            type="button"
            className={cx('flow__col', active?.month === p.month && 'is-on')}
            aria-pressed={active?.month === p.month}
            aria-label={`${capitalize(formatMonthLabel(p.month, locale))}: entró ${fmt.formatRounded(p.income)}, salió ${fmt.formatRounded(p.spent)}`}
            onClick={() => setPicked(p.month)}
            style={{ '--k': k } as React.CSSProperties}
          >
            <span className="flow__bars" aria-hidden="true">
              <i data-s="in" style={{ height: height(p.income) }} />
              <i data-s="out" style={{ height: height(p.spent) }} />
            </span>
            <span className="flow__label" aria-hidden="true">
              {capitalize(monthShort(p.month, locale))}
            </span>
          </button>
        ))}
      </div>
      {active && (
        <p className="flow__detail" aria-live="polite">
          <strong>{capitalize(formatMonthLabel(active.month, locale))}</strong>
          <span>
            Entró <b className="flow__in">{fmt.formatRounded(active.income)}</b>
          </span>
          <span>
            Salió <b>{fmt.formatRounded(active.spent)}</b>
          </span>
          {(active.income > 0 || active.spent > 0) && (
            <span data-sign={left >= 0 ? 'plus' : 'minus'}>
              {left >= 0 ? 'Quedó ' : 'Faltó '}
              <b>{fmt.formatRounded(Math.abs(left))}</b>
            </span>
          )}
        </p>
      )}
    </div>
  );
}
