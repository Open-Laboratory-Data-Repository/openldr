import { type Kysely, sql } from 'kysely';

// Building a pack dataset in the warehouse (pack datasets design, 2026-11-19). PostgreSQL only.

/** The warehouse schema that holds every built dataset and nothing else, so a dataset can never
 *  take the place of a warehouse table. */
export const DATASET_SCHEMA = 'dataset';

/** The same rule the pack format applies. Checked again here because the name becomes a table name. */
const NAME = /^[a-z][a-z0-9_]{2,47}$/;

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`dataset name must be 3 to 48 lower case letters, digits or underscores, starting with a letter: ${name}`);
}

/**
 * Builds `dataset.<name>` from one SELECT.
 *
 * The rows go into `dataset.<name>__new`, with the indexes. Then one transaction drops the old table
 * and gives the new one its name. So a reader sees the old table or the new one, never an empty or a
 * half-filled one, and a build that fails leaves the old table as it was.
 *
 * The caller has checked that `sql` is one read-only SELECT. It is not checked here.
 *
 * A session lock on the name is held for the whole build, so two builds of one dataset run one
 * after the other. The whole build uses one connection, because that lock belongs to a session.
 */
export async function buildWarehouseDataset(
  db: Kysely<any>, def: { name: string; sql: string; indexes?: string[][] },
): Promise<{ rows: number }> {
  assertName(def.name);
  const select = def.sql.trim().replace(/;+\s*$/, '');
  const fresh = `${def.name}__new`;
  const freshTable = sql.id(DATASET_SCHEMA, fresh);
  const finalTable = sql.id(DATASET_SCHEMA, def.name);
  const lockKey = `openldr.dataset.${def.name}`;
  return db.connection().execute(async (conn) => {
    await sql`select pg_advisory_lock(hashtext(${lockKey}))`.execute(conn);
    try {
      await sql`create schema if not exists ${sql.id(DATASET_SCHEMA)}`.execute(conn);
      await sql`drop table if exists ${freshTable}`.execute(conn);
      try {
        await sql`create table ${freshTable} as ${sql.raw(select)}`.execute(conn);
        const indexes = def.indexes ?? [];
        for (const [i, columns] of indexes.entries()) {
          await sql`create index ${sql.id(`${fresh}_${i}_idx`)} on ${freshTable} (${sql.join(columns.map((c) => sql.id(c)))})`.execute(conn);
        }
        // Statistics, so the first report over the new table is planned well.
        await sql`analyze ${freshTable}`.execute(conn);
        const counted = await sql<{ n: string }>`select count(*) as n from ${freshTable}`.execute(conn);
        await sql`begin`.execute(conn);
        try {
          await sql`drop table if exists ${finalTable}`.execute(conn);
          await sql`alter table ${freshTable} rename to ${sql.id(def.name)}`.execute(conn);
          for (const i of indexes.keys()) {
            await sql`alter index ${sql.id(DATASET_SCHEMA, `${fresh}_${i}_idx`)} rename to ${sql.id(`${def.name}_${i}_idx`)}`.execute(conn);
          }
          await sql`commit`.execute(conn);
        } catch (err) {
          await sql`rollback`.execute(conn).catch(() => undefined);
          throw err;
        }
        return { rows: Number(counted.rows[0]?.n ?? 0) };
      } catch (err) {
        await sql`drop table if exists ${freshTable}`.execute(conn).catch(() => undefined);
        throw err;
      }
    } finally {
      await sql`select pg_advisory_unlock(hashtext(${lockKey}))`.execute(conn).catch(() => undefined);
    }
  });
}

/** Drops a built dataset. A dataset that was never built is not an error. */
export async function dropWarehouseDataset(db: Kysely<any>, name: string): Promise<void> {
  assertName(name);
  await sql`drop table if exists ${sql.id(DATASET_SCHEMA, name)}`.execute(db);
  await sql`drop table if exists ${sql.id(DATASET_SCHEMA, `${name}__new`)}`.execute(db);
}
