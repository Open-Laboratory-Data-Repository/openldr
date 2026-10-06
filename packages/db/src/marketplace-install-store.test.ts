import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createMarketplaceInstallStore } from './marketplace-install-store';

describe('MarketplaceInstallStore', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => {
    db = (await makeMigratedDb()) as unknown as Kysely<InternalSchema>;
  });

  it('upserts, gets, lists and removes', async () => {
    const store = createMarketplaceInstallStore(db);
    await store.upsert({ artifactId: 'specimen-intake', version: '1.0.0', kind: 'form-template', targetFormId: 'form-1', payloadSha256: 'a'.repeat(64), publisherName: 'P', sourceRef: 'specimen-intake-1.0.0', installedBy: 'admin' });
    expect((await store.get('specimen-intake'))?.targetFormId).toBe('form-1');
    expect(await store.list()).toHaveLength(1);

    await store.upsert({ artifactId: 'specimen-intake', version: '1.1.0', kind: 'form-template', targetFormId: 'form-1', payloadSha256: 'b'.repeat(64), publisherName: 'P', sourceRef: 'specimen-intake-1.1.0', installedBy: 'admin' });
    expect(await store.list()).toHaveLength(1);
    expect((await store.get('specimen-intake'))?.version).toBe('1.1.0');

    await store.remove('specimen-intake');
    expect(await store.get('specimen-intake')).toBeNull();
  });

  it('records a failed install without a form, and a later upsert resets it', async () => {
    const store = createMarketplaceInstallStore(db);
    await store.upsert({ artifactId: 'pack-a', version: '1.0.0', kind: 'content-pack', targetFormId: null, payloadSha256: 'a'.repeat(64), status: 'failed', failedStep: 4, error: 'x' });
    const failed = await store.get('pack-a');
    expect(failed).toMatchObject({ targetFormId: null, status: 'failed', failedStep: 4, error: 'x' });

    await store.upsert({ artifactId: 'pack-a', version: '1.0.0', kind: 'content-pack', targetFormId: null, payloadSha256: 'a'.repeat(64) });
    const ok = await store.get('pack-a');
    expect(ok).toMatchObject({ status: 'installed', failedStep: null, error: null });
  });
});
