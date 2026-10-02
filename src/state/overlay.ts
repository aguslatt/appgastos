import { useEffect, useRef } from 'react';

/*
 * Lets the phone's Back button (and swipe-back) close the topmost sheet or dialog
 * instead of leaving the app. Each open overlay owns one history entry and registers a
 * closer; Back pops the entry and runs the topmost closer.
 *
 * Giving an entry back is done a moment later, in one go, never in the same breath as
 * pushing one: a sheet that is replaced by another (the goal detail turning into its
 * editor) closes and opens in the same instant, and `history.back()` followed at once by
 * `history.pushState()` can take the browser further back than the app, to a blank page.
 * An entry that is given back and wanted again before that moment is simply kept.
 */

export interface HistoryLike {
  pushState(state: unknown, title: string): void;
  replaceState(state: unknown, title: string): void;
  go(delta: number): void;
}

export interface WindowLike {
  history: HistoryLike;
  addEventListener(type: 'popstate', listener: () => void): void;
}

export interface OverlayHistory {
  /** An overlay opened. Returns what to call when it closes. */
  open(close: () => void): () => void;
  /** How many overlays are open. */
  readonly depth: number;
}

export function createOverlayHistory(win: WindowLike, defer: (task: () => void) => void = (task) => void setTimeout(task, 0)): OverlayHistory {
  const closers: Array<() => void> = [];
  /** Popstate events that come from our own `go()` and mean nothing to the person. */
  let ignorePops = 0;
  /** Entries whose overlay has closed and that have not been given back yet. */
  let pending = 0;

  win.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    closers.pop()?.();
  });

  const settle = () => {
    if (pending === 0) return;
    const entries = pending;
    pending = 0;
    ignorePops++; // one traversal, one popstate, however many entries it spans
    win.history.go(-entries);
  };

  return {
    open(close) {
      const closer = () => close();
      closers.push(closer);
      const state = { overlay: closers.length };
      if (pending > 0) {
        pending--;
        win.history.replaceState(state, '');
      } else {
        win.history.pushState(state, '');
      }
      return () => {
        const at = closers.indexOf(closer);
        if (at === -1) return; // closed by the Back button: its entry is already gone
        closers.splice(at, 1);
        pending++;
        defer(settle);
      };
    },
    get depth() {
      return closers.length;
    },
  };
}

const overlays = typeof window !== 'undefined' ? createOverlayHistory(window) : null;

export function useOverlayHistory(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open || !overlays) return;
    return overlays.open(() => closeRef.current());
  }, [open]);
}
