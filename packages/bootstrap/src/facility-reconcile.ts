import type { Kysely } from 'kysely';
import type { ConceptRowInput, ExternalSchema, InternalSchema, MapType, RegistryRowForConcept, TerminologyAdminStore } from '@openldr/db';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM, FACILITY_REGISTRY_SYSTEM_CODE, FACILITY_REGISTRY_SYSTEM_NAME, facilityMapId, observedFacilityConceptRow, registryConceptRows, registryPreferredCode, registryRowIdsWithSupersededIdConcept, observedSystemForFeed, projectDiagnosticReport } from '@openldr/db';

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
  /** How many facilities the registry reprojection this scan performs MOVED to a different concept
   *  code — each one a `term_mappings` rewrite done underneath whoever authored the mapping.
   *
   *  ⛔ This is the ONLY route by which that number reaches an operator. `scanObservedFacilities` is
   *  the one caller of `publishRegistryConcepts` that is itself reachable from outside this package,
   *  and pressing Scan can now rewrite mappings in bulk (a code collision resolved, an import that
   *  renamed codes). Carrying the count here puts it in the `facility.scan` audit entry's metadata —
   *  both the HTTP route's and the CLI's, which both audit `{ result }` — so "my mappings all point
   *  somewhere else since this morning" is answerable from the audit log instead of from a
   *  `console.warn` nobody kept. It needs no new UI string: `apps/studio`'s `ScanObservedResult` is a
   *  structural mirror that simply ignores fields its banner does not interpolate.
   *
   *  ⚠ Always 0 on a DRY RUN, and that is a limit, not a preview: a dry-run scan returns before the
   *  reprojection, and `publishRegistryConcepts({ apply: false })` deliberately returns without
   *  reading a single code — so there is no computed-but-unwritten answer to report. Making a dry run
   *  predict the rewrites means teaching the reprojection to compute without writing, which is a
   *  change to that function, not to this field. */
  registryCodeChanges: number;
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
 * The coding system a raw `(performer, source_system)` row resolves into. The wire's own
 * `performer_system` (`identifier.system`) is authoritative when present — the data is more
 * trustworthy than our own feed-based inference. `observedSystemForFeed(sourceSystem)` is the
 * fallback for a sender that supplies no identifier system at all (display-only, or no identifier
 * whatsoever).
 *
 * Extracted so `scanObservedFacilities`, `resolveObservedFacilities`, and
 * `captureObservedFacilityFromProjection` share ONE definition of this preference instead of three
 * independently-typed copies of `performer_system ?? observedSystemForFeed(source_system)` that
 * could silently drift apart.
 */
function resolvedObservedSystem(
  performerSystem: string | null | undefined,
  sourceSystem: string | null | undefined,
): string {
  return performerSystem ?? observedSystemForFeed(sourceSystem ?? null);
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
    const system = resolvedObservedSystem(o.performer_system, o.source_system);
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
    registryCodeChanges: 0,
  };

  if (!opts.apply) return result;

  // ⛔ MUST leave each row ACTIVE: `TermMappingDialog` builds its system dropdown from active
  // `coding_systems` rows, so concepts without one are invisible to the operator who has to map
  // them. `ensureCodingSystemActive` is the shared upsert→getByUrl→conditional-reactivate sequence
  // (see its doc comment) — repair that explicitly. Runs once per DISTINCT system encountered — a
  // multi-feed scan registers every feed's system in the same call.
  //
  // No try/catch here, matching this function's pre-existing semantics: `scanObservedFacilities` is
  // an explicit operator-triggered action (via the scan-observed HTTP route / CLI), not the ingest
  // hot path, so a `coding_systems` failure here is allowed to propagate and fail the scan rather
  // than be silently swallowed.
  for (const system of systems) {
    await ensureCodingSystemActive(deps, {
      url: system,
      systemCode: systemCodeFor(system),
      systemName: 'Observed facilities',
    });
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
  //
  // ⛔ The result is NOT discarded. This reprojection can rewrite `term_mappings` in bulk (see
  // `reprojectRegistryRows`), and this call is the only path by which pressing Scan does so — so the
  // count of moved codes is carried out on `ScanResult`, where both audit callers already record the
  // whole result. See `ScanResult.registryCodeChanges` for why that is the chosen surface.
  const projection = await publishRegistryConcepts(deps, { apply: true });
  result.registryCodeChanges = projection.codeChanges;

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
  /** `facilities.region`/`facilities.district` (`Organization.address[0].state`/`.district`,
   *  migration 014) for `sourceCode`, joined WITHIN `sourceSystem` above — i.e.
   *  `facilities.facility_code = sourceCode AND facilities.source_system = sourceSystem`. This is
   *  location CE already knows about the OBSERVED facility itself, independent of any curated
   *  `facility_registry` mapping — the whole point being that an operator can tell DISA's five
   *  facility codes sharing the display "Aga Khan" (BAMAA/BBFAF/CDABE/EAFAE/NDFAM) apart by district
   *  BEFORE mapping any of them, not only after. Null when `facilities` holds no matching row (the
   *  common case today — most codes arrive with no `Organization` alongside them) or when the
   *  matching row's own `address` omitted that part (see `projectFacility`'s doc comment).
   *
   *  ⛔ Scoped by source system on PURPOSE, not merely by code: `facilities.id` is a bare
   *  per-(deterministic-id) upsert key with no source scoping (`relational-writer.ts`'s
   *  `upsertOn`/`insertBatchPg` conflict on `id` alone), so if two feeds ever emit an Organization
   *  under the exact same id for the exact same code, only ONE of them can survive in `facilities`
   *  at all — whichever wrote last — and its `source_system` column reflects that write. Scoping
   *  this join by `source_system` is what stops the LOSING feed's reports from silently inheriting
   *  the WINNING feed's location: they correctly see `null` (no known location) rather than a
   *  location that was never theirs. The data genuinely cannot distinguish the two feeds in that
   *  collision case — only that it must never guess. */
  sourceRegion: string | null;
  sourceDistrict: string | null;
  /** SUM of `diagnostic_reports` rows folded into this (resolved system, code) row, across every
   *  raw `(performer, source_system)` group that shares the fold key — including groups that did
   *  NOT win the representative-display tiebreak below. A route or CLI consumer wanting a report
   *  count reads this field directly rather than re-querying `diagnostic_reports` itself, which is
   *  what let a route-level join key drift out of sync with this function's own fold key (Task 11,
   *  whole-branch review round 2, Fix 1). */
  reportCount: number;
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
  /** A mapping exists, and its target system genuinely IS a facility register (the registry
   *  system, or a `national_system` some LIVE `facility_registry` row actually carries), but the
   *  target code resolves to no live row. Surfaced on the Observed tab; the report still falls
   *  back to the raw string. ⛔ Means exactly this ONE thing — never true for `nonFacilityTarget`
   *  below, which is a DIFFERENT failure (see that field's doc comment for the bug this split
   *  fixes). */
  targetMissing: boolean;
  /** A mapping exists, but its target SYSTEM is not a facility register at all — the observed
   *  system itself (a self-mapping), or an unrelated active system (LOINC, ICD-10, UCUM, LOCAL).
   *  Distinct from `targetMissing` (a genuine facility-register mapping whose CODE doesn't
   *  resolve) and from "never mapped" (`resolvedVia === null && !targetMissing && !nonFacilityTarget`):
   *  the operator DID author a mapping here, and deserves to be told it doesn't resolve to a
   *  facility, not "target missing" (which promises a facility was deleted — nothing here was ever
   *  a facility) and not silence (which would hide that anything was authored at all).
   *
   *  ⛔ Bug this closes: the pre-Fix-1 code classified "any candidate whose `toSystem` is not the
   *  registry system" as a national-register route, unconditionally — so a self-mapping (an
   *  operator mapping an observed code to itself under `DEFAULT_OBSERVED_FACILITY_SYSTEM`) or a
   *  mapping to LOINC/ICD-10/UCUM/LOCAL was looked up in `byNational` (which only ever contains
   *  LIVE registry rows' `national_system`), found nothing, and reported `targetMissing` — a lie:
   *  nothing was ever missing, because the target was never a facility. A national route is now
   *  only recognised when the target system is PROVEN a facility register by the registry's own
   *  data (`knownNationalSystems`, below) — never merely "not the registry system". */
  nonFacilityTarget: boolean;
  /** ACTIVE `SAME-AS` mappings on this observed `(system, code)` name more than one DISTINCT
   *  facility — either several distinct rows in the facility registry, or (when no registry mapping
   *  exists at all) several distinct targets in proven national registers. The row resolves to
   *  NOTHING; there is never an arbitrary winner. Which of the competing facilities appeared in a
   *  report used to depend on database row order (`candidates.find(...)` over an unordered query),
   *  and a nondeterministic answer is worse than a visibly absent one, so the conflict is reported
   *  and the operator settles it.
   *
   *  ⛔ DISTINCT targets, not mapping ROWS. `term_mappings` permits duplicates (no unique index; no
   *  duplicate guard on the mappings POST route; `reference-apply` upserts by `id`), so two rows may
   *  carry an identical `(from, to)`. Those agree on the answer, so they are NOT ambiguous and the
   *  row resolves exactly as one of them alone would — anything else would delete a
   *  correctly-resolving facility from a report over a non-conflict. See the dedupe note in
   *  `resolveObservedFacilities`.
   *
   *  ⛔ Competition WITHIN one route kind only. Registry-beats-national is a fixed, documented total
   *  order between two DIFFERENT kinds (see the precedence note on `resolveObservedFacilities`), so
   *  one registry mapping alongside any number of national ones is NOT ambiguous — the registry one
   *  wins, as it always has.
   *
   *  ⛔ Mutually exclusive with `resolvedVia` — enforced by `assertResolvedFacilityInvariant`. Also
   *  never set alongside `targetMissing` or `nonFacilityTarget`, both of which would misdescribe
   *  it: the targets here are facility-register targets (so not `nonFacilityTarget`) and they are
   *  not being reported as absent (the resolver simply refuses to choose between them, whether or
   *  not they resolve). That exclusion is by construction in `resolveObservedFacilities`, and
   *  pinned by 'reports an ambiguous row as neither nonFacilityTarget nor targetMissing' in the
   *  test file — it is NOT asserted by `assertResolvedFacilityInvariant`.
   *
   *  ⚠ Says nothing about non-`SAME-AS` mappings. Those never resolve (see the `map_type` filter in
   *  `resolveObservedFacilities`) and never compete either, so a row carrying only, say, an
   *  UNMAPPED-FROM mapping reads here exactly like a row carrying none: all four flags false.
   *  Surfacing an unsupported semantic to the operator is not this field. */
  ambiguous: boolean;
}

/**
 * Enforces the invariant documented on `ResolvedFacility.nonFacilityTarget`: it holds today only
 * because of HOW `resolveObservedFacilities` derives the three fields together (see that function's
 * single call site, below) — nothing in the TYPE stops a future producer, or a hand-built test
 * fixture, from constructing a `{ resolvedVia: 'registry', nonFacilityTarget: true }` row, which is
 * meaningless by this field's own definition. A full status union collapsing the three fields into
 * one would make that impossible by construction, but was judged too wide a refactor for this
 * branch (every existing caller — `ObservedTab.tsx`, the routes, the CLI — already branches on three
 * independent booleans). This is the cheap middle ground instead: assert the invariant at the one
 * place that computes it today, so a future edit that breaks it fails LOUDLY (throws) rather than
 * silently emitting a contradictory row that downstream consumers would have to individually guard
 * against. Exported (not merely called inline) so it can be exercised directly by a test that proves
 * it actually fires, without needing to contort `resolveObservedFacilities`'s real inputs into
 * producing an impossible combination.
 */
export function assertResolvedFacilityInvariant(
  row: Pick<ResolvedFacility, 'resolvedVia' | 'targetMissing' | 'nonFacilityTarget' | 'ambiguous'>,
): void {
  if (row.nonFacilityTarget && (row.resolvedVia !== null || row.targetMissing)) {
    throw new Error(
      `ResolvedFacility invariant violated: nonFacilityTarget=true must imply resolvedVia=null and ` +
      `targetMissing=false (got resolvedVia=${JSON.stringify(row.resolvedVia)}, targetMissing=${row.targetMissing})`,
    );
  }
  // Task 10. `ambiguous` means the resolver REFUSED to pick between competing mappings, so a row
  // claiming both it and a resolution is meaningless by that field's own definition — and it is
  // exactly the shape a future edit would produce by adding a new resolution branch that forgets
  // the ambiguity gate. Separate `throw` with its own message rather than a widened condition on
  // the one above, so a break is attributable to THIS rule.
  if (row.ambiguous && row.resolvedVia !== null) {
    throw new Error(
      `ResolvedFacility invariant violated: ambiguous=true must imply resolvedVia=null ` +
      `(got resolvedVia=${JSON.stringify(row.resolvedVia)})`,
    );
  }
}

/**
 * Resolve every observed facility code through its mapping to a registry row.
 *
 * ⛔ Reads `term_mappings`, NOT `concept_map_elements`. `term_mappings` is the authoritative table
 * (`terminology-admin-store.ts:567-633` reads it and writes the concept_map_elements mirror
 * alongside), and only it carries `is_active` — an operator-deactivated mapping must not resolve.
 *
 * ⛔ Precedence is fixed and total: registry route, then national route, then unresolved. Never a
 * silent pick between two candidates — and since Task 10 that is enforced rather than merely
 * intended: two competing candidates within ONE route kind resolve to NOTHING and set
 * `ResolvedFacility.ambiguous`, where the code previously took whichever the database returned
 * first. Precedence BETWEEN the two kinds is unchanged and is not ambiguity.
 *
 * ⛔ Only `map_type = 'SAME-AS'` resolves (Task 10). The other four semantics `TermMappingDialog`
 * offers stay active in `term_mappings` and are simply invisible here — see the `map_type` filter
 * on the mapping query below for why it is applied in SQL rather than after the fact.
 *
 * Feed-aware (Task 9b): each `(performer, source_system)` row looks up mappings under ITS OWN
 * coding system — `observedSystemForFeed(source_system)`, NOT one fixed system for every row — so
 * two feeds sending the SAME `performer` code can carry entirely independent mappings and resolve to
 * different facilities. Before Task 9b this function took a single `opts.system` (the coding system
 * mappings are authored against, defaulting to `DEFAULT_OBSERVED_FACILITY_SYSTEM`) applied to every
 * row regardless of its actual feed; that parameter is gone (see the module-level note below
 * `ScanOptions`) because there is no longer one destination to pick — the system is now DERIVED per
 * row, deterministically, from `source_system` itself.
 *
 * Returns one `ResolvedFacility` per (resolved system, code) — see the fold at the top of the
 * function body for why that dedupe exists and how the representative display is chosen.
 */
export async function resolveObservedFacilities(deps: ReconcileDeps): Promise<ResolvedFacility[]> {
  const observed = await deps.externalDb
    .selectFrom('diagnostic_reports')
    .select(({ fn }) => ['performer', 'performer_display', 'performer_system', 'source_system', fn.countAll<number>().as('n')])
    .where('performer', 'is not', null)
    .groupBy(['performer', 'performer_display', 'performer_system', 'source_system'])
    .execute();

  // Whole-branch review finding (fix round 1): the SQL above groups by all FOUR of (performer,
  // performer_display, performer_system, source_system), but only ONE `ResolvedFacility` should ever
  // exist per logical facility — so the raw groups must be folded down before this function returns.
  // Without this fold, any `(performer, source_system)` pair that ever reported with a differing
  // `performer_display` or `performer_system` across its warehouse rows (a mid-rollout CDR
  // identifier-fix cutover, a corrected `LOCNDIC4.DESCRIPTION`) yielded MULTIPLE resolved rows for
  // what is really one facility code — and both `/api/facilities/observed` (duplicated `reportCount`
  // from its 2-column count map) and `ObservedTab` (colliding `${sourceSystem}|${sourceCode}` React
  // key) assume that never happens.
  //
  // Mirrors `scanObservedFacilities`'s `bySystem`/`displayByKey` Maps (see that function's doc
  // comment, directly above) rather than inventing a second idiom: the fold key is (RESOLVED system,
  // code) — NOT code alone. `performer_system` participates in the key, via the SAME
  // `performer_system ?? observedSystemForFeed(source_system)` preference used everywhere else in
  // this file, because two rows sharing a code under genuinely different coding systems ARE different
  // facilities (the entire point of Task 9b's per-feed system work). Only `performer_display` is
  // folded away.
  //
  // Representative-display rule (deterministic, so a re-run over UNCHANGED data can never flip the
  // shown name): prefer a non-null display over a null one; among rows that both have (or both lack)
  // a display, prefer the one backing the MOST reports (`n`); break any remaining tie by
  // `source_system` ascending, for full reproducibility. "Whichever row the SQL driver happened to
  // return first" is deliberately NOT the rule — that would let the identical warehouse state render
  // a different name on every re-run.
  //
  // Task 11 (whole-branch review round 2, Fix 1): `reportCount` accumulates the SUM of every raw
  // group's `n` folded into this key — independent of which raw group wins the display tiebreak
  // above. This is what makes this function the single owner of the report count: a caller (route,
  // CLI) that instead re-derives its own count via a DIFFERENT grouping/key and joins it back in
  // risks that key silently drifting from this function's own fold key, dropping a feed's
  // contribution (exactly the bug this fix closes — see the route's prior 2-column
  // `(performer, source_system)` join key, which didn't include `performer_system` and so joined the
  // wrong thing whenever two feeds shared a wire system but differed in `source_system`).
  interface FoldedGroup {
    system: string;
    code: string;
    sourceSystem: string;
    sourceDisplay: string | null;
    n: number; // reports backing the CURRENT representative display; used only to break ties
    reportCount: number; // SUM of every raw group's `n` folded into this key so far
  }
  const folded = new Map<string, FoldedGroup>();
  for (const o of observed) {
    if (o.performer === null) continue;
    const system = resolvedObservedSystem(o.performer_system, o.source_system);
    const code = o.performer;
    const key = `${system}\n${code}`;
    const n = Number(o.n);
    const candidate: Omit<FoldedGroup, 'reportCount'> = {
      system,
      code,
      sourceSystem: o.source_system ?? '',
      sourceDisplay: o.performer_display ?? null,
      n,
    };
    const current = folded.get(key);
    if (!current) {
      folded.set(key, { ...candidate, reportCount: n });
      continue;
    }
    const currentHasDisplay = current.sourceDisplay !== null;
    const candidateHasDisplay = candidate.sourceDisplay !== null;
    let replace: boolean;
    if (candidateHasDisplay !== currentHasDisplay) {
      replace = candidateHasDisplay; // a non-null display always beats a null one
    } else if (candidate.n !== current.n) {
      replace = candidate.n > current.n; // more reports wins among equally null/non-null displays
    } else {
      replace = candidate.sourceSystem < current.sourceSystem; // final deterministic tiebreak
    }
    const reportCount = current.reportCount + n; // summed regardless of which side wins the display
    folded.set(key, replace ? { ...candidate, reportCount } : { ...current, reportCount });
  }
  const foldedRows = [...folded.values()];

  // Location CE already knows about the OBSERVED facility itself (`facilities.region`/`.district`,
  // populated from `Organization.address`, migration 014) — independent of any curated mapping. See
  // `ResolvedFacility.sourceRegion`'s doc comment for why the join is scoped by `(facility_code,
  // source_system)` TOGETHER, and what it means when that scoping can't fully distinguish two feeds.
  // Loaded whole and joined here in memory, the same way `registry` (a few lines below) is — the
  // `facilities` dimension is the same order of magnitude as `facility_registry`, not the report
  // volume in `diagnostic_reports`.
  const facilityRows = await deps.externalDb
    .selectFrom('facilities')
    .select(['id', 'facility_code', 'source_system', 'region', 'district'])
    .where('facility_code', 'is not', null)
    .execute();
  // Deterministic by `id` ascending, first-seen-wins: guards the (should-not-happen-today) case of
  // two DISTINCT `facilities` rows somehow claiming the same (source_system, facility_code) pair, so
  // a re-run over UNCHANGED data can never flip which location is shown — same discipline as the
  // sourceDisplay/sourceSystem tiebreak above.
  const facilityLocationByKey = new Map<string, { region: string | null; district: string | null }>();
  for (const f of [...facilityRows].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${f.source_system ?? ''}\n${f.facility_code}`;
    if (!facilityLocationByKey.has(key)) facilityLocationByKey.set(key, { region: f.region, district: f.district });
  }

  // Same preference as `scanObservedFacilities`: the wire's own `performer_system` wins over
  // `observedSystemForFeed(source_system)` — a mapping authored under the wire's system must be
  // found, or Task 9b's whole per-feed resolution silently misses it.
  const systems = [...new Set(foldedRows.map((r) => r.system))];
  const mappings = systems.length > 0
    ? await deps.internalDb
        .selectFrom('term_mappings')
        .select(['from_system', 'from_code', 'to_system', 'to_code'])
        .where('from_system', 'in', systems)
        .where('is_active', '=', true)
        // Task 10: only an exact equivalence resolves a facility. `TermMappingDialog` is the generic
        // terminology dialog and offers all five `MapType`s; this resolver used to honour every one
        // of them, so recording UNMAPPED-FROM — the operator's way of saying "this does NOT
        // correspond" — still drove official reports to that facility.
        //
        // ⛔ Filtered in SQL, not after the fact, and that placement is load-bearing: everything
        // below reasons about `candidates`, and `nonFacilityTarget` in particular is derived from
        // `candidates.length > 0`. Filtering later would leave a non-SAME-AS registry mapping in the
        // list and report it as "the target system is not a facility register" — a lie about a
        // mapping pointing squarely at the registry. Excluded here, such a row reads as unmapped for
        // resolution purposes, which is all this function claims about it.
        //
        // ⚠ These mappings stay ACTIVE in `term_mappings`. Nothing here deactivates one; only their
        // ability to resolve is removed.
        .where('map_type', '=', 'SAME-AS')
        .execute()
    : [];

  const registry = await deps.internalDb.selectFrom('facility_registry').selectAll().execute();
  // Fix 1: the set of `national_system` values PROVEN a facility register by the registry's own
  // data — a LIVE row actually carries it. This, not "anything that isn't the registry system", is
  // what makes a candidate's `toSystem` a genuine national route (see `ResolvedFacility
  // .nonFacilityTarget`'s doc comment for the bug this replaces).
  const knownNationalSystems = new Set(
    registry.map((r) => r.national_system).filter((s): s is string => s !== null),
  );
  // The registry-route mapping's `to_code` is whatever code `TermMappingDialog` showed the operator
  // when they picked this row as a target — i.e. exactly what `registryConceptRows`
  // (packages/db/src/facility-observed.ts) currently projects it as: `local_code`, else
  // `national_code`, else the row's `id` on a collision. Resolution has to derive that SAME code the
  // SAME way, over the SAME full-registry visibility `publishRegistryConcepts` gives it (so the
  // in-batch collision check inside `registryConceptRows` sees the whole table here too), or a
  // mapping authored against the current projection would fail to resolve. A plain `byId` keyed on
  // the row's bare `id` was correct back when every concept's code WAS the id; it is retired here for
  // that reason, not merely renamed.
  const registryConcepts = registryConceptRows(
    registry.map((r): RegistryRowForConcept => ({ id: r.id, name: r.name, localCode: r.local_code, nationalCode: r.national_code })),
  );
  const byRegistryCode = new Map(registry.map((r, i) => [registryConcepts[i].code, r]));
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

  return foldedRows.map((r) => {
    const candidates = byCode.get(`${r.system}\n${r.code}`) ?? [];

    // 1. Registry route wins — the registry is what holds a printable name.
    const registryCandidates = candidates.filter((c) => c.toSystem === FACILITY_REGISTRY_SYSTEM);
    // 2. National route: the candidate's target system must be PROVEN a facility register by
    //    `knownNationalSystems` — never merely "not the registry system" (Fix 1; see
    //    `ResolvedFacility.nonFacilityTarget`'s doc comment). Only considered when the registry
    //    route is absent ENTIRELY — including when it is absent because it is contested, since a
    //    contested registry route must not silently demote the row to a national answer either.
    const nationalCandidates = registryCandidates.length > 0
      ? []
      : candidates.filter((c) => knownNationalSystems.has(c.toSystem));
    // Task 10: two active SAME-AS mappings naming DIFFERENT facilities WITHIN one route kind. The
    // pair used to be settled by `candidates.find(...)` over a query with no `orderBy`, i.e. by
    // whatever the database returned first. Neither wins now — see `ResolvedFacility.ambiguous` for
    // why nothing at all is the chosen answer, and why registry-beats-national is precedence, not
    // ambiguity.
    //
    // ⛔ Counted over DISTINCT TARGETS, not over candidate ROWS. `term_mappings` has no unique index
    // (migration 013 creates two non-unique indexes only), the mappings POST route has no duplicate
    // guard, and central→lab `reference-apply` upserts by `id` — so two rows with different ids and
    // an identical `(from, to)` are reachable, and land here as two candidates. Those name the SAME
    // facility: nothing competes, there is no row-order nondeterminism to protect the operator from,
    // and reporting it would make a correctly-resolving facility VANISH from a report while telling
    // the operator to "remove one" of a non-conflict. `(from, to)` is the identity the rest of the
    // code already uses — `termMappings.create` delete-then-inserts the `concept_map_elements`
    // mirror keyed on `(map_url, source_system, source_code, target_system, target_code)`, which
    // dedupes exactly this way; only `term_mappings` itself does not.
    //
    // Registry targets key on `toCode` alone (every registry candidate shares
    // `FACILITY_REGISTRY_SYSTEM` by construction, two lines up); national targets key on
    // `toSystem|toCode`, since two different proven national registers may legitimately use the same
    // code for two different facilities.
    const registryTargets = new Set(registryCandidates.map((c) => c.toCode));
    const nationalTargets = new Set(nationalCandidates.map((c) => `${c.toSystem}|${c.toCode}`));
    const ambiguous = registryTargets.size > 1 || nationalTargets.size > 1;
    // Safe to take `[0]` once `ambiguous` is false: every remaining candidate on the surviving route
    // names the SAME target, so the answer does not depend on which duplicate row came back first.
    const registryMapping = ambiguous ? undefined : registryCandidates[0];
    const nationalMapping = ambiguous ? undefined : nationalCandidates[0];
    // 3. Anything else the operator mapped to (the observed system itself, an unrelated active
    //    system such as LOINC) is a real, saved mapping that resolves to NEITHER real route.
    //
    // ⛔ Derived from the CANDIDATE LISTS, not from the chosen mappings: an ambiguous row has
    // facility-route candidates (too many of them) and must never be reported as having none.
    const hasFacilityRouteCandidate = registryCandidates.length > 0 || nationalCandidates.length > 0;
    const nonFacilityTarget = !hasFacilityRouteCandidate && candidates.length > 0;

    const row = registryMapping
      ? byRegistryCode.get(registryMapping.toCode)
      : nationalMapping
        ? byNational.get(`${nationalMapping.toSystem}|${nationalMapping.toCode}`)
        : undefined;

    const resolvedVia: ResolvedVia | null = row ? (registryMapping ? 'registry' : 'national') : null;
    // A GENUINE facility-route mapping (registry or a proven national register) was authored but
    // points at nothing live — distinct from "never mapped" AND from `nonFacilityTarget` (Fix 1;
    // see that field's doc comment for why "candidates.length > 0 && !row" was wrong).
    //
    // ⛔ `!ambiguous` is not belt-and-braces. An ambiguous row deliberately looks up NO target, so
    // `!row` is trivially true for it — without this guard every ambiguous row would additionally
    // claim its target had been deleted, which is false whenever the competing facilities are both
    // live (the normal case).
    const targetMissing = !ambiguous && hasFacilityRouteCandidate && !row;

    // Whole-branch review finding (fix round 1): this is the ONE place today that derives
    // `resolvedVia`/`targetMissing`/`nonFacilityTarget`/`ambiguous` together — assert their
    // invariant HERE, before the row escapes into `ResolvedFacility`, so a future edit that breaks
    // it (or drifts the four fields apart) fails loudly instead of silently shipping a
    // contradictory row. See `assertResolvedFacilityInvariant`'s doc comment for why this, not a
    // status union.
    assertResolvedFacilityInvariant({ resolvedVia, targetMissing, nonFacilityTarget, ambiguous });

    const location = facilityLocationByKey.get(`${r.sourceSystem}\n${r.code}`) ?? { region: null, district: null };

    return {
      sourceSystem: r.sourceSystem,
      sourceCode: r.code,
      sourceDisplay: r.sourceDisplay,
      sourceRegion: location.region,
      sourceDistrict: location.district,
      reportCount: r.reportCount,
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
      targetMissing,
      nonFacilityTarget,
      ambiguous,
    };
  });
}

export interface PublishResult {
  resolved: number;
  unmapped: number;
  targetMissing: number;
  /** Fix 1: rows whose mapping resolves to `ResolvedFacility.nonFacilityTarget` — a real, saved
   *  mapping that targets neither the registry nor a proven national register. Counted separately
   *  so `unmapped` never silently absorbs it (see that field's doc comment). */
  nonFacilityTarget: number;
  /** Task 10: rows whose mapping resolves to `ResolvedFacility.ambiguous` — competing active
   *  SAME-AS mappings, so nothing resolved. Counted separately for the same reason as
   *  `nonFacilityTarget`: folded into `unmapped` it would tell an operator to go author a mapping,
   *  when what they must actually do is remove one of the two they already have. */
  ambiguous: number;
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
    // Fix 1: a `nonFacilityTarget` row must NOT fall into this bucket — it is not "never mapped",
    // it is a real mapping that just doesn't target a facility (see its own counter below). Task 10
    // excludes `ambiguous` for the same reason: it is over-mapped, not unmapped.
    unmapped: resolved.filter((r) => r.resolvedVia === null && !r.targetMissing && !r.nonFacilityTarget && !r.ambiguous).length,
    targetMissing: resolved.filter((r) => r.targetMissing).length,
    nonFacilityTarget: resolved.filter((r) => r.nonFacilityTarget).length,
    ambiguous: resolved.filter((r) => r.ambiguous).length,
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

  // Dedupe by `id` before the delete-then-insert below, or a duplicate primary key aborts the whole
  // transaction.
  //
  // ⚠ This is NOT redundant with `resolveObservedFacilities`' own fold, and the two guard DIFFERENT
  // collisions. That fold keys on `(resolved system, code)`, so it deliberately keeps two rows apart
  // when they share a code but resolve to different coding systems — that separation is the entire
  // point of the per-feed system work. But `facilityMapId` is derived from `(sourceSystem, sourceCode)`
  // and knows nothing about the resolved system, so those two legitimately-distinct rows still collide
  // on one `facility_map.id`. This dedupe is the only thing standing between that and a failed publish.
  //
  // (Originally added for a narrower case — a warehouse holding both NULL and empty-string
  // `source_system` for one performer. `resolveObservedFacilities` now folds that case away upstream,
  // but the different-resolved-system case above remains live.)
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
 * ⚠ A deleted facility leaves its concept behind — never pruned, deliberately. `registry` (read
 * above) only ever holds LIVE `facility_registry` rows, so a facility with no row at all is never in
 * it, and the delegated projection only ever deletes a concept keyed on a row it IS projecting (see
 * `reprojectRegistryRows` and `deleteSupersededIdConcepts`). Keeping a deleted facility's concept
 * means a `term_mappings` row an operator already authored against it is not silently erased — it
 * keeps resolving to a live concept even though its target facility is gone, which is a DIFFERENT,
 * deliberately-kept gap from the one the projection's own delete step closes (a row still present in
 * the registry, whose concept merely moved to a different code).
 *
 * ⛔ This does NOT project by itself any more — it delegates the whole write to
 * `reprojectRegistryRows`, exactly as `projectRegistryRows` does. That is the entire point: the two
 * paths used to answer the same question DIFFERENTLY. This one reprojects the whole table, so it
 * forced BOTH sides of a code collision onto their ids; the given-rows path forced only ITS OWN
 * batch and left the incumbent on the shared human code. A facility's code therefore moved on the
 * next Scan as a consequence of a write to a DIFFERENT facility, orphaning whatever was authored
 * against the old code. One shared implementation — including the batch widening, which is a no-op
 * here because this path's batch IS the whole table — is what makes that structurally impossible,
 * and it is also what gives this path the mapping carry-over it never had.
 *
 * `deleteSupersededIdConcepts` is NOT called here any more either — `reprojectRegistryRows` already
 * runs it, in the same position (after the write), on the same inputs. Calling it here too would run
 * it twice per publish.
 */
export async function publishRegistryConcepts(
  deps: ReconcileDeps,
  opts: { apply?: boolean } = {},
): Promise<{ concepts: number; systemRegistered: boolean; codeChanges: number; carryOverSkipped: number }> {
  // `local_code`/`national_code` are deliberately NOT selected: `reprojectRegistryRows` re-reads them
  // for whatever rows it is handed, and a second copy read here would only be a second thing to keep
  // in sync with the code-derivation rule.
  const registry = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name'])
    .execute();

  if (!opts.apply) return { concepts: registry.length, systemRegistered: false, codeChanges: 0, carryOverSkipped: 0 };

  // Kept here, not left to `reprojectRegistryRows`: that function returns early on an empty batch, so
  // an EMPTY registry would otherwise stop registering the system at all — and `TermMappingDialog`
  // builds its system dropdown from `coding_systems`, so a fresh install with no facilities yet must
  // still end up with a pickable (empty) registry system. Idempotent, so the second call the
  // delegation makes below costs nothing but an upsert.
  await ensureRegistrySystemActive(deps);

  let result: ReprojectResult = { projected: 0, codeChanges: [] };
  if (registry.length > 0) {
    // `registry` IS the whole table, which is exactly the batch `reprojectRegistryRows` wants for the
    // widest possible collision detection AND for the mapping carry-over: a code's old and new owners
    // are guaranteed to be in the same batch here, so the `linkedElsewhere` guard (which refuses a
    // carry-over across batch boundaries) can never fire on this path.
    result = await reprojectRegistryRows(deps, registry.map((r) => ({ id: r.id, name: r.name })));
  }

  return {
    concepts: registry.length,
    systemRegistered: true,
    // `codeChanges` REACHES AN OPERATOR, and that is the only reason it is here: `scanObservedFacilities`
    // (the one caller of this function that anything outside the package can invoke) carries it out
    // on `ScanResult.registryCodeChanges`, which both the HTTP route and the CLI record in the
    // `facility.scan` audit entry. A moved code means a mapping was repointed underneath whoever
    // authored it; a count nobody stores would not have made that answerable afterwards.
    //
    // ⚠ `carryOverSkipped` is 0 BY CONSTRUCTION from this path (see the batch note above) and, unlike
    // `codeChanges`, reaches NOBODY — no caller of this function reads it. Said plainly rather than
    // dressed up as future-proofing: the only producer that can make it non-zero is
    // `projectRegistryRows`, whose signature is `Promise<void>`, so today the sole operator-visible
    // signal for a refused carry-over remains `reprojectRegistryRows`' `console.warn`. It is reported
    // here because it costs nothing and because narrowing this path's batch (the thing that would
    // make it reachable) should not also have to re-add the field — but if a later change wants an
    // operator to SEE a refused carry-over, this field is not yet that, and the honest fix is a
    // return value on `projectRegistryRows`.
    codeChanges: result.codeChanges.length,
    carryOverSkipped: result.codeChanges.filter((c) => c.carryOverSkipped).length,
  };
}

/**
 * Upsert `url`'s `coding_systems` row and repair its `active` flag when a prior write (an operator
 * deactivation, or an earlier bug) left it inactive — `upsertByUrl` inserts `active: true` on a
 * fresh row but its `onConflict` never touches `active` on one that already exists
 * (`terminology-admin-store.ts`'s `upsertByUrl`), so this second step is not optional.
 *
 * The ONE definition of this sequence, shared by `ensureRegistrySystemActive` (the registry
 * system) and `registerObservedSystem` (an observed-facility feed's system) — before this
 * extraction the two independently re-typed the identical upsert→getByUrl→conditional-reactivate
 * steps, differing only in which `url`/`systemCode`/`systemName` they passed in, which is exactly
 * the kind of parallel implementation that drifts.
 *
 * Deliberately NO try/catch here. `ensureRegistrySystemActive` and `registerObservedSystem` have
 * genuinely different containment requirements at their own call sites — an explicit operator
 * publish (`publishRegistryConcepts`) is allowed to propagate a failure, while the ingest hot path
 * (`captureObservedFacility` via `registerObservedSystem`) must never fail an ingest cycle over a
 * `coding_systems` hiccup. Folding a try/catch into this shared helper would flatten that
 * distinction; each caller keeps its own.
 */
async function ensureCodingSystemActive(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  input: { url: string; systemCode: string; systemName: string },
): Promise<void> {
  await deps.admin.codingSystems.upsertByUrl({
    url: input.url,
    systemCode: input.systemCode,
    systemName: input.systemName,
    publisherId: SYSTEM_PUBLISHER_ID,
  });
  const cs = await deps.admin.codingSystems.getByUrl(input.url);
  if (cs && !cs.active) {
    await deps.internalDb.updateTable('coding_systems').set({ active: true }).where('url', '=', input.url).execute();
  }
}

/**
 * Delete the `FACILITY_REGISTRY_SYSTEM` concepts that `registryRowIdsWithSupersededIdConcept` says
 * are superseded — the narrow, targeted counterpart to `admin.terms.importRows`' upsert-only write.
 *
 * ⛔ Called from exactly ONE place since Task 8: `reprojectRegistryRows`, which both projection paths
 * now delegate to. It used to be called from each path separately; adding a second call site back
 * would run this twice per publish, because the delegation already includes it.
 *
 * The caller runs this AFTER its own `importRows` call, never before: the new preferred-code concept
 * must already be written before its superseded id-keyed sibling is removed, so a mid-failure can
 * never leave a facility with ZERO concepts (worst case, a failed delete just leaves the old one
 * behind for the next projection to retry).
 *
 * ⛔ NOT a general prune. This only ever deletes a concept whose `code` is the `id` of a row the
 * caller is CURRENTLY projecting, and only the ids `registryRowIdsWithSupersededIdConcept` names —
 * never anything for a facility absent from the caller's own `rows`/`registry` batch. A genuinely
 * deleted facility's concept is untouched by construction (see that function's doc comment).
 *
 * `ids` is a STATIC candidate list — `registryRowIdsWithSupersededIdConcept` flags a row whenever its
 * computed preferred code differs from its own `id`, which is true for essentially every facility
 * that has a `local_code`/`national_code`, whether or not a legacy id-keyed concept actually still
 * exists for it. In steady state (every facility already reprojected past the `0518e7d3` key change)
 * the `DELETE` below matches zero rows on almost every call. Rather than pay for the `term_mappings`
 * lookup on every one of those no-op calls — this runs on every `projectRegistryRows` invocation,
 * i.e. the facility create/update hot path — the delete goes first and the lookup only runs for
 * whatever it actually returns via `RETURNING code`, so the common case is exactly one statement.
 */
async function deleteSupersededIdConcepts(deps: Pick<ReconcileDeps, 'internalDb'>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const deleted = await deps.internalDb
    .deleteFrom('terminology_concepts')
    .where('system', '=', FACILITY_REGISTRY_SYSTEM)
    .where('code', 'in', ids)
    .returning('code')
    .execute();
  if (deleted.length === 0) return;
  const deletedCodes = deleted.map((d) => d.code);

  // A mapping authored against the id-code just removed did not just lose its target — it already
  // HAD no target the moment this row's preferred code changed: `resolveObservedFacilities`
  // recomputes `targetMissing` from a live `facility_registry` lookup keyed on the row's CURRENT
  // preferred code, so the mapping was unresolvable before this delete ever ran. This delete only
  // clears the stale id-keyed concept out of the mapping picker; it does not cause a new break. It is
  // still worth one log line, scoped to `is_active` mappings only (an inactive one was already not
  // resolving, so its target disappearing changes nothing observable), so a "my mapping stopped
  // working" report is traceable back to the code change that actually caused it.
  const stillReferenced = await deps.internalDb
    .selectFrom('term_mappings')
    .select(['from_system', 'from_code', 'to_code'])
    .where('to_system', '=', FACILITY_REGISTRY_SYSTEM)
    .where('to_code', 'in', deletedCodes)
    .where('is_active', '=', true)
    .execute();
  for (const m of stillReferenced) {
    // eslint-disable-next-line no-console -- deliberate: this module takes no logger dependency (see
    // the `err` catches below), and this is diagnostic-only, not an error this function acts on.
    console.warn(
      `[facility-reconcile] term_mappings (${m.from_system}, ${m.from_code}) -> ${FACILITY_REGISTRY_SYSTEM}/${m.to_code}` +
        ' already resolves as target missing (its preferred code changed); its stale id-keyed concept has now been removed from the mapping picker',
    );
  }
}

/**
 * Ensure `FACILITY_REGISTRY_SYSTEM`'s `coding_systems` row exists and is ACTIVE. Called by
 * `reprojectRegistryRows` (which both projection paths delegate to) and, once more, directly by
 * `publishRegistryConcepts` — see the comment at that second call site for why the redundancy is
 * load-bearing rather than an oversight (an EMPTY registry never reaches the delegation, and a fresh
 * install must still leave the system pickable). Idempotent, so the extra call costs one upsert.
 *
 * No try/catch here (see `ensureCodingSystemActive`'s doc comment) — `publishRegistryConcepts`
 * lets a failure propagate as an explicit operator action, while `projectRegistryRows` supplies its
 * own containment around the whole delegation.
 */
async function ensureRegistrySystemActive(deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>): Promise<void> {
  // ⛔ `systemCode` must stay distinct from `DEFAULT_SYSTEM_CODE` ('DEFAULT_FAC') and any
  // `systemCodeFor`-derived observed-facility code.
  await ensureCodingSystemActive(deps, {
    url: FACILITY_REGISTRY_SYSTEM,
    systemCode: FACILITY_REGISTRY_SYSTEM_CODE,
    systemName: FACILITY_REGISTRY_SYSTEM_NAME,
  });
}

/**
 * `rows` widened to a batch that is CLOSED under collision: every `facility_registry` row whose own
 * projection can change because of what this batch just wrote is in the returned array.
 *
 * This is what lets `registryConceptRows`' in-batch collision check be the ONE definition of
 * "collision" in the codebase. That check can only see the rows it is given, so a caller with partial
 * visibility (`projectRegistryRows` is handed the one row a POST/PUT just wrote) used to need a
 * SECOND, separately-typed collision detector reading the table directly (`collidingRegistryIds`,
 * removed in the same change as this comment) whose answer it passed back in as `forceOwnIdFor`.
 * Widening the BATCH instead of widening one row's answer covers strictly more: the incumbent is not
 * merely accounted for, it is REPROJECTED — at the moment its code actually moves, with its
 * `term_mappings` carried across — instead of silently drifting until somebody presses Scan.
 *
 * ⛔ TWO DIRECTIONS, and the first fix only covered one:
 *
 *  1. ACQUIRING a contested code. The batch's rows claim codes some other row already projects as;
 *     both sides must fall back to their ids, so both must be in the batch. Reached below through
 *     `candidates` -> `claimants`.
 *
 *  2. RELEASING a contested code. Two rows collide on 'X', so both are PARKED on their own ids; the
 *     batch renames one of them, which leaves the other as 'X''s sole claimant and moves it onto 'X'.
 *     Nothing in direction 1 finds that row — the batch's new candidate is the new name, and the
 *     batch row's own previous PROJECTED code is its id, because the collision is exactly why it was
 *     parked. The string 'X' the batch used to contest is recorded NOWHERE. So the signal used here
 *     is the parking itself: `facility_concept_projection.concept_code === registry_id` means this
 *     row's code was decided by SOME OTHER row, and any write to it can free somebody. When a batch
 *     row is parked, every OTHER parked row joins the batch and re-answers the question. This is
 *     `resolveObservedFacilities`' view too — it re-derives preferred codes over the whole registry —
 *     so a parked row that has been freed is ALREADY resolving through the human code while its
 *     `term_mappings` still name the id. That window is the bug; this closes it at the write.
 *
 * The parked set is small (it is exactly the registry's live collisions) and closed under collision:
 * a row colliding with a parked row is itself parked, by definition of the fallback. So pulling in
 * all of it costs a bounded, idempotent reprojection — a parked row that is still contested simply
 * projects to its id again.
 *
 * ⚠ A batch row's previous projected code is also added to `candidates` (unless it is the id-parking
 * marker, which no other row can claim). In a consistent registry this finds nothing new — a row
 * claiming the code the batch is vacating would have collided with it, and both would be parked, and
 * direction 2 already covers that. It matters after a projection that FAILED (this path is
 * best-effort and swallows, see `projectRegistryRows`) left a stale link behind: then the vacated
 * code can genuinely have a live claimant that nothing else would reproject. It costs no extra query.
 *
 * ⛔ "Claims a code" is `registryPreferredCode(row) === code`, and NOTHING else. A row only ever
 * PROJECTS as its preferred code (`local_code`, else `national_code`) — that is what
 * `registryConceptRows` writes and what `resolveObservedFacilities` re-derives to match a mapping
 * back to a facility — so a collision is two rows whose PREFERRED codes are equal, not two rows that
 * happen to share a string across two different columns. Registry rows A `{local_code:'X'}` and B
 * `{local_code:'Y', national_code:'X'}` do not collide at all (B projects as `'Y'`); treating B's
 * `national_code` as a claim on `'X'` would drag B into the batch and force BOTH onto their UUIDs,
 * leaving a ghost `'X'` concept and moving A onto a code `resolveObservedFacilities` can never
 * resolve. The SQL predicate below is therefore a deliberately WIDE prefilter — the preference order
 * lives in `registryPreferredCode` and expressing it as a `coalesce(...)` here would be a second copy
 * of it in a dialect pg-mem must also agree with — narrowed to real claims IN MEMORY. Pinned by
 * "does not widen to a row that merely carries the code in a NON-preferred column".
 *
 * One pass is enough: every row this adds projects to a code already in `candidates` (direction 1) or
 * is parked (direction 2, and the parked set is added whole), so a second pass could discover no code
 * the first did not.
 */
async function widenToCollidingRows(
  deps: Pick<ReconcileDeps, 'internalDb'>,
  rows: { id: string; name: string }[],
): Promise<{ id: string; name: string }[]> {
  const ids = rows.map((r) => r.id);
  const own = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'local_code', 'national_code'])
    .where('id', 'in', ids)
    .execute();

  const candidates = new Set<string>();
  for (const r of own) {
    const c = registryPreferredCode({ localCode: r.local_code, nationalCode: r.national_code });
    if (c !== null) candidates.add(c);
  }

  // Keyed by id so a row already in `rows` keeps the caller's own `name` — the caller just wrote it,
  // and its copy is at least as fresh as the one this read returned. Also why `rows` is seeded first:
  // a row the caller named that no longer exists in `facility_registry` must stay in the batch (it is
  // still projected, and `reprojectRegistryRows` handles it), not be silently dropped.
  const byId = new Map(rows.map((r) => [r.id, r]));

  const links = await deps.internalDb
    .selectFrom('facility_concept_projection')
    .select(['registry_id', 'concept_code'])
    .where('registry_id', 'in', ids)
    .execute();
  // Direction 2's trigger. `concept_code === registry_id` is the id-parking marker: this row's code
  // was decided by another row's, so writing it can free that other row.
  const batchHoldsParkedRow = links.some((l) => l.concept_code === l.registry_id);
  for (const l of links) if (l.concept_code !== l.registry_id) candidates.add(l.concept_code);

  if (batchHoldsParkedRow) {
    // Filtered in memory, not with a SQL column-to-column predicate. Same reasoning as the
    // `linkedElsewhere` filter in `reprojectRegistryRows`: pg-mem (the test double behind every test
    // in this module) has already been caught crashing on a non-trivial predicate against this
    // table's indexed primary key, so a filter that is free to do in memory is not worth pushing
    // down. ⚠ The read itself is NOT free — it is one row per PROJECTED facility, unbounded by the
    // batch — which is why it is gated on the batch actually holding a parked row above. A registry
    // with no live collisions never runs it.
    const parkedIds = (await deps.internalDb
      .selectFrom('facility_concept_projection')
      .select(['registry_id', 'concept_code'])
      .execute())
      .filter((l) => l.concept_code === l.registry_id && !byId.has(l.registry_id))
      .map((l) => l.registry_id);
    if (parkedIds.length > 0) {
      const parked = await deps.internalDb
        .selectFrom('facility_registry')
        .select(['id', 'name', 'local_code', 'national_code'])
        .where('id', 'in', parkedIds)
        .execute();
      for (const p of parked) {
        byId.set(p.id, { id: p.id, name: p.name });
        // A freed row's candidate must join `candidates` too, or the claimant lookup below cannot
        // tell whether it is still contested.
        const c = registryPreferredCode({ localCode: p.local_code, nationalCode: p.national_code });
        if (c !== null) candidates.add(c);
      }
    }
  }

  // Nothing to collide ON — every row in the batch is either absent from `facility_registry` (a
  // caller naming a row that no longer exists) or carries no code at all.
  if (candidates.size === 0) return [...byId.values()];

  const candidateList = [...candidates];
  const claimants = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name', 'local_code', 'national_code'])
    .where((eb) => eb.or([eb('local_code', 'in', candidateList), eb('national_code', 'in', candidateList)]))
    .execute();
  for (const c of claimants) {
    // The SAME question `registryConceptRows` and `resolveObservedFacilities` ask — what would this
    // row project as? — and not "does this row contain the string anywhere?".
    const claimed = registryPreferredCode({ localCode: c.local_code, nationalCode: c.national_code });
    if (claimed === null || !candidates.has(claimed)) continue;
    if (!byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name });
  }
  return [...byId.values()];
}

/**
 * Project ONLY the given `facility_registry` rows into `FACILITY_REGISTRY_SYSTEM` — the write-time
 * counterpart to `publishRegistryConcepts`'s full reprojection.
 *
 * A facility must be a usable mapping target the MOMENT it is created or updated (Fix 1 of the
 * mapping-ux report: an operator who registers a facility and immediately opens `TermMappingDialog`
 * must find it, with no "press Publish first" step). `publishRegistryConcepts` cannot be that path —
 * it reprojects the WHOLE registry on every call, which is fine for an explicit operator repair/
 * backfill action but not something to run on every single facility save at national-register scale
 * (10-15k rows). This function instead takes the exact rows that just changed — one row from the
 * POST/PUT routes, the whole batch from a CSV import — and writes only those.
 *
 * ⛔ This shares its ENTIRE projection with `publishRegistryConcepts` — both delegate to
 * `reprojectRegistryRows`, which now also owns the batch widening — so the two cannot drift on shape
 * (code = `local_code`, else `national_code`, else the row's `id` on a collision; display = its
 * `name`), on collision scope, or on what happens to a mapping whose target code moves. ALL that is
 * left in this function is the containment below.
 *
 * ⚠ PARTIAL visibility is handled one layer down, not here: `rows` carries only `{id, name}` — the
 * caller (a POST/PUT route, the CSV importer) hands in exactly what it just wrote, nothing more — so
 * neither this function nor `registryConceptRows` can see a collision against a row outside the
 * batch. `reprojectRegistryRows` widens the batch until it is closed under collision (see
 * `widenToCollidingRows`) before projecting anything. That is safe specifically because every caller
 * of this function invokes it AFTER its own write has already committed (see the doc comments on the
 * create/update routes and `facility-import.ts`'s call site) — by the time this runs, the live table
 * already reflects both "the rest of this batch" (a multi-row CSV import) and "everything
 * pre-existing", so there is no category of row the widening's lookup could miss.
 *
 * ⚠ So a single-row call CAN write more than one row's concept, and that is intended: a facility
 * whose code collides with the one just written is reprojected too, as is a facility the write frees
 * from a collision.
 *
 * ⚠ And it writes MORE than just those, which a reviewer measured and this comment used to deny. It
 * claimed the call "never touches a row whose own projection this batch cannot change"; that is
 * FALSE. When the batch holds a PARKED row, `widenToCollidingRows` pulls in the registry's ENTIRE
 * parked set — it has no cheaper way to find which parked rows this batch might free (see the
 * `batchHoldsParkedRow` branch) — so with two INDEPENDENT collision pairs (A/B on 'X', C/D on 'Z'), a
 * batch naming only fac-A reprojects C and D as well. Measured: all four
 * `facility_concept_projection` rows get a fresh `updated_at`. It is behaviourally invisible — an
 * unrelated parked row recomputes to the identical code and its `terminology_concepts` upsert is a
 * no-op write of the same values, so no concept, mapping or link CONTENT changes — but it is real
 * work, and the honest bound is "the batch, plus everything it can collide with, plus every parked
 * row in the registry whenever the batch holds one", not "only what this batch can change".
 *
 * ⛔ Never throws. A projection failure must NOT take a facility write down with it — mirrors
 * `registerObservedSystem`'s containment on the ingest hot path (see that function's doc comment).
 * The caller (a facility create/update, a CSV import) has already committed its own write by the
 * time this runs; this is a best-effort catch-up, not a step the write depends on.
 */
export async function projectRegistryRows(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  rows: { id: string; name: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    // Everything — widening the batch until it is closed under collision, registering the coding
    // system, writing the concepts, migrating the mappings whose target code moved, deleting the
    // superseded id-keyed leftover — lives in ONE place, shared with `publishRegistryConcepts`. This
    // function's own remaining job is the containment below.
    await reprojectRegistryRows(deps, rows);
  } catch (err) {
    // eslint-disable-next-line no-console -- deliberate: see doc comment above for why this must
    // never propagate, and this module takes no logger dependency to report through otherwise.
    console.error('[facility-reconcile] failed to project facility_registry row(s) into FACILITY_REGISTRY_SYSTEM', err);
  }
}

export interface ReprojectResult {
  /** How many rows were projected — every row handed in, whether or not its code moved. */
  projected: number;
  /** One entry per row whose projected code ACTUALLY moved. A row projected for the first time (no
   *  `facility_concept_projection` link yet) is NOT a code change — there is no old code to move
   *  away from, and nothing could have been authored against one. */
  codeChanges: {
    registryId: string;
    from: string;
    to: string;
    mappingsMigrated: number;
    /** TRUE when the carry-over was deliberately SKIPPED because the identity of `from`'s mappings
     *  is not decidable: either `from` is still linked by a facility OUTSIDE this batch (the
     *  `linkedElsewhere` guard below), or two rows INSIDE this batch both name it as their previous
     *  code (the `contestedInBatch` guard). Without this flag the
     *  skip is indistinguishable from the ordinary "there were no mappings on the old code" case —
     *  both report `mappingsMigrated: 0` — and the guard can suppress the exact repair this function
     *  exists to perform, silently. An operator reading a Publish summary needs to be able to tell
     *  "nothing to carry" from "we refused to carry it". A `console.warn` fires alongside, matching
     *  `deleteSupersededIdConcepts`' precedent for a strictly less alarming case. */
    carryOverSkipped: boolean;
  }[];
}

/**
 * Project the given `facility_registry` rows AND migrate any `term_mappings` whose target code moves
 * as a result.
 *
 * ⚠ It projects MORE rows than it is given, always: the first thing it does is widen `rows` into a
 * batch closed under collision (`widenToCollidingRows`), because `registryConceptRows`' in-batch
 * check — the one collision implementation there is — can only answer for rows it can see. A caller
 * that hands in the whole registry (`publishRegistryConcepts`) is unaffected; a caller that hands in
 * one row (`projectRegistryRows`, via a POST/PUT or a CSV import) gets the identical answer instead
 * of a narrower one. `projected` therefore counts the WIDENED batch, not the caller's array.
 *
 * A facility's concept code is DERIVED (`local_code`, else `national_code`, else its own `id` on a
 * collision — see `registryConceptRows`), so it can move without anyone editing that facility:
 * importing an unrelated row whose `national_code` equals this row's `local_code` makes BOTH fall
 * back to their UUIDs on the next full reprojection. A mapping an operator authored against the
 * human code then points at nothing, and — because the concept write is upsert-only — the orphaned
 * concept stays in the picker, selectable, resolving to no facility.
 *
 * `facility_concept_projection` is what makes "moved" OBSERVABLE. Without a durable record of what a
 * row projected as LAST time, a projection can only compute a desired code; it has no way to know
 * which old code's mappings to carry forward. That is also why the link is read as-is and never
 * re-derived from `local_code`/`national_code` here: the link records what was actually WRITTEN,
 * collision fallback included, and recomputing it would invent a move that never happened.
 *
 * ⛔ ORDERING IS LOAD-BEARING, and it is the same contract `deleteSupersededIdConcepts` documents:
 * write the new concepts FIRST, rewrite the mappings SECOND, delete the old concept LAST. A
 * mid-failure must leave a stale concept behind for the next projection to retry, never a facility
 * with ZERO concepts. Deleting the old concept before the mapping rewrite would strand every mapping
 * still pointing at it if the rewrite then failed. Pinned by the test "leaves the old concept in
 * place when the mapping rewrite fails" — reordering the delete ahead of the rewrite fails it.
 *
 * ⛔ AND THE ORDER IS ALL THE SAFETY THERE IS: these three steps are NOT one transaction, and cannot
 * cheaply be made one. `admin.termMappings.update` opens its OWN transaction internally
 * (`db.transaction().execute(...)` in `terminology-admin-store.ts`) over the `Kysely` instance it
 * was constructed with, and it takes no `Transaction` parameter to join an outer one. Wrapping this
 * sequence in `internalDb.transaction()` would therefore not nest a savepoint and would not even
 * share a session: Kysely's `TransactionBuilder.execute` goes through `provideConnection` →
 * `driver.acquireConnection()`, so the store's inner transaction runs on a DIFFERENT pooled
 * connection. Its `COMMIT` commits only its own work, independently of the outer transaction, which
 * means a later rollback would NOT undo the mapping rewrites — the sequence would LOOK atomic and
 * silently not be. (On a small pool it can also deadlock against locks the outer transaction holds.)
 * That is strictly worse than not wrapping at all: it would trade an honest, converging partial
 * state for a silent one. Making it genuinely atomic means threading a `Transaction` through the
 * admin store's whole `termMappings` surface, which is a store change, not a change here.
 *
 * What each mid-failure actually leaves behind, and why the next run repairs it:
 *  - Failure in STEP 1 (`importRows`): nothing else has run. The link table still names the old
 *    code, the old concept is intact, mappings are untouched. A re-run recomputes the identical
 *    `moved` set and starts over. Fully self-healing.
 *  - Failure DURING STEP 2 (some mappings rewritten, some not): both concepts exist — the new one
 *    was written in step 1 and the old one is not deleted until step 3 — so EVERY mapping, migrated
 *    or not, still points at a live concept and still resolves. The link table is not advanced
 *    either (it is written after the loop), so a re-run computes the SAME `from` -> `to` and the
 *    already-migrated rows are simply not in its `to_code in (fromCodes)` snapshot any more. Fully
 *    self-healing.
 *  - Failure BETWEEN steps 2 and 3, or during the link write: mappings are correct, but the old
 *    concept lingers in the picker as a ghost and the link still names the old code. A re-run
 *    recomputes the same move, finds zero stale mappings, and deletes the ghost. Self-healing.
 *
 * ⚠ The ONE residual that does NOT self-heal, stated rather than glossed: a crash mid-loop (or
 * before the link write) followed by the registry changing that row's code AGAIN before the next
 * run. The re-run's `from` is read from the link, which still names the FIRST code — so the second
 * hop's mappings are computed against a code that has already been vacated, and any mapping the
 * crashed run had already migrated now sits on the intermediate code, which no link record names and
 * no future run will look at. It resolves as `targetMissing` on the Observed tab (visible, not
 * silent) and needs an operator to re-point it. Closing it needs real atomicity, i.e. the store
 * change described above — not more ordering.
 *
 * ⛔ Mappings are rewritten through `admin.termMappings.update`, NEVER with a direct
 * `UPDATE term_mappings`. `term_mappings` is authoritative and `concept_map_elements` is its mirror;
 * a raw UPDATE would leave the mirror pointing at the old code and skip `reference_change_log`
 * capture.
 *
 * ⚠ Throws on failure, deliberately — this function does not contain its own errors. Its callers
 * have genuinely different containment needs (an explicit operator Publish may propagate; the
 * facility-save hot path must not), exactly as `ensureCodingSystemActive`'s doc comment reasons about
 * the same split. `projectRegistryRows`' try/catch stays where it is.
 */
export async function reprojectRegistryRows(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  rows: { id: string; name: string }[],
): Promise<ReprojectResult> {
  if (rows.length === 0) return { projected: 0, codeChanges: [] };

  await ensureRegistrySystemActive(deps);

  // ⛔ FIRST, and for every caller. `registryConceptRows`' in-batch check is the ONE collision
  // implementation in the codebase, and it can only see the batch — so the batch is made COMPLETE
  // here rather than the check being second-guessed by a separate table lookup afterwards. A
  // `publishRegistryConcepts` call already hands in the whole registry, so this is a no-op for it; a
  // `projectRegistryRows` call hands in one row and this is what gives it the same answer.
  const widened = await widenToCollidingRows(deps, rows);

  const ids = widened.map((r) => r.id);
  const own = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'local_code', 'national_code'])
    .where('id', 'in', ids)
    .execute();
  const ownById = new Map(own.map((r) => [r.id, r]));

  const inputs: RegistryRowForConcept[] = widened.map((r) => {
    const found = ownById.get(r.id);
    return { id: r.id, name: r.name, localCode: found?.local_code ?? null, nationalCode: found?.national_code ?? null };
  });

  // No `forceOwnIdFor`: the widening above guarantees that every row projecting to one of this
  // batch's candidate codes IS in the batch, so the in-batch check already sees both sides of every
  // collision. Passing a second, separately-computed collision set (the removed
  // `collidingRegistryIds`) would be a strict subset of what the in-batch check catches, bought with
  // a second execution of the same full-table query the widening just ran.
  const desired = registryConceptRows(inputs);

  const links = await deps.internalDb
    .selectFrom('facility_concept_projection')
    .select(['registry_id', 'concept_code'])
    .where('registry_id', 'in', ids)
    .execute();
  const previousById = new Map(links.map((l) => [l.registry_id, l.concept_code]));

  // STEP 1 of the ordering contract above: the new concepts exist before anything is pointed at them
  // and before anything old is removed.
  await deps.admin.terms.importRows(desired);

  const moved = inputs
    .map((r, i) => ({ registryId: r.id, from: previousById.get(r.id), to: desired[i].code }))
    .filter((m): m is { registryId: string; from: string; to: string } => m.from !== undefined && m.from !== m.to);

  const codeChanges: ReprojectResult['codeChanges'] = [];

  if (moved.length > 0) {
    const fromCodes = [...new Set(moved.map((m) => m.from))];

    // SNAPSHOT the mappings BEFORE rewriting any of them. Two rows swapping codes with each other in
    // one batch (A: X->Y while B: Y->X) is rare but legal, and re-reading per row mid-loop would let
    // A's freshly-rewritten mappings be picked up again as B's "stale" ones and rewritten a second
    // time. One read of the pre-change state cannot do that.
    const staleRows = await deps.internalDb
      .selectFrom('term_mappings')
      .selectAll()
      .where('to_system', '=', FACILITY_REGISTRY_SYSTEM)
      .where('to_code', 'in', fromCodes)
      .execute();
    const staleByCode = new Map<string, typeof staleRows>();
    for (const m of staleRows) {
      const list = staleByCode.get(m.to_code) ?? [];
      list.push(m);
      staleByCode.set(m.to_code, list);
    }

    // ⛔ A link row can DISAGREE with reality: migration 077's backfill matches a facility against
    // either its human code or its id and takes whichever the join happens to yield first, so a row
    // that somehow carried both concepts got a non-deterministic link. If such a link names a code
    // some OTHER facility genuinely projects as, then the mappings on that code are that other
    // facility's, not this one's — migrating them here would silently re-point an operator's mapping
    // at the wrong lab, and deleting the concept would take a LIVE facility out of the picker. So a
    // `from` claimed by a facility outside this batch is left strictly alone (the row still moves to
    // its new code; only the carry-over is skipped). This is a targeted defence on the two
    // DESTRUCTIVE steps, not a re-derivation of the link — second-guessing the link against live
    // concepts is exactly the recompute migration 077 deliberately avoided.
    //
    // "Outside this batch" is filtered in memory rather than with a SQL `not in`: the result set is
    // already bounded by `concept_code in (the codes that moved)` — at most one link row per facility
    // that claims one — so the filter is free, and pg-mem (the test double behind every test in this
    // module) crashes outright on `not in` against this table's indexed primary key.
    const batchIds = new Set(ids);
    const linkedElsewhere = new Set(
      (await deps.internalDb
        .selectFrom('facility_concept_projection')
        .select(['registry_id', 'concept_code'])
        .where('concept_code', 'in', fromCodes)
        .execute())
        .filter((l) => !batchIds.has(l.registry_id))
        .map((l) => l.concept_code),
    );

    // ⛔ THE SAME HAZARD AS `linkedElsewhere`, from INSIDE the batch — and `linkedElsewhere` cannot
    // see it, by construction. That guard only fires for a claimant OUTSIDE the batch, but
    // `widenToCollidingRows` runs first and GUARANTEES a collision partner is pulled IN, so the one
    // shape it was written for is the one shape it can never catch.
    //
    // Two link rows can name the SAME `concept_code` — migration 077's backfill used to create
    // exactly that (see its ⛔ note; both a parked row and its partner matched the leftover shared
    // concept, and nothing conflicted on insert), and a database restored from a dump taken before
    // that fix still holds it. Both rows then compute `from` = that one code, and the loop below
    // would run the carry-over TWICE against ONE `staleByCode` snapshot: the first pass repoints
    // every mapping on the shared code to row 1's new code, the second pass repoints the SAME
    // mappings — they are still in the snapshot — to row 2's. Last writer wins, silently, with
    // `carryOverSkipped: false` and no warning. A mapping authored when the code meant facility A
    // then resolves to facility B in an official report, and the `facility_map` mirror is rebuilt to
    // agree. Confidently wrong master data is strictly worse than a visible refusal.
    //
    // So: if two rows in this batch claim one `from`, NOBODY carries it over. There is no signal
    // here that could pick the rightful owner — the link table is the only record of what the code
    // meant, and it disagrees with itself. The rows still MOVE to their new codes (that part is
    // unambiguous and is what unbreaks the projection); only the two destructive steps are refused,
    // exactly as for `linkedElsewhere`, and an operator gets a warning plus `carryOverSkipped: true`
    // to act on.
    const fromCount = new Map<string, number>();
    for (const m of moved) fromCount.set(m.from, (fromCount.get(m.from) ?? 0) + 1);
    const contestedInBatch = new Set([...fromCount].filter(([, n]) => n > 1).map(([code]) => code));

    // A code this batch is HANDING OVER: one row moves off it in the same call another row moves on
    // to it (an operator renaming a facility and giving its old code to a new one in a single
    // import). The mappings still migrate — they were authored when the code meant the OLD facility,
    // and the snapshot above makes that safe — but the concept must NOT be deleted: `importRows`
    // just wrote it for its new owner.
    const reclaimedInBatch = new Set(desired.map((d) => d.code));

    for (const m of moved) {
      let mappingsMigrated = 0;
      const contested = contestedInBatch.has(m.from);
      const carryOverSkipped = linkedElsewhere.has(m.from) || contested;
      if (carryOverSkipped) {
        // ⛔ Say so out loud. Skipping is the RIGHT call (see both guards above), but it suppresses
        // the exact repair this function exists to perform, and `mappingsMigrated: 0` alone reads
        // identically to "there was nothing on the old code to carry". A skip that cannot be told
        // apart from a no-op is a skip nobody will ever investigate. Same containment reasoning as
        // `deleteSupersededIdConcepts`' warn, for a strictly more alarming case. The two reasons get
        // two messages because the REPAIR differs: one is fixed by widening the batch, the other by
        // fixing the link rows that disagree.
        // eslint-disable-next-line no-console -- deliberate: this module takes no logger dependency
        // (see the `err` catches elsewhere in this file); diagnostic-only, and mirrored on the
        // result as `carryOverSkipped` for callers that render a summary.
        console.warn(
          contested
            ? `[facility-reconcile] facility ${m.registryId} now projects as '${m.to}', but its previous code '${m.from}'`
              + ' is recorded in facility_concept_projection as MORE THAN ONE facility\'s projection, so there is no way'
              + ' to tell whose mappings it carries — its term_mappings were NOT migrated and the stale concept was NOT'
              + ' removed. Repair the link rows sharing that code, then re-publish.'
            : `[facility-reconcile] facility ${m.registryId} now projects as '${m.to}', but its previous code '${m.from}'`
              + ' is still linked by a facility outside this batch — its term_mappings were NOT migrated and the stale'
              + ' concept was NOT removed. Re-publish the WHOLE registry so both facilities are in one batch, or repair'
              + ' the mapping by hand.',
        );
      } else {
        // STEP 2: repoint the mappings, through the admin store so `concept_map_elements` and
        // `reference_change_log` follow. The full `TermMappingInput` is required (it is a replace,
        // not a patch), so every other field is carried across verbatim — including `to_display`,
        // which is the operator's own denormalised label and not this function's to re-curate.
        for (const stale of staleByCode.get(m.from) ?? []) {
          await deps.admin.termMappings.update(stale.id, {
            fromSystem: stale.from_system,
            fromCode: stale.from_code,
            toSystem: FACILITY_REGISTRY_SYSTEM,
            toCode: m.to,
            toDisplay: stale.to_display,
            mapType: stale.map_type as MapType,
            relationship: stale.relationship,
            owner: stale.owner,
            isActive: stale.is_active,
          });
          mappingsMigrated += 1;
        }

        // STEP 3, and only now: the old concept is unreferenced. Doing this before the rewrite above
        // would strand every mapping still pointing at it if the rewrite then failed.
        if (!reclaimedInBatch.has(m.from)) {
          await deps.internalDb
            .deleteFrom('terminology_concepts')
            .where('system', '=', FACILITY_REGISTRY_SYSTEM)
            .where('code', '=', m.from)
            .execute();
        }
      }
      codeChanges.push({ registryId: m.registryId, from: m.from, to: m.to, mappingsMigrated, carryOverSkipped });
    }
  }

  // Record what every row projected as THIS time — the rows that did not move included (the write is
  // idempotent) and the rows projected for the FIRST time (no prior link). Batched, not one statement
  // per row: a national register runs 10-15k rows and `publishRegistryConcepts` hands all of them
  // over in a single call.
  //
  // ⛔ Only rows that ACTUALLY exist in `facility_registry` get a link. `rows` is whatever a caller
  // handed in, and `registryConceptRows` happily projects a row it cannot find (both code columns
  // read as absent, so it falls back to the id) — but `facility_concept_projection.registry_id` is a
  // FOREIGN KEY, so linking one would throw and take the entire projection down with it, including
  // for every legitimate row in the same batch.
  const linkRows = inputs
    .map((r, i) => ({ registry_id: r.id, concept_code: desired[i].code, updated_at: new Date() }))
    .filter((l) => ownById.has(l.registry_id));
  const batchSize = 1000; // Same bound `admin.terms.importRows` uses, for the same parameter-limit reason.
  for (let i = 0; i < linkRows.length; i += batchSize) {
    await deps.internalDb
      .insertInto('facility_concept_projection')
      .values(linkRows.slice(i, i + batchSize))
      .onConflict((oc) => oc.column('registry_id').doUpdateSet((eb) => ({
        concept_code: eb.ref('excluded.concept_code'),
        updated_at: eb.ref('excluded.updated_at'),
      })))
      .execute();
  }

  // The pre-link-table leftover, kept because the link cannot see it: a concept written under the old
  // `code = id` scheme (commit 0518e7d3) for a facility that has never been projected since, so it
  // has no link row for the loop above to have noticed a move from. Same call, same arguments, same
  // position (after the write) as both projection paths used to make it themselves — Task 8 routed
  // them through this function, so THIS is now the only call site and dropping it here would
  // silently retire that cleanup for both.
  await deleteSupersededIdConcepts(deps, registryRowIdsWithSupersededIdConcept(inputs));

  return { projected: inputs.length, codeChanges };
}

/**
 * Mark the given facilities' projected concepts RETIRED — the FIRST half of what deleting a facility
 * has to do to the projection.
 *
 * ⛔ Deliberately NOT a delete, and not `terms.delete`. An operator who already mapped an observed
 * code onto this facility has historical `diagnostic_reports` that resolved through this concept; the
 * mapping must keep naming a concept that EXISTS so those reports stay interpretable and the Observed
 * tab does not start reporting `targetMissing` for a decision that was correct when it was made.
 * RETIRED is exactly the split we need: still resolvable, excluded from new selection — the same
 * split `TermPicker`'s ACTIVE-only status filter expresses (see `TermMappingDialog`'s `statuses` prop,
 * which passes `['ACTIVE']` under `lockedTargetSystem` precisely so this retirement takes effect).
 * Leaving the concept ACTIVE, which is what a delete used to do, left a selectable ghost in the
 * picker pointing at a facility that no longer exists.
 *
 * ⛔ MUST run BEFORE the `facility_registry` row is deleted. `facility_concept_projection` is the
 * only durable record of what a row actually projected as (collision fallback included — the code is
 * NOT recomputable from `local_code`/`national_code` once its collision partner is gone), and that
 * table is `ON DELETE CASCADE`: the link vanishes the instant the facility does.
 * `reprojectAfterRegistryDelete` is the other half and must run AFTER, since it reacts to the row
 * being gone; see its doc comment.
 *
 * ⛔ A link row can DISAGREE with reality, and that is guarded here rather than trusted. Migration
 * 077's backfill matched a facility against either its human code or its id and took whichever the
 * join happened to yield first, so a link can name a code some OTHER, LIVE facility genuinely
 * projects as. Retiring that would pull a live lab out of the mapping picker over a deletion that had
 * nothing to do with it — and, because a retired concept still resolves, entirely silently. So a code
 * still claimed by a surviving facility is skipped. This is the same targeted defence
 * `reprojectRegistryRows` applies to its own destructive steps (`linkedElsewhere`), asking the
 * question the way `widenToCollidingRows` asks it: "claims a code" is `registryPreferredCode(row) ===
 * code` and nothing else, so the SQL below is a deliberately WIDE prefilter narrowed IN MEMORY.
 *
 * ⚠ `registryIds` are still present in `facility_registry` when this runs (that is the whole point of
 * the ordering), so they are excluded from the claimant set explicitly — otherwise a facility being
 * deleted would be read as the live claimant of its own code and nothing would ever retire.
 *
 * Returns how many concept rows were actually updated, so a caller can tell "retired it" from
 * "there was nothing projected to retire" and from "we refused to retire a live facility's code".
 *
 * ⚠ Throws on failure, like `reprojectRegistryRows` and for the same reason: containment belongs to
 * the caller, whose needs differ (the delete route must not fail a successful deletion over this).
 */
export async function retireRegistryConcepts(
  deps: Pick<ReconcileDeps, 'internalDb'>,
  registryIds: string[],
): Promise<number> {
  if (registryIds.length === 0) return 0;

  const links = await deps.internalDb
    .selectFrom('facility_concept_projection')
    .select('concept_code')
    .where('registry_id', 'in', registryIds)
    .execute();
  if (links.length === 0) return 0;
  const codes = [...new Set(links.map((l) => l.concept_code))];

  // The wide prefilter: any registry row CARRYING one of these codes in either column. Narrowed to
  // real claims below — a row that carries the code in a non-preferred column does not project as it
  // and is not a claimant (the same distinction `widenToCollidingRows`' ⛔ note is built around).
  const doomed = new Set(registryIds);
  const claimed = new Set(
    (await deps.internalDb
      .selectFrom('facility_registry')
      .select(['id', 'local_code', 'national_code'])
      .where((eb) => eb.or([eb('local_code', 'in', codes), eb('national_code', 'in', codes)]))
      .execute())
      .filter((r) => !doomed.has(r.id))
      .map((r) => registryPreferredCode({ localCode: r.local_code, nationalCode: r.national_code }))
      .filter((c): c is string => c !== null),
  );

  const retirable = codes.filter((c) => !claimed.has(c));
  if (retirable.length === 0) return 0;

  const res = await deps.internalDb
    .updateTable('terminology_concepts')
    .set({ status: 'RETIRED' })
    .where('system', '=', FACILITY_REGISTRY_SYSTEM)
    .where('code', 'in', retirable)
    .executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0);
}

/**
 * Reproject whatever a facility DELETE just freed — the SECOND half, and the one code-release path
 * that used to have no reprojection at all.
 *
 * A facility's concept code is `local_code ?? national_code`, falling back to the row's own `id`
 * ("parking") when two rows would project to the same code. So deleting one side of a collision FREES
 * the other to move back up to the human code: `resolveObservedFacilities` re-derives preferred codes
 * over the WHOLE registry, so it starts resolving the survivor through the human code the instant the
 * delete commits, while the operator's `term_mappings` row still names the survivor's id. The mapping
 * breaks with nobody having touched it, and stays broken until somebody presses Scan. This is exactly
 * the failure `reprojectRegistryRows` closes for a RENAME; the delete route was the remaining hole.
 *
 * ⛔ MUST run AFTER the `facility_registry` row is gone — it reacts to the row's absence, and the
 * claimant lookup below would otherwise still find the deleted facility contesting its own code and
 * conclude nothing was freed. That is the opposite ordering constraint to `retireRegistryConcepts`,
 * which must run BEFORE (the link it reads cascades away with the row). Hence two calls around the
 * delete rather than one wrapper on either side of it.
 *
 * ⛔ The deleted row is NEVER handed to `reprojectRegistryRows`. `registryConceptRows` happily
 * projects a row it cannot find — both code columns read as absent, so it falls back to the id — and
 * `importRows` upserts `status: 'ACTIVE'`, so passing the deleted id straight through would write a
 * fresh ACTIVE concept for a facility that no longer exists, resurrecting the very ghost
 * `retireRegistryConcepts` just put down. Only SURVIVING claimants of the freed code go in.
 *
 * ⚠ The freed code is the deleted row's PREFERRED code (`registryPreferredCode`), not the code it was
 * projected under. Those differ in precisely the case that matters: a parked row was projected under
 * its own `id`, which no other row can ever claim, while the string it was CONTESTING — the one whose
 * release frees the survivor — is its preferred code. Both are read from the caller's pre-delete
 * snapshot of the row, because the row itself is already gone by the time this runs.
 *
 * ⛔ Never throws, for the same reason as `projectRegistryRows` (which it delegates the projection
 * to, inheriting that containment): the deletion has already committed, and a best-effort catch-up
 * must not turn a successful DELETE into a 500.
 */
export async function reprojectAfterRegistryDelete(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  deleted: { id: string; localCode: string | null; nationalCode: string | null },
): Promise<void> {
  try {
    const freed = registryPreferredCode({ localCode: deleted.localCode, nationalCode: deleted.nationalCode });
    // `facility_registry_has_a_code` makes this unreachable for a real row, but the caller hands in a
    // snapshot, not the row — a codeless snapshot frees nothing and must not become a bare query.
    if (freed === null) return;

    // Wide prefilter, narrowed in memory to rows that would genuinely PROJECT as `freed` — the same
    // `registryPreferredCode`-and-nothing-else rule `widenToCollidingRows` documents at length.
    // `deleted.id` is filtered out defensively: the row should already be gone, and if a caller got
    // the ordering wrong this refuses to reproject a facility it was told was deleted rather than
    // writing an ACTIVE concept for it.
    const survivors = (await deps.internalDb
      .selectFrom('facility_registry')
      .select(['id', 'name', 'local_code', 'national_code'])
      .where((eb) => eb.or([eb('local_code', '=', freed), eb('national_code', '=', freed)]))
      .execute())
      .filter((r) => r.id !== deleted.id
        && registryPreferredCode({ localCode: r.local_code, nationalCode: r.national_code }) === freed)
      .map((r) => ({ id: r.id, name: r.name }));

    if (survivors.length === 0) return;

    // Through `projectRegistryRows`, not `reprojectRegistryRows` directly: the widening, the mapping
    // carry-over and the containment are all things this path needs and none of them are this
    // function's to re-implement. A single surviving claimant is enough to hand over — the widening
    // pulls in the rest of the collision set from there.
    await projectRegistryRows(deps, survivors);
  } catch (err) {
    // eslint-disable-next-line no-console -- deliberate: see doc comment above for why this must
    // never propagate, and this module takes no logger dependency to report through otherwise.
    console.error('[facility-reconcile] failed to reproject after deleting facility_registry row', deleted.id, err);
  }
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
  // Registration is gated on the SAME "genuinely new concept" branch as the write below, not run
  // unconditionally — see `registerObservedSystem`'s doc comment for why.
  await registerObservedSystem(deps, system);
  await deps.admin.terms.importRows([
    observedFacilityConceptRow({ system, code, seenAt: now, reportCount: 0 }),
  ]);
}

/**
 * Ensure `system` has an ACTIVE `coding_systems` row, mirroring the ⛔-flagged block in
 * `scanObservedFacilities` (see that function's doc comment for the same trap: `upsertByUrl` inserts
 * `active: true` on a fresh row but its `onConflict` never re-activates one an operator, or an
 * earlier bug, left inactive).
 *
 * Called ONLY from `captureObservedFacility`'s "concept is genuinely new" branch — never
 * unconditionally on every call. `captureObservedFacilityFromProjection` runs once per projected
 * DiagnosticReport, i.e. on the ingest hot path, so registering on every call would add a
 * `coding_systems` write per report even for codes seen thousands of times before. Gating on
 * "concept just created" instead means the registration cost lands only on genuinely new codes —
 * self-limiting by construction, since a system accumulates a bounded, small number of distinct
 * facility codes relative to report volume. (A per-process memoisation cache was considered instead,
 * but rejected: it would skip re-activating a row an operator deactivates mid-process, and it would
 * need explicit invalidation to avoid going stale across a DB reset between tests — the
 * newly-created-concept gate needs neither.)
 *
 * Never throws: a registration failure here must not take down the concept write, which is the
 * operator-visible half of `captureObservedFacility` and would otherwise have succeeded on its own.
 * `packages/db/src/projection/cycle.ts` wraps the whole `onProjected` hook in its own try/catch, but
 * that containment drops the ENTIRE cycle's capture on any error — swallowing here keeps a
 * `coding_systems` hiccup from taking the concept capture down with it.
 */
async function registerObservedSystem(
  deps: Pick<ReconcileDeps, 'admin' | 'internalDb'>,
  system: string,
): Promise<void> {
  try {
    await ensureCodingSystemActive(deps, {
      url: system,
      systemCode: systemCodeFor(system),
      systemName: 'Observed facilities',
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- deliberate: see doc comment above for why this must
    // never propagate, and this module takes no logger dependency to report through otherwise.
    console.error('[facility-reconcile] failed to register coding_systems row for observed facility system', system, err);
  }
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
  const system = resolvedObservedSystem(projected.performer_system, sourceSystem);
  await captureObservedFacility(deps, system, performer, now);
}

// ── Task 13: the mapping-conflict review queue ─────────────────────────────────────────────────

/** One unresolved row of `facility_mapping_conflicts`, in the camelCase shape the HTTP route and
 *  the CLI both hand on. See `FacilityMappingConflictsTable` (packages/db/src/schema/internal.ts)
 *  and migration 078 for what wrote each field. */
export interface FacilityMappingConflict {
  id: number;
  fromSystem: string;
  fromCode: string;
  /** `'duplicate'` — a set of active SAME-AS mappings on one observed key naming DIFFERENT
   *  facilities; every member was deactivated. `'unsupported_map_type'` — one mapping whose
   *  `map_type` is not SAME-AS; it was left exactly as it was.
   *
   *  ⚠ Typed `string`, not a union: `kind` carries no CHECK constraint, so narrowing it here would
   *  be a promise about the column this reader cannot keep. */
  kind: string;
  /** Every mapping id in the recorded set, oldest first. */
  mappingIds: string[];
  /** Shape depends on `kind` — see `FacilityMappingConflictsTable.detail`. Passed through
   *  unexamined: this is what tells an operator WHICH facilities were competing. */
  detail: unknown;
  detectedAt: Date;
}

/**
 * Every conflict migration 078 recorded that nobody has settled yet.
 *
 * ⛔ `resolved_at is null` is not an optional filter — this is a QUEUE, and a settled row that
 * stayed in it would make it impossible to tell what still needs an operator. 078 writes every row
 * it records with `resolved_at` NULL.
 *
 * ⚠ Read-only, and `resolved_at` has no writer: measured — migration 078 is the only code path in
 * the repo that touches this table at all, and it never sets that column. So an operator who fixes
 * the underlying mappings still sees the row listed here forever. A known gap, deliberately not
 * closed: this task's job was to stop the table being invisible, not to build a resolution
 * workflow. The filter is still written as a filter so a future settle path has somewhere to land.
 *
 * Unbounded by design. The row count is bounded by how many facility mappings an install had
 * violating the invariant when 078 ran — a one-off backlog measured in tens, not a growing feed
 * (no code path inserts into this table after the migration).
 */
export async function listFacilityMappingConflicts(
  deps: Pick<ReconcileDeps, 'internalDb'>,
): Promise<FacilityMappingConflict[]> {
  const rows = await deps.internalDb
    .selectFrom('facility_mapping_conflicts')
    .select(['id', 'from_system', 'from_code', 'kind', 'mapping_ids', 'detail', 'detected_at'])
    .where('resolved_at', 'is', null)
    // Newest first, `id` breaking the tie: 078 records every row inside one transaction, so every
    // row from a given install shares one `detected_at` and ordering on it alone would be
    // nondeterministic.
    .orderBy('detected_at', 'desc')
    .orderBy('id')
    .execute();

  return rows.map((r) => ({
    id: Number(r.id),
    fromSystem: r.from_system,
    fromCode: r.from_code,
    kind: r.kind,
    mappingIds: r.mapping_ids as unknown as string[],
    detail: r.detail as unknown,
    detectedAt: r.detected_at,
  }));
}
