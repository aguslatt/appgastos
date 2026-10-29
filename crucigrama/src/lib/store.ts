import type { GameKind } from './scoring';

export interface Result {
  room: string;
  player: string;
  day: string;
  game: GameKind;
  seconds: number;
  points: number;
}

export interface Profile {
  name: string;
  room: string;
}

const safe = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: sigue andando */ }
  },
};

export const loadProfile = (): Profile | null => {
  const raw = safe.get('cg:profile');
  return raw ? (JSON.parse(raw) as Profile) : null;
};
export const saveProfile = (p: Profile) => safe.set('cg:profile', JSON.stringify(p));

export const loadLocalResults = (): Result[] => JSON.parse(safe.get('cg:results') ?? '[]') as Result[];
export const saveLocalResult = (r: Result) => {
  const all = loadLocalResults().filter(
    (x) => !(x.room === r.room && x.player === r.player && x.day === r.day && x.game === r.game),
  );
  all.push(r);
  safe.set('cg:results', JSON.stringify(all));
};

/** Progreso de una partida en curso (sobrevive a recargar la página). */
export interface Progress {
  startedAt: number; // ms acumulados jugados
  elapsed: number;
  hints: number;
  data: unknown;
}
export const loadProgress = (key: string): Progress | null => {
  const raw = safe.get('cg:p:' + key);
  return raw ? (JSON.parse(raw) as Progress) : null;
};
export const saveProgress = (key: string, p: Progress) => safe.set('cg:p:' + key, JSON.stringify(p));

/** Copia de seguridad: todos los resultados guardados en este dispositivo. */
export const exportBackup = (): string => JSON.stringify({ app: 'crucigrama', results: loadLocalResults() }, null, 2);

/** Suma los resultados de una copia sin pisar los que ya están. Devuelve cuántos agregó. */
export function importBackup(text: string): number {
  const data = JSON.parse(text) as { results?: Result[] };
  const list = Array.isArray(data.results) ? data.results : [];
  const have = new Set(loadLocalResults().map((r) => `${r.room}|${r.player}|${r.day}|${r.game}`));
  let added = 0;
  for (const r of list) {
    if (!r || typeof r.points !== 'number' || typeof r.seconds !== 'number' || !r.room || !r.player || !r.day) continue;
    if (have.has(`${r.room}|${r.player}|${r.day}|${r.game}`)) continue;
    saveLocalResult(r);
    added++;
  }
  return added;
}
