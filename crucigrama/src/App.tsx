import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrosswordGame } from './screens/Crossword';
import { WordSearchGame } from './screens/WordSearch';
import { Finish } from './screens/Finish';
import { GAMES, dayKey, fmtTime, weekStart, type GameKind } from './lib/scoring';
import { loadProfile, saveProfile, type Profile, type Result } from './lib/store';
import { online, pullResults, pushResult } from './lib/sync';

type View = { name: 'home' } | { name: 'play'; game: GameKind } | { name: 'finish'; result: Result };

function Setup({ onSave }: { onSave: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const ok = name.trim().length > 0 && room.trim().length >= 3;
  return (
    <div className="setup">
      <h1>🧩 Crucigrama de a dos</h1>
      <p>Poné tu nombre y un código de sala que compartan (el mismo para los dos).</p>
      <input placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
      <input
        placeholder="Código de sala (ej: nosotros2026)"
        value={room}
        onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\s/g, ''))}
        maxLength={30}
      />
      <button className="btn primary" disabled={!ok} onClick={() => onSave({ name: name.trim(), room: room.trim() })}>
        Empezar
      </button>
      {!online && <p className="muted">Sin servidor configurado: los puntos se comparten con el botón “Mandar mi resultado”.</p>}
    </div>
  );
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [view, setView] = useState<View>({ name: 'home' });
  const [results, setResults] = useState<Result[]>([]);
  const today = dayKey();

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
    const totals = new Map<string, { week: number; all: number; todayPts: number }>();
    for (const r of results) {
      const t = totals.get(r.player) ?? { week: 0, all: 0, todayPts: 0 };
      t.all += r.points;
      if (weekStart(r.day) === wk) t.week += r.points;
      if (r.day === today) t.todayPts += r.points;
      totals.set(r.player, t);
    }
    return [...totals.entries()].sort((a, b) => b[1].week - a[1].week);
  }, [results, today]);

  if (!profile) {
    return <Setup onSave={(p) => { saveProfile(p); setProfile(p); }} />;
  }

  if (view.name === 'play') {
    const Game = view.game === 'crossword' ? CrosswordGame : WordSearchGame;
    return (
      <Game
        day={today}
        onBack={() => setView({ name: 'home' })}
        onDone={(s, p) => void finish(view.game, s, p)}
      />
    );
  }

  const mine = (g: GameKind) => results.find((r) => r.player === profile.name && r.day === today && r.game === g);
  const todays = (g: GameKind) => results.filter((r) => r.day === today && r.game === g).sort((a, b) => b.points - a.points);

  return (
    <div className="home">
      {view.name === 'finish' && <Finish result={view.result} onClose={() => setView({ name: 'home' })} />}
      <h1>🧩 Hola, {profile.name}</h1>
      <p className="muted">Sala <b>{profile.room}</b> · {today}</p>

      <h2>Juegos de hoy</h2>
      {(Object.keys(GAMES) as GameKind[]).map((g) => {
        const done = mine(g);
        return (
          <section className="card" key={g}>
            <div className="card-head">
              <strong>{GAMES[g].label}</strong>
              {done ? <span className="badge">✓ {done.points} pts · {fmtTime(done.seconds)}</span> : <span className="muted">hasta {GAMES[g].base + GAMES[g].base / 2} pts</span>}
            </div>
            {todays(g).map((r) => (
              <div className="row" key={r.player}>
                <span>{r.player}</span>
                <span>{fmtTime(r.seconds)} · <b>{r.points}</b></span>
              </div>
            ))}
            {!done && (
              <button className="btn primary" onClick={() => setView({ name: 'play', game: g })}>
                Jugar
              </button>
            )}
          </section>
        );
      })}

      <h2>Ranking de la semana</h2>
      <section className="card">
        {board.length === 0 && <p className="muted">Todavía nadie jugó esta semana.</p>}
        {board.map(([player, t], i) => (
          <div className="row" key={player}>
            <span>{i === 0 ? '👑 ' : ''}{player}</span>
            <span><b>{t.week}</b> pts <span className="muted">· total {t.all}</span></span>
          </div>
        ))}
      </section>

      <button className="link" onClick={() => { try { localStorage.removeItem('cg:profile'); } catch { /* ok */ } setProfile(null); }}>
        Cambiar nombre o sala
      </button>
    </div>
  );
}
