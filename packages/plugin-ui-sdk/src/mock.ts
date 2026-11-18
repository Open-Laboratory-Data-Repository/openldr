import { checkDownload } from './files';
import type { OpenLdrPluginApi, PluginCheckRun, PluginDownloadMime, PluginCheckStatus, PluginCopyRun, PluginCopyStatus, PluginSiteName } from './types';

function mockCopy(pluginId: string, connectorId: string, status: PluginCopyStatus): PluginCopyRun {
  const at = new Date(0).toISOString();
  return {
    id: 'mock-copy', kind: 'copy', rev: 1, pluginId, pluginVersion: '0.0.0', connectorId, status, options: {}, pageSize: 500,
    sets: {}, setOrder: [], setSql: {}, waiting: null, startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: 'mock',
  };
}

function mockCheck(copyId: string, referenceCopyId: string | null, status: PluginCheckStatus): PluginCheckRun {
  const at = new Date(0).toISOString();
  return {
    id: 'mock-check', copyId, referenceCopyId, status, options: {}, pageSize: 500,
    counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} }, laboratories: [],
    waiting: null, startedAt: at, updatedAt: at, finishedAt: null, lastError: null,
  };
}

export interface MockOptions {
  pluginId: string;
  capabilities?: string[];
  theme?: 'light' | 'dark';
  themeTokens?: Record<string, string>;
  locale?: string;
  site?: PluginSiteName;
  reports?: unknown[];
}

/** The mock, plus what a page's test can read back. */
export interface MockOpenLdrPluginApi extends OpenLdrPluginApi {
  /** Each file the page asked to save and the mock accepted, in order. */
  readonly downloads: Array<{ filename: string; mime: PluginDownloadMime; text: string }>;
}

/** An in-memory implementation of OpenLdrPluginApi for local plugin development + tests. */
export function createMockOpenldr(opts: MockOptions): MockOpenLdrPluginApi {
  const mem = new Map<string, unknown>();
  const downloads: Array<{ filename: string; mime: PluginDownloadMime; text: string }> = [];
  const k = (c: string, key: string) => `${c} ${key}`;
  return {
    pluginId: opts.pluginId,
    capabilities: opts.capabilities ?? [],
    theme: opts.theme ?? 'light',
    themeTokens: Object.freeze({ ...(opts.themeTokens ?? {}) }),
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
      check: {
        async start(input) { return mockCheck(input.copyId, input.referenceCopyId, 'queued'); },
        async list() { return []; },
        async status() { return null; },
        async stop() { return mockCheck('mock-copy', null, 'stopping'); },
        async held() { return { rows: [], total: 0 }; },
        async heldItem() { return null; },
        async correct() { return { corrections: [] }; },
        async recheck(input) { return mockCheck(input.copyId, null, 'queued'); },
        async access() { return { full: true, correct: true }; },
        async heldItems(input) { return input.after !== undefined ? { items: [], total: 0, next: null } : { items: [], total: 0 }; },
      },
    },
    // Refuses what the host refuses, except the one-per-second limit, so a test can save twice.
    files: {
      async download(input) {
        const refused = checkDownload(input);
        if (refused) throw new Error(refused);
        downloads.push({ filename: input.filename, mime: input.mime, text: input.text });
      },
    },
    downloads,
  };
}
