import { describe, it, expect } from 'vitest';
import { canCheck, canCopy, canImportOnePass, importSourceSchema, parseArtifactManifest, pluginManifestToArtifact, type ImportSource } from './artifact-manifest';

const fp = 'a'.repeat(64);
const base = {
  schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme', keyFingerprint: fp },
  compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Observation'] }],
  payload: { kind: 'plugin', wasmSha256: 'b'.repeat(64) },
};

describe('artifact manifest', () => {
  it('parses a valid plugin artifact manifest with defaults', () => {
    const m = parseArtifactManifest(base);
    expect(m.id).toBe('demo');
    expect(m.source).toBe('local-file');
    expect(m.dependencies).toEqual([]);
    expect(m.payload.kind).toBe('plugin');
  });
  it('rejects a bad version', () => {
    expect(() => parseArtifactManifest({ ...base, version: 'not-semver' })).toThrow();
  });
  it('rejects a bad publisher fingerprint', () => {
    expect(() => parseArtifactManifest({ ...base, publisher: { ...base.publisher, keyFingerprint: 'xyz' } })).toThrow();
  });
  it('parses form-template and report-template payloads', () => {
    expect(parseArtifactManifest({ ...base, type: 'form-template', payload: { kind: 'form-template', questionnaireSha256: 'c'.repeat(64) } }).type).toBe('form-template');
    expect(parseArtifactManifest({ ...base, type: 'report-template', payload: { kind: 'report-template', templateSha256: 'd'.repeat(64) } }).type).toBe('report-template');
  });
  it('adapts a legacy plugin manifest (no publisher/signature)', () => {
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    const a = pluginManifestToArtifact(legacy);
    expect(a.type).toBe('plugin');
    expect(a.publisher).toBeUndefined();
    expect(a.signature).toBeUndefined();
    expect(a.payload).toMatchObject({ kind: 'plugin', wasmSha256: 'e'.repeat(64), entrypoint: 'convert' });
    expect(() => parseArtifactManifest(a)).not.toThrow();
  });

  // ── Regression for f48b571 ────────────────────────────────────────────────
  // A flat legacy manifest may declare `capabilities`. Before the fix,
  // pluginManifestToArtifact() dropped the field, so installs persisted an empty
  // emit-fhir grant and fail-closed rejected every emitted resource (e.g. whonet
  // ingestion broke with "Patient … is not permitted by its emit-fhir grant").
  it('carries a declared capabilities array through legacy→artifact normalization (regression: f48b571)', () => {
    const legacy = {
      id: 'whonet-sqlite', version: '0.1.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64),
      description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
      capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation'] }],
    };
    const a = pluginManifestToArtifact(legacy);
    expect(a.capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation'] }]);
    // The derived artifact must round-trip through the schema unchanged.
    expect(parseArtifactManifest(a).capabilities).toEqual(legacy.capabilities);
  });

  it('defaults capabilities to [] when a legacy manifest declares none (declare-or-denied)', () => {
    const legacy = { id: 'plain', version: '0.1.0', wasmSha256: 'e'.repeat(64) };
    // No field ⇒ schema default []. Note: a persisted [] is an ENFORCED empty grant
    // (fail-closed), NOT unrestricted — see packages/plugins runtime enforcement tests.
    expect(pluginManifestToArtifact(legacy).capabilities).toEqual([]);
  });

  it('defaults pluginKind to source and entrypoints to []', () => {
    const m = parseArtifactManifest(base);
    const p = m.payload as Extract<typeof m.payload, { kind: 'plugin' }>;
    expect(p.pluginKind).toBe('source');
    expect(p.entrypoints).toEqual([]);
  });
  it('parses a sink plugin payload carrying entrypoints', () => {
    const m = parseArtifactManifest({
      ...base,
      payload: { kind: 'plugin', pluginKind: 'sink', wasmSha256: 'b'.repeat(64), entrypoints: ['health_check', 'push_aggregate'] },
    });
    const p = m.payload as Extract<typeof m.payload, { kind: 'plugin' }>;
    expect(p.pluginKind).toBe('sink');
    expect(p.entrypoints).toEqual(['health_check', 'push_aggregate']);
  });
  it('carries kind + entrypoints through legacy->artifact normalization for a sink', () => {
    const legacy = {
      id: 'dhis2-sink', version: '0.1.0', kind: 'sink' as const, wasmSha256: 'e'.repeat(64),
      entrypoints: ['health_check', 'push_aggregate'],
      capabilities: [{ kind: 'net-egress', allowedHosts: [] as string[] }],
    };
    const a = pluginManifestToArtifact(legacy);
    const p = a.payload as Extract<typeof a.payload, { kind: 'plugin' }>;
    expect(p.pluginKind).toBe('sink');
    expect(p.entrypoints).toEqual(['health_check', 'push_aggregate']);
    expect(() => parseArtifactManifest(a)).not.toThrow();
  });

  it('carries readme through pluginManifestToArtifact and parse', () => {
    const art = pluginManifestToArtifact({
      id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64),
      description: 'x', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
      readme: '# Hello\n\nsetup steps',
    } as never);
    expect(art.readme).toBe('# Hello\n\nsetup steps');
    expect(parseArtifactManifest({ ...art }).readme).toBe('# Hello\n\nsetup steps');
  });
  it('defaults readme to empty string when absent', () => {
    const art = pluginManifestToArtifact({ id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'e'.repeat(64), wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } } as never);
    expect(art.readme).toBe('');
  });
});

const UI_SHA = 'a'.repeat(64);
const WASM_SHA = 'b'.repeat(64);

describe('manifest ui contribution', () => {
  it('parses a plugin payload carrying a ui block', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      compatibility: { ceVersion: '*' },
      payload: {
        kind: 'plugin', wasmSha256: WASM_SHA,
        ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo' } },
      },
    });
    if (m.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(m.payload.ui?.entry).toBe('ui.html');
    expect(m.payload.ui?.uiSdkVersion).toBe('1');      // default
    expect(m.payload.ui?.nav.icon).toBe('puzzle');     // default
    expect(m.payload.ui?.nav.section).toBe('apps');     // default
  });

  it('parses a ui block carrying requiredRoles (authz boundary)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM_SHA, ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo' }, requiredRoles: ['lab_admin'] } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(m.payload.ui?.requiredRoles).toEqual(['lab_admin']);
  });

  it('ui requiredRoles defaults to undefined when absent', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM_SHA, ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo' } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(m.payload.ui?.requiredRoles).toBeUndefined();
  });

  it('carries requiredRoles through pluginManifestToArtifact', () => {
    const a = pluginManifestToArtifact({
      id: 'demo', version: '1.0.0', wasmSha256: WASM_SHA,
      ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo' }, requiredRoles: ['lab_admin'] },
    });
    if (a.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(a.payload.ui?.requiredRoles).toEqual(['lab_admin']);
  });

  it('ui is optional (payload without it still parses)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      compatibility: { ceVersion: '*' }, payload: { kind: 'plugin', wasmSha256: WASM_SHA },
    });
    if (m.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(m.payload.ui).toBeUndefined();
  });

  it('carries a flat manifest ui block through pluginManifestToArtifact', () => {
    const a = pluginManifestToArtifact({
      id: 'demo', version: '1.0.0', wasmSha256: WASM_SHA,
      ui: { entry: 'ui.html', sha256: UI_SHA, nav: { label: 'Demo', icon: 'share-2', section: 'apps' } },
    });
    if (a.payload.kind !== 'plugin') throw new Error('expected plugin payload');
    expect(a.payload.ui?.nav.label).toBe('Demo');
    expect(a.payload.ui?.nav.icon).toBe('share-2');
    expect(a.payload.ui?.sha256).toBe(UI_SHA);
  });
});

describe('ui tiers', () => {
  const WASM = 'b'.repeat(64);
  it('allows a declarative-only ui block (no entry/sha256)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'cfg', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { nav: { label: 'Cfg' }, declarative: { type: 'object', properties: { url: { type: 'string' } } } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.entry).toBeUndefined();
    expect(m.payload.ui?.declarative).toBeDefined();
  });
  it('still allows a webview ui block (entry+sha256)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'web', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { entry: 'ui.html', sha256: 'a'.repeat(64), nav: { label: 'Web' } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.entry).toBe('ui.html');
  });
  it('rejects a ui block with entry but no sha256 (webview must carry both)', () => {
    expect(() => parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'bad', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { entry: 'ui.html', nav: { label: 'Bad' } } },
    })).toThrow();
  });
});

describe('artifact manifest workflowNodes', () => {
  const NODE = {
    id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
    ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'],
  };

  it('omits payload.workflowNodes when the legacy manifest has none (byte-identical)', () => {
    const a = pluginManifestToArtifact({ id: 'p', version: '1.0.0', wasmSha256: 'a'.repeat(64) });
    expect('workflowNodes' in (a.payload as Record<string, unknown>)).toBe(false);
  });

  it('carries workflowNodes through the legacy→artifact adapter', () => {
    const a = pluginManifestToArtifact({
      id: 'p', version: '1.0.0', wasmSha256: 'a'.repeat(64), kind: 'sink',
      entrypoints: ['wf_push_aggregate'], workflowNodes: [NODE],
    });
    const payload = a.payload as { workflowNodes?: unknown[] };
    expect(payload.workflowNodes).toHaveLength(1);
  });

  it('validates payload.workflowNodes on a full artifact manifest', () => {
    const a = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'p', version: '1.0.0',
      compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: 'a'.repeat(64), workflowNodes: [NODE] },
    });
    const payload = a.payload as { workflowNodes?: { id: string }[] };
    expect(payload.workflowNodes![0].id).toBe('aggregate-push');
  });
});

describe('content-pack artifact manifest', () => {
  const pack = { ...base, type: 'content-pack', payload: { kind: 'content-pack', packSha256: 'e'.repeat(64), steps: [{ kind: 'code-system', label: 'Colours', count: 1 }] } };
  it('parses a content-pack manifest', () => {
    const m = parseArtifactManifest(pack);
    expect(m.type).toBe('content-pack');
    expect(m.payload.kind).toBe('content-pack');
  });
  it('rejects a packSha256 that is not 64 hex', () => {
    expect(() => parseArtifactManifest({ ...pack, payload: { ...pack.payload, packSha256: 'abc' } })).toThrow();
  });

  describe('importSource', () => {
    const importing = {
      ...base,
      capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }, { kind: 'host:import' }],
      payload: {
        kind: 'plugin', pluginKind: 'sink', wasmSha256: 'b'.repeat(64),
        entrypoints: ['import_queries', 'import_checks', 'import_map'],
        importSource: { connectorTypes: ['microsoft-sql'], entrypoints: { queries: 'import_queries', checks: 'import_checks', map: 'import_map' } },
      },
    };
    it('leaves a manifest without it exactly as it was', () => {
      const m = parseArtifactManifest(base);
      expect(m.payload.kind === 'plugin' && 'importSource' in m.payload).toBe(false);
    });
    it('parses a plugin that can import', () => {
      const m = parseArtifactManifest(importing);
      expect(m.payload.kind === 'plugin' && m.payload.importSource?.connectorTypes).toEqual(['microsoft-sql']);
    });
    it('refuses it without the host:import capability', () => {
      expect(() => parseArtifactManifest({ ...importing, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] })).toThrow(/host:import/);
    });
    it('refuses an import entrypoint the plugin does not export', () => {
      expect(() => parseArtifactManifest({ ...importing, payload: { ...importing.payload, entrypoints: ['import_queries', 'import_checks'] } })).toThrow(/import_map/);
    });
    it('refuses an unknown connector type or an empty list', () => {
      const bad = (connectorTypes: unknown) => ({ ...importing, payload: { ...importing.payload, importSource: { ...importing.payload.importSource, connectorTypes } } });
      expect(() => parseArtifactManifest(bad(['oracle']))).toThrow();
      expect(() => parseArtifactManifest(bad(['mysql']))).toThrow();
      expect(() => parseArtifactManifest(bad([]))).toThrow();
    });
    it('refuses a copy entrypoint the plugin does not export', () => {
      const copying = { ...importing, payload: { ...importing.payload, importSource: { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'import_copy' } } } };
      expect(() => parseArtifactManifest(copying)).toThrow(/import_copy/);
      const exported = { ...copying, payload: { ...copying.payload, entrypoints: ['import_copy'] } };
      const m = parseArtifactManifest(exported);
      expect(m.payload.kind === 'plugin' && m.payload.importSource?.entrypoints).toEqual({ copy: 'import_copy' });
    });
    it('refuses a decode or twin-keys entrypoint the plugin does not export', () => {
      const checking = { ...importing, payload: { ...importing.payload, entrypoints: ['import_copy'], importSource: { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'import_copy', decode: 'import_decode', twinKeys: 'import_twin' } } } };
      expect(() => parseArtifactManifest(checking)).toThrow(/import_decode/);
      const noTwin = { ...checking, payload: { ...checking.payload, entrypoints: ['import_copy', 'import_decode'] } };
      expect(() => parseArtifactManifest(noTwin)).toThrow(/import_twin/);
      const all = { ...checking, payload: { ...checking.payload, entrypoints: ['import_copy', 'import_decode', 'import_twin'] } };
      const m = parseArtifactManifest(all);
      expect(m.payload.kind === 'plugin' && m.payload.importSource?.entrypoints).toEqual({ copy: 'import_copy', decode: 'import_decode', twinKeys: 'import_twin' });
    });
  });
});

// Layer: the zod schema and two pure helpers. No database, no plugin.
describe('import source entrypoints', () => {
  const base: ImportSource = { connectorTypes: ['microsoft-sql'], entrypoints: { queries: 'q', map: 'm' } };

  it('an import source with no new field parses to the same object', () => {
    expect(importSourceSchema.parse(base)).toEqual(base);
  });
  it('takes a copy entrypoint beside queries and map', () => {
    const src: ImportSource = { ...base, entrypoints: { ...base.entrypoints, copy: 'import_copy' } };
    expect(importSourceSchema.parse(src)).toEqual(src);
    expect([canImportOnePass(src), canCopy(src)]).toEqual([true, true]);
  });
  it('takes a copy entrypoint alone', () => {
    const src: ImportSource = { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'import_copy' } };
    expect(importSourceSchema.parse(src)).toEqual(src);
    expect([canImportOnePass(src), canCopy(src)]).toEqual([false, true]);
  });
  it('a source with queries and map and no copy cannot be copied from', () => {
    expect([canImportOnePass(base), canCopy(base)]).toEqual([true, false]);
  });
  it('refuses queries without map, map without queries, and no entrypoint at all', () => {
    const types = ['microsoft-sql'];
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { queries: 'q' } })).toThrow(/queries and map/);
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { map: 'm' } })).toThrow(/queries and map/);
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { queries: 'q', copy: 'c' } })).toThrow(/queries and map/);
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: {} })).toThrow(/queries and map, or copy/);
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { checks: 'k' } })).toThrow(/queries and map, or copy/);
  });
  it('takes decode with copy, and twinKeys with decode', () => {
    const decoding: ImportSource = { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'c', decode: 'd' } };
    expect(importSourceSchema.parse(decoding)).toEqual(decoding);
    expect(canCheck(decoding)).toBe(true);
    const twinned: ImportSource = { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'c', decode: 'd', twinKeys: 't' } };
    expect(importSourceSchema.parse(twinned)).toEqual(twinned);
    expect(canCheck(twinned)).toBe(true);
    const withQueries: ImportSource = { ...base, entrypoints: { ...base.entrypoints, copy: 'c', decode: 'd' } };
    expect(importSourceSchema.parse(withQueries)).toEqual(withQueries);
  });
  it('canCheck is false without copy or without decode', () => {
    expect(canCheck({ connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'c' } })).toBe(false);
    expect(canCheck(base)).toBe(false);
    // Built past the schema on purpose: canCheck must still need both names.
    expect(canCheck({ connectorTypes: ['microsoft-sql'], entrypoints: { queries: 'q', map: 'm', decode: 'd' } })).toBe(false);
  });
  it('refuses twinKeys without decode', () => {
    const types = ['microsoft-sql'];
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { copy: 'c', twinKeys: 't' } })).toThrow(/twinKeys needs decode/);
  });
  it('refuses choices without decode, and keeps a choices name with decode (demo.4 item 11)', () => {
    const types = ['microsoft-sql'];
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { copy: 'c', choices: 'h' } })).toThrow(/choices needs decode/);
    const ok = { connectorTypes: types, entrypoints: { copy: 'c', decode: 'd', choices: 'h' } };
    expect(importSourceSchema.parse(ok)).toEqual(ok);
  });
  it('refuses decode without copy', () => {
    const types = ['microsoft-sql'];
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { queries: 'q', map: 'm', decode: 'd' } })).toThrow(/decode needs copy/);
  });
  it('an entrypoint name must not be empty', () => {
    const types = ['microsoft-sql'];
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { copy: 'c', decode: '' } })).toThrow();
    expect(() => importSourceSchema.parse({ connectorTypes: types, entrypoints: { copy: 'c', decode: 'd', twinKeys: '' } })).toThrow();
  });
});

describe('ui sites', () => {
  const WASM = 'b'.repeat(64);
  const withUi = (ui: Record<string, unknown>) => ({
    schemaVersion: 1, type: 'plugin', id: 'sited', version: '1.0.0', compatibility: { ceVersion: '*' },
    payload: { kind: 'plugin', wasmSha256: WASM, ui },
  });
  const web = { entry: 'ui.html', sha256: 'a'.repeat(64), nav: { label: 'Web' } };

  it('a ui block without sites has no sites key (existing bundles unchanged)', () => {
    const m = parseArtifactManifest(withUi(web));
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui && 'sites' in m.payload.ui).toBe(false);
  });
  it('parses a widget and a panel; widget height defaults to medium', () => {
    const m = parseArtifactManifest(withUi({ ...web, sites: { widget: { title: 'Today' }, panel: { title: 'Notes' } } }));
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.sites).toEqual({ widget: { title: 'Today', height: 'medium' }, panel: { title: 'Notes' } });
  });
  it('rejects sites on a declarative-only ui (sites need the webview page)', () => {
    expect(() => parseArtifactManifest(withUi({ nav: { label: 'Cfg' }, declarative: { type: 'object' }, sites: { panel: { title: 'P' } } }))).toThrow();
  });
  it('rejects an unknown site', () => {
    expect(() => parseArtifactManifest(withUi({ ...web, sites: { toast: { title: 'T' } } }))).toThrow();
  });
  it('rejects a bad widget height', () => {
    expect(() => parseArtifactManifest(withUi({ ...web, sites: { widget: { title: 'T', height: 'huge' } } }))).toThrow();
  });
});

// Layer: the zod schema in parseArtifactManifest. No database, no DDL.
describe('declared tables', () => {
  const table = {
    name: 'lab_orders',
    columns: [
      { name: 'id', type: 'uuid' },
      { name: 'facility_id', type: 'text' },
      { name: 'status', type: 'text', nullable: false, default: 'new' },
      { name: 'details', type: 'jsonb', nullable: true },
    ],
    primaryKey: ['id'],
    indexes: [{ columns: ['facility_id', 'status'] }, { columns: ['status'], unique: false }],
    facilityColumn: 'facility_id',
  };
  const withTables = (tables: unknown, capabilities: unknown[] = [{ kind: 'host:db' }]) => ({
    ...base, capabilities, payload: { ...base.payload, tables },
  });

  it('parses a manifest with tables and host:db', () => {
    const m = parseArtifactManifest(withTables([table]));
    expect(m.payload.kind === 'plugin' && m.payload.tables).toEqual([table]);
  });
  it('refuses tables without host:db', () => {
    expect(() => parseArtifactManifest(withTables([table], [{ kind: 'host:ce-read' }]))).toThrow(/host:db/);
  });
  it('refuses a bad table or column name', () => {
    for (const name of ['Orders', '1orders', 'orders;drop', 'a'.repeat(64), '']) {
      expect(() => parseArtifactManifest(withTables([{ ...table, name }])), name).toThrow();
      expect(() => parseArtifactManifest(withTables([{ ...table, columns: [...table.columns, { name, type: 'text' }] }])), name).toThrow();
    }
  });
  it('refuses the two columns CE manages', () => {
    for (const name of ['created_at', 'updated_at']) {
      expect(() => parseArtifactManifest(withTables([{ ...table, columns: [...table.columns, { name, type: 'timestamptz' }] }]))).toThrow(/added by CE/);
    }
  });
  it('refuses an unknown column type', () => {
    for (const type of ['varchar', 'serial', 'text[]', 'TEXT']) {
      expect(() => parseArtifactManifest(withTables([{ ...table, columns: [{ name: 'id', type }] }])), type).toThrow();
    }
  });
  it('refuses a primary key, index or facility column that is not a declared column', () => {
    expect(() => parseArtifactManifest(withTables([{ ...table, primaryKey: ['nope'] }]))).toThrow(/primary key column 'nope'/);
    expect(() => parseArtifactManifest(withTables([{ ...table, primaryKey: [] }]))).toThrow();
    expect(() => parseArtifactManifest(withTables([{ ...table, indexes: [{ columns: ['nope'] }] }]))).toThrow(/index column 'nope'/);
    expect(() => parseArtifactManifest(withTables([{ ...table, facilityColumn: 'nope' }]))).toThrow(/facility column 'nope'/);
  });
  it('refuses a facility column that is not text or uuid', () => {
    const t = { ...table, columns: [...table.columns, { name: 'site', type: 'integer' }], facilityColumn: 'site' };
    expect(() => parseArtifactManifest(withTables([t]))).toThrow(/text or uuid/);
  });
  it('refuses a table or column declared twice', () => {
    expect(() => parseArtifactManifest(withTables([table, table]))).toThrow(/declared twice/);
    expect(() => parseArtifactManifest(withTables([{ ...table, columns: [...table.columns, { name: 'id', type: 'text' }] }]))).toThrow(/declared twice/);
  });
  it('refuses more than 50 tables or 100 columns, and unknown keys', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...table, name: `t${i}` }));
    expect(() => parseArtifactManifest(withTables(many))).toThrow();
    expect(() => parseArtifactManifest(withTables(many.slice(0, 50)))).not.toThrow();
    const cols = Array.from({ length: 101 }, (_, i) => ({ name: `c${i}`, type: 'text' }));
    expect(() => parseArtifactManifest(withTables([{ name: 'wide', columns: cols, primaryKey: ['c0'] }]))).toThrow();
    expect(() => parseArtifactManifest(withTables([{ ...table, sql: 'drop table x' }]))).toThrow();
    expect(() => parseArtifactManifest(withTables([{ ...table, columns: [{ name: 'id', type: 'uuid', check: 'true' }] }]))).toThrow();
  });
  it('a manifest with no tables parses to the same object, with no tables key', () => {
    const m = parseArtifactManifest(base);
    expect(m.payload.kind === 'plugin' && 'tables' in m.payload).toBe(false);
    expect(parseArtifactManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
});
