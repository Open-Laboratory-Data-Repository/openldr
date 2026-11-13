import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Layer under test: the names the command functions hand to their stores and to the audit log, over
// faked contexts. A served hand-off is set in-process. Not covered: the stores themselves, and a
// real child process (Task 15).

const mocks = vi.hoisted(() => ({
  plugins: { install: vi.fn() },
  featureFlags: { get: vi.fn(), set: vi.fn() },
  imports: { allow: vi.fn() },
  jobs: { insertRunning: vi.fn() },
  blob: { putStream: vi.fn(), delete: vi.fn() },
  recordAuditEvent: vi.fn(),
  setAccountStatus: vi.fn(),
}));

vi.mock('@openldr/config', async (orig) => ({ ...(await orig<typeof import('@openldr/config')>()), loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/db', () => ({ createInternalDb: vi.fn(), createMarketplaceInstallStore: vi.fn() }));
vi.mock('@openldr/marketplace', async (orig) => ({
  ...(await orig<typeof import('@openldr/marketplace')>()),
  readBundle: vi.fn(async () => ({
    manifest: { id: 'demo', version: '1.0.0', type: 'plugin', capabilities: [] },
    raw: {}, wasm: new Uint8Array(), publicKeyDer: new Uint8Array(),
  })),
  verifyBundle: vi.fn(),
}));
vi.mock('@openldr/bootstrap', async (orig) => {
  const ctx = {
    plugins: mocks.plugins, featureFlags: mocks.featureFlags, imports: mocks.imports,
    jobs: mocks.jobs, blob: mocks.blob, close: vi.fn(async () => {}),
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
  };
});
vi.mock('node:fs', async (orig) => ({ ...(await orig<typeof import('node:fs')>()), createReadStream: vi.fn(() => 'stream') }));

import { runMarketInstall } from './market';
import { runDistributionImport } from './terminology';
import { runSettingsFlagsSet } from './settings';
import { runUserSetStatus } from './user';
import { runImportAllow } from './import';
import { setServedHandoff } from './served';

const ALICE = { actorType: 'user', actorId: 'u-1', actorName: 'alice', origin: { via: 'cli', keyName: 'ci' } };

describe('names recorded in served mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.plugins.install.mockResolvedValue({ id: 'demo', version: '1.0.0' });
    mocks.jobs.insertRunning.mockRejectedValue(new Error('stop here'));
    mocks.blob.putStream.mockResolvedValue(undefined);
    mocks.blob.delete.mockResolvedValue(undefined);
    setServedHandoff({
      path: 'x', argv: [], runDir: '/srv/run1', keptDirs: [],
      caller: { id: 'u-1', username: 'alice', displayName: 'Alice', keyName: 'ci' },
    });
  });
  afterEach(() => {
    setServedHandoff(null);
    vi.restoreAllMocks();
  });

  it('records the caller as createdBy and as the default approver in served mode', async () => {
    await runMarketInstall('/srv/run1/b', { json: false, approve: true });
    const [, , opts] = mocks.plugins.install.mock.calls[0];
    expect(opts.approval.approvedBy).toBe('alice');
    expect(opts.actor).toEqual({ name: 'alice' });

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

  it('keeps cli outside served mode', async () => {
    setServedHandoff(null);
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
  });
});
