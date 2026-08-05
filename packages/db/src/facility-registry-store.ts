import { type Kysely, sql } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';
import { FACILITY_ADMIN_LEVELS, type FacilityAdminLevel } from './facility-answers';

// `FacilityAdminLevel`/`FACILITY_ADMIN_LEVELS` live in `./facility-answers` (the browser-safe
// subpath) rather than here — that is the one dependency-free seam `apps/studio` already imports
// through (`@openldr/db/facility-answers`, see FacilityDialog.tsx), so the studio UI can import the
// exact same whitelist the server validates against instead of hand-duplicating it. Re-exported
// below (and from this package's root `index.ts`) so every existing server-side caller of
// `FacilityAdminLevel`/`FACILITY_ADMIN_LEVELS` from `@openldr/db`/`./facility-registry-store`
// keeps working unchanged.
export { FACILITY_ADMIN_LEVELS };
export type { FacilityAdminLevel };

/** A curated facility. camelCase; the store translates to/from the snake_case row. */
export interface FacilityRecord {
  id: string;
  /** OURS — required at data entry, absent on a nationally-imported row. */
  localCode?: string | null;
  nationalSystem?: string | null;
  /** THEIRS — the only code an imported row carries. */
  nationalCode?: string | null;
  name: string;
  level?: string | null;
  ownership?: string | null;
  status?: string | null;
  country?: string | null;
  zone?: string | null;
  region?: string | null;
  district?: string | null;
  council?: string | null;
  ward?: string | null;
  village?: string | null;
  addressText?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Fields a form added beyond the core — extend without a migration (the Users pattern). */
  extras?: Record<string, unknown>;
  /** NULL = lab-local, 'central' = central-managed and replaceable by down-sync. */
  managedOrigin?: string | null;
  source: 'manual' | 'import';
}

export interface FacilityAlias {
  sourceSystem: string;
  sourceCode: string;
  registryId: string;
  createdBy?: string | null;
}

export interface FacilityListOptions {
  region?: string;
  district?: string;
  council?: string;
  status?: string;
  /** Defaults to 200 when omitted — a national register runs 10-15k rows and an unbounded scan is
   *  never what a caller wants. Pass an explicit value (including a large one) to override. */
  limit?: number;
}

export interface FacilityAdminValueCount {
  /** The observed value, verbatim (never normalised/cased). */
  value: string;
  /** How many facility_registry rows carry this value for the requested level. */
  count: number;
}

export interface FacilityRegistryStore {
  get(id: string): Promise<FacilityRecord | undefined>;
  /** Capped at 200 rows by default — see `FacilityListOptions.limit`. */
  list(opts?: FacilityListOptions): Promise<FacilityRecord[]>;
  /**
   * Distinct, non-blank values already present in `facility_registry.<level>`, ranked by
   * frequency (commonest first) with their counts — so an operator can see a real value
   * (`Dodoma (142)`) outrank a typo (`Dodomaa (1)`). Backs the `suggest` field type (Task 1):
   * there is no bounded vocabulary for a country's admin geography, so suggestions are derived
   * from what has actually been entered rather than hardcoded.
   *
   * `scope` filters by the OTHER admin columns already chosen (e.g. districts scoped to a
   * region) — a key that is absent, undefined, or blank in `scope` means "unfiltered for that
   * level", never "match the empty string". A `scope` entry for `level` itself is ignored
   * (scoping a column by itself is meaningless). Rows where `<level>` is NULL or blank are
   * excluded — they are not suggestions. Capped at `MAX_ADMIN_VALUES` rows.
   */
  distinctAdminValues(
    level: FacilityAdminLevel,
    scope?: Partial<Record<FacilityAdminLevel, string>>,
  ): Promise<FacilityAdminValueCount[]>;
  /**
   * Conflicts on `id` ONLY. The spec keys re-import on `(national_system, national_code)`, and the
   * CSV parser satisfies that by deriving `id` deterministically from those two fields — but a
   * hand-entered facility that later gains a national code was NOT created that way, so upserting it
   * by national identity collides with the partial unique index
   * (`facility_registry_national_unique`) as a raw constraint violation, not a clean update.
   * A caller importing by national identity must resolve `(national_system, national_code) → id`
   * itself first (e.g. via a lookup method) before calling `upsert`. Widening the conflict target
   * here is deliberately deferred to a dedicated method alongside the CLI that needs it.
   */
  upsert(rec: FacilityRecord): Promise<FacilityRecord>;
  remove(id: string): Promise<void>;
  /** Attach an observed feed code to a facility. Idempotent; re-points if already attached elsewhere. */
  attachAlias(alias: FacilityAlias): Promise<void>;
  detachAlias(sourceSystem: string, sourceCode: string): Promise<void>;
  /** What facility did this feed's code mean? `undefined` when nothing has been attached yet. */
  resolve(sourceSystem: string, sourceCode: string): Promise<FacilityRecord | undefined>;
  listAliases(registryId: string): Promise<FacilityAlias[]>;
}

/** A national register runs 10-15k rows; `list()` with no options must not return all of them. */
const DEFAULT_LIST_LIMIT = 200;

// A real country's admin geography (zones/regions/districts/councils) tops out in the low
// hundreds even for a large country; this is not a row cap (list()'s DEFAULT_LIST_LIMIT), it caps
// the number of DISTINCT values returned. Generous headroom for messy free-text data (typos,
// re-namings) while still bounding the response against a pathological column.
const MAX_ADMIN_VALUES = 1000;

type Row = InternalSchema['facility_registry'];

/** Exported for the bulk import path (facility-import.ts in @openldr/bootstrap): it writes rows via
 *  a batched multi-row upsert instead of this store's one-row-per-transaction `upsert()`, but needs
 *  the exact same camelCase <-> snake_case shape so a hand-entered facility, an interactively-edited
 *  one, and a bulk-imported one all land identically. */
export function toRecord(r: Row): FacilityRecord {
  return {
    id: r.id,
    localCode: r.local_code,
    nationalSystem: r.national_system,
    nationalCode: r.national_code,
    name: r.name,
    level: r.level,
    ownership: r.ownership,
    status: r.status,
    country: r.country,
    zone: r.zone,
    region: r.region,
    district: r.district,
    council: r.council,
    ward: r.ward,
    village: r.village,
    addressText: r.address_text,
    phone: r.phone,
    latitude: r.latitude,
    longitude: r.longitude,
    extras: (r.extras ?? {}) as Record<string, unknown>,
    managedOrigin: r.managed_origin,
    source: r.source as 'manual' | 'import',
  };
}

export function toRow(rec: FacilityRecord): Omit<Row, 'created_at' | 'updated_at'> {
  return {
    id: rec.id,
    local_code: rec.localCode ?? null,
    national_system: rec.nationalSystem ?? null,
    national_code: rec.nationalCode ?? null,
    name: rec.name,
    level: rec.level ?? null,
    ownership: rec.ownership ?? null,
    status: rec.status ?? null,
    country: rec.country ?? null,
    zone: rec.zone ?? null,
    region: rec.region ?? null,
    district: rec.district ?? null,
    council: rec.council ?? null,
    ward: rec.ward ?? null,
    village: rec.village ?? null,
    address_text: rec.addressText ?? null,
    phone: rec.phone ?? null,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    extras: rec.extras ?? {},
    managed_origin: rec.managedOrigin ?? null,
    source: rec.source,
  };
}

// canonicalHash matches the established pattern in report-store.ts's hashOf. Its difference from
// a plain JSON.stringify (order-independence on jsonb key order) is NOT currently reachable here:
// upsert() hashes the row it reads back from the transaction, and by the time that SELECT runs,
// Postgres (and pg-mem, faithfully) has already canonicalized the jsonb's key order in storage —
// so the input to this function is already order-normalized. It is kept anyway as cheap insurance:
// the hash would become order-sensitive the moment upsert() is changed to hash the incoming record
// instead of the stored one.
function hashOf(rec: FacilityRecord): string {
  return canonicalHash(rec);
}

/**
 * Builds — but does not execute — the query behind `distinctAdminValues`. Factored out of the
 * store method purely so the test suite can assert on the compiled SQL (`.compile().sql`, which
 * Kysely exposes on any query builder without running it) rather than on pg-mem's row OUTPUT.
 *
 * That distinction matters here specifically: pg-mem (the in-memory Postgres this store's tests
 * run against) is not a trustworthy oracle for this query. It measurably mis-evaluates an
 * `IS NOT NULL` predicate chained with another `.where()` depending on which one comes first — and
 * this is NOT a `GROUP BY`-specific interaction (an earlier version of this comment claimed that;
 * it reproduces in a bare, ungrouped `SELECT ... WHERE` too). Re-verified directly against THIS
 * query (which does carry the `GROUP BY` below): chaining `col IS NOT NULL` before a second
 * `.where()` on the same grouped column returns an EMPTY result set for every row, not merely the
 * NULL ones — confirmed with both Kysely's typed `is not` operator and an equivalent raw `sql`
 * fragment, so it is not an artifact of one particular operator spelling. A row-output test built
 * on top of that ordering only proves pg-mem did something on that run, not that Postgres would.
 *
 * That's why the NULL/blank guarantee below is a single NULL-safe expression —
 * `coalesce(col, '') != ''` — instead of the two separately-chained `col IS NOT NULL` /
 * `col != ''` predicates this file used to carry. `coalesce(col, '') != ''` is logically identical
 * to `col IS NOT NULL AND col != ''` under standard three-valued logic — a NULL row coalesces to
 * `''` and is excluded, a blank row IS `''` and is excluded, anything else compares unequal and
 * survives — but expressed as ONE predicate it never lands two chained clauses in the vulnerable
 * order in the first place. There is no ordering left to get wrong, and none to accidentally
 * reintroduce by refactoring this back into two `.where()` calls. Under real Postgres this was
 * always true regardless of clause order (`AND` is commutative under 3VL, so `IS NOT NULL` was
 * always logically redundant there) — the whole ordering concern, past and present, is a pg-mem
 * workaround with no live meaning in production; do not read its removal as if some Postgres
 * constraint had lapsed.
 */
export function buildDistinctAdminValuesQuery(
  db: Kysely<InternalSchema>,
  level: FacilityAdminLevel,
  scope: Partial<Record<FacilityAdminLevel, string>> = {},
) {
  // `level` is typed `FacilityAdminLevel`, a 4-member literal union — Kysely resolves it to a
  // real, quoted column reference, exactly as it does for every other typed `.where()`/
  // `.select()` call in this file. There is no string concatenation or raw-SQL interpolation
  // of `level` anywhere below; the type system is what makes an arbitrary column name
  // unrepresentable here, not a runtime check.
  let q = db.selectFrom('facility_registry').select([level, sql<number>`count(*)`.as('count')]);

  for (const col of FACILITY_ADMIN_LEVELS) {
    if (col === level) continue; // scoping a column by itself is meaningless
    const v = scope[col];
    if (v) q = q.where(col, '=', v);
  }

  return q
    .where(sql<boolean>`coalesce(${sql.ref(level)}, '') != ''`)
    .groupBy(level)
    .orderBy(sql`count(*)`, 'desc')
    // Tiebreaker only — keeps the result order deterministic when two values share a count,
    // it is not itself the ranking the brief asks for.
    .orderBy(level, 'asc')
    .limit(MAX_ADMIN_VALUES);
}

export function createFacilityRegistryStore(
  db: Kysely<InternalSchema>,
  capture?: ReferenceCapture,
): FacilityRegistryStore {
  return {
    async get(id) {
      const r = await db.selectFrom('facility_registry').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r as Row) : undefined;
    },

    async list(opts = {}) {
      let q = db.selectFrom('facility_registry').selectAll();
      if (opts.region) q = q.where('region', '=', opts.region);
      if (opts.district) q = q.where('district', '=', opts.district);
      if (opts.council) q = q.where('council', '=', opts.council);
      if (opts.status) q = q.where('status', '=', opts.status);
      q = q.orderBy('name', 'asc');
      q = q.limit(opts.limit ?? DEFAULT_LIST_LIMIT);
      return (await q.execute()).map((r) => toRecord(r as Row));
    },

    async distinctAdminValues(level, scope = {}) {
      const rows = await buildDistinctAdminValuesQuery(db, level, scope).execute();
      return rows.map((r) => ({ value: (r as Record<string, unknown>)[level] as string, count: Number(r.count) }));
    },

    async upsert(rec) {
      const row = toRow(rec);
      return db.transaction().execute(async (trx) => {
        await trx
          .insertInto('facility_registry')
          .values(row as never)
          .onConflict((oc) => oc.column('id').doUpdateSet({ ...row, updated_at: sql`now()` } as never))
          .execute();
        const stored = toRecord(
          (await trx.selectFrom('facility_registry').selectAll().where('id', '=', rec.id).executeTakeFirstOrThrow()) as Row,
        );
        if (capture) await capture.record(trx, 'facility_registry', rec.id, 'upsert', hashOf(stored));
        return stored;
      });
    },

    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('facility_registry').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'facility_registry', id, 'delete', null);
      });
    },

    // ⚠ Alias writes are NOT captured. An alias maps ONE lab's feed codes to a facility; it is
    // meaningless at central and actively wrong at another lab whose identical code means something
    // else. Registry syncs down; aliases stay local.
    async attachAlias(alias) {
      await db
        .insertInto('facility_aliases')
        .values({
          source_system: alias.sourceSystem,
          source_code: alias.sourceCode,
          registry_id: alias.registryId,
          created_by: alias.createdBy ?? null,
        } as never)
        .onConflict((oc) =>
          // Only registry_id moves on a re-point. created_by is deliberately left alone — it
          // records who FIRST created this alias, not who re-pointed it most recently. Creation
          // provenance is separate from the alias's current target.
          oc.columns(['source_system', 'source_code']).doUpdateSet({ registry_id: alias.registryId } as never),
        )
        .execute();
    },

    async detachAlias(sourceSystem, sourceCode) {
      await db
        .deleteFrom('facility_aliases')
        .where('source_system', '=', sourceSystem)
        .where('source_code', '=', sourceCode)
        .execute();
    },

    async resolve(sourceSystem, sourceCode) {
      const r = await db
        .selectFrom('facility_aliases')
        .innerJoin('facility_registry', 'facility_registry.id', 'facility_aliases.registry_id')
        .selectAll('facility_registry')
        .where('facility_aliases.source_system', '=', sourceSystem)
        .where('facility_aliases.source_code', '=', sourceCode)
        .executeTakeFirst();
      return r ? toRecord(r as Row) : undefined;
    },

    async listAliases(registryId) {
      const rows = await db
        .selectFrom('facility_aliases')
        .selectAll()
        .where('registry_id', '=', registryId)
        .orderBy('source_system', 'asc')
        .execute();
      return rows.map((r) => ({
        sourceSystem: r.source_system,
        sourceCode: r.source_code,
        registryId: r.registry_id,
        createdBy: r.created_by,
      }));
    },
  };
}
