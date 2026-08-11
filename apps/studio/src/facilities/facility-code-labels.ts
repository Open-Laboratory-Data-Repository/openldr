import { useEffect, useState } from 'react';
import { expandValueSet } from '@/api';

/**
 * Task 10 (B1, facility-canonical-identity): the Facility form's Status/Level fields are bound to
 * two terminology ValueSets — see packages/db/src/migrations/internal/072_facility_level_status_
 * valuesets.ts's `STATUS_VS_ID`/`LEVEL_VS_ID` (`vs-location-status`/`vs-facility-type`). Those ids
 * are frozen, migration-seeded identifiers, exactly the same "a migration is a snapshot of one
 * release and never renamed" guarantee that migration file itself relies on for its own down()/
 * repointForm() logic — safe to hardcode here.
 *
 * Hardcoded rather than resolved by URL because there is no by-URL ValueSet lookup reachable from
 * the browser — only by-id (`GET /api/terminology/valuesets/:id/expand`, `expandValueSet` in
 * api.ts, the same endpoint `ValueSetBuilder.tsx` already calls by a known id).
 */
export const FACILITY_STATUS_VALUESET_ID = 'vs-location-status';
export const FACILITY_LEVEL_VALUESET_ID = 'vs-facility-type';

/**
 * `code -> display` for one ValueSet id, fetched once per mount via `expandValueSet`. The map
 * starts empty (never `null`/`undefined` — callers never have to guard a missing map, only a
 * missing ENTRY, via `displayFor` below) and fills in once the request resolves; a failed fetch
 * leaves it empty rather than throwing, so a terminology outage degrades to "show the raw code"
 * instead of breaking whatever list/diff is rendering it.
 *
 * Not module-level-cached: the Status/Level vocabularies are small (3 / 63 concepts) and rarely
 * change, so refetching per mount is cheap, and it avoids inventing an unbounded cache with no
 * invalidation story that no caller here needs.
 */
export function useCodeDisplayMap(valueSetId: string): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    expandValueSet(valueSetId)
      .then((res) => {
        if (cancelled) return;
        setMap(new Map(res.codes.map((c) => [c.code, c.display ?? c.code])));
      })
      .catch(() => { if (!cancelled) setMap(new Map()); });
    return () => { cancelled = true; };
  }, [valueSetId]);
  return map;
}

/** `code`'s display label from `map`, falling back to the raw code — never blank, and never the
 *  literal string "null"/"undefined" for a genuinely absent value, which reads as an em dash
 *  instead. Used for both a live map (still loading, or a value with no canonical mapping at all —
 *  an unmapped legacy value must still show something, not disappear) and one that failed to load. */
export function displayFor(map: Map<string, string>, code: string | null | undefined): string {
  if (code === null || code === undefined || code === '') return '—';
  return map.get(code) ?? code;
}
