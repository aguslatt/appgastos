import type { CSSProperties } from 'react';

/** Where each spark flies: angle (degrees), distance (px), size (px) and a small delay (ms). Fixed, so it never changes between renders. */
const SPARKS = [
  [-80, 74, 9, 0],
  [-48, 90, 6, 30],
  [-16, 70, 8, 10],
  [18, 86, 6, 50],
  [52, 72, 9, 20],
  [84, 80, 7, 40],
  [118, 76, 6, 0],
  [152, 88, 8, 30],
  [-118, 82, 7, 20],
  [-152, 70, 6, 50],
] as const;

/** A short burst of sparks around the middle of its parent (which must be positioned). Mount it to play it once. */
export function Burst({ tone = 'accent' }: { tone?: 'accent' | 'blue' }) {
  return (
    <span className={`burst burst--${tone}`} aria-hidden="true">
      {SPARKS.map(([angle, distance, size, delay], i) => (
        <i key={i} style={{ '--a': `${angle}deg`, '--d': `${distance}px`, '--s': `${size}px`, animationDelay: `${delay}ms` } as CSSProperties} />
      ))}
    </span>
  );
}
