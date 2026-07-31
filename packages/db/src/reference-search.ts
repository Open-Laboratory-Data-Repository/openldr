import { sql, type Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';

/** A row a reference picker can render for an entity source. */
export interface EntityRow {
  reference: string;
  display: string;
  /** Disambiguating detail. Never carries an identifier the searcher didn't already have. */
  secondary: string | null;
}

export interface EntitySearchResult { rows: EntityRow[]; total: number }

export interface EntitySearchResolver {
  search(q: string, limit: number, offset: number): Promise<EntitySearchResult>;
}

/** Entity targets a form field may bind to. Extend as resolvers are added. */
export const ENTITY_TARGETS = ['Patient'] as const;

type Engine = 'postgres' | 'mysql' | 'mssql';

/**
 * Search the `patients` read model.
 *
 * Deliberately does NOT consult columnPolicy: that policy governs analytics exposure and
 * denies every column here, which would make the picker return nothing. See the spec, §3.
 * `national_id` is searchable but never rendered, so an ID is not disclosed to someone who
 * did not already know it.
 */
export function createPatientResolver(db: Kysely<ExternalSchema>, _engine: Engine): EntitySearchResolver {
  const SEARCH_COLUMNS = ['surname', 'firstname', 'national_id', 'patient_guid', 'phone'] as const;

  return {
    async search(q, limit, offset) {
      const needle = `%${q.trim().toLowerCase()}%`;

      // lower(col) LIKE lower(?) holds on Postgres, MySQL and MSSQL alike; the Postgres-only
      // case-insensitive LIKE variant does not, so it must never appear here.
      const base = db
        .selectFrom('patients')
        .where('active', '=', true)
        .where('replaced_by_id', 'is', null)
        .where((eb) =>
          eb.or(SEARCH_COLUMNS.map((c) => sql<boolean>`lower(${sql.ref(c)}) like ${needle}`)),
        );

      const rows = await base
        .select(['id', 'surname', 'firstname', 'date_of_birth', 'sex'])
        .orderBy('surname')
        .orderBy('firstname')
        .limit(limit)
        .offset(offset)
        .execute();

      const counted = await base
        .select((eb) => eb.fn.countAll<string | number>().as('n'))
        .executeTakeFirst();

      return {
        rows: rows.map((r) => ({
          reference: `Patient/${String(r.id)}`,
          display: [r.surname, r.firstname].filter(Boolean).join(' ') || String(r.id),
          secondary: [r.date_of_birth, r.sex].filter(Boolean).join(' · ') || null,
        })),
        total: Number(counted?.n ?? 0),
      };
    },
  };
}
