import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import { createInternalDb, type InternalDb } from '../../internal-db';
import { createMigrator } from '../../migrator';
import { internalMigrations } from './index';

// ⛔ THE ONLY TEST THAT CAN SEE THIS DEFECT. Postgres binds at most 65535 parameters per statement,
// and each row of a multi-row statement binds one parameter PER COLUMN. On an upgrade install
// migration 082 re-keys every facility of a national register at once, so its three-column insert
// into `facility_concept_projection` binds 3 × N parameters — 66 000 at the 22 000 rows below.
// pg-mem has no parameter ceiling and would pass either way; `apps/server` migrates on boot, so the
// failure is an upgrade that will not start. Measured here against the pre-fix migration:
//   bind message has 464 parameter formats but 0 parameters   (SQLSTATE 08P01)
// 464 is 66 000 wrapped into the protocol's 16-bit count field.
//
// Gated and provisioned exactly like packages/bootstrap/src/facility-import-live.test.ts: it creates
// its OWN throwaway database and drops it again, so `TARGET_DATABASE_URL` here only needs to name a
// server this test may `create database` against — it never reads or writes a database the operator
// uses. Skipped when that variable is unset, so it does not run in the ordinary gate; it takes
// minutes, because the point of it is the row count.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

// 65535 / 3 columns = 21845 rows is the exact boundary of the failing insert. 22 000 clears it.
const ROWS = 22_000;
const REGISTER_URI = 'urn:openldr:cs:facility-register:hfr';

live('082 against real Postgres at national-register scale', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `fac082_scale_${randomUUID().replace(/-/g, '')}`;
  let internal: InternalDb;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    internal = createInternalDb(target.toString());
    // An UPGRADE install: everything up to 081 has run, 082 has not.
    const upTo081 = Object.fromEntries(Object.entries(internalMigrations).filter(([n]) => n < '082'));
    const res = await createMigrator(internal.db as never, upTo081).migrateToLatest();
    if (res.error) throw res.error;
  }, 300_000);

  afterAll(async () => {
    await internal?.close().catch(() => undefined);
    await admin
      .query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('migrates a register of 22 000 facilities without exceeding the parameter ceiling', async () => {
    const db = internal.db as never as import('kysely').Kysely<any>;

    await sql`
      insert into facility_registry (id, name, national_system, national_code, source)
      select 'fac-seed-' || lpad(i::text, 12, '0'), 'Facility ' || i, 'HFR', i::text, 'import'
        from generate_series(1, ${sql.lit(ROWS)}) i
    `.execute(db);
    // One projection link per facility, parked on its own id — the collision fallback
    // `registryConceptRows` writes, and the shape 082 has to re-point rather than leave alone.
    await sql`
      insert into facility_concept_projection (registry_id, concept_code, updated_at)
      select id, id, now() from facility_registry
    `.execute(db);
    await sql`
      insert into terminology_concepts (system, code, display, status)
      select 'urn:openldr:cs:facility-registry', id, name, 'ACTIVE' from facility_registry
    `.execute(db);
    // …and a live DHIS2 org-unit doc per facility, so the five-column `plugin_data` insert is
    // exercised at the same scale as the three-column one.
    await sql`
      insert into plugin_data (plugin_id, collection, key, doc)
      select 'dhis2-sink', 'orgUnitMaps', id,
             jsonb_build_object('facilityId', id, 'orgUnitId', 'OU' || national_code)
        from facility_registry
    `.execute(db);

    // Run 082 the way a boot runs it: through the migrator, inside its transaction.
    const started = Date.now();
    const res = await createMigrator(internal.db as never, internalMigrations).migrateToLatest();
    if (res.error) throw res.error;
    // eslint-disable-next-line no-console
    console.log(`082 live: ${ROWS} facilities re-keyed in ${Date.now() - started} ms`);

    const [state] = (await sql<any>`
      select
        (select count(*)::int from facility_registry) as registry_rows,
        (select count(*)::int from facility_registry where national_system = ${REGISTER_URI}) as uri_rows,
        (select count(*)::int from facility_registry where id like 'fac-seed-%') as unmoved_rows,
        (select count(*)::int from facility_concept_projection) as link_rows,
        (select count(*)::int from facility_concept_projection p
           join facility_registry r on r.id = p.registry_id) as links_joined,
        (select count(*)::int from facility_concept_projection where concept_code = registry_id) as links_parked,
        (select count(*)::int from plugin_data where collection = 'orgUnitMaps') as org_units,
        (select count(*)::int from plugin_data pd join facility_registry r on r.id = pd.key
          where pd.collection = 'orgUnitMaps') as org_units_joined,
        (select count(*)::int from plugin_data pd where pd.collection = 'orgUnitMaps'
          and pd.doc->>'facilityId' = pd.key) as org_unit_docs_repointed,
        (select count(*)::int from terminology_concepts c
          where c.system = 'urn:openldr:cs:facility-registry'
            and exists (select 1 from facility_registry r where r.id = c.code)) as concepts_repointed
    `.execute(db)).rows;
    // eslint-disable-next-line no-console
    console.log('082 live end state', JSON.stringify(state));

    // ⛔ Nothing lost and nothing left behind: a migration that stops erroring but drops rows is a
    // worse defect than the one this test exists for.
    expect(state.registry_rows).toBe(ROWS);
    expect(state.uri_rows).toBe(ROWS);
    expect(state.unmoved_rows).toBe(0);
    expect(state.link_rows).toBe(ROWS);
    expect(state.links_joined).toBe(ROWS);
    expect(state.links_parked).toBe(ROWS);
    expect(state.org_units).toBe(ROWS);
    expect(state.org_units_joined).toBe(ROWS);
    expect(state.org_unit_docs_repointed).toBe(ROWS);
    expect(state.concepts_repointed).toBe(ROWS);
    // 30 minutes. Measured GREEN on Docker Desktop for Windows over loopback TCP at 722 844 ms
    // (~12 min) for these 22 000 rows, of which ~88 % is this host's per-statement round trip
    // (4.107 ms measured for `select 1`), not Postgres doing work. The previous 900 000 ms left
    // only 24 % headroom, so a host a quarter slower turned a pass into a timeout that reads like
    // a regression. This is a timeout, not a budget: nothing here is expected to take 30 minutes.
  }, 1_800_000);
});
