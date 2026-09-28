import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  createInternalDb, createMigrator, internalMigrations, createTerminologyAdminStore,
  createFacilityRegisterSourceStore, createFacilityRegistryStore, type InternalDb,
} from '@openldr/db';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { linkMatchingFacilityCodes } from './facility-link-matching';
import type { ReconcileDeps } from './facility-reconcile';

// Gated and provisioned exactly like facility-import-live.test.ts (read its header first).
//
// This test exists BECAUSE pg-mem does not roll back a transaction when the callback inside it
// throws: verified in isolation, with a bare pg-mem `Kysely` instance, one table, and
// `db.transaction().execute(async (trx) => { insert; throw; })` — the insert survives the throw.
// `linkMatchingFacilityCodes`'s atomicity claim ("one write fails, nothing lands") can only be
// proven against real Postgres, where a transaction genuinely aborts on an unhandled throw.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

const MZ = 'urn:openldr:register:mz-disa-live';
const WIRE = 'urn:openldr:default_fac';

live('linkMatchingFacilityCodes against real Postgres', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_flm_${randomUUID().replace(/-/g, '')}`;
  let internal: InternalDb;
  let deps: ReconcileDeps;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    internal = createInternalDb(target.toString());
    const res = await createMigrator(internal.db, internalMigrations).migrateToLatest();
    if (res.error) throw res.error;

    const externalDb = await makeMigratedExternalDb();
    deps = { internalDb: internal.db, externalDb, admin: createTerminologyAdminStore(internal.db) };

    await createFacilityRegisterSourceStore(internal.db).create({ url: MZ, name: 'Register MZDISA live', code: 'MZDISA' });
    const registry = createFacilityRegistryStore(internal.db);
    await registry.upsert({ id: 'fac-a-live', name: 'A', facilityCode: 'AAAAA', facilitySystem: MZ, source: 'manual' });
    await registry.upsert({ id: 'fac-b-live', name: 'B', facilityCode: 'BBBBB', facilitySystem: MZ, source: 'manual' });

    const rows: { id: string; performer: string; source_system: string; performer_display: null; performer_system: string }[] = [];
    for (let i = 0; i < 5; i += 1) rows.push({ id: `dr-${randomUUID()}`, performer: 'AAAAA', source_system: 'webhook-ingest', performer_display: null, performer_system: WIRE });
    for (let i = 0; i < 4; i += 1) rows.push({ id: `dr-${randomUUID()}`, performer: 'BBBBB', source_system: 'webhook-ingest', performer_display: null, performer_system: WIRE });
    await externalDb.insertInto('diagnostic_reports').values(rows as never).execute();
  }, 120_000);

  afterAll(async () => {
    await internal?.close().catch(() => undefined); // ends the target pool so the drop can proceed
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('writes nothing when a write fails part way', async () => {
    const real = deps.admin.termMappings.saveExclusive.bind(deps.admin.termMappings);
    let calls = 0;
    vi.spyOn(deps.admin.termMappings, 'saveExclusive').mockImplementation(async (input, opts) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return real(input, opts);
    });

    await expect(linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true })).rejects.toThrow('boom');

    const rows = await deps.internalDb.selectFrom('term_mappings').selectAll().where('is_active', '=', true).execute();
    expect(rows).toHaveLength(0);
  }, 120_000);
});
