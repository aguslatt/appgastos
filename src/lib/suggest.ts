import { diffDays } from './dates';
import type { Category, DateStr } from './types';

/**
 * Active folders ordered by how much (and how recently) they're used, so the ones
 * a person reaches for most are always under the thumb. Ties keep the original order.
 */
export function rankFolders(categories: readonly Category[], expenses: ReadonlyArray<{ categoryId: string; date: DateStr }>, today: DateStr): Category[] {
  const score = new Map<string, number>();
  for (const e of expenses) {
    const age = Math.max(0, diffDays(e.date, today));
    const weight = age <= 120 ? 1 / (1 + age / 30) : 0.03;
    score.set(e.categoryId, (score.get(e.categoryId) ?? 0) + weight);
  }
  return categories
    .filter((c) => !c.archived)
    .map((category, index) => ({ category, index, score: score.get(category.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.category);
}
