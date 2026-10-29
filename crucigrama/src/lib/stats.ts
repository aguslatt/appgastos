import { GAMES, addDays, weekStart } from './scoring';
import type { Result } from './store';

export interface PlayerStats {
  name: string;
  week: number;
  period: number; // puntos del período elegido (semana o mes)
  periodPlayed: number;
  total: number;
  played: number;
  best: number | null; // mejor tiempo, en segundos
  avg: number | null;
  streak: number; // días seguidos jugando, contando hasta hoy o ayer
  last7: { day: string; points: number }[];
  history: Result[];
}

const COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];

/** El color de cada persona sale de su posición alfabética dentro del grupo. */
export function playerColor(name: string, members: string[]): string {
  const i = [...members].sort((a, b) => a.localeCompare(b)).indexOf(name);
  return COLORS[Math.max(0, i) % COLORS.length]!;
}

export function computeStats(results: Result[], extraMembers: string[], today: string, ym?: string): PlayerStats[] {
  const crossword = results.filter((r) => r.game === 'crossword');
  const names = [...new Set([...extraMembers, ...crossword.map((r) => r.player)])].filter(Boolean);
  const wk = weekStart(today);
  return names
    .map((name) => {
      const mine = crossword.filter((r) => r.player === name).sort((a, b) => b.day.localeCompare(a.day));
      const days = new Set(mine.map((r) => r.day));
      let streak = 0;
      let cursor = days.has(today) ? today : addDays(today, -1);
      while (days.has(cursor)) {
        streak++;
        cursor = addDays(cursor, -1);
      }
      const times = mine.map((r) => r.seconds);
      const inPeriod = ym ? mine.filter((r) => r.day.startsWith(ym)) : mine.filter((r) => weekStart(r.day) === wk);
      return {
        name,
        week: mine.filter((r) => weekStart(r.day) === wk).reduce((s, r) => s + r.points, 0),
        period: inPeriod.reduce((s, r) => s + r.points, 0),
        periodPlayed: inPeriod.length,
        total: mine.reduce((s, r) => s + r.points, 0),
        played: mine.length,
        best: times.length ? Math.min(...times) : null,
        avg: times.length ? Math.round(times.reduce((s, x) => s + x, 0) / times.length) : null,
        streak,
        last7: Array.from({ length: 7 }, (_, i) => {
          const day = addDays(today, i - 6);
          return { day, points: mine.find((r) => r.day === day)?.points ?? 0 };
        }),
        history: mine,
      };
    })
    .sort((a, b) => b.period - a.period || b.total - a.total || a.name.localeCompare(b.name));
}

export const MAX_POINTS = Math.round(GAMES.crossword.base * 1.5);
