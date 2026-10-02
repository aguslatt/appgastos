import { donutArcs } from '../../lib/chart';

export interface DonutSlice {
  key: string;
  share: number;
  /** A CSS color. */
  color: string;
}

interface DonutProps {
  slices: readonly DonutSlice[];
  size?: number;
  stroke?: number;
  /** The figure in the middle (and a line under it). */
  centre?: { value: string; caption: string };
}

/** Part-to-whole as a ring. Decorative: the list next to it says the same thing in words and numbers. */
export function Donut({ slices, size = 132, stroke = 17, centre }: DonutProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcs = donutArcs(slices.map((s) => s.share), circumference, slices.length > 1 ? 3 : 0);
  return (
    <span className="donut" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} focusable="false">
        <circle className="donut__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((slice, i) => {
            const arc = arcs[i];
            if (!arc) return null;
            return (
              <circle
                key={slice.key}
                className="donut__arc"
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeWidth={stroke}
                fill="none"
                stroke={slice.color}
                strokeDasharray={`${arc.length} ${circumference - arc.length}`}
                strokeDashoffset={-arc.offset}
                style={{ animationDelay: `${i * 90}ms` }}
              />
            );
          })}
        </g>
      </svg>
      {centre && (
        <span className="donut__centre">
          <strong>{centre.value}</strong>
          <span>{centre.caption}</span>
        </span>
      )}
    </span>
  );
}
