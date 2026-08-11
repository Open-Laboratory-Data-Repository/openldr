import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
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
      const existing = await getByUrl(input.url);
      if (existing) {
        throw new Error(`a facility register already exists for ${input.url}`);
      }
      const id = `cs-freg-${randomUUID()}`;
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
      const created = await getByUrl(input.url);
      if (!created) {
        throw new Error(`failed to create facility register source for ${input.url}`);
      }
      return created;
    },
  };
}
