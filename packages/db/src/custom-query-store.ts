import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';
import { canonicalHash } from '@openldr/core';
import type { ReferenceCapture } from './reference-capture';

// NOTE: These structurally mirror `CustomQueryParam`/`CustomQuery` from `@openldr/dashboards`
// (the shared Zod-derived source of truth). They are re-declared locally because `@openldr/db`
// must not depend on `@openldr/dashboards` (dashboards already depends on db — importing upward
// would introduce a package cycle). db stores define their own record types by convention
// (see report-schedule-store).
export interface CustomQueryParam {
  id: string;
  label: string;
  type: 'text' | 'select' | 'daterange';
  required: boolean;
  optionsSql?: string;
}
export interface CustomQuery {
  id: string;
  name: string;
  connectorId: string;
  sql: string;
  params: CustomQueryParam[];
}

export interface NewCustomQuery {
  id: string; name: string; connectorId: string; sql: string; params: CustomQueryParam[];
}
export interface CustomQueryPatch {
  name?: string; connectorId?: string; sql?: string; params?: CustomQueryParam[];
}
export interface CustomQueryStore {
  create(q: NewCustomQuery): Promise<void>;
  get(id: string): Promise<CustomQuery | null>;
  getByName(name: string): Promise<CustomQuery | null>;
  list(): Promise<CustomQuery[]>;
  update(id: string, patch: CustomQueryPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

const COLS = ['id', 'name', 'connector_id', 'sql', 'params'] as const;

function toQuery(r: { id: string; name: string; connector_id: string; sql: string; params: unknown }): CustomQuery {
  return {
    id: r.id, name: r.name, connectorId: r.connector_id, sql: r.sql,
    params: (r.params as CustomQueryParam[]) ?? [],
  };
}

// Hash over the sync-relevant fields, deliberately EXCLUDING connectorId: which local database a
// query runs against is a lab-local concern (the applier repoints it at the lab's own default
// warehouse connector), so including it would make every lab's hash differ from central's.
function hashOf(q: { name: string; sql: string; params: CustomQueryParam[] }): string {
  return canonicalHash({ name: q.name, sql: q.sql, params: q.params });
}

/** `capture` makes queries part of the central→lab reference-sync set. A report definition points at
 *  one (`reports.primary_query_id`); syncing the definition without the query left labs with report
 *  rows that had no data source. Mirrors createReportStore's capture contract. */
export function createCustomQueryStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): CustomQueryStore {
  return {
    async create(q) {
      await db.transaction().execute(async (trx) => {
        await trx.insertInto('custom_queries').values({
          id: q.id, name: q.name, connector_id: q.connectorId, sql: q.sql,
          params: JSON.stringify(q.params) as never,
        }).execute();
        if (capture) await capture.record(trx, 'custom_query', q.id, 'upsert', hashOf(q));
      });
    },
    async get(id) {
      const r = await db.selectFrom('custom_queries').select(COLS).where('id', '=', id).executeTakeFirst();
      return r ? toQuery(r) : null;
    },
    async getByName(name) {
      const r = await db.selectFrom('custom_queries').select(COLS).where('name', '=', name).executeTakeFirst();
      return r ? toQuery(r) : null;
    },
    async list() {
      return (await db.selectFrom('custom_queries').select(COLS).orderBy('name', 'asc').execute()).map(toQuery);
    },
    async update(id, patch) {
      await db.transaction().execute(async (trx) => {
        const set: Record<string, unknown> = { updated_at: sql`now()` };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.connectorId !== undefined) set.connector_id = patch.connectorId;
        if (patch.sql !== undefined) set.sql = patch.sql;
        if (patch.params !== undefined) set.params = JSON.stringify(patch.params) as never;
        await trx.updateTable('custom_queries').set(set).where('id', '=', id).execute();
        // Hash the read-back row, not the patch, so the log never diverges from storage.
        const r = await trx.selectFrom('custom_queries').select(COLS).where('id', '=', id).executeTakeFirst();
        if (capture && r) await capture.record(trx, 'custom_query', id, 'upsert', hashOf(toQuery(r)));
      });
    },
    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('custom_queries').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'custom_query', id, 'delete', null);
      });
    },
  };
}
