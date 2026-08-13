import { Kysely, sql } from 'kysely';

// The contract half of the expand/contract begun in 086. `local_code`, `national_code` and
// `national_system` are gone; `facility_code` + `facility_system` are the facility's identity.
//
// Every reader and writer moved across in the stages between: the parsers emit the new pair, the
// importer resolves by it, the projection derives its concept code from it, the form binds it, and
// the store stopped dual-writing the old columns. This migration is what makes that irreversible.
//
// ⛔ down() CANNOT restore the DATA. It rebuilds the columns so a schema rollback works, but the
// values are gone: `facility_code` alone cannot say whether a code was once local or national.
// `extras.__localCode`, written by 086 for rows that carried both, is the only survivor. Restore
// from a backup, not from here.

export async function up(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;

  // Constraints and indexes FIRST. Dropping a column out from under a constraint that names it is
  // engine-dependent, and the CHECK below refers to two of the three columns being removed.
  //
  // `facility_registry_has_a_code` (migration 070) asserted "local_code or national_code is not
  // null" — an OR across two nullable columns, which is exactly the shape that made a facility's
  // identity impossible to express as a required form field. It has no successor: `facility_code`
  // carries a NOT NULL of its own below.
  await sql`alter table facility_registry drop constraint if exists facility_registry_has_a_code`.execute(d);
  await sql`drop index if exists facility_registry_national_unique`.execute(d);

  await d.schema.alterTable('facility_registry').dropColumn('local_code').execute();
  await d.schema.alterTable('facility_registry').dropColumn('national_code').execute();
  await d.schema.alterTable('facility_registry').dropColumn('national_system').execute();

  // ⛔ NOT NULL lands HERE, not in 086. While both shapes existed, several code paths and ten test
  // files inserted rows without knowing about these columns; requiring them then would have broken
  // every one. By now the store is the only writer and it always supplies a code.
  //
  // A row with no code cannot exist anyway — 086's backfill covered every row, and the CHECK it
  // replaced guaranteed at least one source column. If this statement fails on a live install, the
  // right answer is to find the codeless row, not to relax the constraint.
  await sql`alter table facility_registry alter column facility_code set not null`.execute(d);

  // ⛔ ONE expression index, not two partial ones.
  //
  // The obvious shape is a pair: `unique (facility_system, facility_code) where facility_system is
  // not null`, plus `unique (facility_code) where facility_system is null` to replace `local_code`'s
  // own UNIQUE. Both are needed because SQL NULLs never compare equal, so a plain pair index would
  // let two registerless facilities share a code.
  //
  // MEASURED: pg-mem then answers `where facility_code = 'X'` with NO ROWS for a row that plainly
  // has it — it picks the wrong partial index and never consults the other. That is not a Postgres
  // behaviour, but it silently broke `claimantsOf` and every reprojection test built on it, with the
  // table visibly containing the row. Coalescing the system into one expression gives one index, no
  // choice to get wrong, and says the rule more directly: a code is unique within its system, and
  // "no system" is a system of its own.
  await sql`drop index if exists facility_registry_system_code_unique`.execute(d);
  await sql`create unique index facility_registry_system_code_unique
              on facility_registry (coalesce(facility_system, ''), facility_code)`.execute(d);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;

  await sql`drop index if exists facility_registry_system_code_unique`.execute(d);
  await sql`alter table facility_registry alter column facility_code drop not null`.execute(d);

  await d.schema.alterTable('facility_registry').addColumn('local_code', 'text', (c) => c.unique()).execute();
  await d.schema.alterTable('facility_registry').addColumn('national_system', 'text').execute();
  await d.schema.alterTable('facility_registry').addColumn('national_code', 'text').execute();

  // Restore 086's partial index so the schema matches what 086 left behind.
  await d.schema
    .createIndex('facility_registry_system_code_unique')
    .unique()
    .on('facility_registry')
    .columns(['facility_system', 'facility_code'])
    .where(sql.ref('facility_code'), 'is not', null)
    .execute();

  // ⛔ `facility_registry_has_a_code` is deliberately NOT restored. It asserts a code exists in the
  // columns this down() just re-added EMPTY, so re-adding it would refuse every existing row. The
  // schema rolls back; the constraint cannot, because the data it constrains is gone.
}
