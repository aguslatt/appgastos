import { useEffect, useRef, useState } from 'react';
import { loadProgress, saveProgress } from './lib/store';

/** Cronómetro que cuenta solo mientras la pestaña está a la vista y se guarda al recargar. */
export function useGameClock(key: string, running: boolean) {
  const saved = useRef(loadProgress(key));
  const [elapsed, setElapsed] = useState(saved.current?.elapsed ?? 0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (!document.hidden) setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [running]);
  return { elapsed, saved: saved.current, save: (hints: number, data: unknown, el = elapsed) =>
    saveProgress(key, { startedAt: 0, elapsed: el, hints, data }) };
}
