import { type Kysely, sql } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';

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

/**
 * The four per-country administrative-area columns on `facility_registry`. Deliberately a closed
 * union, NOT `string` — `country` is a column too but is excluded on purpose (Task 4 binds it to
 * a ValueSet instead of deriving it from observed data). This type IS the whitelist:
 * `distinctAdminValues` below can only ever be called with one of these four literal column
 * names, so a caller cannot smuggle an arbitrary column (`password`, `id`, ...) into the query
 * even by mistake — the check does not depend on a route remembering to validate first.
 */
export type FacilityAdminLevel = 'zone' | 'region' | 'district' | 'council';

/** Single source of truth for the whitelist, so a caller can validate a request param against the
 *  exact same list the type enforces, rather than re-typing the four names elsewhere. */
export const FACILITY_ADMIN_LEVELS: readonly FacilityAdminLevel[] = ['zone', 'region', 'district', 'council'];

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

function toRecord(r: Row): FacilityRecord {
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

function toRow(rec: FacilityRecord): Omit<Row, 'created_at' | 'updated_at'> {
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
      // `level` is typed `FacilityAdminLevel`, a 4-member literal union — Kysely resolves it to a
      // real, quoted column reference, exactly as it does for every other typed `.where()`/
      // `.select()` call in this file. There is no string concatenation or raw-SQL interpolation
      // of `level` anywhere below; the type system is what makes an arbitrary column name
      // unrepresentable here, not a runtime check.
      let q = db
        .selectFrom('facility_registry')
        .select([level, sql<number>`count(*)`.as('count')]);

      for (const col of FACILITY_ADMIN_LEVELS) {
        if (col === level) continue; // scoping a column by itself is meaningless
        const v = scope[col];
        if (v) q = q.where(col, '=', v);
      }

      // ⚠ Order matters here — NOT for correctness in real Postgres (three-valued logic already
      // makes `col != ''` false/unknown for a NULL row, so `IS NOT NULL` is logically redundant
      // there), but pg-mem (the in-memory Postgres this store's tests run against) measurably
      // mis-evaluates an `IS NOT NULL` predicate combined with a GROUP BY unless it is the LAST
      // `.where()` applied — added any earlier, it silently drops every row instead of filtering
      // correctly. Proven by direct experiment against pg-mem (scope filters, or none, before it;
      // `IS NOT NULL` always last). Keeping `!= ''` too because pg-mem, unlike real Postgres,
      // does NOT treat `NULL != ''` as excluding the row on its own.
      q = q
        .where(level, '!=', '')
        .where(level, 'is not', null)
        .groupBy(level)
        .orderBy(sql`count(*)`, 'desc')
        // Tiebreaker only — keeps the result order deterministic when two values share a count,
        // it is not itself the ranking the brief asks for.
        .orderBy(level, 'asc')
        .limit(MAX_ADMIN_VALUES);

      const rows = await q.execute();
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
