import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Config } from '@openldr/config';
import type { TerminologyIngestJob } from '@openldr/db';

/**
 * Every `openldr` CLI command builds an `AppContext`. Building the terminology import worker used to
 * sweep every `running` job to failed, so a CLI process failed the server's live terminology imports.
 * Only the server's start sets `runTerminologyIngestWorker`. Since 2026-11-18 the worker takes back
 * only a job whose heartbeat stopped, on its tick, never at construction
 * (terminology-ingest-worker.test.ts proves the take-back).
 *
 * The job store is swapped for an in-memory one holding a `running` row, so the sweep is seen on the
 * row itself. The database URL is unreachable on purpose, as in facility-import-wiring.test.ts.
 */
const rows = vi.hoisted(() => ({ jobs: [] as Array<{ id: string; status: string; error: string | null }> }));

vi.mock('@openldr/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openldr/db')>();
  return {
    ...actual,
    createTerminologyIngestJobStore: () => ({
      async claimNext(): Promise<TerminologyIngestJob | null> { return null; },
      async listStaleRunning() { return []; },
    }),
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
afterEach(async () => { await ctx?.close(); ctx = undefined; });

describe('createAppContext and the terminology import worker', () => {
  it('without runTerminologyIngestWorker, a running import stays running (the CLI shape)', async () => {
    rows.jobs = [{ id: 'j1', status: 'running', error: null }];
    ctx = await createAppContext(cfg);
    // close() awaits the worker's sweep when there is one, so the row is final after it.
    await ctx.close();
    expect(rows.jobs[0]).toEqual({ id: 'j1', status: 'running', error: null });
  });

  it('with runTerminologyIngestWorker, building and closing the app leaves a running import running (the server shape)', async () => {
    rows.jobs = [{ id: 'j1', status: 'running', error: null }];
    ctx = await createAppContext(cfg, { runTerminologyIngestWorker: true });
    await ctx.close();
    expect(rows.jobs[0]).toEqual({ id: 'j1', status: 'running', error: null });
  });
});
