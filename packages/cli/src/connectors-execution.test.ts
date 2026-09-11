import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (original) => ({ ...await original<typeof import('@openldr/bootstrap')>(), createAppContext: vi.fn() }));
import { createAppContext } from '@openldr/bootstrap';
import { runConnectorInspect, runConnectorUpdate } from './connectors';

afterEach(() => vi.restoreAllMocks());

it('prints only the safe view and updates without erasing credentials or auditing their values', async () => {
  let config = { host: 'old', password: 'stored-secret' };
  const audits: unknown[] = [];
  const ctx = {
    cfg: { SECRETS_ENCRYPTION_KEY: 'test' },
    connectors: {
      get: async () => ({ id: 'pg', type: 'postgres' }),
      getDecryptedConfig: async () => config,
      update: async (_id: string, patch: { config?: typeof config }) => { if (patch.config) config = patch.config; },
    },
    audit: { record: async (value: unknown) => { audits.push(value); } },
    logger: { error: vi.fn() }, close: vi.fn(),
  };
  vi.mocked(createAppContext).mockResolvedValue(ctx as never);
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runConnectorInspect('pg');
  expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual({ config: { host: 'old' }, secretsSet: { password: true } });
  const dir = mkdtempSync(join(tmpdir(), 'connector-patch-'));
  try {
    const file = join(dir, 'patch.json');
    writeFileSync(file, JSON.stringify({ config: { host: 'new' } }));
    expect(await runConnectorUpdate('pg', file)).toBe(0);
    expect(config).toEqual({ host: 'new', password: 'stored-secret' });
    expect(audits).toEqual([expect.objectContaining({ actorName: 'cli', action: 'connector.update' })]);
    expect(JSON.stringify(audits)).not.toContain('stored-secret');
    expect(out.mock.calls.map((call) => call[0]).join('')).not.toContain('stored-secret');
  } finally { rmSync(dir, { recursive: true }); }
});
