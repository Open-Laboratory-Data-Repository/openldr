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
 */
function systemCodeFor(system: string): string {
  if (system === DEFAULT_OBSERVED_FACILITY_SYSTEM) return DEFAULT_SYSTEM_CODE;
  const slug = system
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return slug.length > 0 ? slug.slice(0, 64) : DEFAULT_SYSTEM_CODE;
}

/**
 * Discover the distinct facility strings present in the warehouse and record them as concepts.
 *
 * Re-runnable by construction, which is a hard requirement: new performer values arrive with every
 * ingest. It is NOT redundant with the ingest hook — it does three things the hook structurally
 * cannot. It backfills historical rows (a hook only ever sees new data); it computes `reportCount`,
 * which is an aggregate over the warehouse the hook cannot see from one row; and it repairs any gap
 * (a hook added after data landed, a failed cycle, a restored database).
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
    const properties =
      typeof r.properties === 'string' ? (JSON.parse(r.properties) as Record<string, unknown>) : ((r.properties as Record<string, unknown> | null) ?? null);
    existing.set(r.code, { display: r.display, properties });
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
