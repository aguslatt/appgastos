import type { CSSProperties, ReactNode } from 'react';

interface RingProps {
  /** 0..1 (clamped). */
  value: number;
  size?: number;
  stroke?: number;
  /** Which color the arc takes (the tokens decide the exact shade in each theme). */
  tone?: 'accent' | 'in' | 'warn' | 'bad';
  /** Drawn in the middle. */
  children?: ReactNode;
  className?: string;
}

/** A progress ring that sweeps round to its value when it appears. The content in the middle carries the meaning for screen readers. */
export function Ring({ value, size = 64, stroke = 8, tone = 'accent', children, className }: RingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <span className={`ring ${className ?? ''}`} data-tone={tone} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        {shown > 0 && (
          <circle
            className="ring__bar"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown)}
            style={{ '--circ': circumference } as CSSProperties}
          />
        )}
      </svg>
      {children !== undefined && <span className="ring__center">{children}</span>}
    </span>
  );
}
