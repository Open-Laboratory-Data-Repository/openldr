import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Layer: the CLI's whole-plugin removal over a mocked context. The removal's stop and delete are
// proven in packages/bootstrap/src/plugin-removal.test.ts.

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));

const removal = vi.hoisted(() => ({ plan: vi.fn(), remove: vi.fn(), removeVersion: vi.fn() }));
const close = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return { ...actual, createAppContext: vi.fn(async () => ({ pluginRemoval: removal, close })) };
});

import { ActiveVersionRemoval, PluginStillStopping } from '@openldr/bootstrap';
import { runPluginVersionRemove, runWholePluginRemove } from './plugin-removal';

let out: string[];
let err: string[];

beforeEach(() => {
  vi.clearAllMocks();
  out = []; err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  removal.plan.mockResolvedValue({ running: [{ kind: 'copy', id: 'cp1', label: 'c1', status: 'running' }], copies: 1, copiedBytes: 1 });
  removal.remove.mockResolvedValue({ stopped: ['cp1'], deletedCopies: 0 });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('plugin remove, the whole plugin', () => {
  it('refuses without --force when something is running, and names it', async () => {
    const code = await runWholePluginRemove('cdr-source', { force: false, json: false });
    expect(code).toBe(1);
    expect(err.join('')).toContain('cp1');
    expect(removal.remove).not.toHaveBeenCalled();
  });

  it('refuses without --force when it would delete, even with nothing running', async () => {
    removal.plan.mockResolvedValue({ running: [], copies: 1, copiedBytes: 1 });
    const code = await runWholePluginRemove('cdr-source', { keep: 'settings', force: false, json: false });
    expect(code).toBe(1);
    expect(removal.remove).not.toHaveBeenCalled();
  });

  it('removes at once when nothing runs and everything is kept', async () => {
    removal.plan.mockResolvedValue({ running: [], copies: 1, copiedBytes: 1 });
    removal.remove.mockResolvedValue({ stopped: [], deletedCopies: 0 });
    expect(await runWholePluginRemove('cdr-source', { force: false, json: false })).toBe(0);
    expect(removal.remove).toHaveBeenCalledWith('cdr-source', expect.objectContaining({ keep: 'all' }));
  });

  it('with --force, stops and removes as the cli', async () => {
    const code = await runWholePluginRemove('cdr-source', { keep: 'all', force: true, json: true });
    expect(code).toBe(0);
    expect(removal.remove).toHaveBeenCalledWith('cdr-source', { keep: 'all', actor: expect.objectContaining({ type: 'cli' }) });
    expect(JSON.parse(out.join(''))).toEqual({ removed: 'cdr-source', keep: 'all', stopped: ['cp1'], deletedCopies: 0 });
  });

  it('refuses a --keep it does not know', async () => {
    expect(await runWholePluginRemove('cdr-source', { keep: 'some', force: true, json: false })).toBe(1);
    expect(removal.remove).not.toHaveBeenCalled();
  });

  it('a read that will not stop: exit 1, naming it, nothing removed', async () => {
    removal.remove.mockRejectedValue(new PluginStillStopping(['cp1']));
    expect(await runWholePluginRemove('cdr-source', { force: true, json: false })).toBe(1);
    expect(err.join('')).toContain('cp1');
  });
});

describe('plugin remove --version', () => {
  it('removes one older version and stops nothing', async () => {
    removal.removeVersion.mockResolvedValue(undefined);
    expect(await runPluginVersionRemove('cdr-source', '0.1.4', { json: false })).toBe(0);
    expect(removal.removeVersion).toHaveBeenCalledWith('cdr-source', '0.1.4', expect.objectContaining({ type: 'cli' }));
    expect(removal.remove).not.toHaveBeenCalled();
  });

  it('refuses the active version and says what to do instead', async () => {
    removal.removeVersion.mockRejectedValue(new ActiveVersionRemoval('cdr-source', '0.1.5'));
    expect(await runPluginVersionRemove('cdr-source', '0.1.5', { json: false })).toBe(1);
    expect(err.join('')).toMatch(/0\.1\.5 is the active version/);
  });
});
