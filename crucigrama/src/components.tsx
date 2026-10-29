import type { Crossword } from './lib/crossword';

const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  zoom: 'M11 4a7 7 0 105 12l4 4M8 11h6M11 8v6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  swap: 'M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3',
  delete: 'M21 5H9l-6 7 6 7h12V5zM12 9l5 6M17 9l-5 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  play: 'M7 4.5v15l12-7.5z',
  trophy: 'M8 4h8v5a4 4 0 01-8 0V4zM8 6H4v1a3 3 0 003 3M16 6h4v1a3 3 0 01-3 3M12 13v4M8 20h8',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ ['--c' as string]: color, width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Miniatura de la grilla del día. */
export function GridThumb({ puzzle }: { puzzle: Crossword }) {
  const n = puzzle.size;
  return (
    <svg className="thumb" viewBox={`0 0 ${n} ${n}`} aria-hidden>
      {puzzle.cells.flatMap((row, r) =>
        row.map((c, i) => (c ? <rect key={`${r}-${i}`} x={i + 0.08} y={r + 0.08} width="0.84" height="0.84" rx="0.18" /> : null)),
      )}
    </svg>
  );
}
