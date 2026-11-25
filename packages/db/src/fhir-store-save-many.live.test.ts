import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql, type KyselyPlugin, type RootOperationNode } from 'kysely';
import pg from 'pg';
import { createMigrator } from './migrator';
import { internalMigrations } from './migrations/internal/index';
import { createFhirStore } from './fhir-store';
import { persistResources } from './persist';

// Item 16 slice 1: a database error on record 2 of 3 must save none of the three. pg-mem cannot
// show a rollback, so this needs real PostgreSQL. FHIR_SAVE_TEST_DATABASE_URL points at a server's
// maintenance database (for example postgres://bench@127.0.0.1:54399/postgres); the test creates a
// fresh database there, migrates it, and drops it afterwards.
const url = process.env.FHIR_SAVE_TEST_DATABASE_URL;

/** Throws when the save reaches its insert into `table`, so the failure lands inside the
 *  transaction, after the statements before it have really run. */
function failOnInsert(table: string): KyselyPlugin {
  return {
    transformQuery({ node }) {
      const n = node as RootOperationNode & { kind: string; into?: { table?: { identifier?: { name?: string } } } };
      if (n.kind === 'InsertQueryNode' && n.into?.table?.identifier?.name === table) {
        throw new Error('injected save failure');
      }
      return node;
    },
    async transformResult({ result }) { return result; },
  };
}

describe.skipIf(!url)('saveMany on disposable PostgreSQL', () => {
  const name = `fhir_save_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: Kysely<any>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    // An ICU collation, where 'a' sorts before 'B' as on most Linux servers. Alpine's C library sorts
    // every locale by bytes, which would hide a lock taken in the database's own order.
    await admin.query(`create database ${name} template template0 locale_provider icu icu_locale 'en-US'`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const r = await createMigrator(db, internalMigrations).migrateToLatest();
    if (r.error) throw r.error;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`drop database if exists ${name} with (force)`);
    await admin?.end();
  });

  async function counts(ids: string[]) {
    const one = async (t: string, col: string) =>
      Number((await db.selectFrom(t).select((eb) => eb.fn.countAll().as('n')).where(col, 'in', ids).executeTakeFirstOrThrow()).n);
    return {
      resources: await one('fhir.fhir_resources', 'id'),
      history: await one('fhir.resource_history', 'id'),
      changeLog: await one('fhir.change_log', 'resource_id'),
    };
  }

  it('a failure after the canonical and history rows are written leaves none of the list saved', async () => {
    // The row path: the injected failure hooks a query-builder insert, which only that path sends.
    // The set-based path is one statement, so it is all or nothing by itself (fhir-store-save-set.live.test.ts).
    const store = createFhirStore(db.withPlugin(failOnInsert('change_log')) as never, { saveMode: 'rows' });
    const ids = ['a1', 'a2', 'a3'].map((x) => `${x}-${randomUUID()}`);
    await expect(store.saveMany(ids.map((id) => ({ resourceType: 'Patient', id })) as never)).rejects.toThrow('injected save failure');
    expect(await counts(ids)).toEqual({ resources: 0, history: 0, changeLog: 0 });
  });

  it('a PostgreSQL refusal on record 2 of 3 (check constraint, SQLSTATE 23514) leaves none of them saved', async () => {
    // Refuses the history row of record 2, after its canonical upsert already ran in the same
    // transaction, so the rollback has real rows of records 1 and 2 to undo.
    const marker = `refuse-${randomUUID()}`;
    await sql.raw(`alter table fhir.resource_history add constraint item16_refuse check (id <> '${marker}') not valid`).execute(db);
    try {
      const store = createFhirStore(db);
      const ids = [`c1-${randomUUID()}`, marker, `c3-${randomUUID()}`];
      const err = await store.saveMany(ids.map((id) => ({ resourceType: 'Patient', id })) as never).then(() => null, (e: unknown) => e);
      expect((err as { code?: string } | null)?.code).toBe('23514');
      expect(await counts(ids)).toEqual({ resources: 0, history: 0, changeLog: 0 });
    } finally {
      await sql`alter table fhir.resource_history drop constraint item16_refuse`.execute(db);
    }
  });

  // SaveManyOpts.ownedBy locks the stored rows before it checks them. A writer that is taking the
  // record over in an open transaction makes the plugin save wait, and the save then sees the new
  // owner and refuses, instead of writing over it.
  it('ownedBy waits for a writer holding the record, then refuses it', async () => {
    const store = createFhirStore(db);
    const id = `own-${randomUUID()}`;
    await store.saveMany([{ resourceType: 'Patient', id }] as never, { pluginId: 'lab' });
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query("update fhir.fhir_current set plugin_id = null, source_system = 'ingest' where resource_type = 'Patient' and id = $1", [id]);
      let settled = false;
      const save = store.saveMany([{ resourceType: 'Patient', id, gender: 'male' }] as never, { pluginId: 'lab' }, { ownedBy: 'lab' })
        .then(() => null, (e: unknown) => e)
        .finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await holder.query('commit');
      const err = await save;
      expect((err as { name?: string } | null)?.name).toBe('FhirOwnershipError');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    const row = await db.selectFrom('fhir.fhir_resources').select(['version', 'plugin_id']).where('id', '=', id).executeTakeFirstOrThrow();
    expect([Number(row.version), row.plugin_id]).toEqual([1, null]);
  });

  it('persistResources saves a whole request or none of it', async () => {
    const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
    const ids = ['b1', 'b2', 'b3'].map((x) => `${x}-${randomUUID()}`);
    const bad = createFhirStore(db.withPlugin(failOnInsert('change_log')) as never, { saveMode: 'rows' });
    await expect(persistResources({ fhirStore: bad, logger }, ids.map((id) => ({ resourceType: 'Patient', id })))).rejects.toThrow();
    expect(await counts(ids)).toEqual({ resources: 0, history: 0, changeLog: 0 });
    const good = createFhirStore(db);
    await persistResources({ fhirStore: good, logger }, ids.map((id) => ({ resourceType: 'Patient', id })));
    expect(await counts(ids)).toEqual({ resources: 3, history: 3, changeLog: 3 });
  });

  it('a list of 2,500 records saves: PostgreSQL takes the 1,000-key lookup and the 1,000-row inserts', async () => {
    const tag = randomUUID();
    const ids = Array.from({ length: 2500 }, (_, i) => `big-${tag}-${i}`);
    const store = createFhirStore(db);
    const first = await store.saveMany(ids.map((id) => ({ resourceType: 'Patient', id })) as never);
    expect(first.every((r) => r.version === 1)).toBe(true);
    // A second pass reads a stored version for every key through the same lookup.
    const second = await store.saveMany(ids.map((id) => ({ resourceType: 'Patient', id, gender: 'male' })) as never);
    expect(second.every((r) => r.version === 2)).toBe(true);
    const n = await db.selectFrom('fhir.change_log').select((eb) => eb.fn.countAll().as('n')).where('resource_id', 'like', `big-${tag}-%`).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(5000);
  }, 60_000);

  it('change_log seq rises in input order within one call', async () => {
    const tag = randomUUID();
    const ids = Array.from({ length: 50 }, (_, i) => `seq-${tag}-${String(49 - i).padStart(2, '0')}`);
    await createFhirStore(db).saveMany(ids.map((id) => ({ resourceType: 'Patient', id })) as never);
    const log = await db.selectFrom('fhir.change_log').select('resource_id').where('resource_id', 'like', `seq-${tag}-%`).orderBy('seq').execute();
    expect(log.map((r: any) => r.resource_id)).toEqual(ids);
  });

  it('an update on conflict keeps created_at and moves updated_at', async () => {
    const id = `ts-${randomUUID()}`;
    const store = createFhirStore(db);
    await store.saveMany([{ resourceType: 'Patient', id }] as never, { batchId: 'one' });
    const first = await db.selectFrom('fhir.fhir_resources').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    await new Promise((r) => setTimeout(r, 20));
    await store.saveMany([{ resourceType: 'Patient', id, gender: 'male' }, { resourceType: 'Patient', id, gender: 'female' }] as never, { batchId: 'two' });
    const second = await db.selectFrom('fhir.fhir_resources').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(new Date(second.created_at).getTime()).toBe(new Date(first.created_at).getTime());
    expect(new Date(second.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());
    expect([Number(second.version), second.version_id, second.batch_id, second.resource.gender]).toEqual([3, '3', 'two', 'female']);
  });

  it('two writers of one key, both numbering the same version: one commits, the loser gets 23505 and leaves nothing', async () => {
    // The barrier holds each writer after its versions lookup has returned, until both have read.
    // Both then number version 1 for the shared key, so one must lose on the history primary key.
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((r) => { release = r; });
    const shared = `race-${randomUUID()}`;
    const mine = [`race-a-${randomUUID()}`, `race-b-${randomUUID()}`];
    const gate = (): KyselyPlugin => {
      let held = false;
      return {
        transformQuery({ node }) { return node; },
        async transformResult({ result }) {
          // The first SELECT of the call is the versions lookup (the site lookup runs on the plain db).
          if (!held && (result as { numAffectedRows?: bigint }).numAffectedRows === undefined) {
            held = true;
            if (++arrived === 2) release();
            await bothRead;
          }
          return result;
        },
      };
    };
    // The site lookup is made first on an ungated handle so the gate only sees the versions lookup.
    const writer = (own: string) => {
      const gated = db.withPlugin(gate());
      const store = createFhirStore(new Proxy(db, {
        get(target, prop) {
          if (prop === 'transaction') return () => gated.transaction();
          // Kysely keeps private fields, so its methods must run on the real object, not the proxy.
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      // The row path: the gate holds a writer after its versions lookup, a statement only that path sends.
      }) as never, { saveMode: 'rows' });
      return store.saveMany([{ resourceType: 'Patient', id: own }, { resourceType: 'Patient', id: shared }] as never)
        .then(() => ({ ok: true as const, own }), (e: { code?: string }) => ({ ok: false as const, own, code: e.code }));
    };
    const results = await Promise.all([writer(mine[0]), writer(mine[1])]);
    expect(arrived).toBe(2);
    const won = results.filter((r) => r.ok);
    const lost = results.filter((r) => !r.ok);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as { code?: string }).code).toBe('23505');
    expect(await counts([lost[0].own])).toEqual({ resources: 0, history: 0, changeLog: 0 });
    expect(await counts([won[0].own])).toEqual({ resources: 1, history: 1, changeLog: 1 });
    expect(await counts([shared])).toEqual({ resources: 1, history: 1, changeLog: 1 });
  }, 30_000);

  // Review minor of M2: the owner check locks in byte order on PostgreSQL whatever the save mode, so
  // two saves with mixed-case ids cannot lock the same rows in opposite orders.
  it('ownedBy locks mixed-case ids in byte order, with the set-based save and with the row save', async () => {
    const bytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
    for (const saveMode of ['set', 'rows'] as const) {
      const ids = Array.from({ length: 1002 }, (_, i) => `${i % 2 === 0 ? 'a' : 'B'}-${saveMode}-${String(i).padStart(4, '0')}`);
      await createFhirStore(db, { saveMode }).saveMany(ids.map((id) => ({ resourceType: 'Patient', id })) as never, { pluginId: 'lab' });
      const lockQueries = new Set<string>();
      const locked: string[] = [];
      const spy: KyselyPlugin = {
        transformQuery(args) {
          const c = db.getExecutor().compileQuery(args.node, args.queryId);
          if (/for update/i.test(c.sql) && c.sql.includes('fhir_current')) lockQueries.add(args.queryId.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (lockQueries.has(args.queryId.queryId)) locked.push(...(args.result.rows as Array<{ id: string }>).map((r) => r.id));
          return args.result;
        },
      };
      await createFhirStore(db.withPlugin(spy), { saveMode }).saveMany(ids.map((id) => ({ resourceType: 'Patient', id, gender: 'male' })) as never,
        { pluginId: 'lab' }, { ownedBy: 'lab' });
      expect(locked, saveMode).toEqual([...ids].sort(bytes));
    }
  }, 120_000);
});
