import { useMemo, useRef, useState } from 'react';
import { buildWordSearch } from '../lib/wordsearch';
import { fmtTime, score } from '../lib/scoring';
import { useGameClock } from '../hooks';

interface Props {
  day: string;
  onDone: (seconds: number, points: number) => void;
  onBack: () => void;
}

type Cell = [number, number];

/** Casilleros de la línea recta entre a y b, o null si no están en línea. */
function line(a: Cell, b: Cell): Cell[] | null {
  const dr = b[0] - a[0];
  const dc = b[1] - a[1];
  const len = Math.max(Math.abs(dr), Math.abs(dc));
  if (len === 0) return [a];
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
  const sr = Math.sign(dr), sc = Math.sign(dc);
  return Array.from({ length: len + 1 }, (_, i) => [a[0] + sr * i, a[1] + sc * i] as Cell);
}

export function WordSearchGame({ day, onDone, onBack }: Props) {
  const puzzle = useMemo(() => buildWordSearch(day), [day]);
  const key = `wordsearch:${day}`;
  const [finished, setFinished] = useState(false);
  const { elapsed, saved, save } = useGameClock(key, !finished);
  const [found, setFound] = useState<string[]>((saved?.data as string[] | undefined) ?? []);
  const [drag, setDrag] = useState<Cell[]>([]);
  const start = useRef<Cell | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState('');

  const foundCells = new Set<string>();
  for (const w of puzzle.words) {
    if (!found.includes(w.answer)) continue;
    for (let i = 0; i < w.answer.length; i++) foundCells.add(`${w.row + w.dr * i},${w.col + w.dc * i}`);
  }
  const dragSet = new Set(drag.map(([r, c]) => `${r},${c}`));

  const cellFromPoint = (x: number, y: number): Cell | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const d = el?.dataset;
    return d?.r !== undefined ? [Number(d.r), Number(d.c)] : null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (finished) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    gridRef.current?.setPointerCapture(e.pointerId);
    start.current = cell;
    setDrag([cell]);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    const l = cell && line(start.current, cell);
    if (l) setDrag(l);
  };
  const onUp = () => {
    if (!start.current) return;
    const text = drag.map(([r, c]) => puzzle.grid[r]![c]).join('');
    const rev = text.split('').reverse().join('');
    const hit = puzzle.words.find((w) => !found.includes(w.answer) && (w.answer === text || w.answer === rev));
    start.current = null;
    setDrag([]);
    if (!hit) return;
    const next = [...found, hit.answer];
    setFound(next);
    save(0, next);
    setToast(`¡Bien! ${hit.answer}`);
    try { navigator.vibrate?.(40); } catch { /* sin vibración */ }
    setTimeout(() => setToast(''), 1500);
    if (next.length === puzzle.words.length) {
      setFinished(true);
      onDone(elapsed, score('wordsearch', elapsed, 0));
    }
  };

  return (
    <div className="game">
      <header className="bar">
        <button className="link" onClick={onBack}>← Volver</button>
        <strong>Sopa de letras</strong>
        <span className="timer">{fmtTime(elapsed)}</span>
      </header>
      <p className="muted center">Encontrá la palabra que responde a cada pista. Arrastrá el dedo sobre ella, en cualquier dirección, también al revés. {found.length}/{puzzle.words.length}</p>

      {toast && <div className="toast" role="status">{toast}</div>}
      <div
        ref={gridRef}
        className="ws-grid"
        style={{ gridTemplateColumns: `repeat(${puzzle.size}, 1fr)` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {puzzle.grid.flatMap((row, r) =>
          row.map((ch, c) => (
            <div
              key={`${r}-${c}`}
              data-r={r}
              data-c={c}
              className={`ws-cell${foundCells.has(`${r},${c}`) ? ' found' : ''}${dragSet.has(`${r},${c}`) ? ' drag' : ''}`}
            >
              {ch}
            </div>
          )),
        )}
      </div>

      <ul className="ws-words">
        {puzzle.words.map((w) => (
          <li key={w.answer} className={found.includes(w.answer) ? 'done' : ''}>
            {found.includes(w.answer) ? `✓ ${w.answer}` : `${w.clue} (${w.answer.length})`}
          </li>
        ))}
      </ul>
    </div>
  );
}
