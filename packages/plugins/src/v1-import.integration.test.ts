import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArtifactManifest } from '@openldr/marketplace';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/openldr-v1-import/plugin.wasm is a gitignored build artifact
// (run `pnpm build:v1-import` first). Absent means the whole suite skips.
//
// Layer proven here: the BUILT WASM, run through the real Extism runner and the sink wrapper the
// import service uses. The same golden files the Rust tests use are the oracle, so this shows the
// wasm build maps exactly as the native build does. Not proven here: a database, or saving into CE.
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const pluginDir = join(repo, 'reference-plugins', 'openldr-v1-import');
const wasmPath = join(pluginDir, 'plugin.wasm');
const fixturesDir = join(repo, 'wasm', 'openldr-v1-import', 'tests', 'fixtures');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
const ENTRYPOINTS = ['import_queries', 'import_checks', 'import_map'];

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({ id: 'openldr-v1-import', version: '0.1.0', kind: 'sink', entrypoints: ENTRYPOINTS, wasmSha256: sha256Hex(wasm), wasi: true });
  // No net-egress grant: the plugin needs no network, and must work without it.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'host:import' }]);
}

/** Numbers by value (40 equals 40.0) and object keys in any order; arrays in order. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    return same(ka, kb) && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

describe.skipIf(!present)('openldr-v1-import wasm', () => {
  it('ships a manifest CE accepts, with the import source and the capability it needs', () => {
    const manifest = parseArtifactManifest(JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8')));
    expect(manifest.payload.kind === 'plugin' && manifest.payload.importSource).toEqual({
      connectorTypes: ['microsoft-sql'], sourceSystem: 'openldr-v1',
      entrypoints: { queries: 'import_queries', checks: 'import_checks', map: 'import_map' },
    });
    expect(manifest.capabilities.map((c) => c.kind)).toEqual(['host:import', 'emit-fhir']);
    expect(manifest.payload.kind === 'plugin' && manifest.payload.wasmSha256).toBe(sha256Hex(new Uint8Array(readFileSync(wasmPath))));
    // The page ships beside the wasm, is admin-only, and matches the hash the manifest pins.
    const ui = manifest.payload.kind === 'plugin' ? manifest.payload.ui : undefined;
    expect(ui).toMatchObject({ entry: 'ui.html', requiredRoles: ['lab_admin'], nav: { label: 'OpenLDR v1 import', icon: 'database', section: 'apps' } });
    expect(ui?.sha256).toBe(sha256Hex(new Uint8Array(readFileSync(join(pluginDir, 'ui.html')))));
  });

  it('returns the key query and four detail queries', async () => {
    const out = (await sink().invoke('import_queries', { options: { tz: '+02:00', panels: 'HIVVL,VIRAL' } })) as any;
    expect(out.keyQuery.sql).toBe(
      "SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > {{after}} AND [LIMSPanelCode] IN ('HIVVL', 'VIRAL') ORDER BY [RequestID]",
    );
    expect(out.detailQueries.map((d: { name: string }) => d.name)).toEqual(['requests', 'results', 'patients', 'ast']);
  });

  it('returns checks, and fails clearly without a time zone', async () => {
    const out = (await sink().invoke('import_checks', { options: { tz: 'Z' } })) as any;
    expect(out.checks.map((c: { id: string }) => c.id)).toEqual(['tables_found', 'request_rows', 'result_rows', 'patient_rows', 'ast_rows']);
    await expect(sink().invoke('import_queries', { options: {} })).rejects.toThrow(/tz/);
  });

  it('maps every golden fixture exactly as the TypeScript mapping does', async () => {
    const s = sink();
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json') && f !== 'attribute-rules.json');
    expect(files.length).toBeGreaterThanOrEqual(10);
    let requests = 0;
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
      const out = (await s.invoke('import_map', fixture.input)) as { groups: Array<{ key: string }> };
      expect(out.groups.map((g) => g.key), file).toEqual(fixture.expected.groups.map((g: { key: string }) => g.key));
      for (let i = 0; i < out.groups.length; i += 1) {
        requests += 1;
        expect(same(out.groups[i], fixture.expected.groups[i]), `${file} ${out.groups[i].key}`).toBe(true);
      }
    }
    expect(requests).toBeGreaterThanOrEqual(31);
  });
});
