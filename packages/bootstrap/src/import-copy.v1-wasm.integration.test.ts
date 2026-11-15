import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createImportCopyStore, createPluginDataStore } from '@openldr/db';
import { validateSelectSql } from '@openldr/dashboards';
import { createExtismRunner, createWasmSink, parseManifest, sha256Hex } from '@openldr/plugins';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import type { ImportActor, ImportAuditEvent } from './import-run';
import { copyIdOf, createImportCopyService } from './import-copy';
import { fillDetailQuery, fillKeyQuery } from './import-sql';

// Layer under test: the copy service's start with the BUILT v1 wasm and its staged manifest. Start
// asks the plugin what to copy and checks the answer: the shape, then validateSelectSql on every
// statement with its tokens filled. plugin_data runs on pg-mem.
// Not covered here: a source database (start opens none), driving a copy, real Postgres.
// reference-plugins/openldr-v1-import is git-ignored build output (run `pnpm build:v1-import`
// first). Absent means the whole suite skips.

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..', '..', '..', 'reference-plugins', 'openldr-v1-import');
const wasmPath = join(pluginDir, 'plugin.wasm');
const manifestPath = join(pluginDir, 'manifest.json');
const present = existsSync(wasmPath) && existsSync(manifestPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
const ADMIN: ImportActor = { type: 'user', id: 'u-admin', name: 'admin' };
const OPTIONS = { tz: '+02:00', database: 'OpenLDRData', panels: 'HIVVL' };

let internalDb: Awaited<ReturnType<typeof makeMigratedDb>>;
beforeEach(async () => { internalDb = await makeMigratedDb(); });
afterEach(async () => { await internalDb.destroy(); });

function v1() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    id: string; version: string; payload: { entrypoints: string[]; wasi: boolean };
  };
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const sink = createWasmSink(
    parseManifest({ id: manifest.id, version: manifest.version, kind: 'sink', entrypoints: manifest.payload.entrypoints, wasmSha256: sha256Hex(wasm), wasi: manifest.payload.wasi }),
    wasm, createExtismRunner(), logger, [{ kind: 'host:import' }],
  );
  return { manifest, sink };
}

describe.skipIf(!present)('copy service with the built v1 plugin', () => {
  it('starts a copy: the plugin answer passes every check, and no source is opened', async () => {
    const { manifest, sink } = v1();
    const audited: ImportAuditEvent[] = [];
    let opened = 0;
    const svc = createImportCopyService({
      plugins: {
        list: async () => [{ id: manifest.id, version: manifest.version, enabled: true, manifest: manifest as unknown as Record<string, unknown> }],
        loadSink: async () => sink,
      },
      connectors: {
        get: async (id) => (id === 'c1' ? { type: 'microsoft-sql', enabled: true } : null),
        getDecryptedConfig: async () => { throw new Error('start must not read the connector config'); },
      },
      secretsKey: 'k',
      pluginData: createPluginDataStore(internalDb),
      store: createImportCopyStore(internalDb),
      audit: async (e) => { audited.push(e); },
      allowed: async () => ['c1'],
      driverId: 'server-1',
      createDb: () => { opened += 1; throw new Error('start must not open the source'); },
    });

    const run = await svc.start({ pluginId: manifest.id, connectorId: 'c1', options: OPTIONS, actor: ADMIN });
    expect(run).toMatchObject({ id: copyIdOf(manifest.id, 'c1'), kind: 'copy', status: 'queued', options: OPTIONS, setOrder: ['requests'] });
    expect(run.sets).toEqual({ requests: { cursor: null, keys: 0, rows: 0, bytes: 0, skipped: 0, done: false } });
    expect(run.setSql.requests).toMatch(/^[0-9a-f]{64}$/);
    expect(opened).toBe(0);
    expect(audited.map((e) => [e.action, e.metadata])).toEqual([['import.copy.start', { pageSize: 500, sets: 1, reread: 0 }]]);
  });

  it('every statement it names is one SELECT once filled, the star included', async () => {
    const { sink } = v1();
    const out = (await sink.invoke('import_copy', { options: OPTIONS })) as {
      sets: Array<{ keyQuery: { sql: string }; detailQueries: Array<{ name: string; sql: string }> }>;
    };
    const set = out.sets[0];
    const key = fillKeyQuery(set.keyQuery.sql, 'REQ0001', 500);
    expect(() => validateSelectSql(key, 'mssql')).not.toThrow();
    const filled = set.detailQueries.map((d) => fillDetailQuery(d.sql, ['REQ0002', "O'Brien"]));
    for (const sql of filled) expect(() => validateSelectSql(sql, 'mssql')).not.toThrow();
    expect(filled[0]).toBe(
      "SELECT [RequestID] AS [__key], * FROM [OpenLDRData].[dbo].[Requests] WHERE [RequestID] IN ('REQ0002', 'O''Brien') ORDER BY [RequestID], [OBRSetID]",
    );
  });
});
