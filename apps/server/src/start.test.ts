import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@openldr/config';
import type { Logger } from '@openldr/core';

// startServer needs a database, so these tests swap every resource it opens for a fake. The real
// boot against Postgres is proved by hand (see the Task 4 report), not here.
const fakes = vi.hoisted(() => {
  const calls: string[] = [];
  const state = { listenError: undefined as Error | undefined, ingestError: undefined as Error | undefined };
  const ctx = {
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    audit: {},
    updateCheck: {},
    reportScheduler: { reconcile: async () => {} },
    pluginScheduleRunner: { reconcile: async () => {} },
    workflows: {
      store: { list: async () => [] },
      runner: { setIngestWorkflowIds: () => {}, setEventWorkflowIds: () => {}, reconcile: async () => {} },
      listeners: { reconcile: async () => {} },
    },
    close: async () => { calls.push('context closed'); },
  };
  const app = {
    listen: async () => {
      calls.push('listen');
      if (state.listenError) throw state.listenError;
      return 'http://127.0.0.1:3991';
    },
    close: async () => { calls.push('app closed'); },
  };
  const ingest = {
    eventing: {},
    startWorker: () => ({ stop: async () => { calls.push('worker stopped'); } }),
    close: async () => { calls.push('ingest closed'); },
  };
  return { calls, state, ctx, app, ingest };
});

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => { fakes.calls.push('context opened'); return fakes.ctx; }),
  createIngestContext: vi.fn(async () => {
    if (fakes.state.ingestError) throw fakes.state.ingestError;
    fakes.calls.push('ingest opened');
    return fakes.ingest;
  }),
  createDbContext: vi.fn(async () => { throw new Error('createDbContext is not expected in these tests'); }),
  seedDatabase: vi.fn(),
  seedEssentials: vi.fn(async () => ({ formsSeeded: 0, workflowsSeeded: 0, connectorsSeeded: 0, valueSetsImported: 0 })),
  drainCrashMarkersToAudit: vi.fn(async () => {}),
  startUpdateCheck: vi.fn(() => () => { fakes.calls.push('update check stopped'); }),
}));
vi.mock('./app', () => ({ buildApp: vi.fn(async () => { fakes.calls.push('app built'); return fakes.app; }) }));
vi.mock('./register-event-handlers', () => ({ registerEventHandlers: vi.fn(async () => {}) }));

const cfg = {
  MIGRATE_ON_START: false,
  SEED_ON_START: false,
  PLUGIN_CRASH_LOG_DIR: '/nonexistent/crash-dir',
  PORT: 3991,
  LISTEN_HOST: '127.0.0.1',
} as unknown as Config;
const logger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

beforeEach(() => {
  fakes.calls.length = 0;
  fakes.state.listenError = undefined;
  fakes.state.ingestError = undefined;
});

describe('importing start', () => {
  it('exports startServer and does not run it on import', async () => {
    const bootstrap = await import('@openldr/bootstrap');
    const { buildApp } = await import('./app');
    const mod = await import('./start');
    expect(typeof mod.startServer).toBe('function');
    expect(bootstrap.createAppContext).not.toHaveBeenCalled();
    expect(bootstrap.createDbContext).not.toHaveBeenCalled();
    expect(buildApp).not.toHaveBeenCalled();
    expect(fakes.calls).toEqual([]);
  });

  it('installs no signal or crash handlers on import', async () => {
    // The test above already imported ./start, and vitest caches modules within a file. Reset the
    // cache so this import runs the module's top-level code again.
    vi.resetModules();
    const events = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;
    const before = events.map((e) => process.listenerCount(e));
    await import('./start');
    expect(events.map((e) => process.listenerCount(e))).toEqual(before);
  });
});

describe('startServer', () => {
  it('listens on LISTEN_HOST and PORT and returns the address', async () => {
    const listen = vi.spyOn(fakes.app, 'listen');
    const { startServer } = await import('./start');
    const server = await startServer(cfg, logger);
    expect(listen).toHaveBeenCalledWith({ port: 3991, host: '127.0.0.1' });
    expect(server.address).toBe('http://127.0.0.1:3991');
    expect(server.context).toBe(fakes.ctx);
    await server.close();
    listen.mockRestore();
  });

  it('asks for the three queue workers only the server runs', async () => {
    const bootstrap = await import('@openldr/bootstrap');
    const { startServer } = await import('./start');
    const server = await startServer(cfg, logger);
    expect(bootstrap.createAppContext).toHaveBeenLastCalledWith(cfg, {
      runFacilityImportWorker: true, runFacilityJobWorker: true, runTerminologyIngestWorker: true,
    });
    await server.close();
  });

  it('installs no signal or crash handlers when it runs', async () => {
    const events = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;
    const before = events.map((e) => process.listenerCount(e));
    const { startServer } = await import('./start');
    const server = await startServer(cfg, logger);
    expect(events.map((e) => process.listenerCount(e))).toEqual(before);
    await server.close();
  });

  it('close is safe to call twice: same promise, each shutdown step runs once', async () => {
    const { startServer } = await import('./start');
    const server = await startServer(cfg, logger);
    fakes.calls.length = 0;
    const first = server.close();
    const second = server.close();
    expect(second).toBe(first);
    await first;
    await server.close();
    expect(fakes.calls.filter((c) => c === 'update check stopped')).toHaveLength(1);
    expect(fakes.calls.filter((c) => c === 'app closed')).toHaveLength(1);
    expect(fakes.calls.filter((c) => c === 'worker stopped')).toHaveLength(1);
    expect(fakes.calls.filter((c) => c === 'ingest closed')).toHaveLength(1);
    expect(fakes.calls.filter((c) => c === 'context closed')).toHaveLength(1);
  });

  it('rejects when the port is taken, after closing everything it opened', async () => {
    const taken = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:3991'), { code: 'EADDRINUSE' });
    fakes.state.listenError = taken;
    const { startServer } = await import('./start');
    await expect(startServer(cfg, logger)).rejects.toBe(taken);
    const afterListen = fakes.calls.slice(fakes.calls.indexOf('listen') + 1);
    expect([...afterListen].sort()).toEqual(
      ['app closed', 'context closed', 'ingest closed', 'update check stopped', 'worker stopped'].sort(),
    );
    // Dependencies close after the things that use them.
    expect(afterListen.indexOf('ingest closed')).toBeGreaterThan(afterListen.indexOf('worker stopped'));
    expect(afterListen.indexOf('context closed')).toBeGreaterThan(afterListen.indexOf('ingest closed'));
  });

  it('closes the app context when a later startup step throws', async () => {
    const boom = new Error('ingest down');
    fakes.state.ingestError = boom;
    const { startServer } = await import('./start');
    await expect(startServer(cfg, logger)).rejects.toBe(boom);
    expect(fakes.calls).toEqual(['context opened', 'context closed']);
  });
});
