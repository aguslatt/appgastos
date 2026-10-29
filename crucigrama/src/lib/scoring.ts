export type GameKind = 'crossword' | 'wordsearch';

export const GAMES: Record<GameKind, { label: string; base: number; par: number }> = {
  crossword: { label: 'Crucigrama', base: 150, par: 1800 }, // 30 min de referencia
  wordsearch: { label: 'Sopa de letras', base: 60, par: 420 }, // 7 min
};

export const HINT_COST = 8;

/**
 * Puntos = base + bonus por velocidad (hasta la mitad de la base,
 * que baja linealmente hasta 0 al llegar al tiempo de referencia)
 * menos las pistas usadas. Nunca baja de 10 si se completó.
 */
export function score(kind: GameKind, seconds: number, hints: number): number {
  const { base, par } = GAMES[kind];
  const speed = Math.max(0, 1 - seconds / par) * (base / 2);
  return Math.max(10, Math.round(base + speed - hints * HINT_COST));
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Lunes de la semana de la fecha dada (para el ranking semanal). */
export function weekStart(day: string): string {
  const d = new Date(day + 'T12:00:00');
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return dayKey(d);
}
