import type { Kysely } from 'kysely';
import type { ConceptRowInput, ExternalSchema, InternalSchema, TerminologyAdminStore } from '@openldr/db';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM, facilityMapId, observedFacilityConceptRow, observedSystemForFeed, projectDiagnosticReport } from '@openldr/db';

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
  /** ISO timestamp for this scan. Injected rather than read from a clock so the result is testable. */
  now?: string;
  /** The caller opts IN to writing, mirroring `importFacilities` and `openldr facilities import`. */
  apply?: boolean;
}

/**
 * Task 9b decision: the `system` option that used to live on `ScanOptions` (and the equivalent
 * `opts.system` on `resolveObservedFacilities`/`publishFacilityMap`) is DROPPED, not redefined as a
 * filter.
 *
 * It used to mean "which coding system these codes belong to" — a DESTINATION the caller chose. That
 * stopped being a coherent concept the moment scan/resolve became feed-aware: the destination is now
 * DERIVED per row from `source_system` via `observedSystemForFeed`, so there is no longer one
 * destination to name. A filter-shaped replacement ("only scan/resolve rows whose derived system
 * equals X") was considered and rejected — nothing in this slice needs it (the HTTP routes and the
 * Observed tab always want every feed at once; "One call correctly scans all feeds" is the brief's
 * own acceptance bar), and adding an unused filter parameter would be speculative surface no caller
 * exercises. Every caller (`apps/server/src/facilities-routes.ts`'s `scan-observed`/`publish` routes,
 * `apps/studio/src/api.ts`'s request types, and every test that set `system` as a destination) is
 * updated in the same change that removes it.
 */

/** The `coding_systems.system_code` for the default observed-facility system. `upsertByUrl` derives
 *  the row id as `cs-url-${systemCode}`, so this must stay unique among `urn:openldr:*` systems
 *  (measured: only `FACILITY-TYPE` and `LOCAL` exist today). */
const DEFAULT_SYSTEM_CODE = 'DEFAULT_FAC';

/** Measured present among `publishers`, `role: 'local'`. */
const SYSTEM_PUBLISHER_ID = 'pub-system';

/**
 * Derive a `coding_systems.system_code` for a given observed-facility system url. The default
 * system gets the reserved `DEFAULT_FAC` code; a second feed's system (derived by
 * `observedSystemForFeed`) needs its OWN code or it collides with the default system's
 * `cs-url-DEFAULT_FAC` row.
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
 *
 * Feed-aware (Task 9b): groups by `(performer, source_system)`, not `performer` alone, then routes
 * each group to ITS system via `observedSystemForFeed(source_system)`. Two `source_system` values
 * that derive the SAME system (e.g. `null` and `'webhook-ingest'`, both the default) have their
 * counts summed rather than kept as separate rows — a `terminology_concepts` row is keyed on
 * `(system, code)`, so there is only ever one row to hold the total. A `coding_systems` row is
 * registered per DISTINCT system encountered, so one call correctly scans every feed at once; the
 * `system` destination option is gone (see the module-level note below `ScanOptions`) — there is no
 * longer a single destination to choose.
 */
export async function scanObservedFacilities(deps: ReconcileDeps, opts: ScanOptions = {}): Promise<ScanResult> {
  const now = opts.now ?? new Date().toISOString();

  const observed = await deps.externalDb
    .selectFrom('diagnostic_reports')
    .select(({ fn }) => ['performer', 'performer_display', 'performer_system', 'source_system', fn.countAll<number>().as('n')])
    .where('performer', 'is not', null)
    .groupBy(['performer', 'performer_display', 'performer_system', 'source_system'])
    .execute();

  // Fold the (performer, source_system) groups down to (system, code) totals — the level
  // `terminology_concepts` is actually keyed at. `Map<system, Map<code, count>>` rather than a
  // single string-joined key: a coding system url or an observed code can contain any character
  // (including whatever a joined-key separator would be), so nesting sidesteps that risk entirely.
  //
  // The coding system a row folds into PREFERS the wire's own `performer_system` (`identifier.
  // system`) over `observedSystemForFeed(source_system)` — the data is more authoritative than our
  // own feed-based inference when it actually speaks. `source_system`-derivation remains the
  // fallback for a sender that supplies no identifier system at all (display-only, or no
  // identifier whatsoever).
  const bySystem = new Map<string, Map<string, number>>();
  // The wire-supplied display, per (system, code) — seeds a NEW concept's display (see
  // `observedFacilityConceptRow`'s `defaultDisplay`). Keeps the FIRST non-null display seen for a
  // given key; real data is expected to agree across rows sharing a (system, code) pair.
  const displayByKey = new Map<string, string>();
  for (const o of observed) {
    if (o.performer === null) continue;
    const system = o.performer_system ?? observedSystemForFeed(o.source_system);
    const byCode = bySystem.get(system) ?? new Map<string, number>();
    byCode.set(o.performer, (byCode.get(o.performer) ?? 0) + Number(o.n));
    bySystem.set(system, byCode);
    const key = `${system}\n${o.performer}`;
    if (!displayByKey.has(key) && o.performer_display) displayByKey.set(key, o.performer_display);
  }
  const systems = [...bySystem.keys()];

  // Read the raw stored rows directly rather than through `admin.terms.search`: `Term` unpacks
  // `properties` into named fields (shortName/class/unit/metadata) and has nowhere to carry the
  // firstSeen/lastSeen/reportCount blob this scan depends on. Going through `terms.search` would
  // silently re-stamp `firstSeen` on every single scan, making the field meaningless.
  const existingRows = systems.length > 0
    ? await deps.internalDb
        .selectFrom('terminology_concepts')
        .select(['system', 'code', 'display', 'properties'])
        .where('system', 'in', systems)
        .execute()
    : [];
  const existing = new Map<string, { display: string | null; properties: Record<string, unknown> | null }>();
  for (const r of existingRows) {
    existing.set(`${r.system}\n${r.code}`, { display: r.display, properties: parseProperties(r.properties) });
  }

  const rows: ConceptRowInput[] = [];
  for (const [system, byCode] of bySystem) {
    for (const [code, n] of byCode) {
      rows.push(
        observedFacilityConceptRow({
          system,
          code,
          seenAt: now,
          reportCount: n,
          existing: existing.get(`${system}\n${code}`),
          defaultDisplay: displayByKey.get(`${system}\n${code}`),
        }),
      );
    }
  }

  const created = rows.filter((r) => !existing.has(`${r.system}\n${r.code}`)).length;
  const result: ScanResult = {
    discovered: rows.length,
    created,
    updated: rows.length - created,
    systemRegistered: false,
  };

  if (!opts.apply) return result;

  // ⛔ MUST leave each row ACTIVE: `TermMappingDialog` builds its system dropdown from active
  // `coding_systems` rows, so concepts without one are invisible to the operator who has to map
  // them. `upsertByUrl` inserts `active: true` but never re-activates an existing inactive row, so
  // repair that explicitly. Runs once per DISTINCT system encountered — a multi-feed scan registers
  // every feed's system in the same call.
  for (const system of systems) {
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
  }
  result.systemRegistered = systems.length > 0;

  if (rows.length > 0) await deps.admin.terms.importRows(rows);

  // Task 11 (whole-branch review, Fix 1): the operator journey must not dead-end at Map on a fresh
  // install. `urn:openldr:cs:facility-registry` used to get its `coding_systems` row ONLY from
  // `publishFacilityMap` (via `publishRegistryConcepts`) — an operator who opened the Observed tab,
  // pressed Scan, then opened a row's Map action found no registry system in `TermMappingDialog`'s
  // dropdown (built from `systems.filter((s) => s.active)`), because Scan alone never published it.
  // Scan now publishes the registry projection too, so it alone leaves the registry pickable.
  // ⚠ Gated on `opts.apply` exactly like the rest of this function's write path (the early return
  // above) — a dry-run scan must still write nothing.
  await publishRegistryConcepts(deps, { apply: true });

  return result;
}

export type ResolvedVia = 'registry' | 'national';

export interface ResolvedFacility {
  sourceSystem: string;
  sourceCode: string;
  /** `DiagnosticReport.performer[0].display` as observed on the wire (e.g. "Aga Khan") — the human
   *  name for `sourceCode`, distinct from `name` below (the RESOLVED registry facility's name).
   *  Lets the Observed tab show "BAMAA — Aga Khan" instead of a bare opaque code, without using the
   *  display for matching. Null when the source never supplied one. */
  sourceDisplay: string | null;
  registryId: string | null;
  /** `facility_registry.local_code` of the resolved row — OURS, distinct from `nationalCode`
   *  (THEIRS). Lets an operator tell apart two similarly-named facilities (e.g. "Dodoma Regional
   *  Referral" vs "Dodoma Zonal Lab") on the Observed tab. */
  localCode: string | null;
  name: string | null;
  level: string | null;
  status: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  nationalSystem: string | null;
  nationalCode: string | null;
  resolvedVia: ResolvedVia | null;
  /** A mapping exists, but its target resolves to no live registry row. Surfaced on the Observed
   *  tab; the report still falls back to the raw string. */
  targetMissing: boolean;
}

/**
 * Resolve every observed facility code through its mapping to a registry row.
 *
 * ⛔ Reads `term_mappings`, NOT `concept_map_elements`. `term_mappings` is the authoritative table
 * (`terminology-admin-store.ts:567-633` reads it and writes the concept_map_elements mirror
 * alongside), and only it carries `is_active` — an operator-deactivated mapping must not resolve.
 *
 * ⛔ Precedence is fixed and total: registry route, then national route, then unresolved. Never a
 * silent pick between two candidates.
 *
 * Feed-aware (Task 9b): each `(performer, source_system)` row looks up mappings under ITS OWN
 * coding system — `observedSystemForFeed(source_system)`, NOT one fixed system for every row — so
 * two feeds sending the SAME `performer` code can carry entirely independent mappings and resolve to
 * different facilities. Before Task 9b this function took a single `opts.system` (the coding system
 * mappings are authored against, defaulting to `DEFAULT_OBSERVED_FACILITY_SYSTEM`) applied to every
 * row regardless of its actual feed; that parameter is gone (see the module-level note below
 * `ScanOptions`) because there is no longer one destination to pick — the system is now DERIVED per
 * row, deterministically, from `source_system` itself.
 */
export async function resolveObservedFacilities(deps: ReconcileDeps): Promise<ResolvedFacility[]> {
  const observed = await deps.externalDb
    .selectFrom('diagnostic_reports')
    .select(['performer', 'performer_display', 'performer_system', 'source_system'])
    .where('performer', 'is not', null)
    .groupBy(['performer', 'performer_display', 'performer_system', 'source_system'])
    .execute();

  // Same preference as `scanObservedFacilities`: the wire's own `performer_system` wins over
  // `observedSystemForFeed(source_system)` — a mapping authored under the wire's system must be
  // found, or Task 9b's whole per-feed resolution silently misses it.
  const systems = [...new Set(observed.map((o) => o.performer_system ?? observedSystemForFeed(o.source_system)))];
  const mappings = systems.length > 0
    ? await deps.internalDb
        .selectFrom('term_mappings')
        .select(['from_system', 'from_code', 'to_system', 'to_code'])
        .where('from_system', 'in', systems)
        .where('is_active', '=', true)
        .execute()
    : [];

  const registry = await deps.internalDb.selectFrom('facility_registry').selectAll().execute();
  const byId = new Map(registry.map((r) => [r.id, r]));
  const byNational = new Map(
    registry
      .filter((r) => r.national_system && r.national_code)
      .map((r) => [`${r.national_system}|${r.national_code}`, r]),
  );

  // Keyed on (from_system, from_code) TOGETHER — a plain `from_code` key, as before Task 9b, would
  // let a mapping authored under one feed's system answer a lookup for a different feed's identical
  // code, exactly the collision this task exists to close.
  const byCode = new Map<string, { toSystem: string; toCode: string }[]>();
  for (const m of mappings) {
    const key = `${m.from_system}\n${m.from_code}`;
    const list = byCode.get(key) ?? [];
    list.push({ toSystem: m.to_system, toCode: m.to_code });
    byCode.set(key, list);
  }

  return observed.map((o) => {
    const code = o.performer as string;
    const sourceSystem = o.source_system ?? '';
    const system = o.performer_system ?? observedSystemForFeed(o.source_system);
    const candidates = byCode.get(`${system}\n${code}`) ?? [];

    // 1. Registry route wins — the registry is what holds a printable name.
    const registryMapping = candidates.find((c) => c.toSystem === FACILITY_REGISTRY_SYSTEM);
    const nationalMapping = candidates.find((c) => c.toSystem !== FACILITY_REGISTRY_SYSTEM);

    const row = registryMapping
      ? byId.get(registryMapping.toCode)
      : nationalMapping
        ? byNational.get(`${nationalMapping.toSystem}|${nationalMapping.toCode}`)
        : undefined;

    const resolvedVia: ResolvedVia | null = row ? (registryMapping ? 'registry' : 'national') : null;

    return {
      sourceSystem,
      sourceCode: code,
      sourceDisplay: o.performer_display ?? null,
      registryId: row?.id ?? null,
      localCode: row?.local_code ?? null,
      name: row?.name ?? null,
      level: row?.level ?? null,
      status: row?.status ?? null,
      region: row?.region ?? null,
      district: row?.district ?? null,
      council: row?.council ?? null,
      nationalSystem: row?.national_system ?? null,
      nationalCode: row?.national_code ?? null,
      resolvedVia,
      // A mapping was authored but points at nothing live — distinct from "never mapped".
      targetMissing: candidates.length > 0 && !row,
    };
  });
}

export interface PublishResult {
  resolved: number;
  unmapped: number;
  targetMissing: number;
  written: number;
}

/**
 * Rebuild `facility_map` from the current resolution.
 *
 * ⛔ DELETE-then-INSERT, never upsert-then-prune. All three dialect batch-upserts conflict on `id`
 * and MSSQL caps at ~2000 bound parameters, so a `where id not in (...)` prune is unimplementable
 * at register scale — the same constraint that made `terminology_codes` delete-then-insert. One
 * transaction, so a concurrent reader never sees the dimension empty.
 *
 * `opts.system` is gone (Task 9b) along with `resolveObservedFacilities`'s — see the module-level
 * note below `ScanOptions`.
 */
export async function publishFacilityMap(
  deps: ReconcileDeps,
  opts: { apply?: boolean } = {},
): Promise<PublishResult> {
  if (opts.apply) await publishRegistryConcepts(deps, { apply: true });

  const resolved = await resolveObservedFacilities(deps);

  const result: PublishResult = {
    resolved: resolved.filter((r) => r.resolvedVia !== null).length,
    unmapped: resolved.filter((r) => r.resolvedVia === null && !r.targetMissing).length,
    targetMissing: resolved.filter((r) => r.targetMissing).length,
    written: resolved.length,
  };
  if (!opts.apply) return result;

  const allRows = resolved.map((r) => ({
    id: facilityMapId(r.sourceSystem, r.sourceCode),
    source_system: r.sourceSystem,
    source_code: r.sourceCode,
    registry_id: r.registryId,
    local_code: r.localCode,
    name: r.name,
    level: r.level,
    status: r.status,
    region: r.region,
    district: r.district,
    council: r.council,
    national_system: r.nationalSystem,
    national_code: r.nationalCode,
    resolved_via: r.resolvedVia,
  }));

  // Task 11 (whole-branch review, Fix 3): `scanObservedFacilities` folds `(performer, source_system)`
  // groups that derive the SAME coding system into one `(system, code)` total, but
  // `resolveObservedFacilities` maps 1:1 over the raw groups — so a warehouse holding both a NULL and
  // an empty-string `source_system` for the same performer (both normalise to the SAME
  // `facilityMapId`, since `facilityMapId` is derived from `r.sourceSystem` which is already `?? ''`)
  // yields two rows with an identical `id`, and the delete-then-insert transaction below would abort
  // on the primary key. Dedupe by `id` here, keeping the first occurrence, mirroring the fold
  // `scanObservedFacilities` already does at the (system, code) level.
  const seenIds = new Set<string>();
  const rows = allRows.filter((r) => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });

  await deps.externalDb.transaction().execute(async (trx) => {
    await trx.deleteFrom('facility_map').execute();
    // Chunked: MSSQL's parameter budget is ~2000 and each row binds 14 values (150 * 14 = 2100
    // would exceed it, hence 140 not 150).
    const chunk = 140;
    for (let i = 0; i < rows.length; i += chunk) {
      await trx.insertInto('facility_map').values(rows.slice(i, i + chunk) as never).execute();
    }
  });

  return result;
}

/**
 * Project `facility_registry` into `FACILITY_REGISTRY_SYSTEM` so registry rows are pickable as
 * mapping targets in `TermMappingDialog`'s search mode.
 *
 * ⛔ `display` TRACKS `facility_registry.name` — this concept is a projection, and the registry is
 * the source of truth for a facility's name. That is the OPPOSITE of the observed-facility system,
 * where a curated display is preserved because the operator owns it. Both rules are deliberate.
 *
 * ⚠ A deleted facility leaves its concept behind. `importRows` upserts and never prunes, and that is
 * acceptable and deliberate here: the stale concept is what makes `targetMissing` (resolution) detectable
 * at all, since resolution checks the live `facility_registry` row rather than the concept. Do NOT add
 * a prune — it would silently erase the evidence the Observed tab exists to show.
 */
export async function publishRegistryConcepts(
  deps: ReconcileDeps,
  opts: { apply?: boolean } = {},
): Promise<{ concepts: number; systemRegistered: boolean }> {
  const registry = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name'])
    .execute();

  if (!opts.apply) return { concepts: registry.length, systemRegistered: false };

  // ⛔ MUST leave the row ACTIVE: see `scanObservedFacilities` above for the same trap.
  // `systemCode` must stay distinct from `DEFAULT_SYSTEM_CODE` ('DEFAULT_FAC') and any
  // `systemCodeFor`-derived observed-facility code.
  await deps.admin.codingSystems.upsertByUrl({
    url: FACILITY_REGISTRY_SYSTEM,
    systemCode: 'FACILITY-REGISTRY',
    systemName: 'OpenLDR facility registry',
    publisherId: SYSTEM_PUBLISHER_ID,
  });
  const cs = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
  if (cs && !cs.active) {
    await deps.internalDb.updateTable('coding_systems').set({ active: true })
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();
  }

  if (registry.length > 0) {
    await deps.admin.terms.importRows(
      registry.map((r) => ({
        system: FACILITY_REGISTRY_SYSTEM,
        code: r.id,
        display: r.name,
        status: 'ACTIVE',
        properties: null,
      })),
    );
  }

  return { concepts: registry.length, systemRegistered: true };
}

/**
 * Capture ONE observed facility string, from the ingest path.
 *
 * Shares `observedFacilityConceptRow` with `scanObservedFacilities` so the two capture paths cannot
 * drift on concept shape. It deliberately does NOT compute `reportCount` — that is an aggregate
 * over the warehouse this path cannot see from a single resource; the scan owns it. A code first
 * seen here carries `reportCount: 0` until the next scan corrects it.
 *
 * ⛔ Do NOT go through `deps.admin.terms.search` to check for an existing concept, and do not
 * "simplify" this back to that call. `terms.search` runs `lower(code) LIKE %query%` ordered by
 * `code` (`terminology-admin-store.ts`'s `terms.search`) and this call sites a `limit: 1` page — so
 * a lexicographically EARLIER code that merely CONTAINS this one as a substring, without this code
 * being a PREFIX of it (e.g. `AA Aga Khan Annex` sorts before, and contains, `Aga Khan` — a
 * superstring formed by simple suffix extension like `Aga Khan Hospital` can NOT shadow it, because
 * a string is always <= any string it is a strict prefix of), can fill that single row and shadow
 * the real exact match, even with an exact-match filter applied to the page afterward. When that
 * happens `existing` comes back undefined for a code that already exists, and the fallthrough to
 * `importRows`'s `ON CONFLICT (system, code) DO UPDATE` overwrites `display`/`properties`
 * wholesale — permanently destroying a curated display and resetting `firstSeen` (which does not
 * self-heal; see `scanObservedFacilities`'s doc comment). Querying `terminology_concepts` directly
 * for the exact `(system, code)` pair sidesteps the substring/paging trap entirely. See
 * `facility-reconcile.test.ts`'s `preserves a curated display and firstSeen when a lexicographically
 * earlier concept contains the code as a substring` for the pinned repro.
 */
export async function captureObservedFacility(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  system: string,
  code: string,
  now: string,
): Promise<void> {
  if (!code) return;
  const existing = await deps.internalDb
    .selectFrom('terminology_concepts')
    .select(['code'])
    .where('system', '=', system)
    .where('code', '=', code)
    .executeTakeFirst();
  if (existing) return; // Already known; the scan advances lastSeen/reportCount.
  await deps.admin.terms.importRows([
    observedFacilityConceptRow({ system, code, seenAt: now, reportCount: 0 }),
  ]);
}

/**
 * The projection-runner `onProjected` closure, extracted from `packages/bootstrap/src/index.ts` so
 * it is directly testable without booting the whole `AppContext` (`createAppContext` wires the real
 * Keycloak/S3/event-bus/DB adapters just to construct `onProjected`'s outer scope, which is far more
 * setup than this one filter+extract+capture decision needs). `index.ts`'s
 * `createProjectionRunner({ onProjected: ... })` call is now a one-line delegate to this function —
 * see the wiring comment there for why the filter/guard/extraction shape looks the way it does.
 *
 * Filters to `DiagnosticReport` (the only resource type with a `performer` this slice cares about),
 * extracts `performer` via `projectDiagnosticReport` (the SAME extraction the relational writer
 * already applies to this resource, so the captured code cannot drift from the
 * `diagnostic_reports.performer` value `scanObservedFacilities` reads), and no-ops when there is no
 * performer (no facility string to capture).
 *
 * Task 9b fix round 1 (Gap 1): `sourceSystem` is the projected row's OWN provenance —
 * `packages/db/src/projection/cycle.ts`'s `applyProjection` reads it via `getWithProvenance`
 * alongside `resource` and hands it to this hook unchanged, so it is the SAME value the relational
 * writer just stamped onto `diagnostic_reports.source_system` for this very resource (never a
 * guess or a re-derivation). Falls back through `observedSystemForFeed` exactly as
 * `scanObservedFacilities`/`resolveObservedFacilities` fall back for `diagnostic_reports.
 * source_system` — so a code captured here, from a non-default feed, lands directly in that feed's
 * system instead of the default one until the next scan corrects it. The wire's own
 * `projected.performer_system` (`identifier.system`) is preferred over that fallback when present,
 * matching scan/resolve's own preference — otherwise this capture path and a later full scan would
 * file the identical code under two different systems.
 */
export async function captureObservedFacilityFromProjection(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  resourceType: string,
  resource: Record<string, unknown>,
  sourceSystem: string | null,
  now: string,
): Promise<void> {
  if (resourceType !== 'DiagnosticReport') return;
  const projected = projectDiagnosticReport(resource, {});
  const performer = projected.performer;
  if (!performer) return;
  // Same system preference as scan/resolve: the wire's own `performer_system` (`identifier.
  // system`) wins over the feed-based inference, so a code captured here at ingest time lands
  // under the SAME system a later full scan would also file it under.
  const system = projected.performer_system ?? observedSystemForFeed(sourceSystem);
  await captureObservedFacility(deps, system, performer, now);
}
