import type { Kysely } from 'kysely';
import type { ConceptRowInput, ExternalSchema, InternalSchema, RegistryRowForConcept, TerminologyAdminStore } from '@openldr/db';
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
    const registryMapping = candidates.find((c) => c.toSystem === FACILITY_REGISTRY_SYSTEM);
    // 2. National route: the candidate's target system must be PROVEN a facility register by
    //    `knownNationalSystems` — never merely "not the registry system" (Fix 1; see
    //    `ResolvedFacility.nonFacilityTarget`'s doc comment). Only checked when registry didn't win.
    const nationalMapping = registryMapping
      ? undefined
      : candidates.find((c) => knownNationalSystems.has(c.toSystem));
    // 3. Anything else the operator mapped to (the observed system itself, an unrelated active
    //    system such as LOINC) is a real, saved mapping that resolves to NEITHER real route.
    const hasFacilityRouteCandidate = !!registryMapping || !!nationalMapping;
    const nonFacilityTarget = !hasFacilityRouteCandidate && candidates.length > 0;

    const row = registryMapping
      ? byRegistryCode.get(registryMapping.toCode)
      : nationalMapping
        ? byNational.get(`${nationalMapping.toSystem}|${nationalMapping.toCode}`)
        : undefined;

    const resolvedVia: ResolvedVia | null = row ? (registryMapping ? 'registry' : 'national') : null;

    return {
      sourceSystem: r.sourceSystem,
      sourceCode: r.code,
      sourceDisplay: r.sourceDisplay,
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
      // A GENUINE facility-route mapping (registry or a proven national register) was authored but
      // points at nothing live — distinct from "never mapped" AND from `nonFacilityTarget` (Fix 1;
      // see that field's doc comment for why "candidates.length > 0 && !row" was wrong).
      targetMissing: hasFacilityRouteCandidate && !row,
      nonFacilityTarget,
    };
  });
}

/**
 * The coding-system URLs valid as a facility-mapping TARGET — the registry system, plus every
 * `national_system` value a LIVE `facility_registry` row actually carries. Backs the Observed tab's
 * OWN `TermMappingDialog` caller (Fix 2 of the self-mapping report): a mapping authored from the
 * Observed tab is always meant to resolve a facility, so offering the full active `coding_systems`
 * list (LOINC, ICD-10, UCUM, the observed system itself…) only sets the operator up to author a
 * mapping `resolveObservedFacilities` will file under `nonFacilityTarget` above. `/terminology`'s own
 * caller is UNCHANGED — it still passes the full list; this function is not wired into it.
 *
 * "Proven" mirrors `resolveObservedFacilities`'s own `knownNationalSystems` classification exactly —
 * never a hardcoded guess at what a national register's system might be called.
 *
 * ⚠ Always includes the registry system, even when the table holds ZERO `national_system` values (a
 * fresh install, or a register built entirely from local codes) — the dropdown must never be empty;
 * see this function's own test for the pinned fresh-install behaviour.
 */
export async function facilityMappingTargetSystems(deps: Pick<ReconcileDeps, 'internalDb'>): Promise<string[]> {
  const rows = await deps.internalDb
    .selectFrom('facility_registry')
    .select('national_system')
    .where('national_system', 'is not', null)
    .execute();
  const nationalSystems = [...new Set(rows.map((r) => r.national_system).filter((s): s is string => s !== null))];
  return [...new Set([FACILITY_REGISTRY_SYSTEM, ...nationalSystems.sort()])];
}

export interface PublishResult {
  resolved: number;
  unmapped: number;
  targetMissing: number;
  /** Fix 1: rows whose mapping resolves to `ResolvedFacility.nonFacilityTarget` — a real, saved
   *  mapping that targets neither the registry nor a proven national register. Counted separately
   *  so `unmapped` never silently absorbs it (see that field's doc comment). */
  nonFacilityTarget: number;
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
    // it is a real mapping that just doesn't target a facility (see its own counter below).
    unmapped: resolved.filter((r) => r.resolvedVia === null && !r.targetMissing && !r.nonFacilityTarget).length,
    targetMissing: resolved.filter((r) => r.targetMissing).length,
    nonFacilityTarget: resolved.filter((r) => r.nonFacilityTarget).length,
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
 * it, and this function only ever deletes a concept keyed on the `id` of a row it IS projecting (see
 * `deleteSupersededIdConcepts` below). Keeping a deleted facility's concept means a `term_mappings`
 * row an operator already authored against it is not silently erased — it keeps resolving to a live
 * concept even though its target facility is gone, which is a DIFFERENT, deliberately-kept gap from
 * the one this function's own delete step closes (a row still present in the registry, whose concept
 * merely moved to a different code).
 */
export async function publishRegistryConcepts(
  deps: ReconcileDeps,
  opts: { apply?: boolean } = {},
): Promise<{ concepts: number; systemRegistered: boolean }> {
  const registry = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name', 'local_code', 'national_code'])
    .execute();

  if (!opts.apply) return { concepts: registry.length, systemRegistered: false };

  await ensureRegistrySystemActive(deps);

  if (registry.length > 0) {
    // `registry` IS the whole table here (this function reprojects everything, unlike the given-rows
    // `projectRegistryRows` below) — so `registryConceptRows`' own in-batch collision check already
    // sees every row that could possibly collide with any other. No extra lookup needed.
    const inputs = registry.map((r): RegistryRowForConcept => ({ id: r.id, name: r.name, localCode: r.local_code, nationalCode: r.national_code }));
    await deps.admin.terms.importRows(registryConceptRows(inputs));
    // Write the new projection FIRST, delete the superseded id-keyed leftover SECOND — see
    // `deleteSupersededIdConcepts`'s doc comment for why the order matters.
    await deleteSupersededIdConcepts(deps, registryRowIdsWithSupersededIdConcept(inputs));
  }

  return { concepts: registry.length, systemRegistered: true };
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
 * Shared by `publishRegistryConcepts` and `projectRegistryRows` so the delete itself, not just the
 * determination of WHICH ids, cannot drift between the two call sites.
 *
 * Callers run this AFTER their own `importRows` call, never before: the new preferred-code concept
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
 * Ensure `FACILITY_REGISTRY_SYSTEM`'s `coding_systems` row exists and is ACTIVE. Shared by
 * `publishRegistryConcepts` (the full reprojection) and `projectRegistryRows` (the given-rows path
 * below) so the two agree on exactly one registration.
 *
 * No try/catch here (see `ensureCodingSystemActive`'s doc comment) — `publishRegistryConcepts`
 * lets a failure propagate as an explicit operator action, while `projectRegistryRows` supplies its
 * own containment around this call.
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
 * Shares `registryConceptRows` with `publishRegistryConcepts` so the two projections can never drift
 * on shape (code = `local_code`, else `national_code`, else the row's `id` on a collision; display =
 * its `name`).
 *
 * ⚠ Collision detection with only PARTIAL visibility: `rows` carries only `{id, name}` — the caller
 * (a POST/PUT route, the CSV importer) hands in exactly what it just wrote, nothing more — so this
 * function cannot compute a candidate code, let alone detect a collision, from its arguments alone
 * the way `publishRegistryConcepts` can (that one already has the WHOLE registry loaded). It goes and
 * looks instead: it re-reads the given rows' own `local_code`/`national_code`, then queries for any
 * OTHER `facility_registry` row anywhere in the table that claims one of the same candidate codes,
 * and forces THOSE rows' concepts to fall back to their own `id` via `registryConceptRows`'
 * `forceOwnIdFor`. This is safe specifically because every caller of this function invokes it AFTER
 * its own write has already committed (see the doc comments on the create/update routes and
 * `facility-import.ts`'s call site) — by the time this runs, the live table already reflects both
 * "the rest of this batch" (a multi-row CSV import) and "everything pre-existing", so there is no
 * third category of row a DB lookup here could miss. A single-row call (the common POST/PUT case)
 * gets exactly the same protection as a batch, at the cost of two extra reads.
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
    await ensureRegistrySystemActive(deps);

    const ids = rows.map((r) => r.id);
    const own = await deps.internalDb
      .selectFrom('facility_registry')
      .select(['id', 'local_code', 'national_code'])
      .where('id', 'in', ids)
      .execute();
    const ownById = new Map(own.map((r) => [r.id, r]));

    const inputs: RegistryRowForConcept[] = rows.map((r) => {
      const found = ownById.get(r.id);
      return { id: r.id, name: r.name, localCode: found?.local_code ?? null, nationalCode: found?.national_code ?? null };
    });

    // Candidate codes this batch WANTS to use — dedup'd, since two of the given rows could (rarely)
    // want the same code and both need to be included in the collision lookup below.
    const candidates = [...new Set(inputs.map((r) => registryPreferredCode(r)).filter((c): c is string => c !== null))];

    const forceOwnIdFor = new Set<string>();
    if (candidates.length > 0) {
      // Every OTHER row in the table (this batch's own rows included — a row always "claims" its own
      // code) that claims one of our candidate codes via EITHER column. Matching on `local_code` OR
      // `national_code` independently, not paired with `national_system`, mirrors what
      // `registryPreferredCode` itself compares: a concept's `code` is a bare string, so a collision
      // is possible against either column regardless of which system a national code belongs to.
      const claimants = await deps.internalDb
        .selectFrom('facility_registry')
        .select(['id', 'local_code', 'national_code'])
        .where((eb) => eb.or([eb('local_code', 'in', candidates), eb('national_code', 'in', candidates)]))
        .execute();
      const claimantIdsByCode = new Map<string, Set<string>>();
      const addClaim = (code: string | null, id: string): void => {
        if (code === null || !candidates.includes(code)) return;
        const set = claimantIdsByCode.get(code) ?? new Set<string>();
        set.add(id);
        claimantIdsByCode.set(code, set);
      };
      for (const c of claimants) {
        addClaim(c.local_code, c.id);
        addClaim(c.national_code, c.id);
      }
      for (const r of inputs) {
        const candidate = registryPreferredCode(r);
        // More than one DISTINCT row id claiming this code means at least one OTHER row (not just
        // this one) wants it too — a real collision, not just this row seeing its own claim reflected
        // back.
        if (candidate && (claimantIdsByCode.get(candidate)?.size ?? 0) > 1) forceOwnIdFor.add(r.id);
      }
    }

    await deps.admin.terms.importRows(registryConceptRows(inputs, { forceOwnIdFor }));
    // Write the new projection FIRST, delete the superseded id-keyed leftover SECOND — see
    // `deleteSupersededIdConcepts`'s doc comment for why the order matters. Scoped to exactly the
    // rows this call was handed, same as the write above — a facility outside `rows` (including one
    // genuinely absent from `facility_registry`) is never touched.
    await deleteSupersededIdConcepts(deps, registryRowIdsWithSupersededIdConcept(inputs, { forceOwnIdFor }));
  } catch (err) {
    // eslint-disable-next-line no-console -- deliberate: see doc comment above for why this must
    // never propagate, and this module takes no logger dependency to report through otherwise.
    console.error('[facility-reconcile] failed to project facility_registry row(s) into FACILITY_REGISTRY_SYSTEM', err);
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
