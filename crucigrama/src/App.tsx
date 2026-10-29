import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrosswordGame } from './screens/Crossword';
import { WordSearchGame } from './screens/WordSearch';
import { Finish } from './screens/Finish';
import { GridThumb } from './components';
import { buildCrossword } from './lib/crossword';
import { editionNumber, longDate } from './lib/edition';
import { GAMES, dayKey, fmtTime, weekStart, type GameKind } from './lib/scoring';
import { loadProfile, saveProfile, type Profile, type Result } from './lib/store';
import { online, pullResults, pushResult } from './lib/sync';

type View = { name: 'home' } | { name: 'play'; game: GameKind } | { name: 'finish'; result: Result };

function Masthead({ day }: { day: string }) {
  return (
    <header className="masthead">
      <div className="strip">
        <span>Edición N.º {editionNumber(day)}</span>
        <span>{longDate(day)}</span>
      </div>
      <h1>
        Crucigrama <em>de a dos</em>
      </h1>
    </header>
  );
}

function Setup({ onSave }: { onSave: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const ok = name.trim().length > 0 && room.trim().length >= 3;
  return (
    <div className="page">
      <Masthead day={dayKey()} />
      <section className="setup">
        <p className="lede">Un crucigrama críptico y una sopa de letras nuevos cada día. Ganás puntos por rapidez y el que más junta en la semana se lleva la corona.</p>
        <label htmlFor="name">Tu nombre</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="off" />
        <label htmlFor="room">Código de sala (el mismo para los dos)</label>
        <input
          id="room"
          placeholder="ej: nosotros2026"
          value={room}
          onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\s/g, ''))}
          maxLength={30}
          autoComplete="off"
        />
        <button className="btn primary" disabled={!ok} onClick={() => onSave({ name: name.trim(), room: room.trim() })}>
          Entrar a la sala
        </button>
        {!online && <p className="muted">Sin servidor configurado: los puntos se comparten con el botón “Mandar mi resultado”.</p>}
      </section>
    </div>
  );
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [view, setView] = useState<View>({ name: 'home' });
  const [results, setResults] = useState<Result[]>([]);
  const today = dayKey();
  const puzzle = useMemo(() => buildCrossword(today), [today]);

  const refresh = useCallback(async () => {
    if (profile) setResults(await pullResults(profile.room));
  }, [profile]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const finish = async (game: GameKind, seconds: number, points: number) => {
    if (!profile) return;
    const result: Result = { room: profile.room, player: profile.name, day: today, game, seconds, points };
    await pushResult(result);
    await refresh();
    setView({ name: 'finish', result });
  };

  const board = useMemo(() => {
    const wk = weekStart(today);
    const totals = new Map<string, { week: number; all: number }>();
    for (const r of results) {
      const t = totals.get(r.player) ?? { week: 0, all: 0 };
      t.all += r.points;
      if (weekStart(r.day) === wk) t.week += r.points;
      totals.set(r.player, t);
    }
    return [...totals.entries()].sort((a, b) => b[1].week - a[1].week);
  }, [results, today]);

  if (!profile) {
    return <Setup onSave={(p) => { saveProfile(p); setProfile(p); }} />;
  }

  if (view.name === 'play') {
    const Game = view.game === 'crossword' ? CrosswordGame : WordSearchGame;
    return <Game day={today} onBack={() => setView({ name: 'home' })} onDone={(s, p) => void finish(view.game, s, p)} />;
  }

  const mine = (g: GameKind) => results.find((r) => r.player === profile.name && r.day === today && r.game === g);
  const todays = (g: GameKind) => results.filter((r) => r.day === today && r.game === g).sort((a, b) => b.points - a.points);
  const max = Math.max(1, ...board.map(([, t]) => t.week));
  const [first, second] = board;
  const gap = first && second ? first[1].week - second[1].week : 0;
  const pcolor = (p: string) => (p === profile.name ? 'me' : 'them');

  return (
    <div className="page">
      {view.name === 'finish' && <Finish result={view.result} onClose={() => setView({ name: 'home' })} />}
      <Masthead day={today} />

      <section className="duel" aria-label="Duelo de la semana">
        <div className="section-head">
          <h2>El duelo de la semana</h2>
          <span className="muted">sala <b>{profile.room}</b></span>
        </div>
        {board.length === 0 && <p className="muted">Todavía nadie jugó esta semana. El primero en terminar marca el ritmo.</p>}
        {board.map(([player, t], i) => (
          <div className={`duel-row ${pcolor(player)}`} key={player}>
            <div className="duel-name">
              <span>{i === 0 && board.length > 1 ? '♛ ' : ''}{player}</span>
              <span className="pts">{t.week}<small> pts</small></span>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(t.week / max) * 100}%` }} /></div>
          </div>
        ))}
        {first && second && (
          <p className="gap">
            {gap === 0 ? 'Empate técnico.' : <><b>{first[0]}</b> va {gap} pts adelante.</>}
          </p>
        )}
        {board.length === 1 && <p className="muted">Mandale a tu novio el código <b>{profile.room}</b> para que entre a la sala.</p>}
      </section>

      <div className="section-head"><h2>Las secciones de hoy</h2></div>
      {(Object.keys(GAMES) as GameKind[]).map((g) => {
        const done = mine(g);
        return (
          <article className={`edition ${g}`} key={g}>
            <div className="edition-top">
              {g === 'crossword' ? <GridThumb puzzle={puzzle} /> : <div className="ws-thumb" aria-hidden>{'SOPA'.split('').map((c, i) => <i key={i}>{c}</i>)}</div>}
              <div>
                <h3>{g === 'crossword' ? 'El Críptico' : 'La Sopa'}</h3>
                <p className="muted">
                  {g === 'crossword'
                    ? `${puzzle.words.length} palabras con anagramas, sumas y otras trampas`
                    : '12 palabras escondidas, también al revés'}
                </p>
                <p className="worth">hasta {GAMES[g].base + GAMES[g].base / 2} pts</p>
              </div>
            </div>
            {todays(g).map((r) => (
              <div className={`row ${pcolor(r.player)}`} key={r.player}>
                <span><i className="dot" /> {r.player}</span>
                <span>{fmtTime(r.seconds)} · <b>{r.points}</b> pts</span>
              </div>
            ))}
            {!done ? (
              <button className="btn primary" onClick={() => setView({ name: 'play', game: g })}>
                {g === 'crossword' ? 'Resolver el crucigrama' : 'Buscar las palabras'}
              </button>
            ) : (
              <p className="muted center">Ya jugaste esta sección hoy. Mañana, otra edición.</p>
            )}
          </article>
        );
      })}

      <button className="link" onClick={() => { try { localStorage.removeItem('cg:profile'); } catch { /* ok */ } setProfile(null); }}>
        Cambiar nombre o sala
      </button>
    </div>
  );
}
