import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Config } from '@openldr/config';

/**
 * Every `openldr` CLI command builds an `AppContext`. Building it used to start sync: it read the
 * sync settings, built and started the push and pull workers, and logged a line that reached the
 * caller of a command sent through the app. Only the server's start sets `startSyncWorkers`. Any
 * other process starts sync the first time it asks the sync handle for something only a started
 * sync can answer.
 *
 * The settings reader is swapped for a counter, so "was sync started" is seen as "were the settings
 * read". The database URL is unreachable on purpose, as in terminology-ingest-wiring.test.ts.
 */
const read = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@openldr/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openldr/sync')>();
  return {
    ...actual,
    readSyncConfig: async () => { read.calls += 1; return null; },
  };
});

import { createAppContext, type AppContext } from './index';

const cfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
  AUTH_DEV_BYPASS: true,
  BLOB_ADAPTER: 'minio',
  EVENTING_ADAPTER: 'pg',
  TARGET_STORE_ADAPTER: 'pg',
  INTERNAL_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
  S3_ENDPOINT: 'http://127.0.0.1:9499',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
  S3_BUCKET: 'none',
  S3_FORCE_PATH_STYLE: true,
  OIDC_ISSUER_URL: 'http://127.0.0.1:8499/realms/master',
}) as Config;

let ctx: AppContext | undefined;
beforeEach(() => { read.calls = 0; });
afterEach(async () => { await ctx?.close(); ctx = undefined; });

describe('createAppContext and the sync start', () => {
  it('without startSyncWorkers, building the context does not start sync (the CLI shape)', async () => {
    ctx = await createAppContext(cfg);
    expect(read.calls).toBe(0);
  });

  it('without startSyncWorkers, the first call that needs a started sync starts it, once', async () => {
    ctx = await createAppContext(cfg);
    // retryQuarantine reads only what the start sets, so it needs no database here.
    expect(await ctx.sync.retryQuarantine('terminology_system', 'http://x')).toEqual({
      ok: false, error: 'sync pull is not enabled on this node',
    });
    expect(read.calls).toBe(1);
    await ctx.sync.retryQuarantine('terminology_system', 'http://x');
    expect(read.calls).toBe(1);
  });

  it('with startSyncWorkers, sync is started while the context is built (the server shape)', async () => {
    ctx = await createAppContext(cfg, { startSyncWorkers: true });
    expect(read.calls).toBe(1);
    await ctx.sync.retryQuarantine('terminology_system', 'http://x');
    expect(read.calls).toBe(1);
  });
});
