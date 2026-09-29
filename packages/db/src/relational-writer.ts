import type { Kysely } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { insertBatchPg, mergeBatchMssql, insertBatchMysql, type WriteResult } from './batch-upsert';
import {
  projectResource, tableForResourceType, scopeColumnFor, projectOwnedRows, ownedTablesFor,
  type RelationalResult,
} from './relational/index';
import type { ArrivalEvent } from './projection/ledger';

export type { WriteResult };
/** `provenance` is REQUIRED, deliberately. It used to default to `{}`, which made a
 *  caller that forgot indistinguishable from one that meant it — and that is exactly
 *  how the deferred projection wrote NULL source_system/batch_id into every row for
 *  months. A caller with genuinely no provenance passes `{}` explicitly. */
export interface RelationalWriteItem { resource: unknown; provenance: Provenance; }

export interface RelationalWriter {
  write(resource: unknown, provenance: Provenance): Promise<WriteResult>;
  writeMany(items: RelationalWriteItem[]): Promise<WriteResult[]>;
  deleteById(resourceType: string, id: string): Promise<void>;
  writeIngestEvents(events: ArrivalEvent[]): Promise<void>;
}

export function createRelationalWriter(db: Kysely<ExternalSchema>, engine: TargetEngine = 'postgres'): RelationalWriter {
  const anyDb = db as unknown as Kysely<any>;
  // `conflictCols` defaults to the single `id` PK every other warehouse table has. `ingest_events`
  // is the one table whose natural key IS its primary key, three columns wide with no `id` at all —
  // see batch-upsert.ts's comment on why a hardcoded 'id' target broke it outright on real Postgres.
  async function upsertOn(
    exec: Kysely<any>, table: string, rows: Record<string, unknown>[], conflictCols: string[] = ['id'],
  ): Promise<void> {
    if (rows.length === 0) return;
    if (engine === 'mssql') await mergeBatchMssql(exec, table, rows, conflictCols);
    else if (engine === 'mysql') await insertBatchMysql(exec, table, rows, conflictCols);
    else await insertBatchPg(exec, table, rows, conflictCols);
  }

  /** Replace everything a fan-out resource owns. DELETE-then-INSERT, not upsert-then-prune: a
   *  `not in (<codes>)` prune is impossible on MSSQL, whose ~2000-parameter budget is smaller than
   *  a real value set (vs-seed-specimen-type expands to 2009). The transaction is what stops a
   *  concurrent reader seeing the scope empty between the delete and the insert. */
  async function replaceScope(p: RelationalResult): Promise<void> {
    const scope = p.scope;
    if (!scope) { await upsertOn(anyDb, p.table, p.rows); return; }
    await anyDb.transaction().execute(async (trx: Kysely<any>) => {
      await trx.deleteFrom(p.table).where(scope.column as any, '=', scope.value as any).execute();
      await upsertOn(trx, p.table, p.rows);
    });
  }

  return {
    async write(resource, provenance) {
      const p = projectResource(resource, provenance);
      if (!p) return 'skipped';
      await replaceScope(p);
      for (const owned of projectOwnedRows(resource, provenance)) await replaceScope(owned);
      return 'written';
    },
    async writeMany(items) {
      const results: WriteResult[] = new Array(items.length).fill('skipped');
      const unscoped = new Map<string, Record<string, unknown>[]>();
      const scoped: RelationalResult[] = [];
      // Owned rows, collected PER TABLE across the whole batch, keyed by scope value so a later
      // item for the same id (a second version of the same ServiceRequest in one batch) replaces
      // an earlier one instead of both surviving. Two rows for the same id in one INSERT would
      // hit ON CONFLICT twice for that id, which Postgres rejects; keeping only the last also
      // matches what a live re-send does, one write at a time.
      const owned = new Map<string, { scopeColumn: string; scopeValues: unknown[]; rowsByScope: Map<unknown, Record<string, unknown>[]> }>();
      items.forEach((it, idx) => {
        const p = projectResource(it.resource, it.provenance);
        if (!p) return;
        results[idx] = 'written';
        // Scoped resources are applied INDIVIDUALLY. Merging two value sets into one batch would
        // make each one's scope-delete wipe the other's rows before either insert ran.
        if (p.scope) { scoped.push(p); return; }
        const list = unscoped.get(p.table) ?? [];
        // NOT `list.push(...p.rows)`: a spread call blows Node's call-stack argument limit around
        // 131,072 elements. Inert while every projection was one row, but a fan-out resource
        // (ValueSet -> terminology_codes) can produce hundreds of thousands in one write.
        for (const row of p.rows) list.push(row);
        unscoped.set(p.table, list);
        for (const o of projectOwnedRows(it.resource, it.provenance)) {
          if (!o.scope) continue;
          const entry = owned.get(o.table)
            ?? { scopeColumn: o.scope.column, scopeValues: [], rowsByScope: new Map<unknown, Record<string, unknown>[]>() };
          if (!entry.rowsByScope.has(o.scope.value)) entry.scopeValues.push(o.scope.value);
          entry.rowsByScope.set(o.scope.value, o.rows); // later item for the same scope REPLACES
          owned.set(o.table, entry);
        }
      });
      for (const [table, rows] of unscoped) await upsertOn(anyDb, table, rows);
      for (const p of scoped) await replaceScope(p);
      // One transaction per owned table: every delete for the batch's scope values runs before
      // any insert, so two requests sharing this batch cannot wipe each other's rows regardless
      // of iteration order. Deletes are chunked at 500 values for SQL Server's parameter budget.
      for (const [table, entry] of owned) {
        const allRows: Record<string, unknown>[] = [];
        for (const rows of entry.rowsByScope.values()) for (const row of rows) allRows.push(row);
        await anyDb.transaction().execute(async (trx: Kysely<any>) => {
          for (let i = 0; i < entry.scopeValues.length; i += 500) {
            const chunk = entry.scopeValues.slice(i, i + 500);
            await trx.deleteFrom(table).where(entry.scopeColumn as any, 'in', chunk as any).execute();
          }
          await upsertOn(trx, table, allRows);
        });
      }
      return results;
    },
    async deleteById(resourceType, id) {
      const table = tableForResourceType(resourceType);
      if (table) {
        const scopeColumn = scopeColumnFor(resourceType);
        if (scopeColumn) await anyDb.deleteFrom(table).where(scopeColumn as any, '=', id).execute();
        else await anyDb.deleteFrom(table).where('id', '=', id).execute();
      }
      for (const owned of ownedTablesFor(resourceType)) {
        await anyDb.deleteFrom(owned.table).where(owned.scopeColumn as any, '=', id).execute();
      }
    },
    async writeIngestEvents(events) {
      // Idempotent by construction: the table's PK is (resource_type, resource_id, version), the
      // same natural key as fhir.resource_history, so re-writing an arrival is a no-op. That is
      // what lets the live path and the rebuild path write without coordinating.
      if (events.length === 0) return;
      await upsertOn(
        anyDb, 'ingest_events', events as unknown as Record<string, unknown>[],
        ['resource_type', 'resource_id', 'version'],
      );
    },
  };
}
