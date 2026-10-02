import { useId } from 'react';
import { areaPath, cumulative, linePath, niceCeil, plotPoints } from '../../lib/chart';
import type { Cents } from '../../lib/types';

interface SpendAreaProps {
  /** Total per day of the month, index 0 = day 1. */
  byDay: readonly Cents[];
  /** Days in the month. */
  days: number;
  /** Days that have happened (all of them for a past month). */
  elapsed: number;
  /** Where the month is expected to end, when known (current month only). */
  projection: Cents | null;
  budget: Cents | null;
  /** Spoken in place of the picture. */
  summary: string;
}

const W = 320;
const H = 100;
const BOX = { left: 2, right: W - 12, top: 14, bottom: H - 4 };

/**
 * How the month's spending has built up, day by day: a line that climbs, with the shape of what is
 * still expected drawn dashed. It sits on the hero card and takes the card's ink color, so it works
 * on every background the hero can have. The day-by-day calendar below carries the same data in a
 * form that can be read out, so this picture is described once instead of point by point.
 */
export function SpendArea({ byDay, days, elapsed, projection, budget, summary }: SpendAreaProps) {
  const id = useId();
  const run = cumulative(byDay, elapsed);
  const total = run[run.length - 1] ?? 0;
  if (total <= 0) return null;

  const ahead = projection !== null && elapsed < days ? projection : null;
  const budgetShown = budget !== null && budget <= Math.max(total, ahead ?? 0) * 1.25 ? budget : null;
  const max = niceCeil(Math.max(total, ahead ?? 0, budgetShown ?? 0));
  const scale = { ...BOX, max, slots: days };

  const points = plotPoints(run, scale);
  const start = { x: BOX.left, y: BOX.bottom };
  const line = [start, ...points];
  const last = points[points.length - 1] ?? start;
  const end = ahead !== null ? plotPoints([ahead], { ...scale, slots: 2 })[0] : null;
  const budgetY = budgetShown !== null ? (plotPoints([budgetShown], scale)[0]?.y ?? 0) : null;

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} focusable="false">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {budgetY !== null && (
        <g className="spark__budget">
          <line x1={BOX.left} x2={BOX.right} y1={budgetY} y2={budgetY} />
          <text x={BOX.right} y={budgetY - 5} textAnchor="end">
            Tope
          </text>
        </g>
      )}
      <path className="spark__area" d={areaPath(line, BOX.bottom)} fill={`url(#${id}-fill)`} />
      {end && <line className="spark__ahead" x1={last.x} y1={last.y} x2={BOX.right} y2={end.y} />}
      <path className="spark__line" d={linePath(line)} pathLength={1} fill="none" />
      {elapsed < days && (
        <>
          <circle className="spark__halo" cx={last.x} cy={last.y} r="9" />
          <circle className="spark__dot" cx={last.x} cy={last.y} r="4.5" />
        </>
      )}
    </svg>
  );
}
