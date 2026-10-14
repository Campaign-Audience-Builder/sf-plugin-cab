/** Levenshtein distance, case-insensitive. */
export function distance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const row = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[t.length];
}

/** Returns the `count` candidates most similar to `query`. A substring match ranks first. */
export function mostSimilar(query: string, candidates: string[], count = 3): string[] {
  const q = query.toLowerCase();
  return [...new Set(candidates)]
    .map((c) => ({ c, score: c.toLowerCase().includes(q) || q.includes(c.toLowerCase()) ? -1 : distance(q, c) }))
    .sort((x, y) => x.score - y.score || x.c.localeCompare(y.c))
    .slice(0, count)
    .map((x) => x.c);
}
