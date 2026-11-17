// String similarity for offline mapping suggestions. Pure string functions, safe in a browser.
// Moved here from packages/bootstrap/src/facility-mapping-suggest.ts so the forms mapping core
// can share it. That file re-exports both, so its importers did not change.

export function normaliseLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Sørensen–Dice over character bigrams. Chosen over edit distance because it is length-insensitive
 *  and rewards shared word fragments: `health centre` vs `health center` scores high, while
 *  `1st level hospital` vs `district hospital` does not clear the 0.62 floor the callers use, which
 *  is the outcome that matters most here. */
export function similarity(a: string, b: string): number {
  const na = normaliseLabel(a);
  const nb = normaliseLabel(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let shared = 0;
  let total = 0;
  for (const n of ba.values()) total += n;
  for (const [g, n] of bb) {
    total += n;
    shared += Math.min(n, ba.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}
