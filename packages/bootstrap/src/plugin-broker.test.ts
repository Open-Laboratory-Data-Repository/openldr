import { describe, it, expect, vi } from 'vitest';
import { currentInFlight } from '@openldr/core';
import { createImportCheckHeldStore, createImportCopyStore, createPluginDataStore } from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { createPluginRequests, createPluginSchemas, type TableShape } from '@openldr/db';
import { createPluginStore, createWasmSink, parseManifest } from '@openldr/plugins';
import { PG_MEM_WITHOUT_RLS } from '../../db/src/plugin-schema';
import { checkForPage, createPluginBroker, buildBrokerOpSchema, type PluginBrokerDeps } from './plugin-broker';
import { createPluginHost } from './plugin-host';
import { facilityIdsInScope, type ScopeRegistryRow } from './data-scope';
import { CopySetChangedError, copySetHashes, copySpecSchema, createImportCopyService } from './import-copy';
import { checkIdOf, createImportCheckService } from './import-check';

const ALL_DATA = { limited: false as const };

function memData() {
  const m = new Map<string, unknown>();
  const k = (p: string, c: string, key: string) => `${p} ${c} ${key}`;
  return {
    store: {
      async get(p: string, c: string, key: string) { return m.has(k(p, c, key)) ? m.get(k(p, c, key)) : null; },
      async put(p: string, c: string, key: string, doc: unknown) { m.set(k(p, c, key), doc); },
      async delete(p: string, c: string, key: string) { m.delete(k(p, c, key)); },
      async list(p: string, c: string) { return [...m.entries()].filter(([kk]) => kk.startsWith(`${p} ${c} `)).map(([kk, doc]) => ({ collection: c, key: kk.split(' ')[2], doc, updatedAt: new Date(0) })); },
      async purge(p: string) { for (const kk of [...m.keys()]) if (kk.startsWith(`${p} `)) m.delete(kk); },
    },
  };
}

const defaultReporting = () => ({ list: async () => [], columns: async () => [], run: async () => ({ columns: [], rows: [], meta: {} }), eventSources: () => [] });

function broker(opts: {
  caps: unknown[] | undefined;
  uiEnabled?: boolean;
  egressEnabled?: boolean;
  reporting?: any;
  connectors?: any;
  loadSink?: any;
  testConnector?: any;
  connectorMetadata?: any;
  connectorPush?: any;
  connectorValidate?: any;
  facilities?: any;
  schedules?: any;
  requiredRoles?: string[];
  requiredCapabilities?: string[];
  maxDocBytes?: number;
  imports?: any;
  copies?: any;
  checks?: any;
  diagnoseConnector?: any;
  /** The connectors switched on for p1. By default the ones these tests name. */
  allowedConnectors?: string[];
}) {
  const data = memData();
  for (const id of opts.allowedConnectors ?? ['x', 'c1', 'c9']) void data.store.put('p1', '__import-allowed', id, { connectorId: id });
  const manifest: any = opts.caps === undefined ? {} : { capabilities: opts.caps };
  if (opts.requiredRoles || opts.requiredCapabilities) {
    manifest.payload = { ui: { ...(opts.requiredRoles ? { requiredRoles: opts.requiredRoles } : {}), ...(opts.requiredCapabilities ? { requiredCapabilities: opts.requiredCapabilities } : {}) } };
  }
  const row = { id: 'p1', version: '1.0.0', enabled: true, active: true, manifest };
  const audited: Array<{ pluginId: string; op: string; outcome: string; reason?: string }> = [];
  const logged: Array<{ obj: any; msg: string }> = [];
  const b = createPluginBroker({
    audit: async (e) => { audited.push({ pluginId: e.pluginId, op: e.op, outcome: e.outcome, reason: e.reason }); },
    plugins: { list: async () => [row], loadSink: opts.loadSink ?? (async () => undefined) } as any,
    pluginData: data.store as any,
    reporting: { ...defaultReporting(), ...(opts.reporting ?? {}) },
    connectors: opts.connectors ?? { list: async () => [], get: async () => null },
    testConnector: opts.testConnector,
    connectorMetadata: opts.connectorMetadata,
    connectorPush: opts.connectorPush,
    connectorValidate: opts.connectorValidate,
    facilities: opts.facilities,
    schedules: opts.schedules,
    imports: opts.imports,
    copies: opts.copies,
    jobInterruptions: (opts as any).jobInterruptions,
    checks: opts.checks,
    diagnoseConnector: opts.diagnoseConnector,
    maxDocBytes: opts.maxDocBytes,
    logger: { warn: (obj: unknown, msg: string) => { logged.push({ obj, msg }); } },
    policy: () => ({ uiEnabled: opts.uiEnabled ?? true, egressEnabled: opts.egressEnabled ?? true }),
  });
  return { b, data, audited, logged };
}

const principal = { id: 'u1', roles: ['lab_admin'], dataScope: ALL_DATA };

describe('plugin broker', () => {
  it('allows private storage with no capability and namespaces by the trusted pluginId', async () => {
    const { b } = broker({ caps: [] });
    const put = await b.handle('p1', principal, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } });
    expect(put.ok).toBe(true);
    const got = await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' });
    expect(got).toEqual({ ok: true, data: { n: 1 } });
  });

  it('denies reports.list without the host:reports capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:reports/);
  });

  it('allows reports.list with the host:reports capability', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { list: () => [{ id: 'r1', name: 'R1' }], run: async () => ({ columns: [], rows: [], meta: {} }) } });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 'r1', name: 'R1' }] });
  });

  it('refuses everything when policy.uiEnabled is false', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], uiEnabled: false });
    expect((await b.handle('p1', principal, { kind: 'reports.list' })).ok).toBe(false);
    expect((await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(false);
  });

  it('refuses calls for an unknown / not-installed plugin', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('ghost', principal, { kind: 'storage.get', collection: 'c', key: 'k' });
    expect(r.ok).toBe(false);
  });

  it('connectors.list is gated by host:connectors and returns the store list (masked)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [{ id: 'x', name: 'X', pluginId: 'dhis2-sink', enabled: true }], get: async () => null } });
    const r = await b.handle('p1', principal, { kind: 'connectors.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 'x', name: 'X', pluginId: 'dhis2-sink', enabled: true }] });
  });

  // Design 2026-11-26-plugin-connector-approval-and-results: a plugin uses only the connectors an
  // admin switched on for it.
  it('connectors.list answers only the connectors switched on for the plugin', async () => {
    const list = async () => [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list, get: async () => null }, allowedConnectors: ['y'] });
    expect(await b.handle('p1', principal, { kind: 'connectors.list' })).toEqual({ ok: true, data: [{ id: 'y', name: 'Y' }] });
  });

  it('refuses connectors.test, metadata, push and validate on a connector not switched on, before any dep runs', async () => {
    const testConnector = vi.fn(); const connectorMetadata = vi.fn(); const connectorPush = vi.fn(); const connectorValidate = vi.fn();
    const { b, audited } = broker({ caps: [{ kind: 'host:connectors' }], testConnector, connectorMetadata, connectorPush, connectorValidate, allowedConnectors: ['c1'] });
    for (const op of [
      { kind: 'connectors.test', id: 'c2' },
      { kind: 'connectors.metadata', id: 'c2' },
      { kind: 'connectors.push', connectorId: 'c2', mapping: {}, period: '2026', dryRun: true },
      { kind: 'connectors.validate', connectorId: 'c2', mapping: {} },
    ]) {
      const r = await b.handle('p1', principal, op);
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toContain('connector c2 is not allowed for plugin p1');
    }
    for (const dep of [testConnector, connectorMetadata, connectorPush, connectorValidate]) expect(dep).not.toHaveBeenCalled();
    expect(audited.filter((a) => a.outcome === 'denied')).toHaveLength(4);
  });

  it('invoke calls the plugin own wasm (no host capability) and returns its output', async () => {
    const { b } = broker({ caps: [], loadSink: async () => ({ invoke: async (_e: string, input: unknown) => ({ echoed: input }) }) });
    const r = await b.handle('p1', principal, { kind: 'invoke', entrypoint: 'echo', input: { hi: 1 } });
    expect(r).toEqual({ ok: true, data: { echoed: { hi: 1 } } });
  });

  it('marks an invoke op in-flight (pluginId + op + entrypoint) while the wasm dispatches', async () => {
    let seen: ReturnType<typeof currentInFlight> = [];
    const loadSink = async () => ({ invoke: async () => { seen = currentInFlight(); return { ok: true }; } });
    const { b } = broker({ caps: [], loadSink });
    await b.handle('p1', principal, { kind: 'invoke', entrypoint: 'do_it', input: {} });
    expect(seen.some((o) => o.pluginId === 'p1' && o.op === 'invoke' && o.entrypoint === 'do_it')).toBe(true);
    expect(currentInFlight().some((o) => o.pluginId === 'p1' && o.op === 'invoke')).toBe(false);
  });

  it('marks a connector egress op in-flight during dispatch and clears it after', async () => {
    let seen: ReturnType<typeof currentInFlight> = [];
    const connectorPush = async () => { seen = currentInFlight(); return { ok: true }; };
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorPush });
    await b.handle('p1', principal, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '202401', dryRun: true });
    expect(seen.some((o) => o.pluginId === 'p1' && o.op === 'connectors.push')).toBe(true);
    expect(currentInFlight().some((o) => o.pluginId === 'p1' && o.op === 'connectors.push')).toBe(false);
  });

  it('clears the in-flight stamp even when the dispatched op throws', async () => {
    const connectorPush = async () => { throw new Error('egress blew up'); };
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorPush });
    const r = await b.handle('p1', principal, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '202401', dryRun: false });
    expect(r.ok).toBe(false); // host-op errors are redacted but still return a result
    expect(currentInFlight().some((o) => o.pluginId === 'p1' && o.op === 'connectors.push')).toBe(false);
  });

  it('legacy (capabilities===undefined) rows are grandfathered unrestricted', async () => {
    const { b } = broker({ caps: undefined, reporting: { list: () => [{ id: 'r1' }], run: async () => ({ columns: [], rows: [], meta: {} }) } });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r.ok).toBe(true);
  });

  it('denies a call for a disabled plugin', async () => {
    const data = memData();
    const b = createPluginBroker({
      plugins: { list: async () => [{ id: 'p1', version: '1', enabled: false, manifest: { capabilities: [] } }], loadSink: async () => undefined } as any,
      pluginData: data.store as any,
      reporting: { ...defaultReporting() },
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
    });
    expect((await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(false);
  });

  it('delegates connectors.test to the injected testConnector (gated by host:connectors)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], testConnector: async (id: string) => ({ ok: true, id }) });
    const r = await b.handle('p1', principal, { kind: 'connectors.test', id: 'c9' });
    expect(r).toEqual({ ok: true, data: { ok: true, id: 'c9' } });
  });

  it('never throws — a host-service that throws becomes ok:false', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { list: () => { throw new Error('boom'); }, run: async () => ({}) } });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/boom/);
  });

  it('denies connectors.list when the caller lacks lab_admin (role gate, even with the capability)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [{ id: 'x' }], get: async () => null } });
    const lowPriv = { id: 'u2', roles: ['data_analyst'], dataScope: ALL_DATA };
    const r = await b.handle('p1', lowPriv, { kind: 'connectors.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/lab_admin/);
  });

  it('allows connectors.list for lab_admin with the capability', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [{ id: 'x' }], get: async () => null } });
    const r = await b.handle('p1', { id: 'u', roles: ['lab_admin'], dataScope: ALL_DATA }, { kind: 'connectors.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 'x' }] });
  });

  it('storage/reports ops require no special role (data_analyst allowed)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { list: () => [{ id: 'r1' }], run: async () => ({}) } });
    const low = { id: 'u3', roles: ['data_analyst'], dataScope: ALL_DATA };
    expect((await b.handle('p1', low, { kind: 'storage.put', collection: 'c', key: 'k', doc: {} })).ok).toBe(true);
    expect((await b.handle('p1', low, { kind: 'reports.list' })).ok).toBe(true);
  });

  it('denies fhir.facilities without the host:fhir capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'fhir.facilities' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:fhir/);
  });

  it('denies schedule.list without the host:schedule capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'schedule.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:schedule/);
  });

  it('denies connectors.metadata/push/validate without the host:connectors capability', async () => {
    const { b } = broker({ caps: [] });
    expect((await b.handle('p1', principal, { kind: 'connectors.metadata', id: 'c1' })).ok).toBe(false);
    expect((await b.handle('p1', principal, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '2026', dryRun: true })).ok).toBe(false);
    expect((await b.handle('p1', principal, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} })).ok).toBe(false);
  });

  it('denies reports.eventSources without the host:reports capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'reports.eventSources' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:reports/);
  });

  it('denies connectors.metadata/push/validate when the caller lacks lab_admin (role gate)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }] });
    const low = { id: 'u2', roles: ['data_analyst'], dataScope: ALL_DATA };
    expect((await b.handle('p1', low, { kind: 'connectors.metadata', id: 'c1' })).ok).toBe(false);
    const push = await b.handle('p1', low, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '2026', dryRun: true });
    expect(push.ok).toBe(false);
    expect((push as any).error).toMatch(/lab_admin/);
    expect((await b.handle('p1', low, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} })).ok).toBe(false);
  });

  it('denies schedule.register/list/remove when the caller lacks lab_admin (role gate)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:schedule' }] });
    const low = { id: 'u2', roles: ['data_analyst'], dataScope: ALL_DATA };
    expect((await b.handle('p1', low, { kind: 'schedule.register', schedule: {} })).ok).toBe(false);
    const list = await b.handle('p1', low, { kind: 'schedule.list' });
    expect(list.ok).toBe(false);
    expect((list as any).error).toMatch(/lab_admin/);
    expect((await b.handle('p1', low, { kind: 'schedule.remove', id: 's1' })).ok).toBe(false);
  });

  it('reports.eventSources returns the injected event-source catalog (gated by host:reports)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { eventSources: () => [{ id: 's1', name: 'S1' }] } });
    const r = await b.handle('p1', principal, { kind: 'reports.eventSources' });
    expect(r).toEqual({ ok: true, data: [{ id: 's1', name: 'S1' }] });
  });

  it('connectors.metadata delegates to connectorMetadata(id) for lab_admin with the capability', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorMetadata: async (id: string) => ({ dataElements: 3, id }) });
    const r = await b.handle('p1', principal, { kind: 'connectors.metadata', id: 'c9' });
    expect(r).toEqual({ ok: true, data: { dataElements: 3, id: 'c9' } });
  });

  it('connectors.metadata returns a structured error when no metadata dep is wired', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }] });
    const r = await b.handle('p1', principal, { kind: 'connectors.metadata', id: 'c9' });
    expect(r).toEqual({ ok: false, error: 'connectors.metadata unavailable' });
  });

  it('connectors.push delegates with the FULL input object', async () => {
    const seen: unknown[] = [];
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorPush: async (input: unknown) => { seen.push(input); return { kind: 'aggregate', dryRun: false }; } });
    const r = await b.handle('p1', principal, { kind: 'connectors.push', connectorId: 'c1', mapping: { id: 'm' }, orgUnitMap: { f: 'OU' }, period: '2026', dryRun: false });
    expect(r).toEqual({ ok: true, data: { kind: 'aggregate', dryRun: false } });
    expect(seen[0]).toEqual({ connectorId: 'c1', mapping: { id: 'm' }, orgUnitMap: { f: 'OU' }, period: '2026', dryRun: false });
  });

  it('connectors.validate delegates and returns the validator output', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorValidate: async () => ['bad dataElement'] });
    const r = await b.handle('p1', principal, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} });
    expect(r).toEqual({ ok: true, data: ['bad dataElement'] });
  });

  it('fhir.facilities returns the injected facilities list (gated by host:fhir)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:fhir' }], facilities: async () => [{ id: 'L1', name: 'Lab 1' }] });
    const r = await b.handle('p1', principal, { kind: 'fhir.facilities' });
    expect(r).toEqual({ ok: true, data: [{ id: 'L1', name: 'Lab 1' }] });
  });

  it('schedule.list passes the TRUSTED pluginId to the schedules dep', async () => {
    let seenPlugin: string | undefined;
    const { b } = broker({ caps: [{ kind: 'host:schedule' }], schedules: { register: async () => ({}), list: async (pid: string) => { seenPlugin = pid; return [{ id: 's1' }]; }, remove: async () => ({}) } });
    const r = await b.handle('p1', principal, { kind: 'schedule.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 's1' }] });
    expect(seenPlugin).toBe('p1');
  });

  it('schedule.list returns "schedule unavailable" when no schedules dep is wired', async () => {
    const { b } = broker({ caps: [{ kind: 'host:schedule' }] });
    const r = await b.handle('p1', principal, { kind: 'schedule.list' });
    expect(r).toEqual({ ok: false, error: 'schedule unavailable' });
  });

  it('redacts connectors.test error detail (no raw message to the plugin) and logs it', async () => {
    const { b } = broker({
      caps: [{ kind: 'host:connectors' }],
      testConnector: async () => { throw new Error('connect ECONNREFUSED https://dhis.example user=admin password=s3cr3t'); },
    });
    const r = await b.handle('p1', { id: 'u', roles: ['lab_admin'], dataScope: ALL_DATA }, { kind: 'connectors.test', id: 'c1' });
    expect(r.ok).toBe(false);
    expect((r as any).error).not.toMatch(/s3cr3t/);
    expect((r as any).error).toMatch(/connectors\.test failed/);
  });

  it('tags a redacted host-op error with a correlation id present in BOTH the plugin error and the server log', async () => {
    const { b, logged } = broker({
      caps: [{ kind: 'host:connectors' }],
      connectorPush: async () => { throw new Error('boom ECONNREFUSED password=s3cr3t'); },
    });
    const r = await b.handle('p1', { id: 'u', roles: ['lab_admin'], dataScope: ALL_DATA },
      { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '202601', dryRun: true });
    expect(r.ok).toBe(false);
    // The plugin-facing message carries a ref but no secret detail.
    const m = (r as any).error.match(/operation connectors\.push failed \(ref: ([0-9a-f]+)\)/);
    expect(m).not.toBeNull();
    expect((r as any).error).not.toMatch(/s3cr3t/);
    // The same ref is on the server-side log line (alongside the full detail) so an operator can grep it.
    const entry = logged.find((l) => l.msg === 'plugin broker host op failed');
    expect(entry).toBeDefined();
    expect((entry!.obj as any).correlationId).toBe(m![1]);
    expect((entry!.obj as any).detail).toMatch(/s3cr3t/); // server log keeps the real detail
  });

  // ── SEC-03: plugin-level required-roles gate (applies to ALL ops incl. storage.*/invoke) ──
  describe('plugin required-roles gate (SEC-03)', () => {
    const tech = { id: 'u-tech', roles: ['lab_technician'], dataScope: ALL_DATA };
    const admin = { id: 'u-admin', roles: ['lab_admin'], dataScope: ALL_DATA };

    it('DENIES storage.list/get/put/invoke for a caller lacking the plugin required role', async () => {
      const { b } = broker({ caps: [], requiredRoles: ['lab_admin'], loadSink: async () => ({ invoke: async () => ({}) }) });
      for (const op of [
        { kind: 'storage.list', collection: 'c' },
        { kind: 'storage.get', collection: 'c', key: 'k' },
        { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } },
        { kind: 'invoke', entrypoint: 'e', input: {} },
      ] as const) {
        const r = await b.handle('p1', tech, op);
        expect(r.ok).toBe(false);
        expect((r as any).error).toMatch(/requires one of roles: lab_admin/);
      }
    });

    it('ALLOWS the same ops for a caller holding the plugin required role', async () => {
      const { b } = broker({ caps: [], requiredRoles: ['lab_admin'], loadSink: async () => ({ invoke: async (_e: string, input: unknown) => ({ echoed: input }) }) });
      expect((await b.handle('p1', admin, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'storage.list', collection: 'c' })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'invoke', entrypoint: 'e', input: { hi: 1 } })).ok).toBe(true);
    });

    it('a refusal names the permissions when the plugin lists capabilities only, and never an empty role list', async () => {
      const { b } = broker({ caps: [], requiredCapabilities: ['patients.view'], loadSink: async () => ({ invoke: async () => ({}) }) });
      const r = await b.handle('p1', tech, { kind: 'storage.list', collection: 'c' });
      expect(r.ok).toBe(false);
      expect((r as any).error).not.toMatch(/roles: *$/);
      expect((r as any).error).toMatch(/needs one of these permissions: View patient index/);
    });

    it('a refusal names both lists when the plugin lists roles and capabilities', async () => {
      const { b } = broker({ caps: [], requiredRoles: ['lab_admin'], requiredCapabilities: ['patients.view'], loadSink: async () => ({ invoke: async () => ({}) }) });
      const r = await b.handle('p1', tech, { kind: 'storage.list', collection: 'c' });
      expect((r as any).error).toMatch(/requires one of roles: lab_admin, or one of these permissions: View patient index/);
    });

    it('a plugin with NO requiredRoles leaves storage.* open to any authed caller (unchanged)', async () => {
      const { b } = broker({ caps: [] });
      expect((await b.handle('p1', tech, { kind: 'storage.put', collection: 'c', key: 'k', doc: {} })).ok).toBe(true);
      expect((await b.handle('p1', tech, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(true);
    });
  });

  // ── SEC-04: egress kill-switch covers connector ops (gated to host:connectors, not net-egress) ──
  describe('egress kill-switch (SEC-04)', () => {
    const admin = { id: 'u-admin', roles: ['lab_admin'], dataScope: ALL_DATA };

    it('DENIES every egressing connector op with the kill-switch error and does NOT reach the dep', async () => {
      const calls: string[] = [];
      const { b } = broker({
        caps: [{ kind: 'host:connectors' }],
        egressEnabled: false,
        testConnector: async () => { calls.push('test'); return {}; },
        connectorMetadata: async () => { calls.push('metadata'); return {}; },
        connectorPush: async () => { calls.push('push'); return {}; },
        connectorValidate: async () => { calls.push('validate'); return {}; },
      });
      const ops = [
        { kind: 'connectors.test', id: 'c1' },
        { kind: 'connectors.metadata', id: 'c1' },
        { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '2026', dryRun: false },
        { kind: 'connectors.validate', connectorId: 'c1', mapping: {} },
      ] as const;
      for (const op of ops) {
        const r = await b.handle('p1', admin, op);
        expect(r.ok).toBe(false);
        expect((r as any).error).toMatch(/egress kill-switch/);
      }
      // No egressing dep was reached — denial happens before dispatch.
      expect(calls).toEqual([]);
    });

    it('STILL ALLOWS connectors.list with egressEnabled:false (DB-only, no egress)', async () => {
      const { b } = broker({
        caps: [{ kind: 'host:connectors' }],
        egressEnabled: false,
        connectors: { list: async () => [{ id: 'x' }], get: async () => null },
      });
      const r = await b.handle('p1', admin, { kind: 'connectors.list' });
      expect(r).toEqual({ ok: true, data: [{ id: 'x' }] });
    });

    it('with egressEnabled:true the egressing ops dispatch normally (reach their dep)', async () => {
      const calls: string[] = [];
      const { b } = broker({
        caps: [{ kind: 'host:connectors' }],
        egressEnabled: true,
        testConnector: async (id: string) => { calls.push('test'); return { id }; },
        connectorMetadata: async (id: string) => { calls.push('metadata'); return { id }; },
        connectorPush: async () => { calls.push('push'); return { pushed: true }; },
        connectorValidate: async () => { calls.push('validate'); return []; },
      });
      expect((await b.handle('p1', admin, { kind: 'connectors.test', id: 'c1' })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'connectors.metadata', id: 'c1' })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '2026', dryRun: false })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} })).ok).toBe(true);
      expect(calls).toEqual(['test', 'metadata', 'push', 'validate']);
    });
  });

  // ── SEC-12: op schema + size bounds ──
  describe('broker op schema + bounds (SEC-12)', () => {
    it('returns a structured invalid-operation error for an unknown kind', async () => {
      const { b } = broker({ caps: [] });
      const r = await b.handle('p1', principal, { kind: 'storage.nuke' } as any);
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/invalid operation/);
    });

    it('rejects an over-long collection / key', async () => {
      const { b } = broker({ caps: [] });
      const long = 'x'.repeat(300);
      expect((await b.handle('p1', principal, { kind: 'storage.get', collection: long, key: 'k' } as any)).ok).toBe(false);
      expect((await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: long } as any)).ok).toBe(false);
    });

    it('rejects a storage.put doc just over the configured byte cap', async () => {
      const cap = 1024;
      const { b } = broker({ caps: [], maxDocBytes: cap });
      const big = { blob: 'a'.repeat(cap + 100) };
      const r = await b.handle('p1', principal, { kind: 'storage.put', collection: 'c', key: 'k', doc: big });
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/invalid operation/);
    });

    it('accepts a doc within the cap', async () => {
      const { b } = broker({ caps: [], maxDocBytes: 1024 });
      expect((await b.handle('p1', principal, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } })).ok).toBe(true);
    });

    it('rejects a reports.run params object just over the configured byte cap', async () => {
      const cap = 1024;
      const { b } = broker({ caps: [{ kind: 'host:reports' }], maxDocBytes: cap });
      const bigParams = { blob: 'a'.repeat(cap + 100) };
      const r = await b.handle('p1', principal, { kind: 'reports.run', id: 'r1', params: bigParams } as any);
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/invalid operation/);
    });

    it('accepts a reports.run params object within the cap', async () => {
      const { b } = broker({ caps: [{ kind: 'host:reports' }], maxDocBytes: 1024 });
      const r = await b.handle('p1', principal, { kind: 'reports.run', id: 'r1', params: { from: '2026-01-01' } });
      expect(r.ok).toBe(true);
    });

    it('rejects an out-of-range storage.list limit', async () => {
      const { b } = broker({ caps: [] });
      expect((await b.handle('p1', principal, { kind: 'storage.list', collection: 'c', limit: 5000 } as any)).ok).toBe(false);
      expect((await b.handle('p1', principal, { kind: 'storage.list', collection: 'c', limit: 0 } as any)).ok).toBe(false);
    });

    it('buildBrokerOpSchema accepts a valid op and rejects a malformed one', () => {
      const schema = buildBrokerOpSchema(1024);
      expect(schema.safeParse({ kind: 'storage.get', collection: 'c', key: 'k' }).success).toBe(true);
      expect(schema.safeParse({ kind: 'bogus' }).success).toBe(false);
    });
  });

  describe('audit trail', () => {
    it('records a capability denial with the reason', async () => {
      const { b, audited } = broker({ caps: [] }); // no host:reports capability
      await b.handle('p1', principal, { kind: 'reports.list' });
      expect(audited).toHaveLength(1);
      expect(audited[0]).toMatchObject({ pluginId: 'p1', op: 'reports.list', outcome: 'denied' });
      expect(audited[0].reason).toMatch(/host:reports capability/);
    });

    it('records a role-gate denial', async () => {
      const { b, audited } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [], get: async () => null } });
      await b.handle('p1', { id: 'u2', roles: ['data_analyst'], dataScope: ALL_DATA }, { kind: 'connectors.list' });
      expect(audited[0]).toMatchObject({ op: 'connectors.list', outcome: 'denied' });
    });

    it('records a malformed op as a denial', async () => {
      const { b, audited } = broker({ caps: [] });
      await b.handle('p1', principal, { kind: 'bogus' } as any);
      expect(audited[0]).toMatchObject({ op: '(unparsed)', outcome: 'denied' });
    });

    it('records a completed sensitive op (live connector test) as outcome ok', async () => {
      const { b, audited } = broker({ caps: [{ kind: 'host:connectors' }], testConnector: async () => ({ ok: true }) });
      const r = await b.handle('p1', principal, { kind: 'connectors.test', id: 'c1' });
      expect(r.ok).toBe(true);
      expect(audited[0]).toMatchObject({ op: 'connectors.test:c1', outcome: 'ok' });
    });

    it('does NOT audit high-frequency reads (storage.get)', async () => {
      const { b, audited } = broker({ caps: [] });
      await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' });
      expect(audited).toHaveLength(0);
    });
  });
});

describe('plugin broker: imports', () => {
  const admin = { id: 'u1', roles: ['lab_admin'], dataScope: ALL_DATA, username: 'amina' };
  const IMPORT_CAPS = [{ kind: 'host:import' }];
  function fakeImports() {
    const calls: Array<[string, unknown[]]> = [];
    const rec = (name: string, result: unknown) => async (...args: unknown[]) => { calls.push([name, args]); return result; };
    return {
      calls,
      api: {
        allowed: rec('allowed', ['c1']),
        checks: rec('checks', [{ id: 'requests', value: 7 }]),
        start: rec('start', { id: 'r1', status: 'running' }),
        get: rec('get', { id: 'r1', status: 'running' }),
        list: rec('list', []),
        failures: rec('failures', []),
        stop: rec('stop', { id: 'r1', status: 'stopping' }),
        resume: rec('resume', { id: 'r1', status: 'running' }),
      },
    };
  }

  it('keeps host-owned collections out of reach of plugin storage ops', async () => {
    const { b, data } = broker({ caps: [] });
    await data.store.put('p1', '__import-allowed', 'c1', { connectorId: 'c1' });
    for (const op of [
      { kind: 'storage.get', collection: '__import-allowed', key: 'c1' },
      { kind: 'storage.put', collection: '__import-runs', key: 'r1', doc: { status: 'completed' } },
      { kind: 'storage.delete', collection: '__import-allowed', key: 'c1' },
      { kind: 'storage.list', collection: '__import-failures' },
    ]) {
      const res = await b.handle('p1', admin, op);
      expect(res).toEqual({ ok: false, error: expect.stringMatching(/reserved/) });
    }
    expect(await data.store.get('p1', '__import-allowed', 'c1')).toEqual({ connectorId: 'c1' });
    expect(await data.store.get('p1', '__import-runs', 'r1')).toBeNull();
  });

  it('refuses import ops without the host:import capability or the lab_admin role', async () => {
    const imports = fakeImports();
    const noCap = broker({ caps: [], imports: imports.api });
    expect(await noCap.b.handle('p1', admin, { kind: 'import.list' })).toEqual({ ok: false, error: expect.stringMatching(/host:import/) });
    const withCap = broker({ caps: IMPORT_CAPS, imports: imports.api });
    expect(await withCap.b.handle('p1', { id: 'u2', roles: ['lab_tech'], dataScope: ALL_DATA }, { kind: 'import.list' })).toEqual({ ok: false, error: expect.stringMatching(/lab_admin/) });
    expect(imports.calls).toEqual([]);
  });

  it('starts an import as the signed-in user, and a plugin page cannot pass SQL', async () => {
    const imports = fakeImports();
    const { b } = broker({ caps: IMPORT_CAPS, imports: imports.api });
    const res = await b.handle('p1', admin, {
      kind: 'import.start', connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, limit: 1000, dryRun: true,
      sql: 'SELECT * FROM secrets', keyQuery: { sql: 'SELECT 1' },
    });
    expect(res).toEqual({ ok: true, data: { id: 'r1', status: 'running' } });
    expect(imports.calls).toEqual([['start', [{
      pluginId: 'p1', connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, limit: 1000, dryRun: true,
      actor: { type: 'user', id: 'u1', name: 'amina' },
    }]]]);
  });

  it('passes the other import ops through, always for the calling plugin', async () => {
    const imports = fakeImports();
    const { b } = broker({ caps: IMPORT_CAPS, imports: imports.api, connectors: { list: async () => [], get: async (id: string) => ({ id, name: 'v1 (Moz)', type: 'microsoft-sql', enabled: true }) } });
    const actor = { type: 'user', id: 'u1', name: 'amina' };
    expect(await b.handle('p1', admin, { kind: 'import.allowed' })).toEqual({ ok: true, data: [{ id: 'c1', name: 'v1 (Moz)', type: 'microsoft-sql' }] });
    await b.handle('p1', admin, { kind: 'import.checks', connectorId: 'c1', options: {} });
    await b.handle('p1', admin, { kind: 'import.status', runId: 'r1' });
    await b.handle('p1', admin, { kind: 'import.list' });
    await b.handle('p1', admin, { kind: 'import.failures', runId: 'r1' });
    await b.handle('p1', admin, { kind: 'import.stop', runId: 'r1' });
    await b.handle('p1', admin, { kind: 'import.resume', runId: 'r1' });
    expect(imports.calls).toEqual([
      ['allowed', ['p1']],
      ['checks', [{ pluginId: 'p1', connectorId: 'c1', options: {} }]],
      ['get', ['p1', 'r1']],
      ['list', ['p1']],
      ['failures', ['p1', 'r1']],
      ['stop', ['p1', 'r1', actor]],
      ['resume', ['p1', 'r1', actor]],
    ]);
  });

  it('diagnoses only a connector the admin allowed for this plugin', async () => {
    const imports = fakeImports();
    const diagnosed: string[] = [];
    const { b } = broker({ caps: IMPORT_CAPS, imports: imports.api, diagnoseConnector: async (id: string) => { diagnosed.push(id); return { ok: true, steps: [] }; } });
    expect(await b.handle('p1', admin, { kind: 'import.diagnose', connectorId: 'other' })).toEqual({ ok: false, error: expect.stringMatching(/not allowed/) });
    expect(await b.handle('p1', admin, { kind: 'import.diagnose', connectorId: 'c1' })).toEqual({ ok: true, data: { ok: true, steps: [] } });
    expect(diagnosed).toEqual(['c1']);
  });

  it('says so when imports are not wired', async () => {
    const { b } = broker({ caps: IMPORT_CAPS });
    expect(await b.handle('p1', admin, { kind: 'import.list' })).toEqual({ ok: false, error: 'imports are unavailable' });
  });

  it('returns the reason when the import service refuses', async () => {
    const imports = fakeImports();
    imports.api.start = async () => { throw new Error('connector c9 is not allowed for plugin p1'); };
    const { b } = broker({ caps: IMPORT_CAPS, imports: imports.api });
    expect(await b.handle('p1', admin, { kind: 'import.start', connectorId: 'c9', options: {} })).toEqual({ ok: false, error: 'connector c9 is not allowed for plugin p1' });
  });
});

// Layer under test: the broker's copy ops over a faked copy service, and in one test the real copy
// service over the real plugin_data store on pg-mem. Not covered: a copy being driven, the CLI, or
// the route that hands the broker its principal.
describe('plugin broker: copies', () => {
  const admin = { id: 'u1', roles: ['lab_admin'], dataScope: ALL_DATA, username: 'amina' };
  const IMPORT_CAPS = [{ kind: 'host:import' }];
  const actor = { type: 'user', id: 'u1', name: 'amina' };
  // A source key. It sits in every set's cursor and must never reach the page.
  const SECRET_KEY = 'REQ-SECRET-0042';
  const DRIVER = 'proc-7f3a';
  const copyRun = (over: Record<string, unknown> = {}) => ({
    id: 'cp1', kind: 'copy', rev: 4, pluginId: 'p1', pluginVersion: '1.0.0', connectorId: 'c1', status: 'running',
    options: { tz: '+02:00' }, pageSize: 500,
    sets: {
      requests: { cursor: SECRET_KEY, keys: 500, rows: 1200, bytes: 34000, skipped: 1, done: false },
      facilities: { cursor: SECRET_KEY, keys: 12, rows: 12, bytes: 900, skipped: 0, done: true },
    },
    setOrder: ['requests', 'facilities'], setSql: { requests: 'a1', facilities: 'b2' }, waiting: null, driver: DRIVER,
    startedAt: '2026-11-15T08:00:00.000Z', updatedAt: '2026-11-15T08:01:00.000Z', finishedAt: null, lastError: null, startedBy: 'amina',
    ...over,
  });
  function fakeCopies() {
    const calls: Array<[string, unknown[]]> = [];
    const rec = (name: string, result: () => unknown) => async (...args: unknown[]) => { calls.push([name, args]); return result(); };
    return {
      calls,
      api: {
        start: rec('start', () => copyRun({ status: 'queued', driver: null })),
        get: rec('get', () => copyRun()),
        list: rec('list', () => [copyRun(), copyRun({ id: 'cp2', status: 'completed' })]),
        stop: rec('stop', () => copyRun({ status: 'stopping' })),
        remove: rec('remove', () => copyRun({ status: 'deleting', driver: null })),
      } as Record<string, (...args: unknown[]) => Promise<unknown>>,
    };
  }
  const ALL_OPS = [
    { kind: 'import.copy.start', connectorId: 'c1', options: {} },
    { kind: 'import.copy.list' },
    { kind: 'import.copy.status', copyId: 'cp1' },
    { kind: 'import.copy.stop', copyId: 'cp1' },
    { kind: 'import.copy.delete', copyId: 'cp1', confirm: true },
  ];

  it('import.copy.start passes the caller as the actor and the calling plugin as the plugin', async () => {
    const copies = fakeCopies();
    const { b } = broker({ caps: IMPORT_CAPS, copies: copies.api });
    const res = await b.handle('p1', admin, {
      kind: 'import.copy.start', connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, reread: true,
      pluginId: 'p2', sql: 'SELECT * FROM secrets',
    });
    expect(res).toMatchObject({ ok: true, data: { run: { id: 'cp1', status: 'queued' } } });
    expect(copies.calls).toEqual([['start', [{
      pluginId: 'p1', connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, reread: true, actor,
    }]]]);
  });

  it('a plugin without host:import is denied every copy op', async () => {
    const copies = fakeCopies();
    const noCap = broker({ caps: [], copies: copies.api });
    for (const op of ALL_OPS) {
      expect(await noCap.b.handle('p1', admin, op)).toEqual({ ok: false, error: expect.stringMatching(/host:import/) });
    }
    // The caller's role is the second gate, as for the import ops.
    const withCap = broker({ caps: IMPORT_CAPS, copies: copies.api });
    for (const op of ALL_OPS) {
      expect(await withCap.b.handle('p1', { id: 'u2', roles: ['lab_tech'], dataScope: ALL_DATA }, op)).toEqual({ ok: false, error: expect.stringMatching(/lab_admin/) });
    }
    expect(copies.calls).toEqual([]);
    expect(noCap.audited.map((e) => e.outcome)).toEqual(ALL_OPS.map(() => 'denied'));
  });

  it('import.copy.delete without confirm: true is refused by the schema', async () => {
    const copies = fakeCopies();
    const { b } = broker({ caps: IMPORT_CAPS, copies: copies.api });
    for (const confirm of [undefined, false, 'true', 1]) {
      const op = { kind: 'import.copy.delete', copyId: 'cp1', ...(confirm === undefined ? {} : { confirm }) };
      expect(await b.handle('p1', admin, op)).toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: confirm/) });
    }
    expect(copies.calls).toEqual([]);
    expect(await b.handle('p1', admin, { kind: 'import.copy.delete', copyId: 'cp1', confirm: true })).toMatchObject({ ok: true, data: { status: 'deleting' } });
    expect(copies.calls).toEqual([['remove', ['p1', 'cp1', actor]]]);
  });

  it('a changed set comes back as data that names the sets, so the page can ask', async () => {
    const copies = fakeCopies();
    copies.api.start = async () => { throw new CopySetChangedError(['requests', 'results']); };
    const { b } = broker({ caps: IMPORT_CAPS, copies: copies.api });
    expect(await b.handle('p1', admin, { kind: 'import.copy.start', connectorId: 'c1', options: {} }))
      .toEqual({ ok: true, data: { changedSets: ['requests', 'results'] } });
    // Any other refusal is still a failure with its reason.
    copies.api.start = async () => { throw new Error('copy cp1 is being deleted'); };
    expect(await b.handle('p1', admin, { kind: 'import.copy.start', connectorId: 'c1', options: {} }))
      .toEqual({ ok: false, error: 'copy cp1 is being deleted' });
  });

  it('passes status, list and stop through for the calling plugin', async () => {
    const copies = fakeCopies();
    const { b } = broker({ caps: IMPORT_CAPS, copies: copies.api });
    await b.handle('p1', admin, { kind: 'import.copy.status', copyId: 'cp1', pluginId: 'p2' });
    await b.handle('p1', admin, { kind: 'import.copy.list', pluginId: 'p2' });
    await b.handle('p1', admin, { kind: 'import.copy.stop', copyId: 'cp1', pluginId: 'p2' });
    expect(copies.calls).toEqual([['get', ['p1', 'cp1']], ['list', ['p1']], ['stop', ['p1', 'cp1', actor]]]);
  });

  it('copy status and list carry each copy\'s interruptions (design 2026-11-18-interrupted-jobs)', async () => {
    const copies = fakeCopies();
    const cut = { id: 'i1', at: '2026-11-18T05:00:00.000Z', cause: 'server-restart', phase: null, resumedAt: '2026-11-18T05:02:00.000Z', resumedBy: 'self', continuedAs: null };
    const listFor = vi.fn(async (kind: string, ids: string[]) => new Map(ids.map((id) => [id, kind === 'cdr-run' ? [cut] : []])));
    const { b } = broker({ caps: IMPORT_CAPS, copies: copies.api, jobInterruptions: { listFor } } as never);
    const status = await b.handle('p1', admin, { kind: 'import.copy.status', copyId: 'cp1' }) as { ok: true; data: { interruptions: unknown[] } };
    expect(status.data.interruptions).toEqual([cut]);
    const list = await b.handle('p1', admin, { kind: 'import.copy.list' }) as { ok: true; data: Array<{ interruptions: unknown[] }> };
    expect(list.data.every((r) => r.interruptions.length === 1)).toBe(true);
  });

  it('no answer carries a set cursor or the driver', async () => {
    const copies = fakeCopies();
    const { b } = broker({ caps: IMPORT_CAPS, copies: copies.api });
    const answers = [];
    for (const op of ALL_OPS) answers.push(await b.handle('p1', admin, op));
    expect(answers.every((a) => a.ok)).toBe(true);
    for (const a of answers) {
      const text = JSON.stringify(a);
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(DRIVER);
      expect(text).not.toMatch(/"cursor"|"driver"/);
    }
    // Everything else the page needs is still there, sets in the plugin's order.
    const status = answers[2] as { ok: true; data: Record<string, unknown> };
    expect(status.data).toEqual({
      id: 'cp1', kind: 'copy', rev: 4, pluginId: 'p1', pluginVersion: '1.0.0', connectorId: 'c1', status: 'running',
      options: { tz: '+02:00' }, pageSize: 500,
      sets: {
        requests: { keys: 500, rows: 1200, bytes: 34000, skipped: 1, done: false },
        facilities: { keys: 12, rows: 12, bytes: 900, skipped: 0, done: true },
      },
      setOrder: ['requests', 'facilities'], setSql: { requests: 'a1', facilities: 'b2' }, waiting: null,
      startedAt: '2026-11-15T08:00:00.000Z', updatedAt: '2026-11-15T08:01:00.000Z', finishedAt: null, lastError: null, startedBy: 'amina',
    });
    expect(Object.keys((status.data.sets as object))).toEqual(['requests', 'facilities']);
    // A missing copy is null, not an error.
    copies.api.get = async () => null;
    expect(await b.handle('p1', admin, { kind: 'import.copy.status', copyId: 'nope' })).toEqual({ ok: true, data: null });
  });

  it('says so when copies are not wired', async () => {
    const { b } = broker({ caps: IMPORT_CAPS });
    expect(await b.handle('p1', admin, { kind: 'import.copy.list' })).toEqual({ ok: false, error: 'copies are unavailable' });
  });

  it('a plugin can only see and stop its own copies', async () => {
    // The real copy service over the real plugin_data store, with one copy for p1 and one for p2.
    const db = await makeMigratedDb();
    const pluginData = createPluginDataStore(db);
    const copies = createImportCopyService({
      plugins: { list: async () => [], loadSink: async () => undefined } as any,
      connectors: { get: async () => null, getDecryptedConfig: async () => ({}) } as any,
      secretsKey: 'k', pluginData, store: createImportCopyStore(db),
      audit: async () => {}, allowed: async () => [], driverId: 'test',
    });
    await pluginData.put('p1', '__import-copies', 'mine', copyRun({ id: 'mine', pluginId: 'p1' }));
    await pluginData.put('p2', '__import-copies', 'theirs', copyRun({ id: 'theirs', pluginId: 'p2' }));
    const { b } = broker({ caps: IMPORT_CAPS, copies });

    const list = await b.handle('p1', admin, { kind: 'import.copy.list' });
    expect(list.ok && (list.data as Array<{ id: string }>).map((r) => r.id)).toEqual(['mine']);
    expect(await b.handle('p1', admin, { kind: 'import.copy.status', copyId: 'theirs' })).toEqual({ ok: true, data: null });
    expect(await b.handle('p1', admin, { kind: 'import.copy.stop', copyId: 'theirs' })).toEqual({ ok: false, error: 'copy theirs not found' });
    expect(await b.handle('p1', admin, { kind: 'import.copy.delete', copyId: 'theirs', confirm: true })).toEqual({ ok: false, error: 'copy theirs not found' });
    expect(await pluginData.get('p2', '__import-copies', 'theirs')).toMatchObject({ status: 'running', rev: 4 });

    // Its own copy it can stop.
    expect(await b.handle('p1', admin, { kind: 'import.copy.stop', copyId: 'mine' })).toMatchObject({ ok: true, data: { id: 'mine', status: 'stopping' } });
    await db.destroy();
  });
});


// Layer under test: the broker's check ops over a faked check service, and in the last tests the
// real check service over the real plugin_data and held stores on pg-mem. Not covered: a check
// being driven, the CLI, the route that hands the broker its principal, a real browser page.
describe('plugin broker: checks', () => {
  const admin = { id: 'u1', roles: ['lab_admin'], dataScope: ALL_DATA, username: 'amina' };
  const IMPORT_CAPS = [{ kind: 'host:import' }];
  const actor = { type: 'user', id: 'u1', name: 'amina' };
  // A source key. It is the run's cursor and must never reach the page.
  const SECRET_KEY = 'REQ-SECRET-0042';
  const DRIVER = 'proc-7f3a';
  const PATIENT = 'Maria Santos';
  const checkRun = (over: Record<string, unknown> = {}) => ({
    id: 'ck1', kind: 'check', rev: 6, pluginId: 'p1', pluginVersion: '1.0.0', copyId: 'cp1', referenceCopyId: null, status: 'running',
    options: { tz: '+02:00' }, pageSize: 500, cursor: SECRET_KEY,
    counts: { read: 10, saved: 6, held: 3, failed: 1, resources: 12, labels: { passed: 6 } },
    waiting: null, driver: DRIVER,
    startedAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T08:01:00.000Z', finishedAt: null, lastError: null, startedBy: 'amina',
    ...over,
  });
  const heldRow = { copyId: 'cp1', key: SECRET_KEY, runId: 'ck1', reason: 'held', label: 'odd_age', laboratory: 'LAB-9', error: null, heldAt: '2026-11-16T08:00:30.000Z' };
  function fakeChecks() {
    const calls: Array<[string, unknown[]]> = [];
    const rec = (name: string, result: () => unknown) => async (...args: unknown[]) => { calls.push([name, args]); return result(); };
    return {
      calls,
      api: {
        start: rec('start', () => checkRun({ status: 'queued', driver: null, cursor: null })),
        get: rec('get', () => checkRun()),
        list: rec('list', () => [checkRun(), checkRun({ id: 'ck2', status: 'completed' })]),
        stop: rec('stop', () => checkRun({ status: 'stopping' })),
        held: rec('held', () => ({ rows: [heldRow], total: 41 })),
        heldItem: rec('heldItem', () => ({ ...heldRow, findings: { name: PATIENT }, check: { n: 1 } })),
        heldItems: rec('heldItems', () => ({ items: [{ ...heldRow, findings: { name: PATIENT }, check: { n: 1 } }], total: 41 })),
      } as Record<string, (...args: unknown[]) => Promise<unknown>>,
    };
  }
  const ALL_OPS = [
    { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {} },
    { kind: 'import.check.list' },
    { kind: 'import.check.status', runId: 'ck1' },
    { kind: 'import.check.stop', runId: 'ck1' },
    { kind: 'import.check.held', copyId: 'cp1', offset: 0, limit: 50 },
    { kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY },
    { kind: 'import.check.heldItems', copyId: 'cp1', offset: 0, limit: 200 },
  ];

  it('start passes the caller as the actor, the calling plugin as the plugin, and nothing else from the page', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const res = await b.handle('p1', admin, {
      kind: 'import.check.start', copyId: 'cp1', referenceCopyId: 'cp2', options: { tz: '+02:00' }, pageSize: 200, pluginId: 'p2',
    });
    expect(res).toMatchObject({ ok: true, data: { id: 'ck1', status: 'queued' } });
    expect(checks.calls).toEqual([['start', [{
      pluginId: 'p1', copyId: 'cp1', referenceCopyId: 'cp2', options: { tz: '+02:00' }, pageSize: 200, actor,
    }]]]);
    // referenceCopyId is required, and may be null; the page size is left out when not given.
    await b.handle('p1', admin, { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {} });
    expect(checks.calls[1]).toEqual(['start', [{ pluginId: 'p1', copyId: 'cp1', referenceCopyId: null, options: {}, actor }]]);
    expect(await b.handle('p1', admin, { kind: 'import.check.start', copyId: 'cp1', options: {} })).toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: referenceCopyId/) });
  });

  it('list, status, stop, held and heldItem pass through for the calling plugin', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    expect(await b.handle('p1', admin, { kind: 'import.check.list', pluginId: 'p2' })).toMatchObject({ ok: true, data: [{ id: 'ck1' }, { id: 'ck2' }] });
    await b.handle('p1', admin, { kind: 'import.check.status', runId: 'ck1', pluginId: 'p2' });
    await b.handle('p1', admin, { kind: 'import.check.stop', runId: 'ck1', pluginId: 'p2' });
    const held = await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'cp1', reason: 'held', label: 'odd_age', offset: 20, limit: 10, pluginId: 'p2' });
    expect(held).toEqual({ ok: true, data: { rows: [heldRow], total: 41 } });
    const item = await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY });
    expect(item).toEqual({ ok: true, data: { ...heldRow, findings: { name: PATIENT }, check: { n: 1 } } });
    expect(checks.calls).toEqual([
      ['list', ['p1']],
      ['get', ['p1', 'ck1']],
      ['stop', ['p1', 'ck1', actor]],
      ['held', ['p1', 'cp1', { reason: 'held', label: 'odd_age', offset: 20, limit: 10 }]],
      ['heldItem', ['p1', 'cp1', SECRET_KEY]],
    ]);
    // Reason and label are left out when the page gives none.
    await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'cp1', offset: 0, limit: 100 });
    expect(checks.calls[5]).toEqual(['held', ['p1', 'cp1', { offset: 0, limit: 100 }]]);
    // A missing run is null, not an error.
    checks.api.get = async () => null;
    expect(await b.handle('p1', admin, { kind: 'import.check.status', runId: 'nope' })).toEqual({ ok: true, data: null });
    checks.api.heldItem = async () => null;
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: 'nope' })).toEqual({ ok: true, data: null });
  });

  describe('held corrections (design 2026-11-18-held-corrections)', () => {
    const corrector = { id: 'u2', roles: ['data_corrector'], dataScope: ALL_DATA, capabilities: ['imports.correct_held'], username: 'baraka' };
    const nobody = { id: 'u3', roles: ['data_analyst'], dataScope: ALL_DATA, capabilities: ['reports.view'] };
    const withCorrections = () => {
      const checks = fakeChecks();
      checks.api.correct = async (...args: unknown[]) => { checks.calls.push(['correct', args]); return { corrections: [{ field: 'dob_age' }] }; };
      checks.api.recheck = async (...args: unknown[]) => { checks.calls.push(['recheck', args]); return checkRun({ status: 'queued', driver: null }); };
      checks.api.choices = async (...args: unknown[]) => { checks.calls.push(['choices', args]); return { specimen: [{ code: 'FNA', description: 'Fine needle aspirate' }] }; };
      checks.api.heldCodes = async (...args: unknown[]) => { checks.calls.push(['heldCodes', args]); return [{ code: 'specimen_missing', count: 3 }]; };
      return checks;
    };
    const gated = (checks: ReturnType<typeof fakeChecks>) => broker({
      caps: IMPORT_CAPS, checks: checks.api, copies: { list: async () => [] }, imports: { allowed: async () => [] }, requiredRoles: ['lab_admin'], requiredCapabilities: ['imports.correct_held'],
    });

    it('lets a corrector open the page, read the Feedback tab, correct and check again, and nothing more', async () => {
      const checks = withCorrections();
      const { b } = gated(checks);
      for (const op of [
        { kind: 'import.allowed' }, { kind: 'import.copy.list' }, { kind: 'import.check.list' }, { kind: 'import.check.status', runId: 'ck1' },
        { kind: 'import.check.held', copyId: 'cp1', offset: 0, limit: 50 },
        { kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY },
        { kind: 'import.check.heldItems', copyId: 'cp1', offset: 0, limit: 200 },
        { kind: 'import.check.correct', copyId: 'cp1', key: SECRET_KEY, values: { dob_age: '2023-03-11' }, reason: 'typed wrong' },
        { kind: 'import.check.recheck', copyId: 'cp1', key: SECRET_KEY },
        { kind: 'import.check.access' },
      ]) {
        expect(await b.handle('p1', corrector, op), op.kind).toMatchObject({ ok: true });
      }
      for (const op of [
        { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {} },
        { kind: 'import.check.stop', runId: 'ck1' },
        { kind: 'import.copy.delete', copyId: 'cp1', confirm: true },
        { kind: 'storage.get', key: 'k' },
      ]) {
        expect(await b.handle('p1', corrector, op), op.kind).toMatchObject({ ok: false });
      }
      expect(checks.calls.find(([n]) => n === 'correct')).toEqual(['correct', [{
        pluginId: 'p1', copyId: 'cp1', key: SECRET_KEY, values: { dob_age: '2023-03-11' }, reason: 'typed wrong', actor: { type: 'user', id: 'u2', name: 'baraka' },
      }]]);
    });

    // demo.4 item 11: the correction form's specimen list.
    it('hands a corrector and an admin the choices of the calling plugin, and refuses anyone else', async () => {
      const checks = withCorrections();
      const { b } = gated(checks);
      const want = { ok: true, data: { specimen: [{ code: 'FNA', description: 'Fine needle aspirate' }] } };
      expect(await b.handle('p1', corrector, { kind: 'import.check.choices', copyId: 'cp1', pluginId: 'p2' })).toEqual(want);
      expect(await b.handle('p1', admin, { kind: 'import.check.choices', copyId: 'cp1' })).toEqual(want);
      expect(checks.calls.filter(([n]) => n === 'choices')).toEqual([['choices', ['p1', 'cp1']], ['choices', ['p1', 'cp1']]]);
      expect(await b.handle('p1', nobody, { kind: 'import.check.choices', copyId: 'cp1' })).toMatchObject({ ok: false });
      expect(await b.handle('p1', admin, { kind: 'import.check.choices' })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid operation/) });
    });

    // demo.4 item 10: the finding filter and its counts.
    it('passes a finding filter to held and heldItems, and hands the codes with counts to a corrector', async () => {
      const checks = withCorrections();
      const { b } = gated(checks);
      await b.handle('p1', corrector, { kind: 'import.check.held', copyId: 'cp1', finding: 'specimen_missing', offset: 0, limit: 50 });
      await b.handle('p1', corrector, { kind: 'import.check.heldItems', copyId: 'cp1', finding: 'specimen_missing', after: null, limit: 200 });
      expect(await b.handle('p1', corrector, { kind: 'import.check.heldCodes', copyId: 'cp1', laboratory: 'LAB-1' })).toEqual({ ok: true, data: [{ code: 'specimen_missing', count: 3 }] });
      expect(checks.calls.filter(([n]) => n === 'held' || n === 'heldItems' || n === 'heldCodes')).toEqual([
        ['held', ['p1', 'cp1', { finding: 'specimen_missing', offset: 0, limit: 50 }]],
        ['heldItems', ['p1', 'cp1', { finding: 'specimen_missing', after: null, limit: 200 }]],
        ['heldCodes', ['p1', 'cp1', { laboratory: 'LAB-1' }]],
      ]);
      // A code is a bare word: anything else is refused before the service.
      expect(await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'cp1', finding: "x' or 1=1", offset: 0, limit: 50 })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid operation/) });
      expect(await b.handle('p1', nobody, { kind: 'import.check.heldCodes', copyId: 'cp1' })).toMatchObject({ ok: false });
    });

    it('refuses everything to a caller with neither the role nor the permission', async () => {
      const { b } = gated(withCorrections());
      for (const op of [{ kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY }, { kind: 'import.check.correct', copyId: 'cp1', key: SECRET_KEY, values: { sex: 'F' }, reason: 'r' }, { kind: 'import.check.access' }]) {
        expect(await b.handle('p1', nobody, op)).toMatchObject({ ok: false });
      }
    });

    it('never hands the page the keys a recheck names (review H5)', async () => {
      const page = checkForPage(checkRun({ recheck: { keys: [SECRET_KEY], returnTo: 'completed', finishedAt: null } }) as never);
      expect(JSON.stringify(page)).not.toContain(SECRET_KEY);
      expect(page).not.toHaveProperty('recheck');
    });

    it('access tells the page what to show', async () => {
      const { b } = gated(withCorrections());
      expect(await b.handle('p1', admin, { kind: 'import.check.access' })).toEqual({ ok: true, data: { full: true, correct: true } });
      expect(await b.handle('p1', corrector, { kind: 'import.check.access' })).toEqual({ ok: true, data: { full: false, correct: true } });
    });

    it('refuses a correction with no field, a long value or no reason before it reaches the service', async () => {
      const checks = withCorrections();
      const { b } = gated(checks);
      for (const bad of [{ values: {}, reason: 'r' }, { values: { sex: 'x'.repeat(201) }, reason: 'r' }, { values: { sex: 'F' }, reason: '' }]) {
        expect(await b.handle('p1', admin, { kind: 'import.check.correct', copyId: 'cp1', key: SECRET_KEY, ...bad })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid operation/) });
      }
      expect(checks.calls.filter(([n]) => n === 'correct')).toEqual([]);
    });
  });

  it('a plugin without host:import is denied every check op, and so is a caller below lab_admin', async () => {
    const checks = fakeChecks();
    const noCap = broker({ caps: [], checks: checks.api });
    for (const op of ALL_OPS) {
      expect(await noCap.b.handle('p1', admin, op)).toEqual({ ok: false, error: expect.stringMatching(/host:import/) });
    }
    const withCap = broker({ caps: IMPORT_CAPS, checks: checks.api });
    for (const op of ALL_OPS) {
      expect(await withCap.b.handle('p1', { id: 'u2', roles: ['lab_tech'], dataScope: ALL_DATA }, op)).toEqual({ ok: false, error: expect.stringMatching(/lab_admin/) });
    }
    expect(checks.calls).toEqual([]);
    expect(noCap.audited.map((e) => e.outcome)).toEqual(ALL_OPS.map(() => 'denied'));
  });

  it('refuses a limit above 100 or below 1, a negative offset, a long key and a bad reason, before the service', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const held = (over: Record<string, unknown>) => ({ kind: 'import.check.held', copyId: 'cp1', offset: 0, limit: 50, ...over });
    for (const bad of [{ limit: 101 }, { limit: 0 }, { limit: 1.5 }, { offset: -1 }, { reason: 'other' }, { label: 5 }]) {
      expect(await b.handle('p1', admin, held(bad))).toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: /) });
    }
    const tooLong = 'K'.repeat(201);
    const refused = await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: tooLong });
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: key/) });
    expect(JSON.stringify(refused)).not.toContain(tooLong);
    expect(checks.calls).toEqual([]);
    expect(await b.handle('p1', admin, held({ limit: 100 }))).toMatchObject({ ok: true });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: 'K'.repeat(200) })).toMatchObject({ ok: true });
  });

  it('heldItems passes through for the calling plugin, with the findings and check of each row', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const res = await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', reason: 'error', label: 'odd_age', offset: 40, limit: 200, pluginId: 'p2' });
    expect(res).toEqual({ ok: true, data: { items: [{ ...heldRow, findings: { name: PATIENT }, check: { n: 1 } }], total: 41 } });
    // Reason and label are left out when the page gives none.
    await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', offset: 0, limit: 1 });
    expect(checks.calls).toEqual([
      ['heldItems', ['p1', 'cp1', { reason: 'error', label: 'odd_age', offset: 40, limit: 200 }]],
      ['heldItems', ['p1', 'cp1', { offset: 0, limit: 1 }]],
    ]);
  });

  it('start passes fromStart when the page gives it, and refuses one that is not true or false', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    await b.handle('p1', admin, { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: true });
    await b.handle('p1', admin, { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: false });
    expect(checks.calls).toEqual([
      ['start', [{ pluginId: 'p1', copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: true, actor }]],
      ['start', [{ pluginId: 'p1', copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: false, actor }]],
    ]);
    expect(await b.handle('p1', admin, { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: 'yes' }))
      .toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: fromStart/) });
    expect(checks.calls).toHaveLength(2);
  });

  it('a page never sees what a run recorded about its copies, nor how it last started', async () => {
    const checks = fakeChecks();
    checks.api.get = async () => checkRun({ copyFinishedAt: { source: '2026-11-16T07:00:00.000Z', reference: null }, carriedOn: true });
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const res = await b.handle('p1', admin, { kind: 'import.check.status', runId: 'ck1' }) as { ok: true; data: Record<string, unknown> };
    expect(res.data).not.toHaveProperty('copyFinishedAt');
    expect(res.data).not.toHaveProperty('carriedOn');
  });

  it('heldItems reads by after: passes the key or null, drops the offset, and answers next', async () => {
    const checks = fakeChecks();
    checks.api.heldItems = async (...args: unknown[]) => { checks.calls.push(['heldItems', args]); return { items: [], total: 41, next: 'K9' }; };
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', after: null, limit: 200 }))
      .toEqual({ ok: true, data: { items: [], total: 41, next: 'K9' } });
    await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', reason: 'held', label: 'odd_age', laboratory: 'LAB-9', after: 'K5', offset: 7, limit: 10 });
    expect(checks.calls).toEqual([
      ['heldItems', ['p1', 'cp1', { after: null, limit: 200 }]],
      ['heldItems', ['p1', 'cp1', { reason: 'held', label: 'odd_age', laboratory: 'LAB-9', after: 'K5', limit: 10 }]],
    ]);
  });

  it('heldItems needs an offset when it has no after, and refuses a bad after, before the service', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', limit: 10 }))
      .toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: offset/) });
    for (const after of ['', 'K'.repeat(201), 5]) {
      expect(await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', after, limit: 10 }))
        .toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: after/) });
    }
    expect(checks.calls).toEqual([]);
  });

  it('heldItems refuses a limit above 200 or below 1, a negative offset and a bad reason, before the service', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const items = (over: Record<string, unknown>) => ({ kind: 'import.check.heldItems', copyId: 'cp1', offset: 0, limit: 50, ...over });
    for (const bad of [{ limit: 201 }, { limit: 0 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }, { reason: 'other' }, { label: '' }, { label: 'L'.repeat(65) }, { copyId: '' }]) {
      expect(await b.handle('p1', admin, items(bad))).toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: /) });
    }
    expect(checks.calls).toEqual([]);
    expect(await b.handle('p1', admin, items({ limit: 200 }))).toMatchObject({ ok: true });
    // held keeps its own bound of 100.
    expect(await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'cp1', offset: 0, limit: 101 })).toMatchObject({ ok: false });
  });

  it('held and heldItems pass a laboratory through, and refuse a bad one before the service', async () => {
    const checks = fakeChecks();
    const { b, audited } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const code = 'LAB-1.a_' + 'X'.repeat(24);
    expect(code).toHaveLength(32);
    await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'cp1', laboratory: code, offset: 0, limit: 10 });
    await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', reason: 'held', label: 'odd_age', laboratory: 'TZA', offset: 0, limit: 10 });
    expect(checks.calls).toEqual([
      ['held', ['p1', 'cp1', { laboratory: code, offset: 0, limit: 10 }]],
      ['heldItems', ['p1', 'cp1', { reason: 'held', label: 'odd_age', laboratory: 'TZA', offset: 0, limit: 10 }]],
    ]);
    // The laboratory is not in the audit row: the operation and the copy only.
    expect(audited).toEqual([
      { pluginId: 'p1', op: 'import.check.held:cp1', outcome: 'ok', reason: undefined },
      { pluginId: 'p1', op: 'import.check.heldItems:cp1', outcome: 'ok', reason: undefined },
    ]);
    expect(JSON.stringify(audited)).not.toContain('TZA');
    for (const kind of ['import.check.held', 'import.check.heldItems']) {
      for (const laboratory of ['X'.repeat(33), 'has space', '', 'caf\u00e9', 'a/b', 5, null]) {
        const refused = await b.handle('p1', admin, { kind, copyId: 'cp1', laboratory, offset: 0, limit: 10 });
        expect(refused).toEqual({ ok: false, error: expect.stringMatching(/^invalid operation: laboratory/) });
        if (typeof laboratory === 'string' && laboratory.length > 3) expect(JSON.stringify(refused)).not.toContain(laboratory);
      }
    }
    expect(checks.calls).toHaveLength(2);
  });

  it('a run whose only laboratory entry is the null one shows the page none, and a run with none stored shows none', async () => {
    const checks = fakeChecks();
    const onlyNull = [{ code: null, counts: { read: 10, saved: 6, held: 3, failed: 1, labels: { passed: 6 } } }];
    let run: Record<string, unknown> = checkRun({ laboratories: onlyNull });
    checks.api.get = async () => run;
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    expect(await b.handle('p1', admin, { kind: 'import.check.status', runId: 'ck1' })).toMatchObject({ ok: true, data: { laboratories: [], counts: { read: 10 } } });
    run = checkRun({ laboratories: [] });
    expect(await b.handle('p1', admin, { kind: 'import.check.status', runId: 'ck1' })).toMatchObject({ ok: true, data: { laboratories: [] } });
    // A record from before laboratories were counted: the page gets no field, so it draws no picker.
    run = checkRun();
    const res = await b.handle('p1', admin, { kind: 'import.check.status', runId: 'ck1' }) as { ok: true; data: Record<string, unknown> };
    expect('laboratories' in res.data).toBe(false);
  });

  it('a run passes its laboratories to the page as they are', async () => {
    const checks = fakeChecks();
    const laboratories = [
      { code: 'A', counts: { read: 6, saved: 4, held: 2, failed: 0, labels: { passed: 4 } } },
      { code: null, counts: { read: 4, saved: 2, held: 1, failed: 1, labels: { passed: 2 } } },
    ];
    checks.api.get = async () => checkRun({ laboratories });
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const res = await b.handle('p1', admin, { kind: 'import.check.status', runId: 'ck1' });
    expect(res).toMatchObject({ ok: true, data: { laboratories } });
    expect(JSON.stringify(res)).not.toContain(SECRET_KEY);
  });

  it('heldItems leaves an audit row with the operation and the copy id, never a key, a value or the size', async () => {
    const checks = fakeChecks();
    const { b, audited, logged } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', label: 'odd_age', offset: 0, limit: 200 });
    expect(audited).toEqual([{ pluginId: 'p1', op: 'import.check.heldItems:cp1', outcome: 'ok', reason: undefined }]);
    const noCap = broker({ caps: [], checks: checks.api });
    await noCap.b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'cp1', label: 'odd_age', offset: 0, limit: 200 });
    expect(noCap.audited).toEqual([{ pluginId: 'p1', op: 'import.check.heldItems', outcome: 'denied', reason: expect.stringMatching(/host:import/) }]);
    for (const text of [JSON.stringify(audited), JSON.stringify(logged), JSON.stringify(noCap.audited), JSON.stringify(noCap.logged)]) {
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(PATIENT);
      expect(text).not.toContain('odd_age');
      expect(text).not.toContain('41');
    }
  });

  it('no answer carries the run cursor, the driver, the version, the starter or the kind', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    const start = await b.handle('p1', admin, ALL_OPS[0]);
    const list = await b.handle('p1', admin, ALL_OPS[1]);
    const status = await b.handle('p1', admin, ALL_OPS[2]);
    const stop = await b.handle('p1', admin, ALL_OPS[3]);
    for (const a of [start, list, status, stop]) {
      expect(a.ok).toBe(true);
      const text = JSON.stringify(a);
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(DRIVER);
      expect(text).not.toMatch(/"cursor"|"driver"|"rev"|"kind"|"pluginId"|"pluginVersion"|"startedBy"/);
    }
    expect((status as { data: unknown }).data).toEqual({
      id: 'ck1', copyId: 'cp1', referenceCopyId: null, status: 'running', options: { tz: '+02:00' }, pageSize: 500,
      counts: { read: 10, saved: 6, held: 3, failed: 1, resources: 12, labels: { passed: 6 } }, waiting: null,
      startedAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T08:01:00.000Z', finishedAt: null, lastError: null,
    });
  });

  it('a refused start comes back as a failed operation with the service sentence', async () => {
    const checks = fakeChecks();
    const { b } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    for (const sentence of [
      'copy cp1 is running; a check needs a completed copy',
      'check ck1 is queued; stop it before starting it again',
      'copy cp2 not found',
    ]) {
      checks.api.start = async () => { throw new Error(sentence); };
      expect(await b.handle('p1', admin, ALL_OPS[0])).toEqual({ ok: false, error: sentence });
    }
  });

  it('says so when checks are not wired', async () => {
    const { b } = broker({ caps: IMPORT_CAPS });
    expect(await b.handle('p1', admin, { kind: 'import.check.list' })).toEqual({ ok: false, error: 'checks are unavailable' });
  });

  it('held and heldItem leave an audit row with the operation and the copy id, never the key or a value', async () => {
    const checks = fakeChecks();
    const { b, audited, logged } = broker({ caps: IMPORT_CAPS, checks: checks.api });
    await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'cp1', label: 'odd_age', offset: 0, limit: 10 });
    await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY });
    expect(audited).toEqual([
      { pluginId: 'p1', op: 'import.check.held:cp1', outcome: 'ok', reason: undefined },
      { pluginId: 'p1', op: 'import.check.heldItem:cp1', outcome: 'ok', reason: undefined },
    ]);
    // A refused heldItem (too long a key, then no capability) leaves nothing of the key either.
    await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY.repeat(30) });
    const noCap = broker({ caps: [], checks: checks.api });
    await noCap.b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'cp1', key: SECRET_KEY });
    for (const text of [JSON.stringify(audited), JSON.stringify(logged), JSON.stringify(noCap.audited), JSON.stringify(noCap.logged)]) {
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(PATIENT);
      expect(text).not.toContain('odd_age');
    }
  });

  it('a plugin only reaches its own copies and runs, over the real check service', async () => {
    const db = await makeMigratedDb();
    const pluginData = createPluginDataStore(db);
    const held = createImportCheckHeldStore(db);
    const manifest = (id: string) => ({
      schemaVersion: 1, type: 'plugin', id, version: '1.0.0',
      capabilities: [{ kind: 'host:import' }, { kind: 'emit-fhir', resourceTypes: ['ServiceRequest'] }],
      payload: { kind: 'plugin', entrypoints: ['c', 'd'], importSource: { connectorTypes: ['microsoft-sql'], sourceSystem: 'x', entrypoints: { copy: 'c', decode: 'd' } } },
    });
    // The copy entrypoint names one set, requests. A check start compares it with each copy's setSql.
    const copySpec = { sets: [{ name: 'requests', keyQuery: { sql: 'SELECT TOP ({{limit}}) [K] FROM [R] WHERE [K] > {{after}} ORDER BY [K]' }, detailQueries: [] }] };
    const sink = { invoke: async (entrypoint: string) => (entrypoint === 'c' ? copySpec : { groups: [] }) };
    const plugins = { list: async () => [{ id: 'p1', version: '1.0.0', enabled: true, active: true, manifest: manifest('p1') }, { id: 'p2', version: '1.0.0', enabled: true, active: true, manifest: manifest('p2') }], loadSink: async () => sink } as any;
    const copyDoc = (id: string, pluginId: string) => ({
      id, kind: 'copy', rev: 1, pluginId, pluginVersion: '1.0.0', connectorId: 'c1', status: 'completed', options: {}, pageSize: 500,
      // A source copy: a check start refuses a copy with no set requests.
      sets: {}, setOrder: ['requests'], setSql: copySetHashes(copySpecSchema.parse(copySpec).sets), waiting: null, driver: null,
      startedAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T08:00:00.000Z', finishedAt: '2026-11-16T08:00:00.000Z', lastError: null, startedBy: 'amina',
    });
    await pluginData.put('p1', '__import-copies', 'mine', copyDoc('mine', 'p1'));
    await pluginData.put('p1', '__import-copies', 'mine2', copyDoc('mine2', 'p1'));
    await pluginData.put('p2', '__import-copies', 'theirs', copyDoc('theirs', 'p2'));
    const audit = async () => {};
    const copies = createImportCopyService({
      plugins, connectors: { get: async () => null, getDecryptedConfig: async () => ({}) } as any,
      secretsKey: 'k', pluginData, store: createImportCopyStore(db), audit, allowed: async () => [], driverId: 'test',
    });
    const checks = createImportCheckService({
      plugins, pluginData, audit, persist: async () => [], copyStore: createImportCopyStore(db), held, copies, driverId: 'test',
      // Every copy here was made from connector c1, which both plugins may read.
      allowed: async () => ['c1'],
    });
    const theirRun = checkRun({ id: checkIdOf('theirs'), pluginId: 'p2', copyId: 'theirs' });
    await pluginData.put('p2', '__import-checks', theirRun.id, theirRun);
    await held.put({ copyId: 'mine', key: SECRET_KEY, runId: 'r', reason: 'held', label: 'odd_age', laboratory: 'LAB-9', error: null, findings: { name: PATIENT }, check: { n: 1 } });
    await held.put({ copyId: 'theirs', key: 'T1', runId: 'r', reason: 'held', label: null, laboratory: null, error: null, findings: { name: 'Other Person' }, check: null });
    const { b, audited, logged } = broker({ caps: IMPORT_CAPS, checks });

    // Their copy is not reachable, as the copy or as the reference.
    const start = (copyId: string, referenceCopyId: string | null) => b.handle('p1', admin, { kind: 'import.check.start', copyId, referenceCopyId, options: {} });
    expect(await start('theirs', null)).toEqual({ ok: false, error: 'copy theirs not found' });
    expect(await start('mine', 'theirs')).toEqual({ ok: false, error: 'copy theirs not found' });
    expect(await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'theirs', offset: 0, limit: 10 })).toEqual({ ok: false, error: 'copy theirs not found' });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'theirs', key: 'T1' })).toEqual({ ok: false, error: 'copy theirs not found' });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'theirs', offset: 0, limit: 200 })).toEqual({ ok: false, error: 'copy theirs not found' });
    // Their run is not listed, not shown and not stopped.
    expect(await b.handle('p1', admin, { kind: 'import.check.list' })).toEqual({ ok: true, data: [] });
    expect(await b.handle('p1', admin, { kind: 'import.check.status', runId: theirRun.id })).toEqual({ ok: true, data: null });
    expect(await b.handle('p1', admin, { kind: 'import.check.stop', runId: theirRun.id })).toEqual({ ok: false, error: `check ${theirRun.id} not found` });
    expect(await pluginData.get('p2', '__import-checks', theirRun.id)).toMatchObject({ status: 'running', rev: 6 });

    // Its own copy it can check, see, hold-list and stop.
    const started = await start('mine', null);
    expect(started).toMatchObject({ ok: true, data: { copyId: 'mine', referenceCopyId: null, status: 'queued' } });
    expect(JSON.stringify(started)).not.toMatch(/"cursor"|"driver"|"rev"|"startedBy"/);
    // A second start while it is live is a failed operation with the service's sentence.
    expect(await start('mine', null)).toEqual({ ok: false, error: `check ${checkIdOf('mine')} is queued; stop it before starting it again` });
    expect(await start('mine', 'mine2')).toMatchObject({ ok: false });
    // A reference that is its own copy is refused too.
    expect(await start('mine2', 'mine2')).toEqual({ ok: false, error: 'the reference copy must be another copy than the source copy' });
    const heldAnswer = await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'mine', offset: 0, limit: 10 });
    expect(heldAnswer).toMatchObject({ ok: true, data: { total: 1, rows: [{ key: SECRET_KEY, reason: 'held', label: 'odd_age' }] } });
    // Through the real store: the row carries its laboratory, and the filter narrows by it.
    expect(await b.handle('p1', admin, { kind: 'import.check.held', copyId: 'mine', laboratory: 'LAB-9', offset: 0, limit: 10 }))
      .toMatchObject({ ok: true, data: { total: 1, rows: [{ key: SECRET_KEY, laboratory: 'LAB-9' }] } });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'mine', laboratory: 'LAB-8', offset: 0, limit: 10 }))
      .toEqual({ ok: true, data: { total: 0, items: [] } });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItem', copyId: 'mine', key: SECRET_KEY })).toMatchObject({ ok: true, data: { findings: { name: PATIENT } } });
    expect(await b.handle('p1', admin, { kind: 'import.check.heldItems', copyId: 'mine', offset: 0, limit: 200 })).toEqual({
      ok: true, data: { total: 1, items: [expect.objectContaining({ key: SECRET_KEY, reason: 'held', label: 'odd_age', findings: { name: PATIENT }, check: { n: 1 } })] },
    });
    expect(await b.handle('p1', admin, { kind: 'import.check.stop', runId: checkIdOf('mine') })).toMatchObject({ ok: true, data: { status: 'stopped' } });

    // Neither the audit rows nor the logs hold the key or a value.
    for (const text of [JSON.stringify(audited), JSON.stringify(logged)]) {
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(PATIENT);
    }
    await db.destroy();
  });
});

// Roles part 3 (review P3-01): the broker runs reports and reads data without the caller's report
// permission, so a limited caller may make only the calls that read no warehouse or source data.
describe('plugin broker under a data limit', () => {
  const limited = { id: 'u1', roles: ['lab_admin'], dataScope: { limited: true as const, facilities: ['f1'], districts: [], regions: [] } };
  const caps = [{ kind: 'host:reports' }, { kind: 'host:connectors' }, { kind: 'host:import' }, { kind: 'host:schedule' }];

  it('refuses a limited caller every report, connector, import and schedule call, and audits it', async () => {
    const run = vi.fn(async () => ({ columns: [], rows: [], meta: {} }));
    const { b, audited } = broker({ caps, reporting: { list: () => [{ id: 'r1' }], run } });
    for (const op of [
      { kind: 'reports.list' }, { kind: 'reports.run', id: 'r1' }, { kind: 'reports.columns', id: 'r1' },
      { kind: 'connectors.list' }, { kind: 'import.list' }, { kind: 'import.check.held', copyId: 'c1', offset: 0, limit: 10 }, { kind: 'schedule.list' },
    ]) {
      const r = await b.handle('p1', limited, op);
      expect(r, op.kind).toEqual({ ok: false, error: `operation ${op.kind} is not available with your data limit` });
    }
    expect(run).not.toHaveBeenCalled();
    expect(audited.every((a) => a.outcome === 'denied')).toBe(true);
  });

  it('lets a limited caller use the plugin\'s own storage, and an unlimited caller run a report', async () => {
    const { b } = broker({ caps, reporting: { list: () => [{ id: 'r1' }] } });
    expect((await b.handle('p1', limited, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } })).ok).toBe(true);
    expect(await b.handle('p1', { ...limited, dataScope: { limited: false } }, { kind: 'reports.list' })).toEqual({ ok: true, data: [{ id: 'r1' }] });
  });
});

describe('plugin broker: the caller passed to plugin code (plugin host 2a task 6)', () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
  const registry: ScopeRegistryRow[] = [
    { id: 'FAC-1', name: 'One', facility_code: null, region: 'Dodoma', district: 'Kondoa' },
    { id: 'fac-2', name: 'Two', facility_code: null, region: 'Dodoma', district: 'Chamwino' },
    { id: 'fac-3', name: 'Three', facility_code: null, region: 'Arusha', district: 'Kondoa' },
  ];
  const fakeHost = { forCall: vi.fn(() => ({})) };

  function hostBroker(caps: unknown[], sink: unknown, over: Partial<PluginBrokerDeps> = {}) {
    const row = { id: 'p1', version: '1.0.0', enabled: true, active: true, manifest: { capabilities: caps } };
    const resolveFacilities = vi.fn(async (scope: any) => facilityIdsInScope(registry, scope));
    const b = createPluginBroker({
      plugins: { list: async () => [row], loadSink: async () => sink } as any,
      pluginData: memData().store as any,
      reporting: defaultReporting(),
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
      host: fakeHost,
      resolveFacilities,
      ...over,
    });
    return { b, resolveFacilities };
  }
  const person = { id: 'u7', roles: ['lab_admin'], dataScope: ALL_DATA, username: 'jdoe', displayName: 'Jane Doe', capabilities: ['patients.view'] };
  const limitedTo = (over: Record<string, unknown>) => ({ ...person, dataScope: { limited: true as const, facilities: [], districts: [], regions: [], ...over } });

  it('passes the caller from the session and the host to a plugin with host functions', async () => {
    const invoke = vi.fn(async () => ({ done: true }));
    const { b, resolveFacilities } = hostBroker([{ kind: 'host:db' }], { invoke });
    // A caller or facility list in the op input is the plugin's request, never the caller.
    const input = { caller: { userId: 'admin', facilities: '*' }, facilities: '*' };
    const r = await b.handle('p1', { ...person, dataScope: { limited: false } }, { kind: 'invoke', entrypoint: 'run', input });
    expect(r).toEqual({ ok: true, data: { done: true } });
    expect(invoke).toHaveBeenCalledWith('run', input, {
      caller: { userId: 'u7', displayName: 'Jane Doe', capabilities: ['patients.view'], facilities: '*' },
      host: fakeHost,
    });
    // Everything needs no register read.
    expect(resolveFacilities).not.toHaveBeenCalled();
  });

  // A CLI call (openldr plugin call) names who to audit as; the plugin host records that actor.
  it('passes a principal\'s audit actor on to the plugin code\'s caller', async () => {
    const invoke = vi.fn(async () => ({ done: true }));
    const { b } = hostBroker([{ kind: 'host:db' }], { invoke });
    const auditActor = { actorType: 'cli' as const, actorId: null, actorName: 'ops' };
    await b.handle('p1', { ...person, dataScope: { limited: false }, auditActor }, { kind: 'invoke', entrypoint: 'run', input: {} });
    expect(invoke).toHaveBeenCalledWith('run', {}, expect.objectContaining({ caller: expect.objectContaining({ auditActor }) }));
  });

  it('gives an unlimited caller *, and a caller with no data limit at all no facilities', async () => {
    const invoke = vi.fn(async () => ({}));
    const { b, resolveFacilities } = hostBroker([{ kind: 'host:ce-read' }], { invoke });
    await b.handle('p1', person, { kind: 'invoke', entrypoint: 'run', input: {} });
    expect((invoke.mock.calls[0] as any)[2].caller.facilities).toBe('*');
    // The type requires a data limit; a caller from plain JavaScript can still leave it out.
    const { dataScope: _d, ...noLimit } = person;
    await b.handle('p1', noLimit as never, { kind: 'invoke', entrypoint: 'run', input: {} });
    expect((invoke.mock.calls[1] as any)[2].caller.facilities).toEqual([]);
    expect(resolveFacilities).not.toHaveBeenCalled();
  });

  it.each([
    ['a listed facility', { facilities: ['FAC-1'] }, ['fac-1']],
    ['a listed district', { districts: [{ region: 'Dodoma', district: 'Kondoa' }] }, ['fac-1']],
    ['a listed region', { regions: ['Dodoma'] }, ['fac-1', 'fac-2']],
    ['nothing in the register', { regions: ['Nowhere'] }, []],
  ])('resolves a limited caller\'s %s to facility ids, once per call', async (_what, scope, want) => {
    const invoke = vi.fn(async () => ({}));
    const { b, resolveFacilities } = hostBroker([{ kind: 'host:db' }], { invoke });
    const r = await b.handle('p1', limitedTo(scope), { kind: 'invoke', entrypoint: 'run', input: {} });
    expect(r.ok).toBe(true);
    expect((invoke.mock.calls[0] as any)[2].caller.facilities).toEqual(want);
    expect(resolveFacilities).toHaveBeenCalledTimes(1);
  });

  it('gives a limited caller no facility when nothing resolves the limit, never *', async () => {
    const invoke = vi.fn(async () => ({}));
    const { b } = hostBroker([{ kind: 'host:db' }], { invoke }, { resolveFacilities: undefined });
    await b.handle('p1', limitedTo({ facilities: ['fac-1'] }), { kind: 'invoke', entrypoint: 'run', input: {} });
    expect((invoke.mock.calls[0] as any)[2].caller.facilities).toEqual([]);
  });

  it('invokes a plugin without host capabilities exactly as before', async () => {
    for (const caps of [[], [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], [{ kind: 'net-egress', allowedHosts: [] }]]) {
      const invoke = vi.fn(async () => ({}));
      const { b, resolveFacilities } = hostBroker(caps, { invoke });
      await b.handle('p1', limitedTo({ facilities: ['fac-1'] }), { kind: 'invoke', entrypoint: 'run', input: { a: 1 } });
      expect(invoke.mock.calls[0]).toEqual(['run', { a: 1 }]);
      expect(resolveFacilities).not.toHaveBeenCalled();
    }
  });

  it('invokes a legacy plugin (no capabilities field) exactly as before', async () => {
    const invoke = vi.fn(async () => ({}));
    const row = { id: 'p1', version: '1.0.0', enabled: true, active: true, manifest: {} };
    const b = createPluginBroker({
      plugins: { list: async () => [row], loadSink: async () => ({ invoke }) } as any,
      pluginData: memData().store as any, reporting: defaultReporting(),
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }), host: fakeHost,
    });
    await b.handle('p1', person, { kind: 'invoke', entrypoint: 'run', input: {} });
    expect(invoke.mock.calls[0]).toEqual(['run', {}]);
  });

  it('a limited caller reaches invoke, and its db_select sees only its own facility', async () => {
    // pg-mem: the facility filter CE builds itself (row-level security is proved live in @openldr/db).
    const shapes: TableShape[] = [{
      name: 'orders',
      columns: [{ name: 'id', type: 'integer' }, { name: 'facility', type: 'text' }],
      primaryKey: ['id'],
      facilityColumn: 'facility',
    }];
    const mem = newDb();
    mem.public.interceptQueries((q) => (/^set local statement_timeout/i.test(q.trim()) ? [] : null));
    const db = mem.adapters.createKysely() as Kysely<any>;
    await createPluginSchemas(db, PG_MEM_WITHOUT_RLS).apply('p1', shapes);
    const requests = createPluginRequests(db);
    const everyone = { userId: 'seed', displayName: null, capabilities: [], facilities: '*' as const };
    await requests.write('p1', shapes, everyone, { steps: [
      { op: 'insert', table: 'orders', values: { id: 1, facility: 'fac-1' } },
      { op: 'insert', table: 'orders', values: { id: 2, facility: 'fac-2' } },
      { op: 'insert', table: 'orders', values: { id: 3, facility: 'fac-3' } },
    ] });

    const host = createPluginHost({
      requests,
      patients: {} as any, pluginRefKey: async () => Buffer.alloc(32), testCatalog: {} as any, terminology: {} as any, facilityRegistry: {} as any,
      fhirGetWithProvenance: async () => null, persist: async () => [], audit: async () => {}, logger,
    });
    const caps = [{ kind: 'host:db' }];
    // The real sink, with a runner that does what the plugin's code would: call db_select.
    const runner = {
      async run(_wasm: Uint8Array, input: Uint8Array, opts: any) {
        const req = JSON.parse(new TextDecoder().decode(input));
        const out = await opts.hostFns.db_select(req);
        return new TextEncoder().encode(JSON.stringify(out));
      },
    };
    const manifest = parseManifest({ id: 'p1', version: '1.0.0', kind: 'sink', entrypoints: ['list'], wasmSha256: 'a'.repeat(64) });
    const sink = createWasmSink(manifest, new Uint8Array([0]), runner as never, logger, caps as never, shapes);
    const { b } = hostBroker(caps, sink, { host });
    const op = { kind: 'invoke', entrypoint: 'list', input: { table: 'orders', columns: ['id'], orderBy: [{ column: 'id' }] } };

    const limited = await b.handle('p1', limitedTo({ facilities: ['FAC-1'] }), op) as any;
    expect(limited.ok).toBe(true);
    expect(limited.data).toEqual({ ok: true, result: { rows: [{ id: 1 }] } });

    const district = await b.handle('p1', limitedTo({ regions: ['Dodoma'] }), op) as any;
    expect(district.data.result.rows).toEqual([{ id: 1 }, { id: 2 }]);

    const none = await b.handle('p1', limitedTo({ regions: ['Nowhere'] }), op) as any;
    expect(none.data.result.rows).toEqual([]);

    const all = await b.handle('p1', { ...person, dataScope: { limited: false } }, op) as any;
    expect(all.data.result.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});

describe('plugin broker: the permission each action needs (plugin host 2b task 3)', () => {
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
  const PERMISSIONS = [
    { key: 'lab.orders.receive', label: 'Receive orders', description: 'Mark a sample as received.' },
    { key: 'lab.results.enter', label: 'Enter results', description: 'Type a result.' },
  ];
  const ACTIONS = { receive: ['lab.orders.receive'], enter: ['lab.results.enter', 'lab.orders.receive'], editForm: ['forms.edit'] };

  function gated(payload: Record<string, unknown>, opts: { caps?: unknown[]; sink?: unknown; host?: PluginBrokerDeps['host']; resolveFacilities?: PluginBrokerDeps['resolveFacilities'] } = {}) {
    const invoke = vi.fn(async (entrypoint: string) => ({ ran: entrypoint }));
    const row = { id: 'lab', version: '0.1.0', enabled: true, active: true, manifest: { capabilities: opts.caps ?? [], payload } };
    const audited: Array<{ op: string; outcome: string; reason?: string }> = [];
    const b = createPluginBroker({
      audit: async (e) => { audited.push({ op: e.op, outcome: e.outcome, reason: e.reason }); },
      plugins: { list: async () => [row], loadSink: async () => opts.sink ?? { invoke } } as any,
      pluginData: memData().store as any,
      reporting: defaultReporting(),
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
      host: opts.host,
      resolveFacilities: opts.resolveFacilities,
    });
    return { b, invoke, audited };
  }
  const who = (capabilities: string[], over: Record<string, unknown> = {}) => ({ id: 'u1', roles: [] as string[], dataScope: ALL_DATA, capabilities, ...over });
  const run = (entrypoint: string, input: unknown = {}) => ({ kind: 'invoke', entrypoint, input });

  it('refuses a caller without the action\'s permission, names the permission, audits it and runs nothing', async () => {
    const { b, invoke, audited } = gated({ permissions: PERMISSIONS, actionPermissions: ACTIONS });
    const r = await b.handle('lab', who(['lab.results.enter']), run('receive'));
    expect(r).toEqual({ ok: false, error: 'the action receive of plugin lab needs one of these permissions: Receive orders' });
    expect(invoke).not.toHaveBeenCalled();
    expect(audited).toEqual([{ op: 'invoke:receive', outcome: 'denied', reason: expect.stringMatching(/Receive orders/) }]);
  });

  it('runs the action for a caller holding any one of its permissions', async () => {
    const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions: ACTIONS });
    expect(await b.handle('lab', who(['lab.orders.receive']), run('receive'))).toEqual({ ok: true, data: { ran: 'receive' } });
    expect(await b.handle('lab', who(['lab.orders.receive']), run('enter'))).toEqual({ ok: true, data: { ran: 'enter' } });
    expect(await b.handle('lab', who(['lab.results.enter']), run('enter'))).toEqual({ ok: true, data: { ran: 'enter' } });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('refuses a crafted op that names an entrypoint the plugin does not list, even for a caller with every key', async () => {
    const { b, invoke, audited } = gated({ permissions: PERMISSIONS, actionPermissions: ACTIONS });
    const everything = who(['lab.orders.receive', 'lab.results.enter', 'forms.edit'], { roles: ['lab_admin'] });
    for (const entrypoint of ['delete_everything', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = await b.handle('lab', everything, run(entrypoint));
      expect(r, entrypoint).toEqual({ ok: false, error: `the action ${entrypoint} of plugin lab is closed: the plugin names no permission for it` });
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(audited.every((a) => a.outcome === 'denied')).toBe(true);
  });

  it('takes the permissions from the stored row, never from the op input', async () => {
    const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions: ACTIONS });
    const input = { actionPermissions: { receive: [] }, capabilities: ['lab.orders.receive'], caller: { capabilities: ['lab.orders.receive'] } };
    expect((await b.handle('lab', who([]), run('receive', input))).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a listed CE capability is only required of the caller; the plugin\'s own grant gives none', async () => {
    // The plugin is granted every host capability. That is its ceiling, not the caller's permission.
    const caps = [{ kind: 'host:db' }, { kind: 'host:ce-read' }, { kind: 'emit-fhir', resourceTypes: ['Patient'] }];
    const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions: ACTIONS }, { caps });
    expect(await b.handle('lab', who(['lab.orders.receive']), run('editForm'))).toEqual({
      ok: false, error: 'the action editForm of plugin lab needs one of these permissions: Edit forms',
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(await b.handle('lab', who(['forms.edit']), run('editForm'))).toEqual({ ok: true, data: { ran: 'editForm' } });
  });

  it('a stored row that declares a CE key as its own still only requires it of the caller', async () => {
    // Install refuses this (Task 1). A row written another way gains nothing from it.
    const { b, invoke } = gated({
      permissions: [{ key: 'forms.edit', label: 'Anything', description: '' }],
      actionPermissions: { go: ['forms.edit'] },
    });
    expect(await b.handle('lab', who([]), run('go'))).toEqual({ ok: false, error: 'the action go of plugin lab needs one of these permissions: Edit forms' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a listed key that is neither the plugin\'s own nor a CE capability opens nothing, even to a holder of it', async () => {
    // For example a kept grant of an uninstalled plugin's key.
    const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions: { go: ['other.orders.receive'], both: ['other.orders.receive', 'lab.orders.receive'] } });
    expect(await b.handle('lab', who(['other.orders.receive']), run('go'))).toEqual({
      ok: false, error: 'the action go of plugin lab is closed: it names no permission CE knows',
    });
    expect(await b.handle('lab', who(['other.orders.receive']), run('both'))).toEqual({
      ok: false, error: 'the action both of plugin lab needs one of these permissions: Receive orders',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a malformed stored actionPermissions closes every action', async () => {
    for (const actionPermissions of [null, 'receive', ['receive'], { receive: 'lab.orders.receive' }, { receive: [] }]) {
      const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions });
      const r = await b.handle('lab', who(['lab.orders.receive']), run('receive'));
      expect(r.ok, JSON.stringify(actionPermissions)).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  it('an Administrator, who holds the plugin keys, runs every listed action', async () => {
    const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions: { receive: ACTIONS.receive, enter: ACTIONS.enter } });
    const admin = who(['lab.orders.receive', 'lab.results.enter', 'forms.edit', 'patients.view'], { roles: ['lab_admin'] });
    expect((await b.handle('lab', admin, run('receive'))).ok).toBe(true);
    expect((await b.handle('lab', admin, run('enter'))).ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('the lab_admin role alone does not open an action: the permission does', async () => {
    const { b, invoke } = gated({ permissions: PERMISSIONS, actionPermissions: ACTIONS });
    expect((await b.handle('lab', who([], { roles: ['lab_admin'] }), run('receive'))).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a caller let in by a capability may run an action it holds the permission for, and nothing else', async () => {
    const ui = { requiredCapabilities: ['lab.orders.receive'] };
    const { b, invoke } = gated({ ui, permissions: PERMISSIONS, actionPermissions: ACTIONS });
    const site = who(['lab.orders.receive']);
    expect(await b.handle('lab', site, run('receive'))).toEqual({ ok: true, data: { ran: 'receive' } });
    // The action gate still decides: the caller lacks forms.edit.
    expect((await b.handle('lab', site, run('editForm'))).ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    // Storage and other ops stay closed to a caller let in by a capability, as before.
    expect(await b.handle('lab', site, { kind: 'storage.get', collection: 'c', key: 'k' })).toEqual({
      ok: false, error: "operation storage.get is not open to a caller without the plugin's role",
    });
    // Without the opening capability the page itself is closed.
    expect((await b.handle('lab', who(['lab.results.enter']), run('enter'))).ok).toBe(false);
  });

  it('a corrector gains no action: holding imports.correct_held does not open an action that needs another key', async () => {
    const ui = { requiredRoles: ['lab_admin'], requiredCapabilities: ['imports.correct_held'] };
    const { b, invoke } = gated({ ui, permissions: PERMISSIONS, actionPermissions: ACTIONS });
    expect((await b.handle('lab', who(['imports.correct_held']), run('receive'))).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  describe('a plugin without actionPermissions behaves exactly as before', () => {
    it('any caller with the plugin open runs any entrypoint', async () => {
      const { b, invoke } = gated({ permissions: PERMISSIONS });
      expect(await b.handle('lab', who([]), run('anything'))).toEqual({ ok: true, data: { ran: 'anything' } });
      expect(invoke).toHaveBeenCalledWith('anything', {});
    });

    it('a caller let in by a capability may still make only the corrector\'s calls, not invoke', async () => {
      const ui = { requiredRoles: ['lab_admin'], requiredCapabilities: ['imports.correct_held'] };
      const { b, invoke } = gated({ ui });
      const corrector = who(['imports.correct_held']);
      expect(await b.handle('lab', corrector, run('receive'))).toEqual({ ok: false, error: "operation invoke is not open to a caller without the plugin's role" });
      expect(invoke).not.toHaveBeenCalled();
      // A corrector's call passes the opening gate (and then needs host:import, which this plugin lacks).
      expect(await b.handle('lab', corrector, { kind: 'import.check.access' })).toEqual({
        ok: false, error: 'operation import.check.access requires the host:import capability, which plugin lab was not granted',
      });
      // A caller holding the role invokes as before.
      expect((await b.handle('lab', who([], { roles: ['lab_admin'] }), run('receive'))).ok).toBe(true);
    });
  });

  describe('with the real host functions', () => {
    const registry: ScopeRegistryRow[] = [
      { id: 'fac-1', name: 'One', facility_code: null, region: 'Dodoma', district: 'Kondoa' },
      { id: 'fac-2', name: 'Two', facility_code: null, region: 'Dodoma', district: 'Chamwino' },
    ];
    const shapes: TableShape[] = [{
      name: 'orders',
      columns: [{ name: 'id', type: 'integer' }, { name: 'facility', type: 'text' }],
      primaryKey: ['id'],
      facilityColumn: 'facility',
    }];
    const caps = [{ kind: 'host:db' }, { kind: 'emit-fhir', resourceTypes: ['Patient'] }];

    async function setup() {
      const mem = newDb();
      mem.public.interceptQueries((q) => (/^set local statement_timeout/i.test(q.trim()) ? [] : null));
      const db = mem.adapters.createKysely() as Kysely<any>;
      await createPluginSchemas(db, PG_MEM_WITHOUT_RLS).apply('lab', shapes);
      const requests = createPluginRequests(db);
      await requests.write('lab', shapes, { userId: 'seed', displayName: null, capabilities: [], facilities: '*' }, { steps: [
        { op: 'insert', table: 'orders', values: { id: 1, facility: 'fac-1' } },
        { op: 'insert', table: 'orders', values: { id: 2, facility: 'fac-2' } },
      ] });
      const persist = vi.fn(async () => []);
      const host = createPluginHost({
        requests,
        patients: {} as any, pluginRefKey: async () => Buffer.alloc(32), testCatalog: {} as any, terminology: {} as any, facilityRegistry: {} as any,
        fhirGetWithProvenance: async () => null, persist, audit: async () => {}, logger,
      });
      // What the plugin's code would do: call the host function the input names.
      const runner = {
        async run(_wasm: Uint8Array, input: Uint8Array, opts: any) {
          const req = JSON.parse(new TextDecoder().decode(input));
          const out = await opts.hostFns[req.fn](req.args);
          return new TextEncoder().encode(JSON.stringify(out));
        },
      };
      const manifest = parseManifest({ id: 'lab', version: '0.1.0', kind: 'sink', entrypoints: ['list', 'emit'], wasmSha256: 'a'.repeat(64) });
      const sink = createWasmSink(manifest, new Uint8Array([0]), runner as never, logger, caps as never, shapes);
      const { b } = gated(
        { permissions: PERMISSIONS, actionPermissions: { list: ['lab.orders.receive'], emit: ['lab.results.enter'] } },
        { caps, sink, host, resolveFacilities: async (scope) => facilityIdsInScope(registry, scope) },
      );
      return { b, persist };
    }
    const limited = (capabilities: string[]) => who(capabilities, { dataScope: { limited: true as const, facilities: ['fac-1'], districts: [], regions: [] } });
    const listOp = run('list', { fn: 'db_select', args: { table: 'orders', columns: ['id'], orderBy: [{ column: 'id' }] } });
    const emitOp = run('emit', { fn: 'fhir_emit', args: { resources: [{ resourceType: 'Patient', id: 'p1' }] } });

    it('a facility-limited caller with the permission reaches the action, and db_select sees only its facility', async () => {
      const { b } = await setup();
      const r = await b.handle('lab', limited(['lab.orders.receive']), listOp) as any;
      expect(r.ok).toBe(true);
      expect(r.data).toEqual({ ok: true, result: { rows: [{ id: 1 }] } });
      expect((await b.handle('lab', limited(['lab.results.enter']), listOp)).ok).toBe(false);
    });

    it('fhir_emit needs the action\'s permission, and still refuses a facility-limited caller who holds it', async () => {
      const { b, persist } = await setup();
      expect(await b.handle('lab', who(['lab.orders.receive']), emitOp)).toEqual({
        ok: false, error: 'the action emit of plugin lab needs one of these permissions: Enter results',
      });
      const r = await b.handle('lab', limited(['lab.results.enter']), emitOp) as any;
      expect(r.ok).toBe(true);
      expect(r.data).toMatchObject({ ok: false, error: { code: 'OUTSIDE_DATA_LIMIT' } });
      expect(persist).not.toHaveBeenCalled();
    });
  });
});

describe('plugin broker: the active version\'s manifest (plugin host 2b task 3, fix round 1)', () => {
  const PERMISSIONS = [{ key: 'lab.orders.receive', label: 'Receive orders', description: '' }];
  const gatedPayload = { permissions: PERMISSIONS, actionPermissions: { receive: ['lab.orders.receive'] } };
  const manifest = (version: string, payload?: Record<string, unknown>) => ({ id: 'lab', version, capabilities: [], ...(payload ? { payload } : {}) });
  const nobody = { id: 'u1', roles: [] as string[], dataScope: ALL_DATA, capabilities: [] as string[] };

  async function withStore() {
    const store = createPluginStore(await makeMigratedDb());
    const loaded: Array<string | undefined> = [];
    const invoke = vi.fn(async () => ({ ran: true }));
    const b = createPluginBroker({
      plugins: { list: () => store.list(), loadSink: async (_id: string, version?: string) => { loaded.push(version); return { invoke }; } },
      pluginData: memData().store as any,
      reporting: defaultReporting(),
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
    });
    return { store, b, invoke, loaded };
  }
  const install = (store: ReturnType<typeof createPluginStore>, version: string, payload?: Record<string, unknown>) =>
    store.install({ id: 'lab', version, sha256: version, manifest: manifest(version, payload), approvedBy: null });

  it('after 0.2.0 is upgraded to 0.10.0, the gate reads 0.10.0, not the older row the list sorts first', async () => {
    const { store, b, invoke, loaded } = await withStore();
    await install(store, '0.2.0');
    await install(store, '0.10.0', gatedPayload);
    // Both rows are enabled; text order puts 0.2.0 before 0.10.0.
    const rows = (await store.list()).filter((r) => r.id === 'lab');
    expect(rows.map((r) => [r.version, r.enabled, r.active])).toEqual([['0.2.0', true, false], ['0.10.0', true, true]]);

    expect(await b.handle('lab', nobody, { kind: 'invoke', entrypoint: 'receive', input: {} })).toEqual({
      ok: false, error: 'the action receive of plugin lab needs one of these permissions: Receive orders',
    });
    expect(await b.handle('lab', nobody, { kind: 'invoke', entrypoint: 'anything', input: {} })).toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();

    expect((await b.handle('lab', { ...nobody, capabilities: ['lab.orders.receive'] }, { kind: 'invoke', entrypoint: 'receive', input: {} })).ok).toBe(true);
    expect(loaded).toEqual(['0.10.0']);
  });

  it('after a rollback, the rolled-back version\'s manifest is the one read', async () => {
    const { store, b, invoke, loaded } = await withStore();
    await install(store, '0.1.0', gatedPayload);
    await install(store, '0.2.0');
    // 0.2.0 has no actionPermissions: any caller runs any entrypoint, as before.
    expect((await b.handle('lab', nobody, { kind: 'invoke', entrypoint: 'anything', input: {} })).ok).toBe(true);
    await store.rollback('lab', '0.1.0');
    expect((await b.handle('lab', nobody, { kind: 'invoke', entrypoint: 'anything', input: {} })).ok).toBe(false);
    expect((await b.handle('lab', nobody, { kind: 'invoke', entrypoint: 'receive', input: {} })).ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual(['0.2.0']);
  });

  it('a plugin with no active row is refused', async () => {
    const row = { id: 'lab', version: '0.1.0', enabled: true, active: false, manifest: manifest('0.1.0') };
    const b = createPluginBroker({
      plugins: { list: async () => [row], loadSink: async () => ({ invoke: async () => ({}) }) },
      pluginData: memData().store as any, reporting: defaultReporting(),
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
    });
    expect(await b.handle('lab', nobody, { kind: 'storage.get', collection: 'c', key: 'k' })).toEqual({ ok: false, error: 'plugin lab is not installed or disabled' });
  });
});
