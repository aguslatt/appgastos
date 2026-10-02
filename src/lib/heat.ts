/**
 * Heat level (0-5) for each day. Days without spending are 0; the rest are split by
 * rank, not by value, so one huge day (rent) doesn't flatten everything else to the lightest shade.
 */
export function heatLevels(totals: readonly number[]): number[] {
  const nonzero = totals.filter((t) => t > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return totals.map(() => 0);
  return totals.map((t) => {
    if (t <= 0) return 0;
    const below = nonzero.filter((x) => x < t).length;
    const equal = nonzero.filter((x) => x === t).length;
    const rank = (below + equal / 2) / nonzero.length; // mid-rank, 0..1
    return 1 + Math.min(4, Math.floor(rank * 5));
  });
}
