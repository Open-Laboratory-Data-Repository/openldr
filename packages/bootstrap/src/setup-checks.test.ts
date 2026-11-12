import { describe, it, expect } from 'vitest';
import { runSetupChecks, setupCheckDeps, SETUP_CHECK_TITLE, SETUP_HINT_TEXT, type SetupCheckDeps, type SetupCheckId } from './setup-checks';

// Layer proven here: the rules that turn install state into a check list, with every source faked.
// Not proven: that the real stores return what the fakes do. The route and CLI tests, and the
// browser check on a live CE, cover the wiring.

const upHealth = { status: 'up' as const, checks: { auth: { status: 'up' as const, latencyMs: 1 }, blob: { status: 'up' as const, latencyMs: 1 } } };
const syncOff = { enabled: false, mode: 'bidirectional', centralUrl: '', siteId: '', push: null, pull: null, pendingPush: 0 };
const direction = (over: Record<string, unknown> = {}) => ({
  running: true, lastSeq: 5, lastSyncedAt: null, lastAttemptAt: null, lastSuccessAt: '2026-11-11T10:00:00.000Z', lastErrorAt: null, ...over,
});

function deps(over: Partial<SetupCheckDeps> = {}): SetupCheckDeps {
  return {
    cfg: { AUTH_DEV_BYPASS: false, NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: 'k'.repeat(44) },
    targetEngine: 'postgres',
    health: async () => upHealth,
    labIdentity: async () => ({ 'lab.name': 'Maputo Central Lab', 'lab.timezone': 'Africa/Maputo' }),
    connectors: async () => [],
    connectorConfig: async () => ({ host: 'db' }),
    testConnector: async () => {},
    syncStatus: async () => syncOff as never,
    observedFacilities: async () => ({ total: 0, unmatched: 0 }),
    ...over,
  };
}

async function check(id: SetupCheckId, over: Partial<SetupCheckDeps> = {}) {
  const report = await runSetupChecks(deps(over));
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return { report, check: found };
}

describe('setup checks', () => {
  it('reports every check, in a fixed order, and is ok on a ready install', async () => {
    const report = await runSetupChecks(deps());
    expect(report.checks.map((c) => c.id)).toEqual(['adapters', 'signIn', 'secretsKey', 'labName', 'timeZone', 'connectors', 'sync', 'facilities']);
    expect(report.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'skip', 'skip', 'skip']);
    expect(report.ok).toBe(true);
  });

  it('has a title for every check and text for every hint it can give', async () => {
    const report = await runSetupChecks(deps());
    for (const c of report.checks) expect(SETUP_CHECK_TITLE[c.id]).toBeTruthy();
    for (const text of Object.values(SETUP_HINT_TEXT)) expect(text).not.toContain('\u2014');
  });

  it('fails when an adapter is down and names it, and warns when one is degraded', async () => {
    const down = await check('adapters', { health: async () => ({ status: 'down', checks: { auth: { status: 'up', latencyMs: 1 }, blob: { status: 'down', latencyMs: 9, detail: 'connect ECONNREFUSED 10.0.0.9:9000' } } }) });
    expect(down.check).toMatchObject({ status: 'fail', hint: 'adapterDown', detail: 'blob' });
    // The adapter's own error text can name hosts, so it is not copied into the check.
    expect(JSON.stringify(down.check)).not.toContain('10.0.0.9');
    expect(down.report.ok).toBe(false);
    const degraded = await check('adapters', { health: async () => ({ status: 'degraded', checks: { eventing: { status: 'degraded', latencyMs: 1 } } }) });
    expect(degraded.check).toMatchObject({ status: 'warn', hint: 'adapterDegraded', detail: 'eventing' });
    expect(degraded.report.ok).toBe(true);
  });

  it('fails in production when sign-in is off, and only warns elsewhere', async () => {
    const prod = await check('signIn', { cfg: { AUTH_DEV_BYPASS: true, NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: 'k' } });
    expect(prod.check).toMatchObject({ status: 'fail', hint: 'signInOff' });
    const dev = await check('signIn', { cfg: { AUTH_DEV_BYPASS: true, NODE_ENV: 'development', SECRETS_ENCRYPTION_KEY: 'k' } });
    expect(dev.check).toMatchObject({ status: 'warn', hint: 'signInOff' });
  });

  it('warns while local sign-in still needs setup, with no link', async () => {
    const { check: c, report } = await check('signIn', { setupRequired: async () => true });
    expect(c).toEqual({ id: 'signIn', status: 'warn', hint: 'signInSetup' });
    expect(report.ok).toBe(true);
    expect(SETUP_HINT_TEXT.signInSetup).toBe('No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.');
  });

  it('passes once an administrator exists', async () => {
    expect((await check('signIn', { setupRequired: async () => false })).check).toEqual({ id: 'signIn', status: 'pass' });
  });

  it('reports the bypass before the setup state', async () => {
    const { check: c } = await check('signIn', {
      cfg: { AUTH_DEV_BYPASS: true, NODE_ENV: 'development', SECRETS_ENCRYPTION_KEY: 'k' },
      setupRequired: async () => true,
    });
    expect(c).toMatchObject({ status: 'warn', hint: 'signInOff' });
  });

  it('passes when setupRequired is not provided (keycloak and oidc installs)', async () => {
    expect((await check('signIn')).check).toEqual({ id: 'signIn', status: 'pass' });
  });

  it('reports the sign-in check as failed when the setup state cannot be read, and runs the others', async () => {
    const report = await runSetupChecks(deps({ setupRequired: async () => { throw new Error('db gone at 10.1.2.3'); } }));
    expect(report.checks.find((c) => c.id === 'signIn')).toEqual({ id: 'signIn', status: 'fail', hint: 'checkError' });
    expect(report.checks.map((c) => c.id)).toHaveLength(8);
    expect(JSON.stringify(report)).not.toContain('10.1.2.3');
  });

  it('takes the setup state from ctx.localSignIn, and leaves it out when there is none', async () => {
    const base = { cfg: deps().cfg, targetEngine: 'postgres' } as unknown as Parameters<typeof setupCheckDeps>[0];
    expect(setupCheckDeps(base).setupRequired).toBeUndefined();
    const local = setupCheckDeps({ ...base, localSignIn: { setupRequired: async () => true } });
    expect(await local.setupRequired?.()).toBe(true);
  });

  it('warns when the secrets key is not set', async () => {
    const { check: c } = await check('secretsKey', { cfg: { AUTH_DEV_BYPASS: false, NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: undefined } });
    expect(c).toMatchObject({ status: 'warn', hint: 'secretsKeyMissing' });
  });

  it('warns while the lab name is empty or still the shipped default, with a link to fix it', async () => {
    const identities: Array<Record<string, string>> = [{}, { 'lab.name': 'OpenLDR' }, { 'lab.name': '  ' }];
    for (const identity of identities) {
      const { check: c } = await check('labName', { labIdentity: async () => identity });
      expect(c).toMatchObject({ status: 'warn', hint: 'labNameDefault', fix: '/settings/laboratory' });
    }
    const set = await check('labName');
    expect(set.check).toEqual({ id: 'labName', status: 'pass', detail: 'Maputo Central Lab' });
  });

  it('warns when the time zone is empty, and skips it on a SQL Server warehouse', async () => {
    const empty = await check('timeZone', { labIdentity: async () => ({ 'lab.name': 'Lab' }) });
    expect(empty.check).toMatchObject({ status: 'warn', hint: 'timeZoneEmpty', fix: '/settings/laboratory' });
    const mssql = await check('timeZone', { targetEngine: 'mssql', labIdentity: async () => ({ 'lab.name': 'Lab' }) });
    expect(mssql.check).toMatchObject({ status: 'skip', hint: 'timeZoneSqlServer' });
    expect((await check('timeZone')).check).toEqual({ id: 'timeZone', status: 'pass', detail: 'Africa/Maputo' });
  });

  it('tests each enabled database connector and names the ones that do not answer', async () => {
    const tested: string[] = [];
    const { check: c, report } = await check('connectors', {
      connectors: async () => [
        { id: 'a', name: 'V1 SQL Server', type: 'microsoft-sql', enabled: true },
        { id: 'b', name: 'Warehouse', type: 'postgres', enabled: true },
        { id: 'c', name: 'Old', type: 'postgres', enabled: false },
        { id: 'd', name: 'DHIS2', type: null, enabled: true },
      ],
      testConnector: async (type, config) => {
        tested.push(`${type}:${config.host}`);
        if (type === 'microsoft-sql') throw new Error('Login failed for user sa on LABSRV');
      },
      connectorConfig: async (id) => ({ host: id }),
    });
    expect(tested.sort()).toEqual(['microsoft-sql:a', 'postgres:b']);
    expect(c).toEqual({ id: 'connectors', status: 'fail', hint: 'connectorFailed', fix: '/settings/connectors', detail: 'V1 SQL Server' });
    // Driver text can hold users and hosts. It stays out.
    expect(JSON.stringify(report)).not.toContain('LABSRV');
    const allGood = await check('connectors', { connectors: async () => [{ id: 'b', name: 'Warehouse', type: 'postgres', enabled: true }] });
    expect(allGood.check).toEqual({ id: 'connectors', status: 'pass', detail: '1 of 1' });
  });

  it('counts a connector whose settings cannot be read as failed', async () => {
    const { check: c } = await check('connectors', {
      connectors: async () => [{ id: 'a', name: 'V1', type: 'microsoft-sql', enabled: true }],
      connectorConfig: async () => { throw new Error('SECRETS_ENCRYPTION_KEY is required'); },
    });
    expect(c).toMatchObject({ status: 'fail', detail: 'V1' });
  });

  it('skips sync when it is off, fails when it is on without a central URL or site id', async () => {
    expect((await check('sync')).check).toEqual({ id: 'sync', status: 'skip' });
    const noUrl = await check('sync', { syncStatus: async () => ({ ...syncOff, enabled: true, siteId: 'site-1' }) as never });
    expect(noUrl.check).toMatchObject({ status: 'fail', hint: 'syncIncomplete', fix: '/settings/sync' });
    const noSite = await check('sync', { syncStatus: async () => ({ ...syncOff, enabled: true, centralUrl: 'https://central.example' }) as never });
    expect(noSite.check).toMatchObject({ status: 'fail', hint: 'syncIncomplete' });
  });

  it('warns when the last sync cycle failed after the last success, and passes otherwise', async () => {
    const on = { ...syncOff, enabled: true, centralUrl: 'https://central.example', siteId: 'site-1' };
    const failing = await check('sync', { syncStatus: async () => ({ ...on, push: direction({ lastErrorAt: '2026-11-11T11:00:00.000Z' }), pull: direction() }) as never });
    expect(failing.check).toMatchObject({ status: 'warn', hint: 'syncFailing', fix: '/settings/sync' });
    const neverWorked = await check('sync', { syncStatus: async () => ({ ...on, push: null, pull: direction({ lastSuccessAt: null, lastErrorAt: '2026-11-11T11:00:00.000Z' }) }) as never });
    expect(neverWorked.check).toMatchObject({ status: 'warn', hint: 'syncFailing' });
    const recovered = await check('sync', { syncStatus: async () => ({ ...on, push: direction({ lastErrorAt: '2026-11-11T09:00:00.000Z' }), pull: direction() }) as never });
    expect(recovered.check).toEqual({ id: 'sync', status: 'pass' });
  });

  it('warns when facilities seen in the data have no match in the register, with the count and a link', async () => {
    expect((await check('facilities')).check).toEqual({ id: 'facilities', status: 'skip' });
    expect((await check('facilities', { observedFacilities: async () => ({ total: 12, unmatched: 0 }) })).check)
      .toEqual({ id: 'facilities', status: 'pass', detail: '12 of 12' });
    expect((await check('facilities', { observedFacilities: async () => ({ total: 12, unmatched: 3 }) })).check)
      .toEqual({ id: 'facilities', status: 'warn', hint: 'facilitiesUnmatched', fix: '/facilities', detail: '3 of 12' });
  });

  it('reports a check that throws as failed and still runs the others', async () => {
    const report = await runSetupChecks(deps({
      health: async () => { throw new Error('boom at 10.1.2.3'); },
      labIdentity: async () => { throw new Error('db gone'); },
    }));
    expect(report.checks.map((c) => `${c.id}:${c.status}`)).toEqual([
      'adapters:fail', 'signIn:pass', 'secretsKey:pass', 'labName:fail', 'timeZone:fail', 'connectors:skip', 'sync:skip', 'facilities:skip',
    ]);
    expect(report.checks[0]).toEqual({ id: 'adapters', status: 'fail', hint: 'checkError' });
    expect(JSON.stringify(report)).not.toContain('10.1.2.3');
    expect(report.ok).toBe(false);
  });
});
