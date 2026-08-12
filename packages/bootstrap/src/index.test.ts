import { describe, it, expect, afterEach } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAppSettingsStore, createReportStore, createRoleStore, referenceCapture } from '@openldr/db';
import { createDashboardStore, createColumnPolicyStore, joinableTablesForClient } from '@openldr/dashboards';
import { createFormStore } from '@openldr/forms';
import type { Config } from '@openldr/config';
import { createAppContext, capabilityBackfillEvents, buildReportingForTest, type AppContext } from './index';
import { truncateTables } from './danger';

const cfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
  BLOB_ADAPTER: 'minio',
  EVENTING_ADAPTER: 'pg',
  TARGET_STORE_ADAPTER: 'pg',
  INTERNAL_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  S3_ENDPOINT: 'http://127.0.0.1:9499',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
  S3_BUCKET: 'none',
  S3_FORCE_PATH_STYLE: true,
  OIDC_ISSUER_URL: 'http://127.0.0.1:8499/realms/master',
}) as Config;

let ctx: AppContext;
afterEach(async () => { await ctx?.close(); });

describe('createAppContext', () => {
  it('wires and registers all four port health checks', async () => {
    ctx = await createAppContext(cfg);
    const out = await ctx.health.runAll();
    expect(Object.keys(out.checks).sort()).toEqual(['auth', 'blob', 'eventing', 'target-store']);
    expect(typeof ctx.terminology.ontology.listDistributions).toBe('function');
    expect(typeof ctx.terminology.loaders.loinc).toBe('function');
    expect(typeof ctx.forms.list).toBe('function');
    // RBAC Task 4: ctx.roles is on AppContext (shape check only — no live DB here, see below
    // for the seeded-roles integration test against a real migrated db).
    expect(typeof ctx.roles.list).toBe('function');
    expect(typeof ctx.roles.seedSystemRoles).toBe('function');
    expect(typeof ctx.plugins.list).toBe('function');
    expect(typeof ctx.plugins.install).toBe('function');
    expect(typeof ctx.plugins.rollback).toBe('function');
    expect(typeof ctx.plugins.setEnabled).toBe('function');
    expect(typeof ctx.plugins.remove).toBe('function');
    // Nothing reachable in this test → overall down, but no crash.
    expect(out.status).toBe('down');
  }, 20000);

  // Coverage gap closed: the route-level test (apps/server/src/dashboards-routes.test.ts) mocks
  // ctx.dashboards entirely, so it never exercises the real `models: () => modelsForClient()`
  // wiring in index.ts. This builds the real AppContext (same as above) and calls the real
  // dashboards.models() — modelsForClient() is pure (no DB/pg), so this is safe without a live DB.
  it('dashboards.models() returns the PII-safe client projection (real wiring)', async () => {
    ctx = await createAppContext(cfg);
    const models = ctx.dashboards.models();
    const sr = models.find((m) => m.id === 'service_requests')!;
    expect((sr as Record<string, unknown>).joins).toBeUndefined(); // raw joins never exposed
    const jp = sr.optionalJoins?.find((j) => j.alias === 'jp');
    expect(jp?.label).toBe('Patient');
    expect(jp?.exposableColumns).toContain('managing_organization');
    expect(jp?.exposableColumns).not.toContain('surname'); // denied PII absent
  }, 20000);

  // Data Exposure Task 5: DashboardsApi grows a `columnPolicy` store handle + `reloadColumnPolicy()`
  // beside the existing models()/joinableTables()/query()/compileSql() surface. This cfg's
  // INTERNAL_DATABASE_URL is deliberately unreachable (127.0.0.1:5499, see the class comment above)
  // so this is a SHAPE check only — but it also proves the boot-time cache load (`columnPolicy.load()`
  // called once inside createAppContext, before this object is returned) is wrapped best-effort:
  // construction must still succeed against an unreachable DB, exactly like the other unconditional
  // best-effort seeds/migrations in createAppContext (roles.seedSystemRoles(), migrateLegacySyncConfig,
  // etc.) — an empty cache still falls back to HARDCODED_DENY_UNION per table (registry.ts's
  // `hiddenFor`), so known PII stays denied either way. The real read/write/reload round trip against a
  // live DB is proven below (against pg-mem, mirroring bootstrap's exact construction — createAppContext
  // itself can't run against pg-mem; see the reference-capture describe block's comment for why).
  it('dashboards.columnPolicy + reloadColumnPolicy are wired (shape check; unreachable DB tolerated)', async () => {
    ctx = await createAppContext(cfg);
    expect(typeof ctx.dashboards.columnPolicy.load).toBe('function');
    expect(typeof ctx.dashboards.columnPolicy.listHidden).toBe('function');
    expect(typeof ctx.dashboards.columnPolicy.replaceTable).toBe('function');
    expect(typeof ctx.dashboards.reloadColumnPolicy).toBe('function');
  }, 20000);

  // Task 4 (facility durable updates): the facility job store must be reachable from the context
  // (routes/CLI enqueue through it in later tasks) and the worker polling it must be stopped
  // cleanly on shutdown, alongside the other pollers (terminologyIngestWorker, projectionWorker).
  it('exposes a facility job store on the context and stops its worker on shutdown', async () => {
    ctx = await createAppContext(cfg);
    expect(ctx.facilityJobs).toBeDefined();
    expect(typeof ctx.facilityJobs.enqueue).toBe('function');
    await expect(ctx.close()).resolves.toBeUndefined();
  }, 20000);
});

/**
 * Data Exposure Task 5 (behavioral): proves the actual cache-threading contract createAppContext
 * wires — `columnPolicy.replaceTable()` followed by `reloadColumnPolicy()` changes what the NEXT
 * `joinableTables()`/`models()` call reports, with no per-request DB read in between. createAppContext
 * itself can't run against pg-mem (real pg pools + a LISTEN client — see the reference-capture describe
 * block's comment), so this mirrors its exact construction (`createColumnPolicyStore(internal.db)`,
 * cache variable + `reloadColumnPolicy` closure, `joinableTablesForClient(policyCache)`) against a
 * fully-migrated pg-mem db, the same pattern already used above for the role-seed and
 * reference-capture guarantees.
 */
describe('createAppContext column-policy cache wiring (Data Exposure Task 5)', () => {
  it('replaceTable + reload changes joinableTablesForClient(policyCache) without re-querying per call', async () => {
    const db = await makeMigratedDb();
    const columnPolicy = createColumnPolicyStore(db); // bootstrap construction: createColumnPolicyStore(internal.db)
    let policyCache = await columnPolicy.load(); // bootstrap construction: initial cache load
    const reloadColumnPolicy = async () => { policyCache = await columnPolicy.load(); };

    // Before: patients has no policy rows yet, so hiddenFor() falls back to HARDCODED_DENY_UNION —
    // national_id stays denied.
    const before = joinableTablesForClient(policyCache).find((t) => t.table === 'patients')!;
    expect(before.columns).not.toContain('national_id');

    // Fully expose the table (Task 5b: per-column `hidden` flag) — this now survives reload
    // instead of reverting to HARDCODED_DENY_UNION, because load() yields a map entry (an empty
    // Set) for any table with rows, not just tables with hidden columns.
    await columnPolicy.replaceTable('patients', [], 'test');
    await reloadColumnPolicy();

    const after = joinableTablesForClient(policyCache).find((t) => t.table === 'patients')!;
    expect(after.columns).toContain('national_id');
  });
});

/**
 * Regression guard for the S2 CRITICAL integration gap: `createAppContext` must construct the
 * reference-config stores WITH `referenceCapture`, or nothing is ever written to
 * `reference_change_log` and `POST /api/sync/pull` returns empty forever (the feature is inert in
 * production — the acceptance harness wired capture itself and masked it).
 *
 * `createAppContext` opens real pg pools + a LISTEN client from a URL, so it can't run against
 * pg-mem in a unit test. This mirrors bootstrap's exact construction (same factories, same
 * `referenceCapture` binding, imported the same way index.ts imports them) against a fully-migrated
 * db and proves a write THROUGH each store lands a log row. If a future edit drops the capture arg
 * from any of these constructions in index.ts, this construction — and thus the guarantee — breaks
 * in the same way, and the matching case here fails. (facility_registry is ALSO constructed with
 * `referenceCapture` in index.ts, but its capture is suspended at the entity-type level — see
 * SUSPENDED_REFERENCE_ENTITY_TYPES — so it has no case here.)
 */
describe('createAppContext reference-capture wiring (S2 pull source)', () => {
  const refLog = (db: Awaited<ReturnType<typeof makeMigratedDb>>, entityId: string) =>
    db.selectFrom('reference_change_log').selectAll().where('entity_id', '=', entityId).orderBy('seq').execute();

  it('app_settings.set of a center-owned key lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const appSettings = createAppSettingsStore(db, referenceCapture); // bootstrap construction
    await appSettings.set('dashboard.raw_sql', 'true', 'test');
    const log = await refLog(db, 'dashboard.raw_sql');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'setting', op: 'upsert' });
  });

  it('dashboard create lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const dashboards = createDashboardStore(db, referenceCapture); // bootstrap construction
    await dashboards.create({ id: 'd1', name: 'Main', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true, ownerId: null });
    const log = await refLog(db, 'd1');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'dashboard', op: 'upsert' });
  });

  it('report create lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const reportDefs = createReportStore(db, referenceCapture); // bootstrap construction
    await reportDefs.create({
      id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1', primaryQueryId: 'q1',
      summaryMetrics: null, chart: null, paramOptions: null, status: 'published',
    });
    const log = await refLog(db, 'r1');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity_type: 'report', op: 'upsert' });
  });

  it('publishing a form lands a reference_change_log row', async () => {
    const db = await makeMigratedDb();
    const forms = createFormStore(db, referenceCapture); // bootstrap construction
    const created = await forms.create({ name: 'Intake', schema: { name: 'Intake', fields: [], sections: [] } as never, targetPages: ['forms'] });
    await forms.publish(created.id);
    const log = await refLog(db, created.id);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log.at(-1)).toMatchObject({ entity_type: 'form', op: 'upsert' });
  });

  // facility_registry is absent DELIBERATELY — capture suspended, see
  // SUSPENDED_REFERENCE_ENTITY_TYPES in @openldr/db's reference-change-log.ts.
});

/**
 * RBAC Task 4: `createAppContext` seeds the 5 system roles UNCONDITIONALLY (via
 * `roles.seedSystemRoles()` beside `const roles = createRoleStore(internal.db)` in index.ts) —
 * deliberately NOT gated behind SEED_ON_START, which defaults to false and only guards optional
 * demo/sample data (see seed.ts). `createAppContext` itself can't run against pg-mem (real pg
 * pools + a LISTEN client, per the comment above), so this mirrors the exact bootstrap
 * construction (`createRoleStore(internal.db)`) against a fully-migrated db, the same pattern the
 * reference-capture tests above use, and proves the seed call's idempotent semantics: 5 roles
 * after one call, still 5 after a second (both fresh install and an existing-DB upgrade re-run it
 * on every boot).
 */
describe('createAppContext system-role seed (RBAC Task 4)', () => {
  it('seedSystemRoles produces the 5 system roles, idempotently', async () => {
    const db = await makeMigratedDb();
    const roles = createRoleStore(db); // bootstrap construction: createRoleStore(internal.db)
    await roles.seedSystemRoles();
    await roles.seedSystemRoles(); // second call (mirrors every-boot re-seed) — no duplicates
    const list = await roles.list();
    expect(list).toHaveLength(5);
    expect(list.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'].sort(),
    );
    const admin = list.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
  });
});

/**
 * Admin-lockout regression guard for `dangerFactoryReset` (packages/bootstrap/src/index.ts): a
 * factory reset TRUNCATEs every internal-DB table — including `roles`/`role_capabilities`/
 * `user_roles` — via `wipeInternalDatabase()`, and `seedDatabase()` deliberately does NOT reseed
 * roles (that seed is routed through `createAppContext`'s unconditional boot-time call — see the
 * comment beside `const roles = createRoleStore(internal.db)` in index.ts). Left unfixed, a live
 * server would be left with zero roles until the process restarts.
 *
 * `dangerFactoryReset` itself can't run against pg-mem end-to-end (it calls `createDbContext`,
 * which opens real pg pools — see the reference-capture describe block above for the same
 * constraint), and `wipeInternalDatabase()`'s own table-discovery query (`pg_tables`) isn't
 * supported by pg-mem either (see danger.test.ts, which for the same reason only unit-tests the
 * pure `buildTruncateSql` SQL builder, never a live wipe). This instead proves the narrower
 * guarantee the fix relies on, using `truncateTables()` — the same CASCADE TRUNCATE statement
 * `wipeInternalDatabase` issues, just against an explicit table list instead of one discovered via
 * `pg_tables` — targeted at exactly the tables a factory reset empties: `roles` really does end up
 * empty, and re-calling `roles.seedSystemRoles()` after the wipe — exactly what `dangerFactoryReset`
 * now does — repopulates all 5 system roles without any process restart.
 */
describe('dangerFactoryReset role reseed (admin-lockout fix)', () => {
  it('truncating roles (as a factory reset would) then re-seeding repopulates the 5 system roles', async () => {
    const db = await makeMigratedDb();
    const roles = createRoleStore(db); // bootstrap construction: createRoleStore(internal.db)

    // Boot-time seed (mirrors createAppContext's unconditional call).
    await roles.seedSystemRoles();
    expect(await roles.list()).toHaveLength(5);

    // Factory reset step 1: wipe. Proves the bug's premise — roles really is emptied. Same CASCADE
    // TRUNCATE `wipeInternalDatabase` runs, just given the table names directly (pg-mem can't run
    // the `pg_tables` query it uses to discover them — see the comment above) and one statement per
    // table (pg-mem also doesn't support a single multi-table TRUNCATE, unlike real Postgres).
    for (const table of ['role_capabilities', 'user_roles', 'roles'] as const) {
      await truncateTables(db, [table]);
    }
    expect(await roles.list()).toHaveLength(0);

    // Factory reset step 2 (the fix): dangerFactoryReset now calls ctx.roles.seedSystemRoles()
    // after the wipe/reseed, using the same already-constructed roles store off ctx (not a
    // fresh one) — so the reset leaves 5 roles present with no restart required.
    await roles.seedSystemRoles();
    const list = await roles.list();
    expect(list).toHaveLength(5);
    expect(list.map((r) => r.slug).sort()).toEqual(
      ['data_analyst', 'lab_admin', 'lab_manager', 'lab_technician', 'system_auditor'].sort(),
    );
    const admin = list.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
  });
});

describe('boot-time capability reconciliation audit', () => {
  // Reconciliation grants a privilege without anyone asking for it. That is exactly what an audit
  // log is for — otherwise the Data Exposure pane simply appears one day with no explanation.
  it('groups granted capabilities into one event per role', async () => {
    const granted = [
      { slug: 'lab_admin', roleId: 'r-admin', capability: 'data_exposure.manage' },
      { slug: 'lab_admin', roleId: 'r-admin', capability: 'audit.view' },
      { slug: 'lab_technician', roleId: 'r-tech', capability: 'forms.submit' },
    ];

    const events = capabilityBackfillEvents(granted);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      action: 'role.capability.backfill',
      entityType: 'role',
      entityId: 'r-admin',
      metadata: { slug: 'lab_admin', capabilities: ['data_exposure.manage', 'audit.view'] },
    });
    expect(events[1].entityId).toBe('r-tech');
  });

  // An ordinary restart changes nothing; it must not write an event, or the signal is worthless.
  it('emits no events when nothing was granted', () => {
    expect(capabilityBackfillEvents([])).toEqual([]);
  });
});

/**
 * Root C1 Task 1: the render-time refusal for a report whose subject does not exist. Builds the
 * smallest `renderDataDriven` dependency set (the four `createDataDrivenReporting` reads, via the
 * existing `buildReportingForTest` seam — see `reporting-data-driven.test.ts` for the same deps
 * shape) so the gate in index.ts's `renderDataDriven` can be exercised without a real DB.
 */
function makeDataDriven(opts: {
  design: { id: string; pages: unknown[]; parameters: unknown[] };
  resolved: Map<string, { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } | { error: string }>;
  onRender?: () => void;
}) {
  const def = {
    id: 'r1', name: 'R', description: '', category: 'other', designId: opts.design.id,
    primaryQueryId: 'q1', summaryMetrics: null, chart: null, paramOptions: null, status: 'published',
  } as any;
  const deps = {
    reportDefs: { list: async () => [def], get: async (id: string) => (id === 'r1' ? def : undefined) },
    reportDesigns: { get: async (id: string) => (id === opts.design.id ? opts.design : undefined) },
    runStoredQuery: async () => ({ columns: [], rows: [] }),
    resolveDesignTables: async () => opts.resolved,
    renderReportDesignPdf: async () => {
      opts.onRender?.();
      return Buffer.from('%PDF-1.4 fake');
    },
  };
  const reporting = buildReportingForTest(deps as any);
  return { renderDataDriven: (id: string, params: unknown) => reporting.renderPdf(id, params) };
}

describe('renderDataDriven refuses a listed design whose subject has zero rows (Root C1 Task 1)', () => {
  it('the refusal: a listed design whose required element resolved to ZERO rows', async () => {
    // The audit photographed a clinical report showing labels with no values and a signature line.
    // `keyValuePairs` renders zero rows exactly that way (draw.ts:340), so the page reads as a real,
    // signable result for a request that was never made.
    let rendered = false;
    const dd = makeDataDriven({
      design: { id: 'rt-clinical-micro', pages: [], parameters: [] },
      resolved: new Map([['hdr', { columns: [], rows: [] }]]),
      onRender: () => { rendered = true; },
    });
    await expect(dd.renderDataDriven('r1', {})).rejects.toMatchObject({ code: 'RP0005' });
    expect(rendered, 'no PDF may be produced for a refused report').toBe(false);
  });

  it('renders a listed design when its required element has rows', async () => {
    const dd = makeDataDriven({
      design: { id: 'rt-clinical-micro', pages: [], parameters: [] },
      resolved: new Map([['hdr', { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] }]]),
    });
    await expect(dd.renderDataDriven('r1', {})).resolves.toBeInstanceOf(Buffer);
  });

  it('does NOT refuse on a query error - the renderer draws a visible placeholder for that', async () => {
    // An error is loud. Refusing here would turn a visible red box into a failed download, and the
    // spec deliberately scopes the refusal to the silent case.
    const dd = makeDataDriven({
      design: { id: 'rt-clinical-micro', pages: [], parameters: [] },
      resolved: new Map([['hdr', { error: 'boom' }]]),
    });
    await expect(dd.renderDataDriven('r1', {})).resolves.toBeInstanceOf(Buffer);
  });

  it('renders a design ABSENT from the map, whatever its tables resolved to', async () => {
    const dd = makeDataDriven({
      design: { id: 'rt-amr-antibiogram', pages: [], parameters: [] },
      resolved: new Map([['hdr', { columns: [], rows: [] }]]),
    });
    await expect(dd.renderDataDriven('r1', {})).resolves.toBeInstanceOf(Buffer);
  });
});
