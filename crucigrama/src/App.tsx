import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrosswordGame } from './screens/Crossword';
import { Finish } from './screens/Finish';
import { Flame, Icon, Tile } from './components';
import { buildCrossword } from './lib/crossword';
import { dayKey, fmtTime, longDate, shortWeekday } from './lib/scoring';
import { computeStats, playerColor, MAX_POINTS, type PlayerStats } from './lib/stats';
import { exportBackup, importBackup, loadProfile, saveProfile, type Profile, type Result } from './lib/store';
import { online, pullResults, pushResult } from './lib/sync';

type Tab = 'play' | 'points';
type View = { name: 'home' } | { name: 'play' } | { name: 'finish'; result: Result };

function Setup({ onSave }: { onSave: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const ok = name.trim().length > 0 && room.trim().length >= 3;
  return (
    <div className="page">
      <section className="hero setup-hero">
        <div className="duo">
          <Tile name="Cruci" color="var(--p1)" size={84} mood="cheer" />
          <Tile name="Zuri" color="var(--p2)" size={84} mood="happy" />
        </div>
        <h1>Crucigrama<br />de a dos</h1>
        <p>Un crucigrama nuevo cada día. Jueguen contra reloj y junten puntos en el grupo.</p>
      </section>
      <section className="card form">
        <label htmlFor="name">Tu nombre</label>
        <input id="name" type="text" inputMode="text" enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="off" />
        <label htmlFor="room">Código del grupo</label>
        <input
          id="room"
          type="text"
          inputMode="text"
          enterKeyHint="go"
          placeholder="ej: agus-y-juli"
          value={room}
          onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          maxLength={30}
          autoComplete="off"
        />
        <p className="muted">Los dos escriben el mismo código (los espacios se vuelven guiones) y cada uno su nombre: así quedan en el mismo grupo.</p>
        <button className="btn go" disabled={!ok} onClick={() => onSave({ name: name.trim(), room: room.trim() })}>
          Entrar al grupo
        </button>
        {!online && <p className="muted">Sin servidor configurado: los puntos se comparten con el botón “Mandar mi resultado”.</p>}
      </section>
    </div>
  );
}

function ProfileCard({ s, rank, color, max, me, label }: { s: PlayerStats; rank: number; color: string; max: number; me: boolean; label: string }) {
  const peak = Math.max(1, ...s.last7.map((d) => d.points));
  return (
    <article className="card profile">
      <div className="profile-head">
        <Tile name={s.name} color={color} size={64} mood={s.played ? 'happy' : 'sleep'} />
        <div>
          <h3>{s.name}{me && <span className="you">vos</span>}</h3>
          <p className="muted">{rank === 0 && s.period > 0 ? `Va primero ${label}` : `Puesto ${rank + 1} ${label}`}</p>
        </div>
        <p className="big">{s.period}<small>pts</small></p>
      </div>
      <div className="meter"><div style={{ width: `${(s.period / max) * 100}%`, background: color }} /></div>
      <dl className="stat-grid">
        <div className="stat"><dt><Flame size={18} lit={s.streak > 0} /> Racha</dt><dd>{s.streak} {s.streak === 1 ? 'día' : 'días'}</dd></div>
        <div className="stat"><dt><Icon name="trophy" size={16} /> Total</dt><dd>{s.total} pts</dd></div>
        <div className="stat"><dt><Icon name="clock" size={16} /> Mejor tiempo</dt><dd>{s.best ? fmtTime(s.best) : '–'}</dd></div>
        <div className="stat"><dt><Icon name="grid" size={16} /> Partidas</dt><dd>{s.periodPlayed} <small>de {s.played}</small></dd></div>
      </dl>
      <div className="week" aria-label="Últimos 7 días">
        {s.last7.map((d) => (
          <div key={d.day} className="week-col">
            <div className="week-bar"><i style={{ height: `${d.points ? Math.max(14, (d.points / peak) * 100) : 0}%`, background: color }} /></div>
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
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [backupMsg, setBackupMsg] = useState('');
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

  const [ym, setYm] = useState(today.slice(0, 7));
  const stats = useMemo(
    () => computeStats(results, profile ? [profile.name] : [], today, period === 'month' ? ym : undefined),
    [results, profile, today, period, ym],
  );
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

  const color = (n: string) => playerColor(n, members);
  const me = stats.find((s) => s.name === profile.name);
  const todays = results.filter((r) => r.game === 'crossword' && r.day === today);
  const mine = todays.find((r) => r.player === profile.name);
  const fastest = todays.length > 1 ? Math.min(...todays.map((r) => r.seconds)) : null;
  const max = Math.max(1, ...stats.map((s) => s.period));
  const history = results.filter((r) => r.game === 'crossword').sort((a, b) => b.day.localeCompare(a.day) || b.points - a.points);
  const allDays = [...new Set(history.map((r) => r.day))];
  const days = period === 'month' ? allDays.filter((d) => d.startsWith(ym)) : allDays.slice(0, 14);
  const monthLabel = (() => {
    const s = new Date(ym + '-15T12:00:00').toLocaleDateString('es', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();
  const shiftMonth = (n: number) => {
    const d = new Date(ym + '-15T12:00:00');
    d.setMonth(d.getMonth() + n);
    setYm(d.toISOString().slice(0, 7));
  };
  const periodLabel = period === 'month' ? 'en el mes' : 'esta semana';
  const monthGames = new Set(results.filter((r) => r.day.startsWith(ym)).map((r) => r.day)).size;
  const doBackup = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crucigrama-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setBackupMsg('Copia descargada.');
  };
  const doRestore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const added = importBackup(await file.text());
      await refresh();
      setBackupMsg(added ? `Recuperé ${added} ${added === 1 ? 'partida' : 'partidas'}.` : 'No había partidas nuevas.');
    } catch {
      setBackupMsg('No pude leer ese archivo.');
    }
  };
  const other = members.find((n) => n !== profile.name);

  return (
    <div className="page with-nav">
      {view.name === 'finish' && (
        <Finish
          result={view.result}
          words={puzzle.words.length}
          streak={me?.streak ?? 1}
          color={color(profile.name)}
          others={todays.filter((r) => r.player !== profile.name)}
          onClose={() => { setView({ name: 'home' }); setTab('points'); }}
        />
      )}

      {tab === 'play' ? (
        <>
          <section className="hero">
            <div className="hero-top">
              <p className="hero-date">{longDate(today)}</p>
              <span className="streak"><Flame size={22} lit={(me?.streak ?? 0) > 0} /> {me?.streak ?? 0}</span>
            </div>
            <div className="hero-main">
              <Tile name={profile.name} color={color(profile.name)} size={112} mood={mine ? 'cheer' : 'happy'} />
              <div className="bubble">
                <strong>{mine ? `¡Bien, ${profile.name}!` : `¡Hola, ${profile.name}!`}</strong>
                <span>{mine ? 'Ya completaste el de hoy. Mañana hay otro.' : `Hoy hay un crucigrama nuevo con ${puzzle.words.length} palabras.`}</span>
              </div>
            </div>
            {mine ? (
              <div className="hero-done"><Icon name="check" /> {fmtTime(mine.seconds)} · {mine.points} pts</div>
            ) : (
              <button className="btn sun big-btn" onClick={() => setView({ name: 'play' })}>¡A jugar!</button>
            )}
            {!mine && <p className="hero-note">Hasta {MAX_POINTS} pts si lo hacés rápido</p>}
          </section>

          <section>
            <h2 className="h2">Hoy en el grupo</h2>
            {members.length === 2 ? (
              <div className="card versus-card">
                {members.map((n, i) => {
                  const r = todays.find((x) => x.player === n);
                  return (
                    <div className={`vs-side${i ? ' right' : ''}`} key={n}>
                      <Tile name={n} color={color(n)} size={76} mood={r ? 'cheer' : 'sleep'} />
                      <strong>{n}</strong>
                      <span className="vs-res">{r ? `${fmtTime(r.seconds)} · ${r.points} pts` : 'Todavía no jugó'}</span>
                      {r && fastest === r.seconds && <span className="badge"><Flame size={14} /> Más rápido</span>}
                    </div>
                  );
                })}
                <span className="vs">VS</span>
              </div>
            ) : (
              <div className="card">
                {members.map((n) => {
                  const r = todays.find((x) => x.player === n);
                  return (
                    <div className="member" key={n}>
                      <Tile name={n} color={color(n)} size={48} mood={r ? 'happy' : 'sleep'} />
                      <div>
                        <strong>{n}</strong>
                        <p className="muted">{r ? `${fmtTime(r.seconds)} · ${r.points} pts` : 'Todavía no jugó'}</p>
                      </div>
                    </div>
                  );
                })}
                {!other && <p className="muted invite">Pasale el código <b>{profile.room}</b> a tu pareja para que entre al grupo.</p>}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <header className="top">
            <div>
              <h1>Puntos</h1>
              <p className="muted">Grupo <b>{profile.room}</b></p>
            </div>
          </header>
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={period === 'week'} className={period === 'week' ? 'on' : ''} onClick={() => setPeriod('week')}>Semana</button>
            <button role="tab" aria-selected={period === 'month'} className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Mes</button>
          </div>
          {period === 'month' && (
            <div className="month-nav">
              <button className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Mes anterior"><Icon name="back" /></button>
              <div><strong>{monthLabel}</strong><p className="muted">{monthGames} {monthGames === 1 ? 'día jugado' : 'días jugados'}</p></div>
              <button className="icon-btn next" onClick={() => shiftMonth(1)} disabled={ym >= today.slice(0, 7)} aria-label="Mes siguiente"><Icon name="back" /></button>
            </div>
          )}
          <section className="card board">
            {stats.map((s, i) => (
              <div className="board-row" key={s.name}>
                <span className={`rank r${i + 1}`}>{i + 1}</span>
                <Tile name={s.name} color={color(s.name)} size={44} mood={s.played ? 'happy' : 'sleep'} />
                <strong>{s.name}</strong>
                <b>{s.period} <small>pts</small></b>
              </div>
            ))}
          </section>
          <section className="stack">
            {stats.map((s, i) => (
              <ProfileCard key={s.name} s={s} rank={i} color={color(s.name)} max={max} me={s.name === profile.name} label={periodLabel} />
            ))}
          </section>
          <section>
            <h2 className="h2">{period === 'month' ? `Historial de ${monthLabel}` : 'Últimos días'}</h2>
            {days.length === 0 && <p className="muted">{period === 'month' ? 'No hay partidas en este mes.' : 'Todavía no hay partidas. La primera marca el ritmo.'}</p>}
            {days.map((d) => (
              <div className="card day" key={d}>
                <p className="day-title">{longDate(d)}</p>
                {history.filter((r) => r.day === d).map((r) => (
                  <div className="day-row" key={r.player}>
                    <Tile name={r.player} color={color(r.player)} size={30} />
                    <span>{r.player}</span>
                    <span className="muted">{fmtTime(r.seconds)}</span>
                    <b>{r.points}</b>
                  </div>
                ))}
              </div>
            ))}
          </section>
          <section className="card backup">
            <h3>Copia de seguridad</h3>
            <p className="muted">{online ? 'Tus partidas se guardan en el servidor y también en este teléfono.' : 'Tus partidas se guardan solo en este teléfono. Descargá una copia de vez en cuando.'}</p>
            <div className="backup-actions">
              <button className="btn white" onClick={doBackup}>Descargar copia</button>
              <label className="btn white file">Restaurar<input type="file" accept="application/json" onChange={(e) => void doRestore(e.target.files?.[0])} hidden /></label>
            </div>
            {backupMsg && <p className="muted" role="status">{backupMsg}</p>}
          </section>
          <button className="link" onClick={() => { try { localStorage.removeItem('cg:profile'); } catch { /* ok */ } setProfile(null); }}>
            Cambiar de perfil o de grupo
          </button>
        </>
      )}

      <nav className="tabbar" aria-label="Secciones">
        <button className={tab === 'play' ? 'on' : ''} onClick={() => setTab('play')}><Icon name="puzzle" size={26} /><span>Jugar</span></button>
        <button className={tab === 'points' ? 'on' : ''} onClick={() => setTab('points')}><Icon name="trophy" size={26} /><span>Puntos</span></button>
      </nav>
    </div>
  );
}
