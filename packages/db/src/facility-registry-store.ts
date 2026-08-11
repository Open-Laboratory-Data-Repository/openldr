import { type Kysely, type SelectQueryBuilder, type Selectable, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';
import { FACILITY_ADMIN_LEVELS, type FacilityAdminLevel } from './facility-answers';
import { FACILITY_REGISTRY_SYSTEM } from './facility-observed';

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
  /** `in_register` / `dropped` / `not_registered` (migration 081's `FACILITY_REGISTER_STATE_*`
   *  constants, `@openldr/db`'s root index) — REGISTER MEMBERSHIP, never operational `status`. See
   *  `toRow()`'s doc comment for why this store never WRITES it (the retirement path owns that);
   *  `toRecord()` still reads it back off every row a `SELECT` returns. Optional, like almost every
   *  other field on this interface, because a caller that builds a `FacilityRecord` OUTSIDE a DB
   *  round-trip (e.g. `facility-classify.ts`'s in-memory merge during import classification) has no
   *  register state to report yet — only a value this store itself produced (`get`/`list`/`upsert`)
   *  is guaranteed to carry one. */
  registerState?: string;
}

/** Derived per row by `list()`, never stored. */
export type FacilityHealth = 'mapped' | 'unmapped' | 'unprojected';

/**
 * Single source of truth for the three `FacilityHealth` values, following the same bidirectional
 * pattern as `FACILITY_ADMIN_LEVEL_SET`/`FACILITY_ADMIN_LEVELS` in `facility-answers.ts` — see that
 * file's doc comment for the full reasoning. A plain `readonly FacilityHealth[]` array literal (what
 * `apps/server/src/facilities-routes.ts`'s `HEALTH_VALUES` used to be, defined independently there)
 * only checks that every array ELEMENT is a valid `FacilityHealth`; it does nothing to stop a member
 * being dropped from the array while the union keeps it, or a NEW member being added to the union
 * (say `'retired'`) without the array ever being told. `Record<FacilityHealth, true>` enforces
 * completeness in both directions: remove a key below and `tsc` reports it missing against the type;
 * add a member to the union above and this object literal is missing that key and fails to compile.
 * `FACILITY_HEALTH_VALUES` is derived FROM this object (`Object.keys`), not hand-typed alongside it,
 * so there is exactly one place the three values are spelled — and the route's `isFacilityHealth`
 * whitelist check can no longer silently drift out of step with what `FacilityHealth` actually is.
 */
const FACILITY_HEALTH_SET: Record<FacilityHealth, true> = {
  mapped: true,
  unmapped: true,
  unprojected: true,
};
export const FACILITY_HEALTH_VALUES: readonly FacilityHealth[] = Object.keys(
  FACILITY_HEALTH_SET,
) as FacilityHealth[];

export interface FacilityListOptions {
  /** Case-insensitive substring across name, local code, national code, and admin area.
   *  ⚠ NOT aliases — `facility_registry` has no alias column and `extras` is an untyped jsonb bag.
   *  The audit (FAC-P1-01) asks for alias search; it belongs with sub-project B's identity
   *  modelling, and is deliberately unmet here rather than faked. */
  q?: string;
  country?: string;
  zone?: string;
  region?: string;
  district?: string;
  council?: string;
  /** Operational status. Distinct from `source` and `managedOrigin` below — see their comments. */
  status?: string;
  level?: string;
  /** Facility ownership (public/private/…), not provenance. */
  ownership?: string;
  /** WHICH national register the row's `nationalCode` belongs to — the audit's "registry source". */
  nationalSystem?: string;
  /** HOW the row entered this registry (manual, import, …). */
  source?: string;
  /** WHO owns the row's content — central sync vs local. */
  managedOrigin?: string;
  /** Registry MEMBERSHIP — `in_register` / `dropped` / `not_registered` (migration 081). Distinct
   *  from `status` (operational) and `health` (mapping/projection) below. */
  registerState?: string;
  /** Defaults to 200 when omitted — a national register runs 10-15k rows and an unbounded scan is
   *  never what a caller wants. Pass an explicit value (including a large one) to override. */
  limit?: number;
  /** Rows to skip. Offset paging, not cursor: the audit requires an authoritative total and
   *  page-jumping, which a cursor composes badly with. Drift under concurrent writes is accepted —
   *  see the spec's Known limits. */
  offset?: number;
  /** Mapping/projection health (FAC-P1-01). `unprojected` means the facility has no
   *  `facility_concept_projection` row and therefore CANNOT be selected as a mapping target at all
   *  — the FAC-P0-08 failure state, visible in a list instead of only as a failed background job. */
  health?: FacilityHealth;
}

/** A `FacilityRecord` as `list()` returns it — with the two fields it derives, per row, via the
 *  `facility_concept_projection`/`term_mappings` join. Not what `get()`/`upsert()` traffic in. */
export type FacilityListRow = FacilityRecord & {
  health: FacilityHealth;
  mappingCount: number;
};

export interface FacilityAdminValueCount {
  /** The observed value, verbatim (never normalised/cased). */
  value: string;
  /** How many facility_registry rows carry this value for the requested level. */
  count: number;
}

export interface FacilityRegistryStore {
  get(id: string): Promise<FacilityRecord | undefined>;
  /** Page of facilities plus the EXACT total matching the same search/filters (before limit/offset).
   *  Capped at 200 rows by default — see `FacilityListOptions.limit`. */
  list(opts?: FacilityListOptions): Promise<{ rows: FacilityListRow[]; total: number }>;
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
}

/** A national register runs 10-15k rows; `list()` with no options must not return all of them.
 *  Exported (Task 3) so `GET /api/facilities` can echo the limit it actually applied when the
 *  client sent none, instead of a caller re-deriving it from `rows.length` — which is wrong on a
 *  short last page (a 12-row result with no limit would echo `limit: 12`). */
export const DEFAULT_LIST_LIMIT = 200;

// A real country's admin geography (zones/regions/districts/councils) tops out in the low
// hundreds even for a large country; this is not a row cap (list()'s DEFAULT_LIST_LIMIT), it caps
// the number of DISTINCT values returned. Generous headroom for messy free-text data (typos,
// re-namings) while still bounding the response against a pathological column.
const MAX_ADMIN_VALUES = 1000;

type Row = InternalSchema['facility_registry'];
// The shape a SELECT actually returns: `Selectable<>` unwraps `register_state`'s `Generated<string>`
// (migration 081) down to a plain `string`, same as it always implicitly did for every other column
// here (none of which were `ColumnType`-wrapped before). `Row` itself stays the raw table type — it
// is still the right shape for `toRow()`'s Omit-based insert construction below.
type SelectRow = Selectable<Row>;

/** Exported for the bulk import path (facility-import.ts in @openldr/bootstrap): it writes rows via
 *  a batched multi-row upsert instead of this store's one-row-per-transaction `upsert()`, but needs
 *  the exact same camelCase <-> snake_case shape so a hand-entered facility, an interactively-edited
 *  one, and a bulk-imported one all land identically. */
export function toRecord(r: SelectRow): FacilityRecord {
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
    // Read-only here — see `FacilityRecord.registerState`'s doc comment. `r.register_state` is
    // always a real string on a `SELECT` row (the column is `NOT NULL DEFAULT 'not_registered'`),
    // never actually undefined; the field stays optional on the TYPE only because a caller that
    // builds a `FacilityRecord` by hand has nothing to put here.
    registerState: r.register_state,
  };
}

// `register_state` (migration 081) is deliberately excluded from WRITES here, same as
// `created_at`/`updated_at` — Task 10 made `toRecord()` (above) read it back, but this store still
// never sets it. Omitting it here means a fresh INSERT gets the column default
// ('not_registered'), and `upsert()`'s `doUpdateSet({ ...row, ... })` below leaves an EXISTING
// row's register_state untouched on conflict, rather than stomping it back to the default on every
// edit. The retirement path (facility-import.ts) is what decides register_state's value and writes
// it explicitly, via a direct update — never through this store's `upsert()`.
export function toRow(rec: FacilityRecord): Omit<Row, 'created_at' | 'updated_at' | 'register_state'> {
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
      return r ? toRecord(r as SelectRow) : undefined;
    },

    async list(opts = {}) {
      // ⛔ ONE predicate builder shared by the rows query and the count query. Two copies would
      // drift, and a `total` that disagrees with the page it describes is worse than no total.
      // Generic over the select list (`O`) so the same closure types against both the
      // `selectAll()` rows query and the `count(*)` aggregate query below — `.where()` never
      // changes `O`, so this is ordinary Kysely generic inference, not a cast.
      const applyFilters = <O>(
        qb: SelectQueryBuilder<InternalSchema, 'facility_registry', O>,
      ): SelectQueryBuilder<InternalSchema, 'facility_registry', O> => {
        let q = qb;
        if (opts.country) q = q.where('country', '=', opts.country);
        if (opts.zone) q = q.where('zone', '=', opts.zone);
        if (opts.region) q = q.where('region', '=', opts.region);
        if (opts.district) q = q.where('district', '=', opts.district);
        if (opts.council) q = q.where('council', '=', opts.council);
        if (opts.status) q = q.where('status', '=', opts.status);
        if (opts.level) q = q.where('level', '=', opts.level);
        if (opts.ownership) q = q.where('ownership', '=', opts.ownership);
        if (opts.nationalSystem) q = q.where('national_system', '=', opts.nationalSystem);
        if (opts.source) q = q.where('source', '=', opts.source);
        if (opts.managedOrigin) q = q.where('managed_origin', '=', opts.managedOrigin);
        if (opts.registerState) q = q.where('register_state', '=', opts.registerState);
        if (opts.q) {
          // `ilike` with a wrapped `%` — a leading wildcard means no plain btree index can serve
          // this; it is an unindexed sequential scan on every call. Not benchmarked at
          // national-register scale (10-15k rows) as part of this task — if that turns out to be
          // too slow in practice, a trigram/full-text index is the fix, deliberately left to when
          // it is actually measured rather than pre-emptively added. `facility_registry` lives in
          // the INTERNAL database, which is always Postgres, so `ilike` needs none of the dialect
          // branching the EXTERNAL-DB reference-search resolver avoids it for (see that file's
          // portability test, which pins lower()/LIKE specifically for multi-engine support).
          const like = `%${opts.q}%`;
          q = q.where((eb) => eb.or([
            eb('name', 'ilike', like),
            eb('local_code', 'ilike', like),
            eb('national_code', 'ilike', like),
            eb('region', 'ilike', like),
            eb('district', 'ilike', like),
            eb('council', 'ilike', like),
          ]));
        }
        return q;
      };

      // ⛔ An UNCORRELATED derived-table aggregate, and both halves of that matter.
      //
      // NOT a plain join to `term_mappings`: one facility is legitimately the target of MANY
      // observed codes (migration 078's partial unique index constrains one active resolution per
      // OBSERVED code, not per target), so a plain join would multiply the facility row by its
      // mapping count and inflate both the page and the total — the same fan-out class the
      // `facility_of` CTE exists to prevent in the seeded reports.
      //
      // NOT an EXISTS/correlated subquery either: pg-mem, which this suite runs against, has zero
      // correlated-subquery support (measured on a predecessor slice: five variants all failed with
      // `column "t1.k" does not exist`), so a correlated form would be untestable here.
      //
      // Applied AFTER `applyFilters` (not before, unlike the brief's snippet) so `applyFilters`
      // keeps running against a builder whose only table is `facility_registry` — its column
      // references (`'country'`, `'region'`, ...) stay unqualified and unambiguous, and its type
      // stays exactly `SelectQueryBuilder<InternalSchema, 'facility_registry', O>` with no widening
      // needed. SQL clause order doesn't depend on JS call order (Kysely always renders
      // FROM/JOIN before WHERE), so filtering first and joining after is equivalent to the brief's
      // join-first ordering.
      //
      // Health is applied here as explicit predicates rather than filtering on a computed alias —
      // the same three conditions serve both the rows query and the count query below without
      // wrapping either in a subquery.
      const joinHealth = <O>(qb: SelectQueryBuilder<InternalSchema, 'facility_registry', O>) => {
        const joined = qb
          .leftJoin('facility_concept_projection as fcp', 'fcp.registry_id', 'facility_registry.id')
          .leftJoin(
            (eb) => eb
              .selectFrom('term_mappings')
              .select((e) => ['to_code', e.fn.countAll<number>().as('n')])
              .where('to_system', '=', FACILITY_REGISTRY_SYSTEM)
              .where('is_active', '=', true)
              .where('map_type', '=', 'SAME-AS')
              .groupBy('to_code')
              .as('m'),
            (join) => join.onRef('m.to_code', '=', 'fcp.concept_code'),
          );
        if (opts.health === 'unprojected') return joined.where('fcp.registry_id', 'is', null);
        if (opts.health === 'mapped') return joined.where(sql`coalesce(m.n, 0)`, '>', 0);
        if (opts.health === 'unmapped') {
          return joined.where('fcp.registry_id', 'is not', null).where(sql`coalesce(m.n, 0)`, '=', 0);
        }
        return joined;
      };

      const rowsQ = joinHealth(applyFilters(
        db.selectFrom('facility_registry')
          .selectAll('facility_registry')
          .select(sql<string>`case when fcp.registry_id is null then 'unprojected'
                                   when coalesce(m.n, 0) > 0 then 'mapped'
                                   else 'unmapped' end`.as('health'))
          .select(sql<number>`coalesce(m.n, 0)`.as('mapping_count')),
      ))
        .orderBy('facility_registry.name', 'asc')
        // Tiebreaker only — keeps the result order deterministic when two facilities share a name
        // (the norm, not the exception, in a national master facility list). Without this, offset
        // paging over a non-unique sort column can show the same facility on two pages and never
        // reach another — see the matching tiebreaker on `buildDistinctAdminValuesQuery` above for
        // the same pattern.
        .orderBy('facility_registry.id', 'asc')
        .limit(opts.limit ?? DEFAULT_LIST_LIMIT)
        .offset(opts.offset ?? 0);
      const countQ = joinHealth(applyFilters(
        db.selectFrom('facility_registry').select((eb) => eb.fn.countAll<number>().as('n')),
      ));

      const [rows, counted] = await Promise.all([rowsQ.execute(), countQ.executeTakeFirst()]);
      return {
        rows: rows.map((r) => ({
          ...toRecord(r as SelectRow),
          health: r.health as FacilityHealth,
          mappingCount: Number(r.mapping_count ?? 0),
        })),
        total: Number(counted?.n ?? 0),
      };
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
          (await trx.selectFrom('facility_registry').selectAll().where('id', '=', rec.id).executeTakeFirstOrThrow()) as SelectRow,
        );
        // Capture SUSPENDED — see SUSPENDED_REFERENCE_ENTITY_TYPES in reference-change-log.ts. The
        // `capture` dep stays on this store's interface so re-enabling is one line, not a re-wiring.
        return stored;
      });
    },

    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('facility_registry').where('id', '=', id).execute();
        // Capture SUSPENDED — see SUSPENDED_REFERENCE_ENTITY_TYPES in reference-change-log.ts. The
        // `capture` dep stays on this store's interface so re-enabling is one line, not a re-wiring.
      });
    },
  };
}
