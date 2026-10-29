import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCrossword, wordCells, type Dir, type Placed } from '../lib/crossword';
import { HINT_COST, fmtTime, score } from '../lib/scoring';
import { useGameClock } from '../hooks';
import { Icon, Tile } from '../components';
import { isMuted, play, setMuted } from '../lib/sound';

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
  const [dir, setDir] = useState<Dir>(() => puzzle.words[0]!.dir);
  const [zoom, setZoom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<Dir>('across');
  const [muted, setMutedState] = useState(isMuted);
  const [popping, setPopping] = useState<Set<string>>(new Set());

  const wordKey = (w: Placed) => `${w.n}${w.dir}`;
  const solved = useMemo(() => {
    const s = new Set<string>();
    for (const w of puzzle.words) {
      if (wordCells(w).every(([r, c], i) => letters[r]![c] === w.answer[i])) s.add(wordKey(w));
    }
    return s;
  }, [letters, puzzle]);
  const locked = useMemo(() => {
    const s = new Set<string>();
    for (const w of puzzle.words) {
      if (solved.has(wordKey(w))) for (const [r, c] of wordCells(w)) s.add(`${r},${c}`);
    }
    return s;
  }, [solved, puzzle]);
  const prevSolved = useRef(solved);

  const wordAt = useCallback(
    (r: number, c: number, d: Dir): Placed | undefined =>
      puzzle.words.find((w) => w.dir === d && wordCells(w).some(([wr, wc]) => wr === r && wc === c)),
    [puzzle],
  );
  const active = wordAt(sel[0], sel[1], dir) ?? wordAt(sel[0], sel[1], dir === 'across' ? 'down' : 'across');
  const activeCells = active ? wordCells(active) : [];
  const activeDir = active?.dir ?? dir;

  useEffect(() => {
    const fresh = puzzle.words.filter((w) => solved.has(wordKey(w)) && !prevSolved.current.has(wordKey(w)));
    prevSolved.current = solved;
    if (!fresh.length) return;
    const cells = new Set<string>();
    for (const w of fresh) for (const [r, c] of wordCells(w)) cells.add(`${r},${c}`);
    setPopping(cells);
    setToast(fresh[0]!.answer);
    play('ok');
    try { navigator.vibrate?.(40); } catch { /* sin vibración */ }
    const t1 = setTimeout(() => setPopping(new Set()), 700);
    const t2 = setTimeout(() => setToast(''), 1600);
    // Salta a la próxima palabra que falta resolver.
    const order = puzzle.words;
    const from = order.indexOf(fresh[0]!);
    const next = [...order.slice(from + 1), ...order.slice(0, from)].find((w) => !solved.has(wordKey(w)));
    if (next) {
      const cells2 = wordCells(next);
      const empty = cells2.find(([r, c]) => letters[r]![c] !== puzzle.cells[r]![c]) ?? cells2[0]!;
      setSel(empty);
      setDir(next.dir);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved]);

  useEffect(() => {
    if (!finished && elapsed % 5 === 0) save(hints, letters);
  }, [elapsed, finished, hints, letters, save]);

  const check = (grid: string[][]) => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (puzzle.cells[r]![c] && grid[r]![c] !== puzzle.cells[r]![c]) return;
    }
    setFinished(true);
    play('win');
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
    if (locked.has(`${sel[0]},${sel[1]}`)) return advance(sel[0], sel[1]);
    const grid = letters.map((row) => row.slice());
    grid[sel[0]]![sel[1]] = ch;
    setLetters(grid);
    advance(sel[0], sel[1]);
    check(grid);
  };
  const erase = () => {
    if (finished) return;
    if (locked.has(`${sel[0]},${sel[1]}`)) return advance(sel[0], sel[1], true);
    const grid = letters.map((row) => row.slice());
    if (grid[sel[0]]![sel[1]]) grid[sel[0]]![sel[1]] = '';
    else advance(sel[0], sel[1], true);
    setLetters(grid);
  };
  const hint = () => {
    if (finished) return;
    const wrong = (r: number, c: number) => letters[r]![c] !== puzzle.cells[r]![c];
    // Revela el casillero elegido si está mal; si no, la primera letra que falte de la palabra.
    const target = wrong(sel[0], sel[1]) ? sel : activeCells.find(([r, c]) => wrong(r, c));
    if (!target) return;
    const [r, c] = target;
    const grid = letters.map((row) => row.slice());
    grid[r]![c] = puzzle.cells[r]![c]!;
    setLetters(grid);
    setHints((h) => h + 1);
    const next = activeCells.find(([wr, wc]) => (wr !== r || wc !== c) && grid[wr]![wc] !== puzzle.cells[wr]![wc]);
    if (next) setSel(next);
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

  // Con la grilla agrandada, el scroll acompaña al casillero elegido.
  useEffect(() => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-rc="${sel[0]},${sel[1]}"]`);
    if (!box || !el || !zoom) return;
    box.scrollTo({
      left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2,
      top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2,
      behavior: 'smooth',
    });
  }, [sel, zoom]);

  const pct = Math.round((solved.size / puzzle.words.length) * 100);

  return (
    <div className="page game">
      <header className="game-bar">
        <button className="icon-btn" onClick={onBack} aria-label="Salir"><Icon name="close" /></button>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <button className="icon-btn" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label={muted ? 'Activar sonido' : 'Silenciar'}>
          <Icon name={muted ? 'mute' : 'sound'} size={20} />
        </button>
      </header>
      <div className="game-sub">
        <span><b>{solved.size}</b> de {puzzle.words.length} palabras</span>
        <span className="timer"><Icon name="clock" size={16} /> {fmtTime(elapsed)}</span>
      </div>

      {toast && (
        <div className="banner" role="status">
          <Tile name="Cruci" color="var(--go)" size={52} mood="cheer" />
          <div><strong>¡Muy bien!</strong><span>{toast}</span></div>
        </div>
      )}
      <div className="clue-now">
        {active ? (
          <>
            <div className="clue-meta">
              <span className="pill">{active.n} · {activeDir === 'across' ? 'Horizontal' : 'Vertical'}</span>
              <span className="muted">{active.answer.length} letras</span>
            </div>
            <p>{active.clue}</p>
          </>
        ) : (
          <p className="muted">Tocá un casillero para ver su consigna.</p>
        )}
      </div>

      <div className="cw-scroll" ref={scrollRef}>
        <div
          className={`cw-grid${zoom ? ' big' : ''}`}
          style={{
            ['--cs' as string]: zoom ? '34px' : `calc((100cqw - ${(n - 1) * 3}px) / ${n})`,
            gridTemplateColumns: `repeat(${n}, var(--cs))`,
            gridAutoRows: 'var(--cs)',
          }}
        >
          {puzzle.cells.flatMap((row, r) =>
            row.map((cell, c) => {
              if (!cell) return <div key={`${r}-${c}`} className="cell blank" />;
              const isSel = sel[0] === r && sel[1] === c;
              const inWord = activeCells.some(([wr, wc]) => wr === r && wc === c);
              const k = `${r},${c}`;
              return (
                <button
                  key={`${r}-${c}`}
                  data-rc={k}
                  className={`cell${isSel ? ' sel' : inWord ? ' word' : ''}${locked.has(k) ? ' solved' : ''}${popping.has(k) ? ' pop' : ''}`}
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
        <button className="chip-btn" onClick={() => setZoom((z) => !z)}><Icon name="zoom" /> {zoom ? 'Ver todo' : 'Agrandar'}</button>
        <button className="chip-btn" onClick={hint}><Icon name="bulb" /> Pista <small>−{HINT_COST}</small></button>
        <button className="chip-btn" onClick={() => setDir((d) => (d === 'across' ? 'down' : 'across'))}>
          <Icon name="swap" /> {activeDir === 'across' ? 'Vertical' : 'Horizontal'}
        </button>
      </div>

      <div className="osk">
        {KEYS.map((row, i) => (
          <div key={i} className="osk-row">
            {row.split('').map((k) => (
              <button key={k} onClick={() => type(k)}>{k}</button>
            ))}
            {i === 2 && <button className="wide" onClick={erase} aria-label="Borrar"><Icon name="delete" /></button>}
          </div>
        ))}
      </div>

      <section className="clues">
        <div className="segmented" role="tablist">
          {(['across', 'down'] as const).map((d) => (
            <button key={d} role="tab" aria-selected={tab === d} className={tab === d ? 'on' : ''} onClick={() => setTab(d)}>
              {d === 'across' ? 'Horizontales' : 'Verticales'}
              <small>{list(d).filter((w) => solved.has(wordKey(w))).length}/{list(d).length}</small>
            </button>
          ))}
        </div>
        {list(tab).map((w) => (
          <button
            key={`${w.n}${tab}`}
            className={`clue${active === w ? ' on' : ''}${solved.has(wordKey(w)) ? ' solved' : ''}`}
            onClick={() => { pickClue(w); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          >
            <b>{solved.has(wordKey(w)) ? <Icon name="check" /> : w.n}</b>
            <span>
              {w.clue} <span className="muted">({w.answer.length})</span>
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}
