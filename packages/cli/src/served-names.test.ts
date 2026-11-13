import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Layer under test: the names the command functions hand to their stores and to the audit log, over
// faked contexts. A served hand-off is set in-process. Not covered: the stores themselves, and a
// real child process (Task 15).

const PLUGIN_BUNDLE = {
  manifest: { id: 'demo', version: '1.0.0', type: 'plugin', capabilities: [] },
  raw: {}, wasm: new Uint8Array(), publicKeyDer: new Uint8Array(),
};

const mocks = vi.hoisted(() => ({
  plugins: { install: vi.fn(), remove: vi.fn() },
  marketplacePacks: { list: vi.fn(), install: vi.fn() },
  featureFlags: { get: vi.fn(), set: vi.fn() },
  imports: { allow: vi.fn() },
  jobs: { insertRunning: vi.fn() },
  blob: { putStream: vi.fn(), delete: vi.fn() },
  readBundle: vi.fn(),
  recordAuditEvent: vi.fn(),
  setAccountStatus: vi.fn(),
  enrollSite: vi.fn(),
}));

vi.mock('@openldr/config', async (orig) => ({ ...(await orig<typeof import('@openldr/config')>()), loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/db', () => ({ createInternalDb: vi.fn(), createMarketplaceInstallStore: vi.fn() }));
vi.mock('@openldr/marketplace', async (orig) => ({
  ...(await orig<typeof import('@openldr/marketplace')>()),
  readBundle: mocks.readBundle,
  verifyBundle: vi.fn(),
}));
vi.mock('@openldr/bootstrap', async (orig) => {
  const ctx = {
    plugins: mocks.plugins, marketplacePacks: mocks.marketplacePacks, featureFlags: mocks.featureFlags,
    imports: mocks.imports, jobs: mocks.jobs, blob: mocks.blob, close: vi.fn(async () => {}),
  };
  return {
    ...(await orig<typeof import('@openldr/bootstrap')>()),
    createAppContext: vi.fn(async () => ctx),
    createIngestContext: vi.fn(async () => ctx),
    createTerminologyContext: vi.fn(async () => ctx),
    resolveCodingSystemId: vi.fn(async () => 'cs-1'),
    createRunIngest: vi.fn(),
    runIngestJob: vi.fn(),
    recordAuditEvent: mocks.recordAuditEvent,
    setAccountStatus: mocks.setAccountStatus,
    enrollSite: mocks.enrollSite,
  };
});
vi.mock('node:fs', async (orig) => ({ ...(await orig<typeof import('node:fs')>()), createReadStream: vi.fn(() => 'stream') }));

import { runMarketInstall } from './market';
import { runDistributionImport } from './terminology';
import { runSettingsFlagsSet } from './settings';
import { runUserSetStatus } from './user';
import { runImportAllow } from './import';
import { runPluginInstall, runPluginRemove } from './plugin';
import { runSyncEnroll } from './sync';
import { resetServedHandoffForTests, setServedHandoff } from './served';

const ALICE = { actorType: 'user', actorId: 'u-1', actorName: 'alice', origin: { via: 'cli', keyName: 'ci' } };
const ALICE_REF = { id: 'u-1', name: 'alice' };

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'openldr-served-names-'));
  writeFileSync(join(dir, 'p.wasm'), '');
  writeFileSync(join(dir, 'manifest.json'), '{"id":"demo","version":"1.0.0"}');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('names recorded in served mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.readBundle.mockResolvedValue(PLUGIN_BUNDLE);
    mocks.plugins.install.mockResolvedValue({ id: 'demo', version: '1.0.0' });
    mocks.plugins.remove.mockResolvedValue(undefined);
    mocks.marketplacePacks.list.mockResolvedValue([]);
    mocks.marketplacePacks.install.mockResolvedValue({ status: 'installed', id: 'pack', version: '1.0.0' });
    mocks.jobs.insertRunning.mockRejectedValue(new Error('stop here'));
    mocks.blob.putStream.mockResolvedValue(undefined);
    mocks.blob.delete.mockResolvedValue(undefined);
    mocks.enrollSite.mockResolvedValue({ siteId: 's1', clientId: 'c', clientSecret: 'placeholder' });
    setServedHandoff({
      path: 'x', argv: [], runDir: '/srv/run1', keptDirs: [],
      caller: { id: 'u-1', username: 'alice', displayName: 'Alice', keyName: 'ci' },
    });
  });
  afterEach(() => {
    resetServedHandoffForTests();
    vi.restoreAllMocks();
  });

  it('records the caller as createdBy and as the default approver in served mode', async () => {
    await runMarketInstall('/srv/run1/b', { json: false, approve: true });
    const [, , opts] = mocks.plugins.install.mock.calls[0];
    expect(opts.approval.approvedBy).toBe('alice');
    expect(opts.actor).toEqual(ALICE_REF);

    await runDistributionImport('loinc', { file: '/srv/run1/d.zip', acceptLicense: true, json: false });
    expect(mocks.jobs.insertRunning).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'alice' }));
  });

  it('records the caller where the CLI wrote the fixed name cli', async () => {
    await runSettingsFlagsSet('f1', 'true', { json: false });
    expect(mocks.featureFlags.set).toHaveBeenCalledWith('f1', true, 'alice');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), ALICE, expect.anything());

    await runUserSetStatus('u-2', 'active', { json: false });
    expect(mocks.setAccountStatus).toHaveBeenCalledWith(expect.anything(), { localId: 'u-2' }, true, ALICE);

    await runImportAllow('p1', 'c1');
    expect(mocks.imports.allow).toHaveBeenCalledWith('p1', 'c1', { type: 'user', id: 'u-1', name: 'alice' });
  });

  it('records the caller with its id where a command passed no actor or only a name', async () => {
    await runPluginInstall(join(dir, 'p.wasm'), { json: false });
    expect(mocks.plugins.install.mock.calls[0]![2]).toEqual({ ui: undefined, actor: ALICE_REF });
    await runPluginRemove('demo', { json: false });
    expect(mocks.plugins.remove).toHaveBeenCalledWith('demo', undefined, { actor: ALICE_REF });

    mocks.readBundle.mockResolvedValueOnce({ ...PLUGIN_BUNDLE, manifest: { ...PLUGIN_BUNDLE.manifest, id: 'pack', type: 'content-pack' } });
    await runMarketInstall('/srv/run1/pack', { json: false });
    expect(mocks.marketplacePacks.install.mock.calls[0]![1]).toEqual({ actor: ALICE_REF });

    await runSyncEnroll('s1', { centralUrl: 'https://central.example', json: true });
    expect(mocks.enrollSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actor: 'u-1' }));
  });

  it('keeps what was passed before outside served mode', async () => {
    resetServedHandoffForTests();
    await runMarketInstall('/x', { json: false, approve: true });
    const [, , opts] = mocks.plugins.install.mock.calls[0];
    expect(opts.approval.approvedBy).toBe('cli');
    expect(opts.actor).toEqual({ name: 'cli' });
    await runDistributionImport('loinc', { file: '/x/d.zip', acceptLicense: true, json: false });
    expect(mocks.jobs.insertRunning).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'cli' }));
    await runUserSetStatus('u-2', 'active', { json: false });
    expect(mocks.setAccountStatus).toHaveBeenCalledWith(expect.anything(), { localId: 'u-2' }, true,
      { actorType: 'cli', actorId: null, actorName: 'cli' });
    await runImportAllow('p1', 'c1');
    expect(mocks.imports.allow).toHaveBeenCalledWith('p1', 'c1', expect.objectContaining({ type: 'cli', id: null }));

    await runPluginInstall(join(dir, 'p.wasm'), { json: false });
    expect(Object.keys(mocks.plugins.install.mock.calls[1]![2])).toEqual(['ui']);
    await runPluginRemove('demo', { json: false });
    expect(mocks.plugins.remove.mock.calls[0]).toEqual(['demo', undefined]);
    mocks.readBundle.mockResolvedValueOnce({ ...PLUGIN_BUNDLE, manifest: { ...PLUGIN_BUNDLE.manifest, id: 'pack', type: 'content-pack' } });
    await runMarketInstall('/x/pack', { json: false });
    expect(mocks.marketplacePacks.install.mock.calls[0]![1]).toEqual({ actor: { id: null, name: 'cli' } });
    await runSyncEnroll('s1', { centralUrl: 'https://central.example', json: true });
    expect(mocks.enrollSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actor: null }));
  });
});
