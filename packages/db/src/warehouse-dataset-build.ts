import { type Kysely, sql } from 'kysely';

// Building a pack dataset in the warehouse (pack datasets design, 2026-11-19). PostgreSQL only.

/** The warehouse schema that holds every built dataset and nothing else, so a dataset can never
 *  take the place of a warehouse table. */
export const DATASET_SCHEMA = 'dataset';

/** The same rule the pack format applies. Checked again here because the name becomes a table name.
 *  No two underscores in a row: `<name>__new` and `<name>__idx<n>` are the build's own names, and a
 *  dataset called `abc__new` would be dropped by a build of `abc`. */
const NAME = /^(?!.*__)[a-z][a-z0-9_]{2,47}$/;

/** The longest a build's statements may each run. A build reads whole warehouse tables: on 2.3
 *  million requests the largest took 57 seconds. */
export const DATASET_BUILD_TIMEOUT_MS = 15 * 60 * 1000;

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`dataset name must be 3 to 48 lower case letters, digits or single underscores, starting with a letter: ${name}`);
}

const lockKeyOf = (name: string): string => `openldr.dataset.${name}`;

/**
 * Builds `dataset.<name>` from one SELECT.
 *
 * The SELECT comes from a content pack. It runs with the same guards a report's SQL gets
 * (`connector-db.ts`), because the keyword check alone does not stop a SELECT that calls a function
 * with a side effect:
 *  - Its rows are read inside a READ ONLY transaction, filling a temporary table, which a read-only
 *    transaction allows. So `select setval(...)`, or any write reached through a function, is refused
 *    by PostgreSQL itself.
 *  - It is wrapped as `select * from (<select>) as _q`, so text after a `;` is a syntax error and
 *    never a second statement.
 *  - `standard_conforming_strings` is forced on, so a backslash cannot end a string early and turn
 *    the rest into a statement.
 *  - Every statement has a time limit.
 *  - Before the connection goes back to the pool, session locks are released and settings reset, so
 *    nothing the SELECT set reaches the next user of that connection.
 *
 * The rows are then copied into `dataset.<name>__new`, with the indexes. One transaction drops the
 * old table and gives the new one its name. So a reader sees the old table or the new one, never an
 * empty or a half-filled one, and a build that fails leaves the old table as it was.
 *
 * A session lock on the name is held for the whole build, so two builds of one dataset run one
 * after the other, and a delete waits for a build. The whole build uses one connection, because
 * that lock, the temporary table and the settings belong to a session.
 */
export async function buildWarehouseDataset(
  db: Kysely<any>, def: { name: string; sql: string; indexes?: string[][] }, opts: { timeoutMs?: number } = {},
): Promise<{ rows: number }> {
  assertName(def.name);
  const select = def.sql.trim().replace(/;+\s*$/, '');
  const timeoutMs = Math.max(1, Math.round(opts.timeoutMs ?? DATASET_BUILD_TIMEOUT_MS));
  const fresh = `${def.name}__new`;
  const freshTable = sql.id(DATASET_SCHEMA, fresh);
  const finalTable = sql.id(DATASET_SCHEMA, def.name);
  const staging = sql.id('openldr_dataset_build');
  const indexes = def.indexes ?? [];
  return db.connection().execute(async (conn) => {
    try {
      await sql`select pg_advisory_lock(hashtext(${lockKeyOf(def.name)}))`.execute(conn);
      await sql.raw(`set statement_timeout = ${timeoutMs}`).execute(conn);
      await sql`set standard_conforming_strings = on`.execute(conn);
      await sql`create schema if not exists ${sql.id(DATASET_SCHEMA)}`.execute(conn);
      await sql`drop table if exists ${staging}`.execute(conn);
      await sql`drop table if exists ${freshTable}`.execute(conn);

      // The pack's SELECT, read-only. The line feed before the closing bracket ends a `--` comment
      // at the end of the pack's text.
      // First the temporary table's shape, with no rows: PostgreSQL plans the SELECT and runs none of
      // it. Creating a table is not allowed inside a read-only transaction, filling a temporary one is.
      await sql`create temporary table ${staging} as select * from (${sql.raw(select)}\n) as _q with no data`.execute(conn);
      await sql`begin transaction read only`.execute(conn);
      try {
        await sql`insert into ${staging} select * from (${sql.raw(select)}\n) as _q`.execute(conn);
        await sql`commit`.execute(conn);
      } catch (err) {
        await sql`rollback`.execute(conn).catch(() => undefined);
        throw err;
      }

      try {
        await sql`create table ${freshTable} as table ${staging}`.execute(conn);
        for (const [i, columns] of indexes.entries()) {
          await sql`create index ${sql.id(`${fresh}_idx${i}`)} on ${freshTable} (${sql.join(columns.map((c) => sql.id(c)))})`.execute(conn);
        }
        // Statistics, so the first report over the new table is planned well.
        await sql`analyze ${freshTable}`.execute(conn);
        const counted = await sql<{ n: string }>`select count(*) as n from ${freshTable}`.execute(conn);
        await sql`begin`.execute(conn);
        try {
          await sql`drop table if exists ${finalTable}`.execute(conn);
          await sql`alter table ${freshTable} rename to ${sql.id(def.name)}`.execute(conn);
          for (const i of indexes.keys()) {
            await sql`alter index ${sql.id(DATASET_SCHEMA, `${fresh}_idx${i}`)} rename to ${sql.id(`${def.name}__idx${i}`)}`.execute(conn);
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
      // Leave the session as it was found. `reset all` also lifts the time limit set above, and
      // `unlock all` also frees a lock the pack's SELECT took.
      await sql`rollback`.execute(conn).catch(() => undefined);
      await sql`drop table if exists ${staging}`.execute(conn).catch(() => undefined);
      await sql`select pg_advisory_unlock_all()`.execute(conn).catch(() => undefined);
      await sql`reset all`.execute(conn).catch(() => undefined);
    }
  });
}

/** Drops a built dataset. A dataset that was never built is not an error. It takes the build's
 *  lock, so a delete during a build waits for it and removes what the build made. */
export async function dropWarehouseDataset(db: Kysely<any>, name: string): Promise<void> {
  assertName(name);
  await db.connection().execute(async (conn) => {
    try {
      await sql`select pg_advisory_lock(hashtext(${lockKeyOf(name)}))`.execute(conn);
      await sql`drop table if exists ${sql.id(DATASET_SCHEMA, name)}`.execute(conn);
      await sql`drop table if exists ${sql.id(DATASET_SCHEMA, `${name}__new`)}`.execute(conn);
    } finally {
      await sql`select pg_advisory_unlock_all()`.execute(conn).catch(() => undefined);
    }
  });
}
