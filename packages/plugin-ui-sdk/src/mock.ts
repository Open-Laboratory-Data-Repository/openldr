import type { OpenLdrPluginApi, PluginCopyRun, PluginCopyStatus, PluginSiteName } from './types';

function mockCopy(pluginId: string, connectorId: string, status: PluginCopyStatus): PluginCopyRun {
  const at = new Date(0).toISOString();
  return {
    id: 'mock-copy', kind: 'copy', rev: 1, pluginId, pluginVersion: '0.0.0', connectorId, status, options: {}, pageSize: 500,
    sets: {}, setOrder: [], setSql: {}, waiting: null, startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: 'mock',
  };
}

export interface MockOptions {
  pluginId: string;
  capabilities?: string[];
  theme?: 'light' | 'dark';
  locale?: string;
  site?: PluginSiteName;
  reports?: unknown[];
}

/** An in-memory implementation of OpenLdrPluginApi for local plugin development + tests. */
export function createMockOpenldr(opts: MockOptions): OpenLdrPluginApi {
  const mem = new Map<string, unknown>();
  const k = (c: string, key: string) => `${c} ${key}`;
  return {
    pluginId: opts.pluginId,
    capabilities: opts.capabilities ?? [],
    theme: opts.theme ?? 'light',
    locale: opts.locale ?? 'en',
    site: opts.site ?? 'page',
    ready: Promise.resolve(),
    storage: {
      async get(c, key) { return mem.has(k(c, key)) ? mem.get(k(c, key)) : null; },
      async put(c, key, doc) { mem.set(k(c, key), doc); },
      async delete(c, key) { mem.delete(k(c, key)); },
      async list(c) {
        return [...mem.entries()]
          .filter(([kk]) => kk.startsWith(`${c} `))
          .map(([kk, doc]) => ({ collection: c, key: kk.split(' ')[1], doc }));
      },
    },
    async invoke(_e, input) { return { echoed: input }; },
    reports: {
      async list() { return opts.reports ?? []; },
      async columns() { return []; },
      async run() { return { columns: [], rows: [] }; },
      async eventSources() { return []; },
    },
    connectors: {
      async list() { return []; },
      async test() { return { ok: true }; },
      async metadata() { return {}; },
      async push() { return { ok: true, skipped: [] }; },
      async validate() { return { ok: true }; },
    },
    fhir: { async facilities() { return []; } },
    schedule: {
      async register() { return { ok: true }; },
      async list() { return []; },
      async remove() { return { ok: true }; },
    },
    imports: {
      async allowed() { return []; },
      async diagnose() { return { ok: true, steps: [] }; },
      async checks() { return []; },
      async start() { return { id: 'mock-run', status: 'running' }; },
      async status() { return null; },
      async list() { return []; },
      async failures() { return []; },
      async stop() { return { id: 'mock-run', status: 'stopping' }; },
      async resume() { return { id: 'mock-run', status: 'running' }; },
      copy: {
        async start(input) { return { run: mockCopy(opts.pluginId, input.connectorId, 'queued') }; },
        async list() { return []; },
        async status() { return null; },
        async stop() { return mockCopy(opts.pluginId, 'mock-connector', 'stopping'); },
        async remove() { return mockCopy(opts.pluginId, 'mock-connector', 'deleting'); },
      },
    },
  };
}
