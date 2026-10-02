import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface SwipeOptions {
  /** Swipe towards the left (a finger moving left). */
  left?: (() => void) | null;
  /** Swipe towards the right. */
  right?: (() => void) | null;
  /** Things a swipe must not start on: fields, rows that scroll sideways... */
  ignore?: string;
}

const DISTANCE = 70;
const MORE_SIDEWAYS_THAN_DOWN = 1.8;

/**
 * Horizontal swipes with a finger (never a mouse) on a container. Vertical scrolling is left alone: a
 * swipe only counts when the move is clearly sideways. Events that come from a sheet or dialog rendered
 * from inside the container (portals bubble in React) are not swipes of the container.
 */
export function useSwipe({ left, right, ignore = 'input, textarea, select, .chips-row' }: SwipeOptions) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      start.current = null;
      if (e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement;
      if (!e.currentTarget.contains(target) || target.closest(ignore)) return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      if (!from || !e.currentTarget.contains(e.target as Node)) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * MORE_SIDEWAYS_THAN_DOWN) return;
      (dx < 0 ? left : right)?.();
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
