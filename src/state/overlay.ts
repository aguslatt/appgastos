import { useEffect, useRef } from 'react';

/*
 * Lets the phone's Back button (and swipe-back) close the topmost sheet or dialog
 * instead of leaving the app. Each open overlay pushes one history entry and
 * registers a closer; Back pops the entry and runs the topmost closer.
 */

const closers: Array<() => void> = [];
let ignorePops = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    closers.pop()?.();
  });
}

export function useOverlayHistory(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const closer = () => closeRef.current();
    closers.push(closer);
    history.pushState({ overlay: closers.length }, '');
    return () => {
      const i = closers.indexOf(closer);
      if (i === -1) return; // closed by the Back button, entry already popped
      closers.splice(i, 1);
      ignorePops++;
      history.back();
    };
  }, [open]);
}
