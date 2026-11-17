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
 * How well a column's parent fits a field's record, to break a tie: 2 when the parent names the
 * record (`patient.dob` for a Patient field), 1 for a column with no parent, 0 for another parent
 * (`mother.dob`). Only a tie looks at it.
 */
function parentRank(field: string, targetPath: string): number {
  const dot = field.lastIndexOf('.');
  if (dot <= 0) return 1;
  return similarity(field.slice(0, dot), targetPath.split('.')[0]) >= MIN_SCORE ? 2 : 0;
}

/**
 * `synonyms[path]` lists names a column for that field might have. `synonyms['!' + path]` lists names
 * that must not go to it, such as a full name for First name: a column at least as close to one of
 * those as to the field is not offered for it.
 *
 * Equal scores are settled together, so the order of the columns or fields never decides. Among
 * equal scores the better parent wins; equal scores with equal parents are a tie, left to the person.
 * A column takes part once, at its best score still open: if it loses or ties there, it is not
 * offered for a weaker field.
 */
export function suggest(target: MapTarget, fieldNames: string[], synonyms: Record<string, string[]>): MapSuggestion[] {
  type Candidate = MapSuggestion & { rank: number };
  const candidates: Candidate[] = [];
  for (const f of target.fields) {
    const names = [f.label, ...(synonyms[f.path] ?? [])];
    const notFor = synonyms[`!${f.path}`] ?? [];
    for (const field of fieldNames) {
      const reads = readsOf(field);
      const best = (list: string[]) => Math.max(0, ...reads.flatMap((r) => list.map((n) => similarity(r, n))));
      const score = best(names);
      if (score < MIN_SCORE) continue;
      if (notFor.length > 0 && best(notFor) >= score) continue;
      candidates.push({ targetPath: f.path, field, score, rank: parentRank(field, f.path) });
    }
  }

  const usedTargets = new Set<string>();
  const usedFields = new Set<string>();
  const out: MapSuggestion[] = [];
  const levels = [...new Set(candidates.map((c) => c.score))].sort((a, b) => b - a);
  for (const level of levels) {
    // Every candidate open at this score, taken before any is settled.
    const open = candidates.filter(
      (c) => Math.abs(c.score - level) < TIE && !usedTargets.has(c.targetPath) && !usedFields.has(c.field),
    );
    const winners: Candidate[] = [];
    for (const c of open) {
      const rivals = open.filter((d) => d !== c && (d.targetPath === c.targetPath || d.field === c.field));
      if (rivals.every((d) => d.rank < c.rank)) winners.push(c);
    }
    // A target closes with its winner, or when two of its best-ranked candidates tie. A target whose
    // candidates only lost their column to another target stays open for a weaker score.
    for (const path of new Set(open.map((c) => c.targetPath))) {
      const here = open.filter((c) => c.targetPath === path);
      const top = Math.max(...here.map((c) => c.rank));
      if (winners.some((w) => w.targetPath === path) || here.filter((c) => c.rank === top).length > 1) usedTargets.add(path);
    }
    for (const c of open) usedFields.add(c.field);
    out.push(...winners.map(({ targetPath, field, score }) => ({ targetPath, field, score })));
  }
  return out.sort((a, b) => b.score - a.score);
}
