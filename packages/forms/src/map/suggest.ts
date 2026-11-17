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

/** Two scores closer than this are a tie. */
const TIE = 1e-9;

/** The names a column is read by: its own, and for a nested column its last part as well. */
function readsOf(field: string): string[] {
  const dot = field.lastIndexOf('.');
  return dot > 0 && dot < field.length - 1 ? [field, field.slice(dot + 1)] : [field];
}

/**
 * `synonyms[path]` lists names a column for that field might have. `synonyms['!' + path]` lists names
 * that must not go to it, such as a full name for First name: a column at least as close to one of
 * those as to the field is not offered for it.
 */
export function suggest(target: MapTarget, fieldNames: string[], synonyms: Record<string, string[]>): MapSuggestion[] {
  const candidates: (MapSuggestion & { t: number; s: number })[] = [];
  target.fields.forEach((f, t) => {
    const names = [f.label, ...(synonyms[f.path] ?? [])];
    const notFor = synonyms[`!${f.path}`] ?? [];
    fieldNames.forEach((field, s) => {
      const reads = readsOf(field);
      const best = (list: string[]) => Math.max(0, ...reads.flatMap((r) => list.map((n) => similarity(r, n))));
      const score = best(names);
      if (score < MIN_SCORE) return;
      if (notFor.length > 0 && best(notFor) >= score) return;
      candidates.push({ targetPath: f.path, field, score, t, s });
    });
  });

  // Highest first, so each target field and each source field takes its best match once.
  candidates.sort((a, b) => b.score - a.score || a.t - b.t || a.s - b.s);
  const usedTargets = new Set<string>();
  const usedFields = new Set<string>();
  const out: MapSuggestion[] = [];
  for (const c of candidates) {
    if (usedTargets.has(c.targetPath) || usedFields.has(c.field)) continue;
    // A tie is left to the person: never pick by the order of the columns or the fields.
    const rivals = candidates.filter(
      (d) => d !== c && Math.abs(d.score - c.score) < TIE && !usedTargets.has(d.targetPath) && !usedFields.has(d.field),
    );
    const fieldTie = rivals.some((d) => d.targetPath === c.targetPath);
    const columnTie = rivals.some((d) => d.field === c.field);
    if (fieldTie || columnTie) {
      if (fieldTie) usedTargets.add(c.targetPath);
      if (columnTie) usedFields.add(c.field);
      continue;
    }
    usedTargets.add(c.targetPath);
    usedFields.add(c.field);
    out.push({ targetPath: c.targetPath, field: c.field, score: c.score });
  }
  return out;
}
