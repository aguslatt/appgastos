import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrosswordGame } from './screens/Crossword';
import { Finish } from './screens/Finish';
import { Avatar, GridThumb, Icon } from './components';
import { buildCrossword } from './lib/crossword';
import { dayKey, fmtTime, longDate, shortWeekday } from './lib/scoring';
import { computeStats, playerColor, MAX_POINTS, type PlayerStats } from './lib/stats';
import { loadProfile, saveProfile, type Profile, type Result } from './lib/store';
import { online, pullResults, pushResult } from './lib/sync';

type Tab = 'play' | 'points';
type View = { name: 'home' } | { name: 'play' } | { name: 'finish'; result: Result };

function Setup({ onSave }: { onSave: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const ok = name.trim().length > 0 && room.trim().length >= 3;
  return (
    <div className="page">
      <div className="brand">
        <span className="logo" aria-hidden><i /><i /><i /><i /></span>
        <h1>Crucigrama<br />de a dos</h1>
        <p className="muted">Un crucigrama nuevo cada día. Jueguen contra reloj y junten puntos en el grupo.</p>
      </div>
      <section className="card form">
        <label htmlFor="name">Tu nombre</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="off" />
        <label htmlFor="room">Código del grupo</label>
        <input
          id="room"
          placeholder="ej: agus-y-juli"
          value={room}
          onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\s/g, ''))}
          maxLength={30}
          autoComplete="off"
        />
        <p className="muted">Los dos escriben el mismo código y cada uno su nombre: así quedan en el mismo grupo.</p>
        <button className="btn primary" disabled={!ok} onClick={() => onSave({ name: name.trim(), room: room.trim() })}>
          Entrar al grupo
        </button>
        {!online && <p className="muted">Sin servidor configurado: los puntos se comparten con el botón “Mandar mi resultado”.</p>}
      </section>
    </div>
  );
}

function PlayerCard({ s, rank, color, max, me }: { s: PlayerStats; rank: number; color: string; max: number; me: boolean }) {
  const peak = Math.max(1, ...s.last7.map((d) => d.points));
  return (
    <article className="card player">
      <div className="player-head">
        <Avatar name={s.name} color={color} size={48} />
        <div>
          <h3>{s.name}{me && <span className="you">vos</span>}</h3>
          <p className="muted">{rank === 0 && s.week > 0 ? 'Lidera la semana' : `Puesto ${rank + 1} de la semana`}</p>
        </div>
        <p className="big">{s.week}<small> pts</small></p>
      </div>
      <div className="meter"><div style={{ width: `${(s.week / max) * 100}%`, background: color }} /></div>
      <dl className="stats">
        <div><dt>Total</dt><dd>{s.total}</dd></div>
        <div><dt>Partidas</dt><dd>{s.played}</dd></div>
        <div><dt>Mejor tiempo</dt><dd>{s.best ? fmtTime(s.best) : '–'}</dd></div>
        <div><dt>Racha</dt><dd>{s.streak} {s.streak === 1 ? 'día' : 'días'}</dd></div>
      </dl>
      <div className="week" aria-label="Últimos 7 días">
        {s.last7.map((d) => (
          <div key={d.day} className="week-col">
            <div className="week-bar"><i style={{ height: `${d.points ? Math.max(10, (d.points / peak) * 100) : 0}%`, background: color }} /></div>
            <span>{shortWeekday(d.day)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [view, setView] = useState<View>({ name: 'home' });
  const [tab, setTab] = useState<Tab>('play');
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

  const stats = useMemo(() => computeStats(results, profile ? [profile.name] : [], today), [results, profile, today]);
  const members = stats.map((s) => s.name);

  if (!profile) {
    return <Setup onSave={(p) => { saveProfile(p); setProfile(p); }} />;
  }

  const finish = async (seconds: number, points: number) => {
    const result: Result = { room: profile.room, player: profile.name, day: today, game: 'crossword', seconds, points };
    await pushResult(result);
    await refresh();
    setView({ name: 'finish', result });
  };

  if (view.name === 'play') {
    return <CrosswordGame day={today} onBack={() => setView({ name: 'home' })} onDone={(s, p) => void finish(s, p)} />;
  }

  const todays = results.filter((r) => r.game === 'crossword' && r.day === today);
  const mine = todays.find((r) => r.player === profile.name);
  const fastest = todays.length > 1 ? Math.min(...todays.map((r) => r.seconds)) : null;
  const max = Math.max(1, ...stats.map((s) => s.week));
  const color = (n: string) => playerColor(n, members);
  const history = [...results].filter((r) => r.game === 'crossword').sort((a, b) => b.day.localeCompare(a.day) || b.points - a.points);
  const days = [...new Set(history.map((r) => r.day))].slice(0, 14);

  return (
    <div className="page with-nav">
      {view.name === 'finish' && (
        <Finish
          result={view.result}
          others={todays.filter((r) => r.player !== profile.name)}
          onClose={() => { setView({ name: 'home' }); setTab('points'); }}
        />
      )}

      {tab === 'play' ? (
        <>
          <header className="top">
            <div>
              <p className="muted">{longDate(today)}</p>
              <h1>Hola, {profile.name}</h1>
            </div>
            <Avatar name={profile.name} color={color(profile.name)} size={44} />
          </header>

          <section className="hero">
            <svg className="hero-grid" viewBox="0 0 100 100" aria-hidden />
            <GridThumb puzzle={puzzle} />
            <p className="hero-kicker">Crucigrama de hoy</p>
            <h2>{puzzle.words.length} palabras para cruzar</h2>
            <p className="hero-meta"><span><Icon name="clock" size={16} /> unos 25 min</span><span><Icon name="trophy" size={16} /> hasta {MAX_POINTS} pts</span></p>
            {mine ? (
              <div className="hero-done">
                <Icon name="check" /> Completado en {fmtTime(mine.seconds)} · <b>{mine.points} pts</b>
              </div>
            ) : (
              <button className="btn accent" onClick={() => setView({ name: 'play' })}>
                <Icon name="play" size={18} /> Jugar ahora
              </button>
            )}
          </section>

          <section>
            <h2 className="h2">Hoy en el grupo</h2>
            <div className="card list">
              {members.map((n) => {
                const r = todays.find((x) => x.player === n);
                return (
                  <div className="member" key={n}>
                    <Avatar name={n} color={color(n)} />
                    <div>
                      <strong>{n}{n === profile.name && <span className="you">vos</span>}</strong>
                      <p className="muted">{r ? `${fmtTime(r.seconds)} · ${r.points} pts` : 'Todavía no jugó'}</p>
                    </div>
                    {r && fastest === r.seconds && <span className="badge"><Icon name="flame" size={14} /> Más rápido</span>}
                    {r && fastest !== r.seconds && <Icon name="check" />}
                  </div>
                );
              })}
              {members.length < 2 && (
                <p className="muted invite">Pasale el código <b>{profile.room}</b> a tu pareja para que entre al grupo.</p>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <header className="top">
            <div>
              <p className="muted">Grupo <b>{profile.room}</b></p>
              <h1>Puntos</h1>
            </div>
          </header>
          <section className="stack">
            {stats.map((s, i) => (
              <PlayerCard key={s.name} s={s} rank={i} color={color(s.name)} max={max} me={s.name === profile.name} />
            ))}
          </section>
          <section>
            <h2 className="h2">Historial</h2>
            {days.length === 0 && <p className="muted">Todavía no hay partidas. La primera marca el ritmo.</p>}
            {days.map((d) => (
              <div className="card day" key={d}>
                <p className="day-title">{longDate(d)}</p>
                {history.filter((r) => r.day === d).map((r) => (
                  <div className="day-row" key={r.player}>
                    <Avatar name={r.player} color={color(r.player)} size={28} />
                    <span>{r.player}</span>
                    <span className="muted">{fmtTime(r.seconds)}</span>
                    <b>{r.points}</b>
                  </div>
                ))}
              </div>
            ))}
          </section>
          <button className="link" onClick={() => { try { localStorage.removeItem('cg:profile'); } catch { /* ok */ } setProfile(null); }}>
            Cambiar de perfil o de grupo
          </button>
        </>
      )}

      <nav className="tabbar" aria-label="Secciones">
        <button className={tab === 'play' ? 'on' : ''} onClick={() => setTab('play')}><Icon name="grid" /> Jugar</button>
        <button className={tab === 'points' ? 'on' : ''} onClick={() => setTab('points')}><Icon name="trophy" /> Puntos</button>
      </nav>
    </div>
  );
}
