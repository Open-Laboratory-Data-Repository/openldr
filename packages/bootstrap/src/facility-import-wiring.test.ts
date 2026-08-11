import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Config } from '@openldr/config';

/**
 * ⛔ Whole-branch Critical 2, background-upload door — the one `facility-import-worker.test.ts`
 * cannot see.
 *
 * `importFacilities` writes Task 7's per-facility `facility.import.row` events only when
 * `deps.audit` is supplied, and all three production deps literals omitted it: the HTTP route, the
 * CLI, and `createAppContext`'s `importDeps` here. The worker's OWN `audit` dep (right below
 * `importDeps` in index.ts) was correctly wired all along and is what made the omission invisible —
 * it feeds the register-scoped `facility.import` summary, a different event entirely. So every
 * applied upload logged "the per-row write is unaudited", `GET /api/facilities/:id/history` could
 * never show an import, and the Studio's provenance panel said "Never imported" for a facility
 * imported seconds earlier.
 *
 * `facility-import-worker.test.ts` builds its own deps by hand and therefore proves nothing about
 * what `createAppContext` hands over; `index.test.ts` cannot reach the object at all, since the
 * worker keeps its deps private. So this file intercepts the factory at the seam and inspects the
 * literal `createAppContext` actually passes.
 *
 * The DB URL below is deliberately unreachable (127.0.0.1:5499, exactly as index.test.ts uses), and
 * the worker is not enabled — `createFacilityImportWorkerIfEnabled` is nonetheless called
 * UNCONDITIONALLY with its deps, which is what makes the capture work without a live database. That
 * an audit store then produces real `facility.import.row` rows is proven end-to-end against a real
 * store and a real (pg-mem) database in facility-import.test.ts.
 */
const captured = vi.hoisted(() => ({ deps: undefined as undefined | { importDeps?: Record<string, unknown> } }));

vi.mock('./facility-import-worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./facility-import-worker')>();
  return {
    ...actual,
    createFacilityImportWorkerIfEnabled: (enabled: boolean, deps: Parameters<typeof actual.createFacilityImportWorkerIfEnabled>[1]) => {
      captured.deps = deps as unknown as { importDeps?: Record<string, unknown> };
      return actual.createFacilityImportWorkerIfEnabled(enabled, deps);
    },
  };
});

// Deliberately imported BELOW the `vi.mock` above rather than with the other imports: vitest hoists
// the mock either way, but keeping the order visible is what makes it obvious that
// `createAppContext` closes over the intercepting factory and not the real one.
import { createAppContext, type AppContext } from './index';

const cfg: Config = Object.freeze({
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  AUTH_ADAPTER: 'keycloak',
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

let ctx: AppContext;
afterEach(async () => { await ctx?.close(); });

describe('createAppContext — facility import worker deps', () => {
  it('⛔ hands the background import worker an audit store, so an uploaded register writes per-row history', async () => {
    ctx = await createAppContext(cfg);

    const importDeps = captured.deps?.importDeps;
    expect(importDeps).toBeDefined();
    // Truthy, because truthiness is the actual predicate `importFacilities` branches on
    // (`if (!deps.audit)`) — "the key is present" would pass with `audit: undefined`.
    expect(importDeps!.audit).toBeTruthy();
    expect(typeof (importDeps!.audit as { record?: unknown }).record).toBe('function');
    // The SAME store the rest of the app audits through, not a second sink: the worker's own
    // register-scoped `facility.import` entry and these per-row events must land in one table.
    expect(importDeps!.audit).toBe(ctx.audit);
  }, 20000);
});
