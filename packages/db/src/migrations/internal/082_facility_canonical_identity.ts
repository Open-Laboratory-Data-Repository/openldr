import { createHash, randomUUID } from 'node:crypto';
import { type Kysely } from 'kysely';

// Facility registry slice — canonical identity, DATA half (B1 task 4). Migration 081 added the
// schema (`coding_systems.kind`), Task 3 gated both HTTP import doors on a REGISTERED register's
// canonical URI. This migration migrates what already exists: every distinct `national_system`
// string an operator once typed is resolved to a real `coding_systems` register row, the column is
// rewritten to that register's URI, and every facility id derived from the old string is re-derived
// from the URI.
//
// ⛔ THE MIGRATION NEVER TOUCHES THE EXTERNAL WAREHOUSE. `facility_map.registry_id` holds facility
// ids too, but that table lives in a separate database that may be Postgres, SQL Server or MySQL and
// may be unreachable when migrations run — a migration writing to it either fails the boot or
// half-succeeds, leaving the reporting dimension pointing at ids that no longer exist. Instead this
// enqueues a `facility-map-rebuild` job. That is sufficient because `publishFacilityMap({apply:true})`
// (packages/bootstrap/src/facility-reconcile.ts) is a FULL REGENERATION — it runs
// `deleteFrom('facility_map')` and re-inserts every resolved row inside one transaction — so the
// stale dimension is replaced wholesale carrying the new ids. This module's only imports are
// `node:crypto` and `kysely`; it has no way to open an external connection, and the test pins that.

/** The namespace every register minted by this migration lives in. */
export const FACILITY_REGISTER_URI_PREFIX = 'urn:openldr:cs:facility-register:';

// ⛔ Deliberately INLINED, not imported — the frozen-snapshot rule 075/077/078 all document: a
// migration records what it wrote when it ran, and importing a live constant a later change could
// edit would let this migration's behaviour drift out from under it. `FACILITY_REGISTER_KIND` is
// exported from 081, but 081 is itself a frozen snapshot, so importing it would couple two of them.
const FACILITY_REGISTER_KIND = 'facility-register';
const REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';
const MAP_REBUILD_KIND = 'facility-map-rebuild';
const DHIS2_PLUGIN_ID = 'dhis2-sink';
const DHIS2_ORG_UNIT_COLLECTION = 'orgUnitMaps';

/** The per-register coding systems `observedFieldSystem` derives for a controlled field
 *  (`packages/bootstrap/src/facility-controlled-fields.ts`, `CONTROLLED_FIELDS = level/status/
 *  country`). Inlined for the same frozen-snapshot reason as the constants above. */
const CONTROLLED_FIELD_PREFIXES = [
  'urn:openldr:cs:facility-level:',
  'urn:openldr:cs:facility-status:',
  'urn:openldr:cs:facility-country:',
];

/** The exact algorithm `observedFieldSystem` and `observedSystemForFeed` use — duplicated, not
 *  imported, for the frozen-snapshot reason above (and `@openldr/bootstrap` is downstream of this
 *  package anyway). */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
}

/** Slugify-with-hash-fallback, byte-identical to `observedFieldSystem`'s: non-alphanumeric runs
 *  collapse to one `_`, edges trim, lowercase — and a value that slugifies to NOTHING (e.g. `///`)
 *  falls back to a stable hash rather than collapsing onto the bare prefix, which would make every
 *  punctuation-only value one register. */
function slugify(value: string): string {
  const trimmed = (value ?? '').trim();
  const slug = trimmed.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return slug.length > 0 ? slug : djb2Hex(trimmed);
}

/** The canonical URI a typed `national_system` value resolves to when no register is already
 *  registered under that exact string. Exported so a test (and a later operator tool) never
 *  re-implements the slug. */
export function registerUriFor(value: string): string {
  return `${FACILITY_REGISTER_URI_PREFIX}${slugify(value)}`;
}

/** ⛔ A byte-for-byte reimplementation of `idFor` (`packages/terminology/src/facility-csv.ts`) —
 *  `fac-` + the first 16 hex chars of sha256(`<system>|<code>`), no normalisation. It is copied
 *  rather than imported because `@openldr/terminology` depends on `@openldr/db` (facility-csv.ts
 *  imports `FacilityRecord` from it), so importing it here would close a dependency cycle; the
 *  frozen-snapshot rule points the same way. Cross-checked in the test against the
 *  `HFR|100 -> fac-d112c779ad583160` value already measured and quoted in facility-csv.ts's own doc
 *  comment, so a drift in either implementation is visible. */
function idFor(nationalSystem: string, nationalCode: string): string {
  return `fac-${createHash('sha256').update(`${nationalSystem}|${nationalCode}`).digest('hex').slice(0, 16)}`;
}

interface RegistryRow {
  id: string;
  national_system: string | null;
  national_code: string | null;
}

interface Move {
  oldId: string;
  /** Equal to `oldId` when the row's id was never derived from the register — see the
   *  `national_code` guard in `planMoves`. */
  newId: string;
  rawValue: string;
  uri: string;
}

/** Resolve each distinct typed value to a register URI, refusing any merge.
 *
 *  ⛔ REFUSE, NEVER MERGE. `HFR` and `hfr` slug to the same URI. Adopting one for both would fuse
 *  two registers' facilities into one register — the corruption A2b spent a whole slice proving is
 *  how national registries get destroyed. A refusal an operator has to resolve by hand is correct;
 *  a silent merge is not. The error names BOTH raw values so the operator can find them.
 *
 *  A value that is ALREADY the url of a registered facility register resolves to itself: Task 3
 *  gated both HTTP import doors on exactly such a URI, so a live install can already hold rows keyed
 *  that way, and deriving a URI from a URI would move a permanent id for no reason. */
function resolveRegisters(values: string[], registeredUrls: ReadonlySet<string>): Map<string, string> {
  const uriByValue = new Map<string, string>();
  const firstClaimant = new Map<string, string>();
  // Sorted so the refusal message names the pair in a stable order regardless of row order.
  for (const value of [...values].sort()) {
    const uri = registeredUrls.has(value) ? value : registerUriFor(value);
    const prior = firstClaimant.get(uri);
    if (prior !== undefined) {
      throw new Error(
        `082_facility_canonical_identity refuses to migrate: national_system values ${JSON.stringify(prior)} `
        + `and ${JSON.stringify(value)} both resolve to the register ${uri}. Migrating would merge two `
        + 'registers\' facilities into one. Correct the duplicate spelling in facility_registry '
        + '(and any facility_import_runs referring to it) before running migrations again.',
      );
    }
    firstClaimant.set(uri, value);
    uriByValue.set(value, uri);
  }
  return uriByValue;
}

/** One entry per registry row whose `national_system` string changes.
 *
 *  ⚠ `newId === oldId` for a row that carries a `national_system` but NO `national_code`. Such a row
 *  was never keyed by `idFor` — that hash is only ever applied to an imported row, and the table's
 *  `facility_registry_has_a_code` CHECK lets a hand-entered row carry a register name with only a
 *  `local_code`. Re-deriving its id would invent an identity it never had. Its `national_system` is
 *  still rewritten, so it names the register the same way every other row does. */
function planMoves(rows: RegistryRow[], uriByValue: Map<string, string>): Move[] {
  const moves: Move[] = [];
  for (const row of rows) {
    const rawValue = row.national_system;
    if (rawValue === null || rawValue === '') continue;
    const uri = uriByValue.get(rawValue);
    if (uri === undefined || uri === rawValue) continue;
    const code = row.national_code;
    const newId = code === null || code === '' ? row.id : idFor(uri, code);
    moves.push({ oldId: row.id, newId, rawValue, uri });
  }
  return moves;
}

/** ⛔ Every new id must be free before ANY row moves, or the order rows are updated in becomes
 *  load-bearing (row A moving onto a primary key row B has not vacated yet is a PK violation, and
 *  which of them moves first is just scan order). Checked up front so the answer cannot depend on
 *  it — and so a genuine clash is reported as itself rather than as a constraint error. */
function assertNoIdClash(moves: Move[], allRows: RegistryRow[]): void {
  const taken = new Map<string, string>();
  for (const m of moves) {
    if (m.newId === m.oldId) continue;
    const other = taken.get(m.newId);
    if (other !== undefined) {
      throw new Error(
        `082_facility_canonical_identity refuses to migrate: facilities ${other} and ${m.oldId} both `
        + `re-key to ${m.newId}.`,
      );
    }
    taken.set(m.newId, m.oldId);
  }
  // ⚠ An id held by a row that is ITSELF moving away is refused too, not waved through. A chain
  // (A re-keys onto B's id while B re-keys onto a third) is migratable in principle, but only in an
  // order this function does not control — the updates below run in `moves` order, so A would be
  // written while B still holds the key. Requiring every destination to be free outright makes the
  // outcome independent of that order. Two sha256 facility ids meeting this way is not a case worth
  // ordering for; it is a case worth refusing loudly.
  const occupied = new Set(allRows.map((r) => r.id));
  for (const m of moves) {
    if (m.newId === m.oldId) continue;
    if (occupied.has(m.newId)) {
      throw new Error(
        `082_facility_canonical_identity refuses to migrate: facility ${m.oldId} re-keys to ${m.newId}, `
        + 'which another facility already holds.',
      );
    }
  }
}

/**
 * Resolve typed `national_system` values to registers, re-key every facility derived from one, and
 * mark the report-facing dimension stale.
 *
 * Exported (like 081's `backfillRegisterState`) so the test can drive it against LEGACY-SHAPED rows
 * seeded AFTER the full migration set has run: `makeMigratedDb()` executes every migration first, so
 * a row a test inserts afterwards never meets an inline `up()`-only rewrite.
 *
 * ⛔ THE SPEC'S "FK CASCADE" DOES NOT HOLD FOR AN UPDATE. Its table of the nine places a facility id
 * is written down calls `facility_concept_projection.registry_id` an automatic cascade. IT IS NOT:
 * migration 077 declares `references('facility_registry.id').onDelete('cascade')` and nothing else,
 * so ON UPDATE is NO ACTION and an id UPDATE is REFUSED, not followed. Measured under pg-mem:
 * "update or delete on table facility_registry violates foreign key constraint on table
 * facility_concept_projection_registry_id_fk". That is why the link rows are captured, DELETED, and
 * re-inserted around the parent update below rather than updated in place — no DDL, no constraint
 * juggling, and it works identically on real Postgres.
 * (`facility_registry_identifiers`, the spec's other "cascade" row, does not exist on this branch —
 * no migration creates it — so there is nothing to rewrite there yet.)
 *
 * ⚠ Three locations the spec's id table does not list, rewritten here because THIS migration is what
 * breaks them:
 *  - `term_mappings.to_system`. The national resolution route matches a mapping's `to_system`
 *    against the set of live `facility_registry.national_system` values (`knownNationalSystems` in
 *    `resolveObservedFacilities`, packages/bootstrap/src/facility-reconcile.ts). Rewriting the
 *    registry column without it silently stops every national-route mapping resolving.
 *  - the controlled-field namespaces. `observedFieldSystem(field, nationalSystem)` slugifies the
 *    register name into a coding-system url, so mappings authored for a register imported as `HFR`
 *    live under `urn:openldr:cs:facility-level:hfr`; after the rewrite that function derives a
 *    different url and every one of those mappings reads as unmapped.
 *  - `facility_import_runs.national_system`. It names a REGISTER, and its `active_key` is derived
 *    per register; left behind, the run history for a register no longer joins to it. The file
 *    hash, counts and actor of each run are untouched — only the register's spelling changes.
 */
export async function rekey<DB>(db: Kysely<DB>): Promise<void> {
  const anyDb = db as unknown as Kysely<any>;

  const rows: RegistryRow[] = await anyDb
    .selectFrom('facility_registry')
    .select(['id', 'national_system', 'national_code'])
    // `id` is unique, so this is a total order — the plan below is then the same on every dialect
    // (pg-mem's scan order is stable and would hide a missing tiebreaker).
    .orderBy('id')
    .execute();

  const distinctValues = [...new Set(
    rows.map((r) => r.national_system).filter((v): v is string => v !== null && v !== ''),
  )];
  if (distinctValues.length === 0) return;

  const registeredUrls = new Set(
    (await anyDb.selectFrom('coding_systems').select('url').where('kind', '=', FACILITY_REGISTER_KIND).execute())
      .map((r: { url: string | null }) => r.url)
      .filter((u: string | null): u is string => u !== null),
  );

  // Refusals happen BEFORE the first write, so a refused migration leaves the database exactly as it
  // found it — which matters beyond tidiness: pg-mem does not roll back a thrown statement, and a
  // real deployment re-runs this migration after the operator resolves the duplicate.
  const uriByValue = resolveRegisters(distinctValues, registeredUrls);
  const moves = planMoves(rows, uriByValue);
  if (moves.length === 0) return;
  assertNoIdClash(moves, rows);

  // 1. Mint the register rows. `kind` is what makes them selectable through
  //    `createFacilityRegisterSourceStore` (packages/db/src/facility-register-sources.ts); the
  //    operator's original typed value is preserved as the human-facing `system_name`, so the
  //    register is recognisable in the picker Task 9 builds.
  for (const [rawValue, uri] of uriByValue) {
    if (registeredUrls.has(uri)) continue;
    const id = `cs-freg-${createHash('sha256').update(uri).digest('hex').slice(0, 12)}`;
    await anyDb.insertInto('coding_systems').values({
      id,
      system_code: slugify(rawValue),
      system_name: rawValue,
      url: uri,
      system_version: null,
      description: `Facility register migrated from the typed national_system value ${JSON.stringify(rawValue)}.`,
      active: true,
      seeded: false,
      kind: FACILITY_REGISTER_KIND,
    } as never).execute();
    registeredUrls.add(uri);
  }

  const newIdByOld = new Map(moves.map((m) => [m.oldId, m.newId]));
  const oldIds = moves.map((m) => m.oldId);

  // 2. Lift the projection links out of the way of the FK (see this function's ⛔ note), …
  const links = await anyDb
    .selectFrom('facility_concept_projection')
    .selectAll()
    .where('registry_id', 'in', oldIds)
    .execute() as { registry_id: string; concept_code: string }[];
  await anyDb.deleteFrom('facility_concept_projection').where('registry_id', 'in', oldIds).execute();

  // 3. … move the registry rows themselves, …
  for (const m of moves) {
    await anyDb.updateTable('facility_registry')
      .set({ id: m.newId, national_system: m.uri })
      .where('id', '=', m.oldId)
      .execute();
  }

  // 4. … and put the links back. `concept_code` is rewritten ONLY when it IS the row's id: that is
  //    the collision fallback `registryConceptRows` (packages/db/src/facility-observed.ts) writes
  //    when two facilities claim one human code, and `facility_concept_projection.concept_code ===
  //    registry_id` is precisely how `widenToCollidingRows` recognises a parked row. A link naming a
  //    HUMAN code is left alone — that code did not move.
  if (links.length > 0) {
    // The `?? l.registry_id` fallbacks are unreachable — `links` was selected `where registry_id in
    // oldIds` and `newIdByOld` is keyed on exactly those ids — and exist only to keep the value a
    // `string` rather than `string | undefined`.
    await anyDb.insertInto('facility_concept_projection').values(links.map((l) => ({
      ...l,
      registry_id: newIdByOld.get(l.registry_id) ?? l.registry_id,
      concept_code: l.concept_code === l.registry_id
        ? (newIdByOld.get(l.registry_id) ?? l.registry_id)
        : l.concept_code,
    })) as never).execute();
  }

  // 5. Everything else that names the old id as a plain string.
  for (const m of moves) {
    if (m.newId === m.oldId) continue;
    // The parked concept itself, so the link and every mapping below still name a live concept.
    await anyDb.updateTable('terminology_concepts')
      .set({ code: m.newId }).where('system', '=', REGISTRY_SYSTEM).where('code', '=', m.oldId).execute();
    await anyDb.updateTable('term_mappings')
      .set({ to_code: m.newId }).where('to_system', '=', REGISTRY_SYSTEM).where('to_code', '=', m.oldId).execute();
    await anyDb.updateTable('facility_jobs')
      .set({ registry_id: m.newId }).where('registry_id', '=', m.oldId).execute();
    await anyDb.updateTable('form_definitions')
      .set({ facility_id: m.newId }).where('facility_id', '=', m.oldId).execute();
    await anyDb.updateTable('form_versions')
      .set({ facility_id: m.newId }).where('facility_id', '=', m.oldId).execute();
    // Migration 008's table. 036 copied its contents into `plugin_data` but never dropped it, so
    // both still exist and both are rewritten.
    await anyDb.updateTable('dhis2_orgunit_map')
      .set({ facility_id: m.newId }).where('facility_id', '=', m.oldId).execute();
  }

  // 6. The LIVE DHIS2 org-unit map: `plugin_data`, which is what `apps/server/src/workflows-routes
  //    .ts` reads through `pluginData.list('dhis2-sink', 'orgUnitMaps')`. The facility id is both the
  //    row KEY (part of the primary key, so the row is re-inserted rather than updated) and a field
  //    inside the jsonb doc. The doc is rewritten in JS, not with a jsonb operator, so this works
  //    the same on every dialect and under pg-mem.
  const orgUnitDocs = await anyDb
    .selectFrom('plugin_data')
    .selectAll()
    .where('plugin_id', '=', DHIS2_PLUGIN_ID)
    .where('collection', '=', DHIS2_ORG_UNIT_COLLECTION)
    .where('key', 'in', oldIds)
    .execute() as { key: string; doc: unknown }[];
  if (orgUnitDocs.length > 0) {
    await anyDb.deleteFrom('plugin_data')
      .where('plugin_id', '=', DHIS2_PLUGIN_ID)
      .where('collection', '=', DHIS2_ORG_UNIT_COLLECTION)
      .where('key', 'in', oldIds)
      .execute();
    await anyDb.insertInto('plugin_data').values(orgUnitDocs.map((row) => {
      const newId = newIdByOld.get(row.key) ?? row.key;
      const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
      const rewritten = doc && typeof doc === 'object' && (doc as { facilityId?: unknown }).facilityId === row.key
        ? { ...(doc as object), facilityId: newId }
        : doc;
      return { ...row, key: newId, doc: JSON.stringify(rewritten) };
    }) as never).execute();
  }

  // 7. Per-VALUE rewrites — the three locations that name the register STRING rather than a facility
  //    id. See this function's ⚠ note for why each one is here.
  for (const [rawValue, uri] of uriByValue) {
    if (uri === rawValue) continue;
    await anyDb.updateTable('term_mappings').set({ to_system: uri }).where('to_system', '=', rawValue).execute();
    await anyDb.updateTable('facility_import_runs')
      .set({ national_system: uri }).where('national_system', '=', rawValue).execute();
    // ⛔ `active_key` separately, and matched on its OWN value: `createFacilityImportRunStore` sets
    // it to the national system while a run is live and NULLs it on every terminal status, so
    // rewriting only `national_system` would leave a live run guarding the old spelling — and an
    // import against the register's URI would then slip past the one-active-run index (080) that
    // exists to stop two imports writing one register at once.
    await anyDb.updateTable('facility_import_runs')
      .set({ active_key: uri }).where('active_key', '=', rawValue).execute();

    for (const prefix of CONTROLLED_FIELD_PREFIXES) {
      const from = `${prefix}${slugify(rawValue)}`;
      const to = `${prefix}${slugify(uri)}`;
      if (from === to) continue;
      await anyDb.updateTable('term_mappings').set({ from_system: to }).where('from_system', '=', from).execute();
      await anyDb.updateTable('terminology_concepts').set({ system: to }).where('system', '=', from).execute();
      // `coding_systems.url` carries a unique index (012), so the row is moved only when the
      // destination is free. When it is not, the destination row is already the register's
      // controlled-field system and the stale one is left for an operator to retire — losing a
      // coding-system row is not something a migration should do silently.
      const taken = await anyDb.selectFrom('coding_systems').select('id').where('url', '=', to).executeTakeFirst();
      if (!taken) {
        await anyDb.updateTable('coding_systems').set({ url: to }).where('url', '=', from).execute();
      }
    }
  }

  // 8. Mark the warehouse dimension stale. ⛔ Enqueued, never written across — see the module
  //    banner. Coalesced by hand on `active_key` (migration 079's plain unique index): the store's
  //    `enqueue` lives in `facility-job-store.ts`, which a migration must not import.
  const alreadyQueued = await anyDb
    .selectFrom('facility_jobs').select('id').where('active_key', '=', MAP_REBUILD_KIND).executeTakeFirst();
  if (!alreadyQueued) {
    await anyDb.insertInto('facility_jobs').values({
      id: `fj-${randomUUID()}`,
      kind: MAP_REBUILD_KIND,
      status: 'queued',
      attempts: 0,
      registry_id: null,
      requested_by: 'migration:082_facility_canonical_identity',
      active_key: MAP_REBUILD_KIND,
    } as never).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await rekey(db);
}

/** ⛔ NOT REVERSIBLE, and deliberately a no-op rather than a guess. Reversing would mean re-deriving
 *  each facility's OLD id from the typed string this migration replaced — recoverable, since it is
 *  preserved as the register's `system_name` — and then re-keying every reference back. That is a
 *  second full re-key with the same nine-location blast radius, run at the moment an operator is
 *  already rolling something back, and it cannot restore rows written since (a facility imported
 *  after this migration has no old id to return to). Dropping the register rows would be worse
 *  still: `facility_registry.national_system` would then name a `coding_systems` row that no longer
 *  exists. Leaving the data as-is is the honest answer; `up` is idempotent, so re-applying is safe. */
export async function down(): Promise<void> {
  // intentionally empty — see the doc comment above
}
