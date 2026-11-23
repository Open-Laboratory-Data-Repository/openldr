import { describe, it, expect, vi } from 'vitest';
import { createPluginRemoval, PluginStillStopping, ActiveVersionRemoval } from './plugin-removal';

// Layer: the order of a removal, over fake read and check services. The services' own stop and
// delete are proven in import-copy.test.ts and import-check.test.ts; this proves only that removal
// stops checks before reads, waits until both have stopped, and deletes only what was chosen.

type Status = string;
interface Run { id: string; status: Status; copyId?: string; connectorId?: string; sets?: Record<string, { bytes: number }> }

const actor = { type: 'user' as const, id: 'u1', name: 'admin' };

/** A service whose stop moves a run to `stopping`, and whose get settles it to `stopped` after
 *  `settleAfter` reads (never, when null). The log records the order of calls across services. */
function fakeService(kind: 'copy' | 'check' | 'import', runs: Run[], log: string[], settleAfter: number | null = 1) {
  const reads = new Map<string, number>();
  return {
    async list() { return runs.map((r) => ({ ...r })); },
    async get(_p: string, id: string) {
      const r = runs.find((x) => x.id === id);
      if (!r) return null;
      if (r.status === 'stopping' && settleAfter !== null) {
        const n = (reads.get(id) ?? 0) + 1; reads.set(id, n);
        if (n >= settleAfter) r.status = 'stopped';
      }
      return { ...r };
    },
    async stop(_p: string, id: string) {
      log.push(`stop ${kind} ${id}`);
      const r = runs.find((x) => x.id === id)!;
      r.status = 'stopping';
      return { ...r };
    },
    async remove(_p: string, id: string) {
      log.push(`delete ${kind} ${id}`);
      const r = runs.find((x) => x.id === id)!;
      r.status = 'deleting';
      return { ...r };
    },
  };
}

function setup(o: { copies?: Run[]; checks?: Run[]; imports?: Run[]; settleAfter?: number | null } = {}) {
  const log: string[] = [];
  const copies = o.copies ?? [{ id: 'cp1', status: 'running', connectorId: 'c1', sets: { requests: { bytes: 2_000 }, results: { bytes: 500 } } }];
  const checks = o.checks ?? [{ id: 'ck1', status: 'running', copyId: 'cp1' }];
  const importCopies = fakeService('copy', copies, log, o.settleAfter === undefined ? 1 : o.settleAfter);
  const importChecks = fakeService('check', checks, log, o.settleAfter === undefined ? 1 : o.settleAfter);
  const imports = fakeService('import', o.imports ?? [], log, o.settleAfter === undefined ? 1 : o.settleAfter);
  const plugins = {
    remove: vi.fn(async (_id: string, version?: string) => { log.push(version ? `remove version ${version}` : 'remove plugin'); }),
    list: vi.fn(async () => [{ id: 'cdr-source', version: '0.1.4', active: false }, { id: 'cdr-source', version: '0.1.5', active: true }]),
  };
  const pluginData = { purgeExcept: vi.fn(async (_p: string, keep: string[]) => { log.push(`purge except ${keep.join(',')}`); }) };
  const pluginSchemas = { drop: vi.fn(async (p: string): Promise<{ dropped: boolean; reason?: string }> => { log.push(`drop tables ${p}`); return { dropped: true }; }) };
  const logger = { warn: vi.fn() };
  const audit = vi.fn(async () => {});
  const removal = createPluginRemoval({
    plugins: plugins as never, importCopies: importCopies as never, importChecks: importChecks as never, imports: imports as never,
    pluginData: pluginData as never, pluginSchemas, logger, audit, sleep: async () => {},
  });
  return { removal, log, copies, checks, plugins, pluginData, pluginSchemas, logger, audit };
}

describe('plugin removal', () => {
  it('plan lists what runs and the size of what was copied', async () => {
    const { removal } = setup();
    const plan = await removal.plan('cdr-source');
    expect(plan.running).toEqual([
      { kind: 'check', id: 'ck1', label: 'cp1', status: 'running' },
      { kind: 'copy', id: 'cp1', label: 'c1', status: 'running' },
    ]);
    expect(plan.copies).toBe(1);
    expect(plan.copiedBytes).toBe(2_500);
  });

  it('plan does not count a copy that is already being deleted (found in the live check)', async () => {
    const { removal } = setup({
      copies: [
        { id: 'cp1', status: 'deleting', connectorId: 'c1', sets: { requests: { bytes: 1_800 } } },
        { id: 'cp2', status: 'completed', connectorId: 'c2', sets: { requests: { bytes: 300 } } },
      ],
      checks: [],
    });
    const plan = await removal.plan('cdr-source');
    expect(plan.copies).toBe(1);
    expect(plan.copiedBytes).toBe(300);
  });

  it('keep all: stops the check, then the read, waits, then removes only the plugin', async () => {
    const { removal, log, copies } = setup();
    const r = await removal.remove('cdr-source', { keep: 'all', actor });
    expect(log).toEqual(['stop check ck1', 'stop copy cp1', 'remove plugin']);
    expect(r).toEqual({ stopped: ['ck1', 'cp1'], deletedCopies: 0 });
    expect(copies[0]!.status).toBe('stopped');
  });

  it('keep settings: also deletes every copy, and keeps the plugin\'s other data', async () => {
    const { removal, log, pluginData } = setup();
    const r = await removal.remove('cdr-source', { keep: 'settings', actor });
    expect(log).toEqual(['stop check ck1', 'stop copy cp1', 'delete copy cp1', 'remove plugin']);
    expect(r.deletedCopies).toBe(1);
    expect(pluginData.purgeExcept).not.toHaveBeenCalled();
  });

  it('keep nothing: deletes every copy and the plugin\'s other data, leaving copy records to their drives', async () => {
    const { removal, log } = setup();
    await removal.remove('cdr-source', { keep: 'nothing', actor });
    expect(log).toEqual(['stop check ck1', 'stop copy cp1', 'delete copy cp1', 'purge except __import-copies', 'drop tables cdr-source', 'remove plugin']);
  });

  it('keep all and keep settings leave the plugin\'s own tables', async () => {
    for (const keep of ['all', 'settings'] as const) {
      const { removal, pluginSchemas } = setup();
      await removal.remove('cdr-source', { keep, actor });
      expect(pluginSchemas.drop).not.toHaveBeenCalled();
    }
  });

  it('a schema that is another plugin\'s is kept, logged, and the plugin is still removed', async () => {
    const { removal, plugins, pluginSchemas, logger } = setup();
    pluginSchemas.drop.mockResolvedValueOnce({ dropped: false, reason: "schema plugin_cdr_source belongs to plugin 'cdr.source'" });
    await removal.remove('cdr-source', { keep: 'nothing', actor });
    expect(plugins.remove).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { pluginId: 'cdr-source', reason: "schema plugin_cdr_source belongs to plugin 'cdr.source'" }, expect.stringMatching(/kept a schema/),
    );
  });

  it('a failed drop of the tables leaves the plugin installed, so the removal can be tried again', async () => {
    const { removal, plugins, pluginSchemas } = setup();
    pluginSchemas.drop.mockRejectedValueOnce(new Error('drop failed'));
    await expect(removal.remove('cdr-source', { keep: 'nothing', actor })).rejects.toThrow('drop failed');
    expect(plugins.remove).not.toHaveBeenCalled();
  });

  it('a read that will not stop: says which, and removes and deletes nothing', async () => {
    const { removal, log, plugins } = setup({ settleAfter: null });
    const err = await removal.remove('cdr-source', { keep: 'nothing', actor, waitMs: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginStillStopping);
    expect((err as PluginStillStopping).ids).toEqual(['ck1', 'cp1']);
    expect(log).toEqual(['stop check ck1', 'stop copy cp1']);
    expect(plugins.remove).not.toHaveBeenCalled();
  });

  it('a one-pass import that runs is stopped too, before the reads', async () => {
    const { removal, log } = setup({ imports: [{ id: 'im1', status: 'running', connectorId: 'c2' }] });
    const plan = await removal.plan('cdr-source');
    expect(plan.running.map((r) => [r.kind, r.id])).toEqual([['check', 'ck1'], ['import', 'im1'], ['copy', 'cp1']]);
    await removal.remove('cdr-source', { keep: 'all', actor });
    expect(log).toEqual(['stop check ck1', 'stop import im1', 'stop copy cp1', 'remove plugin']);
  });

  it('removing one older version removes that row only and stops nothing', async () => {
    const { removal, log, pluginSchemas } = setup();
    await removal.removeVersion('cdr-source', '0.1.4', actor);
    expect(log).toEqual(['remove version 0.1.4']);
    expect(pluginSchemas.drop).not.toHaveBeenCalled();
  });

  it('removing the active version by version is refused: it would remove the plugin with its work running', async () => {
    const { removal, log } = setup();
    const err = await removal.removeVersion('cdr-source', '0.1.5', actor).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActiveVersionRemoval);
    expect((err as Error).message).toMatch(/0\.1\.5 is the active version/);
    expect(log).toEqual([]);
  });

  it('waits longer than the two minutes after which another process takes over an orphaned stop', async () => {
    const sleeps: number[] = [];
    const log: string[] = [];
    const stuck = [{ id: 'cp1', status: 'running', connectorId: 'c1', sets: {} }];
    const svc = fakeService('copy', stuck, log, null);
    const removal = createPluginRemoval({
      plugins: { remove: vi.fn(), list: vi.fn(async () => []) } as never, importCopies: svc as never,
      importChecks: fakeService('check', [], log) as never, imports: fakeService('import', [], log) as never,
      pluginData: { purgeExcept: vi.fn() } as never, pluginSchemas: { drop: vi.fn(async () => ({ dropped: true })) }, audit: vi.fn(async () => {}), sleep: async (ms) => { sleeps.push(ms); },
    });
    await removal.remove('cdr-source', { keep: 'all', actor }).catch(() => {});
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThan(120_000);
  });

  it('nothing running: stops nothing and removes the plugin', async () => {
    const { removal, log } = setup({ copies: [{ id: 'cp1', status: 'completed', connectorId: 'c1', sets: {} }], checks: [{ id: 'ck1', status: 'completed', copyId: 'cp1' }] });
    const r = await removal.remove('cdr-source', { keep: 'all', actor });
    expect(log).toEqual(['remove plugin']);
    expect(r.stopped).toEqual([]);
  });

  it('writes one audit row naming the choice and what was stopped', async () => {
    const { removal, audit } = setup();
    await removal.remove('cdr-source', { keep: 'settings', actor });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'import.plugin.remove', pluginId: 'cdr-source', actor,
      metadata: { keep: 'settings', stopped: ['ck1', 'cp1'], deletedCopies: 1 },
    }));
  });
});
