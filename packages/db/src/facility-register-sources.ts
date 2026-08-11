import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import { FACILITY_REGISTER_KIND } from './migrations/internal/081_facility_source_and_register_state';

// The selectable surface a caller (e.g. an import-sheet Select) actually needs — a real, selectable
// register, not a typed-in string. See migration 081's comment on `coding_systems.kind` for why
// `kind` is a real column and never a URL-prefix convention.
export interface FacilityRegisterSource {
  id: string;
  url: string;
  name: string;
  code: string;
  version: string | null;
  jurisdiction: string | null;
  contact: string | null;
  publisherId: string | null;
  active: boolean;
}

export interface FacilityRegisterSourceStore {
  /** Active facility registers, ordered by name with a unique id tiebreaker. */
  list(opts?: { includeInactive?: boolean }): Promise<FacilityRegisterSource[]>;
  /** Resolves a register by its canonical url REGARDLESS of `active` — deliberately, unlike `list`'s
   *  default. A caller that needs "is this a known, currently-selectable register" (e.g. the import
   *  gate in `apps/server/src/facilities-routes.ts`) must check the returned row's `active` itself;
   *  a caller doing a historical lookup (naming a register a past import already used, which may
   *  since have been deactivated) still needs it resolved. Narrowing this to active-only would break
   *  that second caller, so the filtering stays the CALLER's decision, not this method's. */
  getByUrl(url: string): Promise<FacilityRegisterSource | null>;
  create(input: {
    url: string;
    name: string;
    code: string;
    version?: string | null;
    jurisdiction?: string | null;
    contact?: string | null;
    publisherId?: string | null;
  }): Promise<FacilityRegisterSource>;
}

interface CodingSystemRegisterRow {
  id: string;
  url: string | null;
  system_name: string;
  system_code: string;
  system_version: string | null;
  jurisdiction: string | null;
  contact: string | null;
  publisher_id: string | null;
  active: boolean;
}

/** Same defensive shape as `facility-job-store.ts`'s own `isUniqueViolation`: real Postgres always
 *  carries `.code === '23505'` on a unique-index violation, but this store is exercised under pg-mem
 *  in tests, and this codebase has already found pg-mem not always worth trusting to reproduce that
 *  code — the message fallback is what keeps the catch below firing under BOTH engines. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /unique|duplicate/i.test(e?.message ?? '');
}

function toSource(row: CodingSystemRegisterRow): FacilityRegisterSource {
  return {
    id: row.id,
    url: row.url ?? '',
    name: row.system_name,
    code: row.system_code,
    version: row.system_version,
    jurisdiction: row.jurisdiction,
    contact: row.contact,
    publisherId: row.publisher_id,
    active: row.active,
  };
}

// ⛔ Do NOT build this over `codingSystems.upsertByUrl` (terminology-admin-store.ts). That method is
// an upsert keyed on `url` alone — pointed at a non-register coding system's url (e.g. LOINC) it
// would silently adopt that row as a facility register by writing `kind` onto it. `create` here
// writes a fresh row and refuses when one already exists for the url, instead.
export function createFacilityRegisterSourceStore(db: Kysely<InternalSchema>): FacilityRegisterSourceStore {
  async function getByUrl(url: string): Promise<FacilityRegisterSource | null> {
    const row = await db
      .selectFrom('coding_systems')
      .selectAll()
      .where('kind', '=', FACILITY_REGISTER_KIND)
      .where('url', '=', url)
      .executeTakeFirst();
    return row ? toSource(row as CodingSystemRegisterRow) : null;
  }

  return {
    async list(opts) {
      let query = db
        .selectFrom('coding_systems')
        .selectAll()
        .where('kind', '=', FACILITY_REGISTER_KIND);
      if (!opts?.includeInactive) {
        query = query.where('active', '=', true);
      }
      // `id` is the unique tiebreaker — pg-mem's scan order is stable and would pass even without
      // it, but on real Postgres a `system_name`-only ORDER BY is not deterministic across rows
      // that share a name.
      const rows = await query.orderBy('system_name', 'asc').orderBy('id', 'asc').execute();
      return rows.map((row) => toSource(row as CodingSystemRegisterRow));
    },
    getByUrl,
    async create(input) {
      // ⛔ CASE-INSENSITIVE, and deliberately unlike `getByUrl` (which stays exact-match — see its
      // own doc comment, and facilities-routes.ts's `unknownRegisterError`). `idFor`
      // (packages/terminology/src/facility-csv.ts) hashes a nationalSystem string WITHOUT
      // lowercasing it, while `observedFieldSystem` (packages/bootstrap/src/facility-controlled-
      // fields.ts) DOES lowercase its slug — so an exact-match-only check here would let
      // 'urn:tz:hfr' and 'urn:tz:HFR' each earn their own row, each individually pass the import
      // route's exact-match gate, and each mint a DIFFERENT `idFor` identity while sharing the SAME
      // controlled-field namespace. That is the original defect this whole slice exists to remove,
      // arriving through THIS door instead of the import route's. Refusing a case-insensitive
      // duplicate at creation is what keeps "one spelling of a register" true from the moment a
      // register is minted, so the exact-match gate downstream never has two spellings to choose
      // between.
      const normalizedUrl = input.url.toLowerCase();
      const existing = await db
        .selectFrom('coding_systems')
        .select(['id'])
        .where('kind', '=', FACILITY_REGISTER_KIND)
        .where((eb) => eb(sql`lower(url)`, '=', normalizedUrl))
        .executeTakeFirst();
      if (existing) {
        throw new Error(`a facility register already exists for a url matching "${input.url}" (case-insensitive)`);
      }
      const id = `cs-freg-${randomUUID()}`;
      try {
        await db
          .insertInto('coding_systems')
          .values({
            id,
            system_code: input.code,
            system_name: input.name,
            url: input.url,
            system_version: input.version ?? null,
            jurisdiction: input.jurisdiction ?? null,
            contact: input.contact ?? null,
            publisher_id: input.publisherId ?? null,
            active: true,
            seeded: false,
            kind: FACILITY_REGISTER_KIND,
          } as never)
          .execute();
      } catch (err) {
        // `coding_systems_url_uq` (migration 012) is a PLAIN unique index on `url` ALONE, not scoped
        // by `kind` — while the pre-check above (like `getByUrl`) IS scoped to
        // `kind = FACILITY_REGISTER_KIND`. MEASURED: a url already used by a NON-register coding
        // system (e.g. one `upsertByUrl` conjured for a LOINC import) passes that pre-check and
        // throws here instead, as a raw Postgres 23505 — a bare, unclassified exception, not the
        // operator-legible refusal the case-insensitive check above gives for the register-vs-
        // register collision. Recognised here and turned into the same shape of plain Error rather
        // than left for the route (or, absent this, the app's generic 500 handler) to puzzle out.
        if (isUniqueViolation(err)) {
          throw new Error(`a coding system already exists for the url "${input.url}"`);
        }
        throw err;
      }
      const created = await getByUrl(input.url);
      if (!created) {
        throw new Error(`failed to create facility register source for ${input.url}`);
      }
      return created;
    },
  };
}
