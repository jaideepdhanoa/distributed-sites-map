/** Reciprocal rank fusion. Exact name, id, and APN matches are applied by the caller. */

export const RRF_K = 60;

export function reciprocalRankFusion(lists: string[][], k = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((id, index) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      scores.set(id, (scores.get(id) || 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Exact names, ids, and APNs sort ahead of semantic neighbors. */
export function withExactWins(fused: { id: string; score: number }[], exactIds: Iterable<string>): { id: string; score: number }[] {
  const exact = new Set(exactIds);
  return fused
    .map((row) => (exact.has(row.id) ? { ...row, score: row.score + 10 } : row))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
