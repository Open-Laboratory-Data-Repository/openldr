import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbCtx: { pendingMigrations: vi.fn(), migrateAll: vi.fn(), reset: vi.fn(), close: vi.fn(), internalDb: { marker: 'internalDb' }, relationalWriter: { marker: 'relationalWriter' } },
  appCtx: { close: vi.fn() },
  createDbContext: vi.fn(),
  createAppContext: vi.fn(),
  seedDatabase: vi.fn(),
  recordAuditEvent: vi.fn(),
  reprojectAll: vi.fn(),
  listDatasetsWithState: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createDbContext: mocks.createDbContext,
  createAppContext: mocks.createAppContext,
  seedDatabase: mocks.seedDatabase,
  recordAuditEvent: mocks.recordAuditEvent,
  listDatasetsWithState: mocks.listDatasetsWithState,
}));

vi.mock('@openldr/db', () => ({
  reprojectAll: mocks.reprojectAll,
}));

import { runDbSeed, runDbMigrate, runDbReset, runDbReproject } from './db';

const SEED_RESULT = {
  resources: ['a', 'b', 'c'],
  formsSeeded: 0,
  workflowsSeeded: 0,
  connectorsSeeded: 0,
  dashboardsSeeded: 0,
  settingsSeeded: 0,
  terminology: { valueSetsImported: 0, ucumConceptsImported: 0 },
};

describe('db seed pending-migration guard', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.seedDatabase.mockResolvedValue(SEED_RESULT);
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to seed when migrations are pending and never builds the app context', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({
      internal: ['053_workflow_secrets', '054_sync_amendments'],
      external: ['008_patients_merge'],
    });

    const code = await runDbSeed({ json: false });

    expect(code).toBe(1);
    expect(mocks.seedDatabase).not.toHaveBeenCalled();
    // The crux: createAppContext boots the SEC-06 secret shim, whose failure against a stale
    // schema is the stack trace that buried the real problem. The guard must precede it.
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('names the pending migrations and the remedy', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({
      internal: ['053_workflow_secrets'],
      external: ['008_patients_merge'],
    });

    await runDbSeed({ json: false });

    expect(out).toContain('053_workflow_secrets');
    expect(out).toContain('008_patients_merge');
    expect(out).toContain('db migrate');
  });

  it('closes the db context when it refuses', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: ['053_workflow_secrets'], external: [] });

    await runDbSeed({ json: false });

    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('reports the pending_migrations shape as JSON', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: ['053_workflow_secrets'], external: [] });

    await runDbSeed({ json: true });

    expect(JSON.parse(out)).toEqual({
      ok: false,
      error: 'pending_migrations',
      pending: { internal: ['053_workflow_secrets'], external: [] },
    });
  });

  it('seeds normally when the schema is up to date', async () => {
    const code = await runDbSeed({ json: false });

    expect(code).toBe(0);
    expect(mocks.seedDatabase).toHaveBeenCalledOnce();
    expect(out).toContain('seeded 3 resources');
    expect(mocks.dbCtx.close).toHaveBeenCalled();
    expect(mocks.appCtx.close).toHaveBeenCalled();
  });
});

describe('db migrate error reporting', () => {
  let out: string;

  const ok = { results: [], error: undefined };

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces the internal migration error instead of a bare "migration error"', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [], error: new Error('corrupted migrations: previously executed migration 055_sync_quarantine is missing') },
      external: ok,
    });

    const code = await runDbMigrate({ json: false });

    expect(code).toBe(1);
    expect(out).toContain('corrupted migrations');
    expect(out).toContain('055_sync_quarantine');
    expect(out).toContain('internal');
  });

  it('names the failing side when the external migrations fail', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: ok,
      external: { results: [], error: new Error('relation "patients" already exists') },
    });

    await runDbMigrate({ json: false });

    expect(out).toContain('external');
    expect(out).toContain('relation "patients" already exists');
  });

  it('redacts credentials echoed by a driver error', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [], error: new Error('connect failed: postgres://openldr:hunter2@localhost:5433/openldr') },
      external: ok,
    });

    await runDbMigrate({ json: false });

    expect(out).not.toContain('hunter2');
    expect(out).toContain('***');
  });

  it('reports migration_failed with per-side detail as JSON', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [], error: new Error('boom') },
      external: ok,
    });

    await runDbMigrate({ json: true });

    const payload = JSON.parse(out);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe('migration_failed');
    expect(payload.internalError).toBe('boom');
    expect(payload.externalError).toBeUndefined();
  });

  it('reports the applied migrations on success', async () => {
    mocks.dbCtx.migrateAll.mockResolvedValue({
      internal: { results: [{ migrationName: '055_sync_quarantine' }], error: undefined },
      external: ok,
    });

    const code = await runDbMigrate({ json: false });

    expect(code).toBe(0);
    expect(out).toContain('055_sync_quarantine');
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });
});

describe('db reset audit', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.dbCtx.reset.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records db.reset as the cli actor with empty metadata, matching the reconciled shape', async () => {
    const code = await runDbReset({ json: false, force: true });

    expect(code).toBe(0);
    expect(mocks.dbCtx.reset).toHaveBeenCalledWith({ force: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.appCtx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'db.reset',
        entityType: 'database',
        entityId: 'internal+external',
        metadata: {},
      }),
    );
    expect(mocks.appCtx.close).toHaveBeenCalled();
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('is best-effort: a failure building the audit app context does not fail the reset', async () => {
    mocks.createAppContext.mockRejectedValueOnce(new Error('db down'));

    const code = await runDbReset({ json: false, force: true });

    expect(code).toBe(0);
    expect(out).toContain('database reset complete');
  });
});

describe('db reproject', () => {
  let out: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    mocks.createDbContext.mockResolvedValue(mocks.dbCtx);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses without --force, and rebuilds nothing', async () => {
    // It rebuilds EVERY projected row in the warehouse from the canonical store. AGENTS.md §6:
    // destructive commands refuse without --force.
    //
    // Not "every warehouse created_at moves" — that was false and pre-dates this branch. All three
    // upsert paths in packages/db/src/batch-upsert.ts exclude created_at from their update set, so
    // it is a first-written stamp that survives a reprojection over existing rows and only moves for
    // a row that has to be re-inserted.
    const code = await runDbReproject({ json: false, force: false });
    expect(code).toBe(1);
    expect(mocks.reprojectAll).not.toHaveBeenCalled();
  });

  it('reports the resource count and the ledger count as SEPARATE numbers', async () => {
    // Two different units. Conflating a resource count with a ledger-row count is the exact
    // confusion terminology.ts:152-166 was written to fix.
    mocks.reprojectAll.mockResolvedValueOnce({ projected: 8692, arrivals: 92395 });
    const code = await runDbReproject({ json: false, force: true });
    expect(code).toBe(0);
    expect(mocks.reprojectAll).toHaveBeenCalledTimes(1);
    expect(out).toContain('8692 canonical resources');
    expect(out).toContain('92395 arrivals');
  });

  it('reports a zero-arrival rebuild without hiding it behind the resource count', async () => {
    // The ledger is this command's headline capability; a run that recorded nothing must say so.
    mocks.reprojectAll.mockResolvedValueOnce({ projected: 8692, arrivals: 0 });
    await runDbReproject({ json: false, force: true });
    expect(out).toContain('0 arrivals');
  });

  it('emits both counts as JSON', async () => {
    mocks.reprojectAll.mockResolvedValueOnce({ projected: 3, arrivals: 7 });
    await runDbReproject({ json: true, force: true });
    expect(JSON.parse(out)).toEqual({ projected: 3, arrivals: 7 });
  });

  it('audits as the cli actor, carrying both counts', async () => {
    mocks.reprojectAll.mockResolvedValueOnce({ projected: 1, arrivals: 2 });
    await runDbReproject({ json: false, force: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ action: 'db.reproject', metadata: { projected: 1, arrivals: 2 } }),
    );
  });

  it('refuses when migrations are pending, and rebuilds nothing', async () => {
    // The failure this prevents: on a schema without migration 016, reprojectAll completes the
    // entire clinical rewrite and only then throws `relation "ingest_events" does not exist` —
    // a long expensive run, no cursor advanced, no audit event, and a raw error. Post-upgrade
    // backfill is this command's stated purpose, so a stale schema is its likely first invocation.
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: ['016_ingest_events'] });

    const code = await runDbReproject({ json: false, force: true });

    expect(code).toBe(1);
    expect(mocks.reprojectAll).not.toHaveBeenCalled();
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('names the pending migration and the remedy, and names ITSELF as the refusing command', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({
      internal: ['053_workflow_secrets'], external: ['016_ingest_events'],
    });

    await runDbReproject({ json: false, force: true });

    expect(out).toContain('016_ingest_events');
    expect(out).toContain('053_workflow_secrets');
    expect(out).toContain('db migrate');
    // The shared message is parameterized on the command name — `db seed`'s wording must not leak
    // into `db reproject`'s refusal.
    expect(out).toContain('db reproject refused');
    expect(out).not.toContain('db seed');
  });

  it('reports the pending_migrations shape as JSON', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: ['016_ingest_events'] });

    await runDbReproject({ json: true, force: true });

    expect(JSON.parse(out)).toEqual({
      ok: false,
      error: 'pending_migrations',
      pending: { internal: [], external: ['016_ingest_events'] },
    });
  });

  it('checks --force BEFORE the schema, so a stale schema never masks the missing flag', async () => {
    mocks.dbCtx.pendingMigrations.mockResolvedValue({ internal: [], external: ['016_ingest_events'] });

    const code = await runDbReproject({ json: false, force: false });

    expect(code).toBe(1);
    expect(mocks.dbCtx.pendingMigrations).not.toHaveBeenCalled();
  });
});

describe('db warehouse-status', () => {
  const base = { head: 1000, cursor: 400, behind: 600, waitingRetry: 0, oldestWaitingAt: '2026-11-19T10:00:00.000Z', readAt: '2026-11-19T10:05:00.000Z' };

  it('formats_a_duration_in_the_largest_two_units', async () => {
    const { formatDuration } = await import('./db');
    expect([formatDuration(40), formatDuration(720), formatDuration(7500)]).toEqual(['40 s', '12 min', '2 h 5 min']);
  });

  it('says_up_to_date_when_nothing_waits', async () => {
    const { warehouseStatusLines } = await import('./db');
    expect(warehouseStatusLines({ ...base, cursor: 1000, behind: 0, oldestWaitingAt: null, appliedPerSecond: null, secondsLeft: null, fallingBehind: false })).toEqual(['The warehouse is up to date.']);
  });

  it('prints_the_gap_the_rate_and_the_time_left', async () => {
    const { warehouseStatusLines } = await import('./db');
    expect(warehouseStatusLines({ ...base, appliedPerSecond: 50, secondsLeft: 720, fallingBehind: false })).toEqual([
      'behind = 600 changes (the warehouse is at 400 of 1000)',
      'oldestWaiting = 2026-11-19T10:00:00.000Z',
      'rate = 50 changes a second',
      'timeLeft = about 12 min',
      'waitingRetry = 0',
    ]);
  });

  it('says_falling_behind_when_the_gap_grows', async () => {
    const { warehouseStatusLines } = await import('./db');
    expect(warehouseStatusLines({ ...base, appliedPerSecond: 50, secondsLeft: null, fallingBehind: true })[3]).toBe('timeLeft = falling behind: records are being saved faster than the warehouse takes them');
  });
});

describe('db datasets', () => {
  const service = { rebuild: vi.fn(), remove: vi.fn(), setGroup: vi.fn() };
  let out = '';
  let err = '';
  beforeEach(() => {
    out = ''; err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { out += String(c); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { err += String(c); return true; });
    service.rebuild.mockReset(); service.remove.mockReset();
    mocks.listDatasetsWithState.mockReset(); mocks.recordAuditEvent.mockReset(); mocks.dbCtx.close.mockReset(); mocks.appCtx.close.mockReset();
    mocks.createDbContext.mockResolvedValue({ ...mocks.dbCtx, warehouseDatasets: service });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('list_prints_one_line_for_each_dataset', async () => {
    mocks.listDatasetsWithState.mockResolvedValue([
      { name: 'zm_request_times', ownerPack: 'reports-zm', group: 'reports-zm', rowCount: 4239703, builtAt: '2026-11-19T11:00:00.000Z', buildMs: 28400, lastError: null, stale: false },
      { name: 'zm_broken', ownerPack: 'reports-zm', group: null, rowCount: null, builtAt: null, buildMs: null, lastError: 'relation "nope" does not exist', stale: true },
    ]);
    const { runDbDatasetsList } = await import('./db');
    expect(await runDbDatasetsList({ json: false })).toBe(0);
    expect(out.trimEnd().split('\n')).toEqual([
      'zm_request_times  reports-zm  group reports-zm  4239703 rows  built 2026-11-19T11:00:00.000Z in 28 s',
      'zm_broken  reports-zm  no group  not built  stale  error: relation "nope" does not exist',
    ]);
    expect(mocks.dbCtx.close).toHaveBeenCalled();
  });

  it('list_says_so_when_there_are_none', async () => {
    mocks.listDatasetsWithState.mockResolvedValue([]);
    const { runDbDatasetsList } = await import('./db');
    expect(await runDbDatasetsList({ json: false })).toBe(0);
    expect(out).toBe('No datasets. A content pack installs them.\n');
  });

  it('rebuild_prints_each_result_audits_and_fails_when_a_build_failed', async () => {
    service.rebuild.mockResolvedValue([{ name: 'one', ok: true, rows: 7, ms: 1200 }, { name: 'two', ok: false, error: 'relation "nope" does not exist' }]);
    const { runDbDatasetsRebuild } = await import('./db');
    expect(await runDbDatasetsRebuild(undefined, { json: false })).toBe(1);
    expect(service.rebuild).toHaveBeenCalledWith(undefined);
    expect(out.trimEnd().split('\n')).toEqual(['one  rebuilt  7 rows in 1 s', 'two  failed  relation "nope" does not exist']);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(mocks.appCtx, expect.objectContaining({ actorType: 'cli' }), expect.objectContaining({ action: 'dataset.rebuild', entityType: 'dataset', entityId: 'all' }));
  });

  it('rebuild_of_an_unknown_name_fails_with_one_line', async () => {
    service.rebuild.mockRejectedValue(new Error('no dataset named nope'));
    const { runDbDatasetsRebuild } = await import('./db');
    expect(await runDbDatasetsRebuild('nope', { json: false })).toBe(1);
    expect(err).toBe('no dataset named nope\n');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('delete_refuses_without_force', async () => {
    const { runDbDatasetsDelete } = await import('./db');
    expect(await runDbDatasetsDelete('abc', { json: false, force: false })).toBe(1);
    expect(err).toContain('db datasets delete refused');
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('delete_with_force_removes_and_audits', async () => {
    service.remove.mockResolvedValue(undefined);
    const { runDbDatasetsDelete } = await import('./db');
    expect(await runDbDatasetsDelete('abc', { json: false, force: true })).toBe(0);
    expect(service.remove).toHaveBeenCalledWith('abc');
    expect(out).toBe('Deleted the dataset abc.\n');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(mocks.appCtx, expect.objectContaining({ actorType: 'cli' }), expect.objectContaining({ action: 'dataset.delete', entityId: 'abc' }));
  });

  it('move_puts_a_dataset_in_a_group_or_in_none', async () => {
    service.setGroup.mockReset(); service.setGroup.mockResolvedValue(undefined);
    const { runDbDatasetsMove } = await import('./db');
    expect(await runDbDatasetsMove('abc', { json: false, group: ' Turnaround ' })).toBe(0);
    expect(await runDbDatasetsMove('abc', { json: false })).toBe(0);
    expect(service.setGroup.mock.calls).toEqual([['abc', 'Turnaround'], ['abc', null]]);
    expect(out).toBe('Moved abc to the group Turnaround.\nMoved abc out of its group.\n');
  });

  it('move_of_an_unknown_dataset_fails_with_one_line', async () => {
    service.setGroup.mockReset(); service.setGroup.mockRejectedValue(new Error('no dataset named nope'));
    const { runDbDatasetsMove } = await import('./db');
    expect(await runDbDatasetsMove('nope', { json: false, group: 'x' })).toBe(1);
    expect(err).toBe('no dataset named nope\n');
  });
});

