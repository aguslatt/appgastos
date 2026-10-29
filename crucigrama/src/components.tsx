import type { ClueType } from './lib/bank';
import { CLUE_TYPES } from './lib/edition';
import type { Crossword } from './lib/crossword';

export function TypeChip({ t, small }: { t: ClueType; small?: boolean }) {
  const info = CLUE_TYPES[t];
  return (
    <span className={`chip chip-${t}${small ? ' small' : ''}`} title={info.hint}>
      <b aria-hidden>{info.glyph}</b> {info.label}
    </span>
  );
}

/** Miniatura de la grilla del día: casilleros negros y blancos como en el diario. */
export function GridThumb({ puzzle }: { puzzle: Crossword }) {
  const n = puzzle.size;
  return (
    <svg className="thumb" viewBox={`0 0 ${n} ${n}`} aria-hidden>
      <rect width={n} height={n} fill="var(--ink)" />
      {puzzle.cells.flatMap((row, r) =>
        row.map((c, i) => (c ? <rect key={`${r}-${i}`} x={i + 0.06} y={r + 0.06} width="0.88" height="0.88" fill="var(--paper)" /> : null)),
      )}
    </svg>
  );
}
