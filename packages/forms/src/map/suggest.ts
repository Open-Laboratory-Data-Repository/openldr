import { similarity } from '@openldr/core/pure';
import type { MapTarget } from './target';

/**
 * Offer a source field for each target field, by label and by synonym. Only a suggestion: nothing
 * here is applied until a person accepts it. It must be willing to say nothing, so a weak match
 * gives no suggestion at all.
 */

/** The floor `packages/bootstrap/src/facility-mapping-suggest.ts` uses (`WEAK_MIN`). */
const MIN_SCORE = 0.62;

export interface MapSuggestion {
  targetPath: string;
  field: string;
  score: number;
}

export function suggest(target: MapTarget, fieldNames: string[], synonyms: Record<string, string[]>): MapSuggestion[] {
  const candidates: (MapSuggestion & { t: number; s: number })[] = [];
  target.fields.forEach((f, t) => {
    const names = [f.label, ...(synonyms[f.path] ?? [])];
    fieldNames.forEach((field, s) => {
      const score = Math.max(...names.map((n) => similarity(field, n)));
      if (score >= MIN_SCORE) candidates.push({ targetPath: f.path, field, score, t, s });
    });
  });

  // Highest first, so each target field and each source field takes its best match once.
  candidates.sort((a, b) => b.score - a.score || a.t - b.t || a.s - b.s);
  const usedTargets = new Set<string>();
  const usedFields = new Set<string>();
  const out: MapSuggestion[] = [];
  for (const c of candidates) {
    if (usedTargets.has(c.targetPath) || usedFields.has(c.field)) continue;
    usedTargets.add(c.targetPath);
    usedFields.add(c.field);
    out.push({ targetPath: c.targetPath, field: c.field, score: c.score });
  }
  return out;
}
