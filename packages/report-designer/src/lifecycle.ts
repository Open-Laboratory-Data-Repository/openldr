import { canonicalJson } from '@openldr/core/pure';
import type { ReportDesign } from './schema';

/**
 * Design lifecycle rules, mirroring `packages/forms/src/lifecycle.ts`.
 *
 * ⚠ `designContentFingerprint` is the SINGLE definition of "did this design's content change". The
 * boot seed's drift check (`packages/reporting/src/seed/report-seeds.ts`) and the store's
 * un-publish check must both use it. T1's defect was precisely two answers to that question
 * disagreeing: the seed compared a field the store did not persist, so it rewrote eight built-in
 * designs on every boot, reverting operator edits.
 */

/** `max + 1`, or 1 when nothing has been published yet. */
export function computeNextDesignVersion(existing: readonly number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

/** The product-owned content of a design. Excludes `id` and the DB-stamped timestamps, which are
 *  envelope: a re-read that restamps `updated_at` must not count as an edit.
 *
 *  `pageNumbers ?? false` normalises unset and explicit-false to one value, so a design that never
 *  set the flag and one that set it off are the same content. */
export function designContentFingerprint(d: ReportDesign): string {
  return canonicalJson({
    name: d.name,
    paper: d.paper,
    orientation: d.orientation,
    margins: d.margins ?? null,
    pageNumbers: d.pageNumbers ?? false,
    parameters: d.parameters ?? [],
    pages: d.pages ?? [],
    // ⛔ Printed translations are CONTENT. Leaving them out gave two silent failures at once: the
    // boot seeder saw no drift, so a shipped translation could never reach an install that already
    // had the design; and a studio edit that changed only a translation did not count as a change,
    // so a published design kept printing new words without being re-published. `?? null` for the
    // same reason `margins` has it — never-set and cleared are one content.
    i18n: d.i18n ?? null,
  });
}

export function designContentChanged(before: ReportDesign, after: ReportDesign): boolean {
  return designContentFingerprint(before) !== designContentFingerprint(after);
}
