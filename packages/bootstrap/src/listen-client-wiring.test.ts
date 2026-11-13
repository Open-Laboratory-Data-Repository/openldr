import type { EventEmitter } from 'node:events';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Config } from '@openldr/config';

/**
 * `createAppContext` opens a database connection of its own to LISTEN for changes. When Postgres
 * restarts, that connection dies and emits `error`. With no listener that throws, and in the server
 * it ended the process. Polling on an interval is what keeps the work moving, so the right answer is
 * to log it and carry on.
 *
 * `pg.Client` is swapped for one that records each connection the context makes. The database URL
 * is unreachable on purpose, as in terminology-ingest-wiring.test.ts, so the connect itself fails
 * and the context falls back to polling; the connection object is still the one that would emit.
 */
const made = vi.hoisted(() => ({ clients: [] as EventEmitter[] }));

vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pg')>();
  class RecordedClient extends actual.default.Client {
    constructor(...args: ConstructorParameters<typeof actual.default.Client>) {
      super(...args);
      made.clients.push(this as unknown as EventEmitter);
    }
  }
  return { ...actual, default: { ...actual.default, Client: RecordedClient }, Client: RecordedClient };
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
beforeEach(() => { made.clients = []; });
afterEach(async () => { await ctx?.close(); ctx = undefined; });

describe('createAppContext and its LISTEN connection', () => {
  it('a lost LISTEN connection does not throw', async () => {
    ctx = await createAppContext(cfg);
    expect(made.clients.length).toBeGreaterThan(0);
    for (const client of made.clients) {
      expect(() => client.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    }
  });
});
