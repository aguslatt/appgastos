import type { BudgetLevel } from '../../lib/stats';

interface MeterProps {
  /** Used share, 0 and up (above 1 is over the limit). */
  pct: number;
  level: BudgetLevel;
  /** Share of the month that has passed, drawn as a tick so pace is easy to judge. */
  timeShare?: number;
  label: string;
}

export function Meter({ pct, level, timeShare, label }: MeterProps) {
  return (
    <div className="meter" data-level={level} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <div className="meter__fill" style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
      {timeShare !== undefined && timeShare > 0 && timeShare < 1 && <span className="meter__tick" style={{ left: `${timeShare * 100}%` }} aria-hidden="true" />}
    </div>
  );
}
