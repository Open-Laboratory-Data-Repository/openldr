import type { Kysely } from 'kysely';
import type { ExternalSchema, InternalSchema, TerminologyAdminStore } from '@openldr/db';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, observedFacilityConceptRow } from '@openldr/db';

export interface ReconcileDeps {
  internalDb: Kysely<InternalSchema>;
  externalDb: Kysely<ExternalSchema>;
  admin: TerminologyAdminStore;
}

export interface ScanResult {
  discovered: number;
  created: number;
  updated: number;
  systemRegistered: boolean;
}

export interface ScanOptions {
  /** Which coding system these codes belong to. One per FEED; defaults to the site default. */
  system?: string;
  /** ISO timestamp for this scan. Injected rather than read from a clock so the result is testable. */
  now?: string;
  /** The caller opts IN to writing, mirroring `importFacilities` and `openldr facilities import`. */
  apply?: boolean;
}

/** The `coding_systems.system_code` for the default observed-facility system. `upsertByUrl` derives
 *  the row id as `cs-url-${systemCode}`, so this must stay unique among `urn:openldr:*` systems
 *  (measured: only `FACILITY-TYPE` and `LOCAL` exist today). */
const DEFAULT_SYSTEM_CODE = 'DEFAULT_FAC';

/** Measured present among `publishers`, `role: 'local'`. */
const SYSTEM_PUBLISHER_ID = 'pub-system';

/**
 * Derive a `coding_systems.system_code` for a given observed-facility system url. The default
 * system gets the reserved `DEFAULT_FAC` code; a second feed (a non-default `opts.system`) needs
 * its OWN code or it collides with the default system's `cs-url-DEFAULT_FAC` row.
 *
 * ⛔ A non-default url that slugifies to empty (e.g. `///` or a url made only of punctuation) must
 * NOT fall back to `DEFAULT_SYSTEM_CODE` — that would collide with the real default system on
 * `cs-url-DEFAULT_FAC`, exactly the collision this function exists to prevent. It falls back to a
 * deterministic hash of the full url instead, so it stays reproducible across scans while staying
 * distinct from the default code.
 */
function systemCodeFor(system: string): string {
  if (system === DEFAULT_OBSERVED_FACILITY_SYSTEM) return DEFAULT_SYSTEM_CODE;
  const slug = system
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (slug.length > 0) return slug.slice(0, 64);
  return `SYS_${djb2Hex(system)}`;
}

/** A tiny, dependency-free stable hash — mirrors `facility-observed.ts`'s `djb2Hex`, reimplemented
 *  here rather than imported because that one is not exported (this module's browser-safety
 *  boundary is separate from that file's). */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * Parse a `terminology_concepts.properties` value into an object, treating an unparseable blob the
 * same as an absent one rather than throwing and killing the whole scan. This matters beyond
 * defensive coding: `admin.terms.update()` (`terminology-admin-store.ts` `packProps`/`update`) is
 * not the only writer of this column, and this scan must survive whatever state an external writer
 * leaves it in.
 */
function parseProperties(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return (raw as Record<string, unknown> | null) ?? null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Discover the distinct facility strings present in the warehouse and record them as concepts.
 *
 * Re-runnable by construction, which is a hard requirement: new performer values arrive with every
 * ingest. It is NOT redundant with the ingest hook — it does three things the hook structurally
 * cannot. It backfills historical rows (a hook only ever sees new data); it computes `reportCount`,
 * which is an aggregate over the warehouse the hook cannot see from one row; and it repairs any gap
 * (a hook added after data landed, a failed cycle, a restored database).
 *
 * ⚠ `firstSeen` guarantee is WEAKER than it looks: it is carried forward across re-scans (see
 * `does not advance firstSeen on a re-scan` in the test file), but an operator editing this facility's
 * display through `/terminology` resets it. `admin.terms.update()` calls `packProps`
 * (`terminology-admin-store.ts:185-193`), which keeps only `shortName`/`class`/`unit`/`replacedBy`/
 * `metadata` and returns `null` otherwise; `update` (`terminology-admin-store.ts:520-528`) then
 * writes `properties: props === null ? null : …` unconditionally, destroying the
 * `firstSeen`/`lastSeen`/`reportCount` blob this function relies on. The next scan sees no prior
 * `firstSeen` and re-stamps it to "now". This is a pre-existing bug in shared terminology code
 * (also destroys `organism_type`/`result_role` elsewhere) and is out of scope here; see
 * `firstSeen resets if an operator edits the term in /terminology` in the test file for the pinned
 * behaviour.
 */
export async function scanObservedFacilities(deps: ReconcileDeps, opts: ScanOptions = {}): Promise<ScanResult> {
  const system = opts.system ?? DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const now = opts.now ?? new Date().toISOString();

  const observed = await deps.externalDb
    .selectFrom('diagnostic_reports')
    .select(({ fn }) => ['performer', fn.countAll<number>().as('n')])
    .where('performer', 'is not', null)
    .groupBy('performer')
    .execute();

  // Read the raw stored row directly rather than through `admin.terms.search`: `Term` unpacks
  // `properties` into named fields (shortName/class/unit/metadata) and has nowhere to carry the
  // firstSeen/lastSeen/reportCount blob this scan depends on. Going through `terms.search` would
  // silently re-stamp `firstSeen` on every single scan, making the field meaningless.
  const existingRows = await deps.internalDb
    .selectFrom('terminology_concepts')
    .select(['code', 'display', 'properties'])
    .where('system', '=', system)
    .execute();
  const existing = new Map<string, { display: string | null; properties: Record<string, unknown> | null }>();
  for (const r of existingRows) {
    existing.set(r.code, { display: r.display, properties: parseProperties(r.properties) });
  }

  const rows = observed
    .filter((o): o is { performer: string; n: number } => o.performer !== null)
    .map((o) =>
      observedFacilityConceptRow({
        system,
        code: o.performer,
        seenAt: now,
        reportCount: Number(o.n),
        existing: existing.get(o.performer),
      }),
    );

  const created = rows.filter((r) => !existing.has(r.code)).length;
  const result: ScanResult = {
    discovered: rows.length,
    created,
    updated: rows.length - created,
    systemRegistered: false,
  };

  if (!opts.apply) return result;

  // ⛔ MUST leave the row ACTIVE: `TermMappingDialog` builds its system dropdown from active
  // `coding_systems` rows, so concepts without one are invisible to the operator who has to map
  // them. `upsertByUrl` inserts `active: true` but never re-activates an existing inactive row, so
  // repair that explicitly.
  await deps.admin.codingSystems.upsertByUrl({
    url: system,
    systemCode: systemCodeFor(system),
    systemName: 'Observed facilities',
    publisherId: SYSTEM_PUBLISHER_ID,
  });
  const cs = await deps.admin.codingSystems.getByUrl(system);
  if (cs && !cs.active) {
    await deps.internalDb.updateTable('coding_systems').set({ active: true }).where('url', '=', system).execute();
  }
  result.systemRegistered = true;

  if (rows.length > 0) await deps.admin.terms.importRows(rows);

  return result;
}
