import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCrossword, wordCells, type Dir, type Placed } from '../lib/crossword';
import { HINT_COST, fmtTime, score } from '../lib/scoring';
import { useGameClock } from '../hooks';

interface Props {
  day: string;
  onDone: (seconds: number, points: number) => void;
  onBack: () => void;
}

const KEYS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function CrosswordGame({ day, onDone, onBack }: Props) {
  const puzzle = useMemo(() => buildCrossword(day), [day]);
  const n = puzzle.size;
  const key = `crossword:${day}`;
  const [finished, setFinished] = useState(false);
  const { elapsed, saved, save } = useGameClock(key, !finished);
  const [letters, setLetters] = useState<string[][]>(
    () => (saved?.data as string[][] | undefined) ?? Array.from({ length: n }, () => Array<string>(n).fill('')),
  );
  const [hints, setHints] = useState(saved?.hints ?? 0);
  const [sel, setSel] = useState<[number, number]>(() => {
    const w = puzzle.words[0]!;
    return [w.row, w.col];
  });
  const [dir, setDir] = useState<Dir>('across');
  const [zoom, setZoom] = useState(false);

  const wordAt = useCallback(
    (r: number, c: number, d: Dir): Placed | undefined =>
      puzzle.words.find((w) => w.dir === d && wordCells(w).some(([wr, wc]) => wr === r && wc === c)),
    [puzzle],
  );
  const active = wordAt(sel[0], sel[1], dir) ?? wordAt(sel[0], sel[1], dir === 'across' ? 'down' : 'across');
  const activeCells = active ? wordCells(active) : [];
  const activeDir = active?.dir ?? dir;

  useEffect(() => {
    if (!finished && elapsed % 5 === 0) save(hints, letters);
  }, [elapsed, finished, hints, letters, save]);

  const check = (grid: string[][]) => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (puzzle.cells[r]![c] && grid[r]![c] !== puzzle.cells[r]![c]) return;
    }
    setFinished(true);
    onDone(elapsed, score('crossword', elapsed, hints));
  };

  const advance = (r: number, c: number, back = false) => {
    const w = active;
    if (!w) return;
    const cells = wordCells(w);
    const i = cells.findIndex(([wr, wc]) => wr === r && wc === c);
    const next = cells[i + (back ? -1 : 1)];
    if (next) setSel(next);
  };

  const type = (ch: string) => {
    if (finished || !puzzle.cells[sel[0]]![sel[1]]) return;
    const grid = letters.map((row) => row.slice());
    grid[sel[0]]![sel[1]] = ch;
    setLetters(grid);
    advance(sel[0], sel[1]);
    check(grid);
  };
  const erase = () => {
    if (finished) return;
    const grid = letters.map((row) => row.slice());
    if (grid[sel[0]]![sel[1]]) grid[sel[0]]![sel[1]] = '';
    else advance(sel[0], sel[1], true);
    setLetters(grid);
  };
  const hint = () => {
    const [r, c] = sel;
    if (finished || letters[r]![c] === puzzle.cells[r]![c]) return;
    const grid = letters.map((row) => row.slice());
    grid[r]![c] = puzzle.cells[r]![c]!;
    setLetters(grid);
    setHints((h) => h + 1);
    advance(r, c);
    check(grid);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) type(e.key.toUpperCase());
      else if (e.key === 'Backspace') erase();
      else if (e.key === ' ' || e.key === 'Tab') {
        e.preventDefault();
        setDir((d) => (d === 'across' ? 'down' : 'across'));
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const nr = sel[0] + dr, nc = sel[1] + dc;
        if (puzzle.cells[nr]?.[nc]) {
          setSel([nr, nc]);
          if (dr) setDir('down');
          if (dc) setDir('across');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tap = (r: number, c: number) => {
    if (!puzzle.cells[r]![c]) return;
    if (sel[0] === r && sel[1] === c) setDir((d) => (d === 'across' ? 'down' : 'across'));
    else {
      setSel([r, c]);
      if (!wordAt(r, c, dir)) setDir(dir === 'across' ? 'down' : 'across');
    }
  };

  const pickClue = (w: Placed) => {
    setSel([w.row, w.col]);
    setDir(w.dir);
  };

  const list = (d: Dir) => puzzle.words.filter((w) => w.dir === d).sort((a, b) => a.n - b.n);

  return (
    <div className="game">
      <header className="bar">
        <button className="link" onClick={onBack}>← Volver</button>
        <strong>Crucigrama</strong>
        <span className="timer">{fmtTime(elapsed)}</span>
      </header>

      <div className="clue-now">
        {active ? (
          <>
            <b>{active.n} {activeDir === 'across' ? '→' : '↓'}</b> {active.clue} <span className="muted">({active.answer.length})</span>
          </>
        ) : 'Tocá un casillero'}
      </div>

      <div className="cw-scroll">
      <div className="cw-grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, width: zoom ? `${n * 34}px` : '100%' }}>
        {puzzle.cells.flatMap((row, r) =>
          row.map((cell, c) => {
            if (!cell) return <div key={`${r}-${c}`} className="cell blank" />;
            const isSel = sel[0] === r && sel[1] === c;
            const inWord = activeCells.some(([wr, wc]) => wr === r && wc === c);
            return (
              <button
                key={`${r}-${c}`}
                className={`cell${isSel ? ' sel' : inWord ? ' word' : ''}`}
                onClick={() => tap(r, c)}
                aria-label={`fila ${r + 1} columna ${c + 1}`}
              >
                {puzzle.numbers[r]![c] && <i>{puzzle.numbers[r]![c]}</i>}
                <span>{letters[r]![c]}</span>
              </button>
            );
          }),
        )}
      </div>
      </div>

      <div className="actions">
        <button className="btn" onClick={() => setZoom((z) => !z)}>🔍 {zoom ? 'Achicar' : 'Agrandar'}</button>
        <button className="btn" onClick={hint}>💡 Pista (−{HINT_COST} pts)</button>
        <button className="btn" onClick={() => setDir((d) => (d === 'across' ? 'down' : 'across'))}>
          Girar {activeDir === 'across' ? '↓' : '→'}
        </button>
      </div>

      <div className="osk">
        {KEYS.map((row, i) => (
          <div key={i} className="osk-row">
            {row.split('').map((k) => (
              <button key={k} onClick={() => type(k)}>{k}</button>
            ))}
            {i === 2 && <button className="wide" onClick={erase}>⌫</button>}
          </div>
        ))}
      </div>

      <div className="clues">
        {(['across', 'down'] as const).map((d) => (
          <section key={d}>
            <h3>{d === 'across' ? 'Horizontales →' : 'Verticales ↓'}</h3>
            {list(d).map((w) => (
              <button
                key={`${w.n}${d}`}
                className={`clue${active === w ? ' on' : ''}`}
                onClick={() => pickClue(w)}
              >
                <b>{w.n}</b> {w.clue} <span className="muted">({w.answer.length})</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
