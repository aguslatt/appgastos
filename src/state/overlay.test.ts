import { describe, expect, it } from 'vitest';
import { createOverlayHistory, type OverlayHistory } from './overlay';

/*
 * A stand-in for the browser's session history. `go()` is asynchronous, like the real one, and
 * browsers disagree on what it is relative to: the entry that is current when it RUNS (the
 * specification) or the one that was current when it was CALLED (what Chrome has been seen to do
 * when a push happens in between). Everything here must come out right under both.
 */
type Model = 'when-run' | 'when-called';

function browser(model: Model) {
  // entry 0 is the page before the app; entry 1 is the app itself
  const entries: unknown[] = [null, 'app'];
  let index = 1;
  let lowest = 1;
  const listeners: Array<() => void> = [];
  const queue: Array<() => void> = [];
  const traverse = (to: number) => {
    index = Math.max(0, Math.min(entries.length - 1, to));
    lowest = Math.min(lowest, index);
    listeners.forEach((l) => l());
  };
  const win = {
    history: {
      pushState(state: unknown) {
        entries.splice(index + 1);
        entries.push(state);
        index++;
      },
      replaceState(state: unknown) {
        entries[index] = state;
      },
      go(delta: number) {
        const calledAt = index;
        queue.push(() => traverse((model === 'when-run' ? index : calledAt) + delta));
      },
    },
    addEventListener(_type: 'popstate', listener: () => void) {
      listeners.push(listener);
    },
  };
  const tasks: Array<() => void> = [];
  return {
    win,
    defer: (task: () => void) => tasks.push(task),
    /** Runs what was deferred and then the traversals that were asked for. */
    flush() {
      while (tasks.length || queue.length) {
        tasks.splice(0).forEach((t) => t());
        queue.splice(0).forEach((t) => t());
      }
    },
    /** The person presses Back. */
    back() {
      traverse(index - 1);
    },
    get index() {
      return index;
    },
    get lowest() {
      return lowest;
    },
    get entries() {
      return entries.length;
    },
  };
}

const models: Model[] = ['when-run', 'when-called'];

describe.each(models)('overlay history (traversals relative to the entry current %s)', (model) => {
  const setup = () => {
    const b = browser(model);
    const overlays: OverlayHistory = createOverlayHistory(b.win, b.defer);
    return { b, overlays };
  };

  it('gives its entry back when the only overlay closes', () => {
    const { b, overlays } = setup();
    const close = overlays.open(() => undefined);
    expect(b.index).toBe(2);
    close();
    b.flush();
    expect(b.index).toBe(1);
    expect(overlays.depth).toBe(0);
  });

  it('keeps the app where it is when one overlay is replaced by another in the same instant', () => {
    const { b, overlays } = setup();
    const closeDetail = overlays.open(() => undefined);
    b.flush();
    // the goal detail turns into its editor: one closes and the other opens, together
    closeDetail();
    const closeEditor = overlays.open(() => undefined);
    b.flush();
    expect(b.index).toBe(2);
    expect(overlays.depth).toBe(1);
    closeEditor();
    b.flush();
    expect(b.index).toBe(1);
    expect(b.lowest).toBe(1);
    expect(overlays.depth).toBe(0);
  });

  it('never takes the browser behind the app, whatever the order of a busy moment', () => {
    const { b, overlays } = setup();
    const a = overlays.open(() => undefined);
    const c = overlays.open(() => undefined);
    b.flush();
    // c closes, a new one opens, and a closes: all before the browser gets to run anything
    c();
    const d = overlays.open(() => undefined);
    a();
    d();
    b.flush();
    expect(b.index).toBe(1);
    expect(b.lowest).toBe(1);
    expect(overlays.depth).toBe(0);
  });

  it('takes back several entries in one traversal when several overlays close together', () => {
    const { b, overlays } = setup();
    const a = overlays.open(() => undefined);
    const c = overlays.open(() => undefined);
    expect(b.index).toBe(3);
    c();
    a();
    b.flush();
    expect(b.index).toBe(1);
    expect(overlays.depth).toBe(0);
  });

  it('closes only the topmost overlay when the person presses Back', () => {
    const { b, overlays } = setup();
    const closed: string[] = [];
    overlays.open(() => closed.push('first'));
    overlays.open(() => closed.push('second'));
    b.back();
    expect(closed).toEqual(['second']);
    expect(overlays.depth).toBe(1);
    expect(b.index).toBe(2);
  });

  it('does not take another entry back after Back closed the overlay (its entry is already gone)', () => {
    const { b, overlays } = setup();
    let release = () => undefined as void;
    release = overlays.open(() => release());
    b.back();
    release(); // the component unmounts because it was closed: nothing left to give back
    b.flush();
    expect(b.index).toBe(1);
    expect(b.lowest).toBe(1);
    expect(overlays.depth).toBe(0);
  });

  it('does not mistake its own traversal for the person pressing Back', () => {
    const { b, overlays } = setup();
    const closed: string[] = [];
    overlays.open(() => closed.push('under'));
    const top = overlays.open(() => closed.push('top'));
    b.flush();
    top();
    b.flush();
    expect(closed).toEqual([]);
    expect(overlays.depth).toBe(1);
    expect(b.index).toBe(2);
  });

  it('keeps working after a replacement: Back closes the new overlay, and only it', () => {
    const { b, overlays } = setup();
    const closed: string[] = [];
    const first = overlays.open(() => closed.push('first'));
    first();
    overlays.open(() => closed.push('second'));
    b.flush();
    b.back();
    expect(closed).toEqual(['second']);
    expect(b.index).toBe(1);
  });

  it('survives an overlay that is opened, closed and opened again at once (as a development build does)', () => {
    const { b, overlays } = setup();
    const first = overlays.open(() => undefined);
    first();
    const second = overlays.open(() => undefined);
    b.flush();
    expect(b.index).toBe(2);
    expect(b.entries).toBe(3);
    second();
    b.flush();
    expect(b.index).toBe(1);
  });

  it('can be used again and again without drifting', () => {
    const { b, overlays } = setup();
    for (let i = 0; i < 25; i++) {
      const close = overlays.open(() => undefined);
      b.flush();
      if (i % 3 === 0) {
        const next = overlays.open(() => undefined);
        close();
        b.flush();
        next();
      } else close();
      b.flush();
      expect(b.index).toBe(1);
      expect(overlays.depth).toBe(0);
    }
    expect(b.lowest).toBe(1);
  });
});
