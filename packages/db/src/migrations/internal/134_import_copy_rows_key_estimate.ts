import { type Kysely, sql } from 'kysely';

// Tells PostgreSQL how many different keys `import_copy_rows` holds, as a share of its rows.
//
// The copy deletes a page's keys before it writes them (`replaceKeys`). On 2026-11-19, in a full
// Tanzania copy on a fresh standalone, ANALYZE sampled the table at 37 million rows and estimated
// 39,200 different keys, when there were over 1.2 million. Postgres then expected about 880 rows a
// key, and from a page of 1,000 keys it stopped using the primary key: a page of 2,000 keys scanned
// the whole table. The copy fell from about 120,000 keys a minute to under 20,000. The sample
// guesses lower the bigger the table grows, so a smaller page only puts it off.
//
// n_distinct = -0.05 says the keys are one in twenty rows, so the estimate grows with the table. A
// request of a lab system copies about 15 to 25 rows; a dictionary set one row a key, which only
// makes the estimate lower than the truth, the safe side. The setting takes effect at the next
// ANALYZE, so the migration runs one where the database is PostgreSQL. pg-mem knows neither
// statement, and a refused statement would end the migration's transaction on PostgreSQL, so both
// are asked for only there (as migration 130 does).
async function isPostgres(db: Kysely<unknown>): Promise<boolean> {
  return sql<{ v: string }>`select version() as v`.execute(db).then((r) => /PostgreSQL/i.test(r.rows[0]?.v ?? ''), () => false);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (!(await isPostgres(db))) return;
  await sql`alter table import_copy_rows alter column key set (n_distinct = -0.05)`.execute(db);
  await sql`analyze import_copy_rows`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (!(await isPostgres(db))) return;
  await sql`alter table import_copy_rows alter column key reset (n_distinct)`.execute(db);
  await sql`analyze import_copy_rows`.execute(db);
}
