import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake plugin runtime methods
const mockPlugins = vi.hoisted(() => ({
  install: vi.fn(),
  list: vi.fn(),
  rollback: vi.fn(),
  setEnabled: vi.fn(),
  remove: vi.fn(),
  load: vi.fn(),
  test: vi.fn(),
}));

const mockPacks = vi.hoisted(() => ({
  check: vi.fn(),
  install: vi.fn(),
  list: vi.fn(),
}));

const mockForms = vi.hoisted(() => ({
  install: vi.fn(),
  list: vi.fn(),
}));

const mockCtx = vi.hoisted(() => ({
  close: vi.fn(),
  plugins: mockPlugins,
  marketplacePacks: mockPacks,
  marketplaceForms: mockForms,
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createIngestContext: vi.fn(async () => mockCtx),
  createAppContext: vi.fn(async () => mockCtx),
}));

// Mock readBundle / verifyBundle from @openldr/marketplace
const mockBundle = vi.hoisted(() => ({
  manifest: {
    id: 'demo',
    version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: 'a'.repeat(64) },
    compatibility: { ceVersion: '*' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
  },
  raw: {},
  wasm: new Uint8Array([1, 2, 3]),
  publicKeyDer: new Uint8Array([4, 5, 6]),
  payloadSha256: 'abc123',
}));

vi.mock('@openldr/marketplace', () => ({
  readBundle: vi.fn(async () => mockBundle),
  verifyBundle: vi.fn(() => ({ valid: true, fingerprint: 'f'.repeat(64) })),
}));

import {
  runMarketVerify,
  runMarketInstall,
  runMarketList,
  runMarketRollback,
  runMarketEnable,
  runMarketDisable,
  runMarketRemove,
} from './market';

describe('market commands', () => {
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPacks.list.mockReset();
    mockPacks.list.mockResolvedValue([]);
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  // ------------------------------------------------------------------
  // verify
  // ------------------------------------------------------------------
  it('verify: calls readBundle + verifyBundle and emits JSON', async () => {
    const { readBundle, verifyBundle } = await import('@openldr/marketplace');
    const code = await runMarketVerify('/some/dir', { json: true });
    expect(readBundle).toHaveBeenCalledWith('/some/dir');
    expect(verifyBundle).toHaveBeenCalledWith(mockBundle);
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.id).toBe('demo');
    expect(parsed.valid).toBe(true);
  });

  it('verify: returns 1 when verifyBundle returns invalid', async () => {
    const { verifyBundle } = await import('@openldr/marketplace');
    (verifyBundle as ReturnType<typeof vi.fn>).mockReturnValueOnce({ valid: false, fingerprint: '0'.repeat(64) });
    const code = await runMarketVerify('/some/dir', { json: false });
    expect(code).toBe(1);
  });

  // ------------------------------------------------------------------
  // install
  // ------------------------------------------------------------------
  it('install: calls readBundle then ctx.plugins.install without approval when flag absent', async () => {
    mockPlugins.install.mockResolvedValueOnce({ id: 'demo', version: '1.0.0' });
    const code = await runMarketInstall('/some/dir', { json: true, approve: false });
    expect(mockPlugins.install).toHaveBeenCalledTimes(1);
    const [, , opts] = mockPlugins.install.mock.calls[0];
    expect(opts.approval).toBeUndefined();
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.id).toBe('demo');
  });

  it('install: passes approval when --approve is set', async () => {
    mockPlugins.install.mockResolvedValueOnce({ id: 'demo', version: '1.0.0' });
    await runMarketInstall('/some/dir', { json: false, approve: true, approvedBy: 'admin' });
    const [, , opts] = mockPlugins.install.mock.calls[0];
    expect(opts.approval).toEqual({
      approvedBy: 'admin',
      acknowledgedCapabilities: mockBundle.manifest.capabilities,
    });
  });

  it('install: defaults approvedBy to "cli" when --approve set but no --approved-by', async () => {
    mockPlugins.install.mockResolvedValueOnce({ id: 'demo', version: '1.0.0' });
    await runMarketInstall('/some/dir', { json: false, approve: true });
    const [, , opts] = mockPlugins.install.mock.calls[0];
    expect(opts.approval?.approvedBy).toBe('cli');
  });

  it('install: returns 1 and writes error on failure', async () => {
    mockPlugins.install.mockRejectedValueOnce(new Error('boom'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await runMarketInstall('/some/dir', { json: false, approve: false });
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });

  // ------------------------------------------------------------------
  // list
  // ------------------------------------------------------------------
  it('list: calls plugins.list and emits JSON array', async () => {
    mockPlugins.list.mockResolvedValueOnce([
      { id: 'demo', version: '1.0.0', status: 'installed', sha256: 'a'.repeat(64), enabled: true, active: true, approvedBy: null },
    ]);
    const code = await runMarketList({ json: true });
    expect(mockPlugins.list).toHaveBeenCalledTimes(1);
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('demo');
  });

  it('list: emits tab-separated human rows when --json absent', async () => {
    mockPlugins.list.mockResolvedValueOnce([
      { id: 'demo', version: '1.0.0', status: 'installed', sha256: 'a'.repeat(64), enabled: true, active: true, approvedBy: 'admin' },
    ]);
    const code = await runMarketList({ json: false });
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    expect(written).toContain('demo');
  });

  // ------------------------------------------------------------------
  // rollback
  // ------------------------------------------------------------------
  it('rollback: delegates to plugins.rollback with id+version', async () => {
    mockPlugins.rollback.mockResolvedValueOnce(undefined);
    const code = await runMarketRollback('demo', '1.0.0', { json: true });
    expect(mockPlugins.rollback).toHaveBeenCalledWith('demo', '1.0.0', expect.anything());
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.id).toBe('demo');
    expect(parsed.version).toBe('1.0.0');
  });

  // ------------------------------------------------------------------
  // enable / disable
  // ------------------------------------------------------------------
  it('enable: calls plugins.setEnabled(id, true)', async () => {
    mockPlugins.setEnabled.mockResolvedValueOnce(undefined);
    const code = await runMarketEnable('demo', { json: true });
    expect(mockPlugins.setEnabled).toHaveBeenCalledWith('demo', true, expect.anything());
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    expect(JSON.parse(written)).toMatchObject({ id: 'demo', enabled: true });
  });

  it('disable: calls plugins.setEnabled(id, false)', async () => {
    mockPlugins.setEnabled.mockResolvedValueOnce(undefined);
    const code = await runMarketDisable('demo', { json: false });
    expect(mockPlugins.setEnabled).toHaveBeenCalledWith('demo', false, expect.anything());
    expect(code).toBe(0);
  });

  // ------------------------------------------------------------------
  // remove
  // ------------------------------------------------------------------
  it('remove: calls plugins.remove with id (no version)', async () => {
    mockPlugins.remove.mockResolvedValueOnce(undefined);
    const code = await runMarketRemove('demo', undefined, { json: true });
    expect(mockPlugins.remove).toHaveBeenCalledWith('demo', undefined, expect.anything());
    expect(code).toBe(0);
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.removed).toBe('demo');
  });

  it('remove: passes version when provided', async () => {
    mockPlugins.remove.mockResolvedValueOnce(undefined);
    await runMarketRemove('demo', '1.0.0', { json: false });
    expect(mockPlugins.remove).toHaveBeenCalledWith('demo', '1.0.0', expect.anything());
  });

  // ------------------------------------------------------------------
  // content packs and form templates
  // ------------------------------------------------------------------
  const packBundle = {
    ...mockBundle,
    manifest: { ...mockBundle.manifest, id: 'demo-pack', type: 'content-pack', capabilities: [] },
  };
  const formBundle = {
    ...mockBundle,
    manifest: { ...mockBundle.manifest, id: 'demo-form', type: 'form-template' },
  };

  async function useBundle(b: unknown): Promise<void> {
    const { readBundle } = await import('@openldr/marketplace');
    (readBundle as ReturnType<typeof vi.fn>).mockResolvedValueOnce(b);
  }

  it('install pack: goes to the pack installer, not plugins.install', async () => {
    await useBundle(packBundle);
    mockPacks.install.mockResolvedValueOnce({ id: 'demo-pack', version: '1.0.0', status: 'installed' });
    const code = await runMarketInstall('/some/dir', { json: false });
    expect(code).toBe(0);
    expect(mockPlugins.install).not.toHaveBeenCalled();
    expect(mockPacks.install).toHaveBeenCalledTimes(1);
    const [bundle, opts] = mockPacks.install.mock.calls[0];
    expect(bundle).toBe(packBundle);
    expect(opts.actor).toEqual({ id: null, name: 'cli' });
    expect(mockCtx.close).toHaveBeenCalled();
  });

  it('install pack --dry-run: calls check only and prints the steps', async () => {
    await useBundle(packBundle);
    mockPacks.check.mockResolvedValueOnce({
      steps: [{ kind: 'value-set', label: 'Specimen types', count: 1 }],
    });
    const code = await runMarketInstall('/some/dir', { json: false, dryRun: true });
    expect(code).toBe(0);
    expect(mockPacks.check).toHaveBeenCalledWith(packBundle);
    expect(mockPacks.install).not.toHaveBeenCalled();
    const text = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(text).toContain('Specimen types');
  });

  it('install pack: refuses an installed pack without --force', async () => {
    await useBundle(packBundle);
    mockPacks.list.mockResolvedValueOnce([{ artifactId: 'demo-pack', version: '1.0.0', status: 'installed' }]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await runMarketInstall('/some/dir', { json: false });
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    stderrSpy.mockRestore();
    expect(code).toBe(1);
    expect(err).toContain('already installed; use --force to install again');
    expect(mockPacks.install).not.toHaveBeenCalled();
  });

  it('install pack --force: installs an installed pack again', async () => {
    await useBundle(packBundle);
    mockPacks.list.mockResolvedValueOnce([{ artifactId: 'demo-pack', version: '1.0.0', status: 'installed' }]);
    mockPacks.install.mockResolvedValueOnce({ id: 'demo-pack', version: '1.0.0', status: 'installed' });
    const code = await runMarketInstall('/some/dir', { json: false, force: true });
    expect(code).toBe(0);
    expect(mockPacks.install).toHaveBeenCalledTimes(1);
  });

  it('install pack --dry-run: does not need --force for an installed pack', async () => {
    await useBundle(packBundle);
    mockPacks.list.mockResolvedValueOnce([{ artifactId: 'demo-pack', version: '1.0.0', status: 'installed' }]);
    mockPacks.check.mockResolvedValueOnce({ steps: [] });
    const code = await runMarketInstall('/some/dir', { json: false, dryRun: true });
    expect(code).toBe(0);
    expect(mockPacks.install).not.toHaveBeenCalled();
  });

  it('install pack: a failed step prints "failed at step N" and returns 1', async () => {
    await useBundle(packBundle);
    mockPacks.install.mockResolvedValueOnce({
      id: 'demo-pack', version: '1.0.0', status: 'failed', failedStep: 2, error: 'bad csv',
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await runMarketInstall('/some/dir', { json: false });
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    stderrSpy.mockRestore();
    expect(code).toBe(1);
    expect(err).toContain('failed at step 2: bad csv');
  });

  it('install pack --json: prints the failed result object', async () => {
    await useBundle(packBundle);
    mockPacks.install.mockResolvedValueOnce({
      id: 'demo-pack', version: '1.0.0', status: 'failed', failedStep: 2, error: 'bad csv',
    });
    const code = await runMarketInstall('/some/dir', { json: true });
    expect(code).toBe(1);
    const parsed = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ status: 'failed', failedStep: 2, error: 'bad csv' });
  });

  it('install form template: goes to the form installer', async () => {
    await useBundle(formBundle);
    mockForms.install.mockResolvedValueOnce({ id: 'demo-form', version: '1.0.0' });
    const code = await runMarketInstall('/some/dir', { json: false });
    expect(code).toBe(0);
    expect(mockPlugins.install).not.toHaveBeenCalled();
    expect(mockForms.install).toHaveBeenCalledTimes(1);
    const [, opts] = mockForms.install.mock.calls[0];
    expect(opts.approval).toBeUndefined();
  });

  it('install form template --approve: passes the approval', async () => {
    await useBundle(formBundle);
    mockForms.install.mockResolvedValueOnce({ id: 'demo-form', version: '1.0.0' });
    await runMarketInstall('/some/dir', { json: false, approve: true, approvedBy: 'admin' });
    const [, opts] = mockForms.install.mock.calls[0];
    expect(opts.approval).toEqual({
      approvedBy: 'admin',
      acknowledgedCapabilities: formBundle.manifest.capabilities,
    });
  });

  it('list: includes content packs with their status', async () => {
    mockPlugins.list.mockResolvedValueOnce([]);
    mockPacks.list.mockResolvedValueOnce([
      { artifactId: 'demo-pack', version: '2.0.0', status: 'failed', failedStep: 3, error: 'boom' },
    ]);
    const code = await runMarketList({ json: false });
    expect(code).toBe(0);
    const text = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(text).toContain('demo-pack');
    expect(text).toContain('failed');
    expect(text).toContain('content-pack');
  });
});
