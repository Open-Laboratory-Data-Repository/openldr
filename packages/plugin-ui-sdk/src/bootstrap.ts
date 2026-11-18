import type { PluginOp, PluginRpcResult } from './types';

/** Minimal MessagePort surface used by the RPC core (works for real ports + test fakes). */
export interface PortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
}

/** Promise-based, id-correlated RPC over a MessagePort. The host replies { id, result }. */
export function makeRpc(port: PortLike): { call(op: PluginOp): Promise<unknown> } {
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; result?: PluginRpcResult };
    if (typeof msg?.id !== 'number') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    const r = msg.result;
    if (r && r.ok) waiter.resolve(r.data);
    else waiter.reject(new Error(r && !r.ok ? r.error : 'plugin host call failed'));
  };
  port.start?.();
  return {
    call(op) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ id, op });
      });
    },
  };
}

/** The in-iframe runtime, authored as a function so it is reviewable + lintable, then
 *  serialized into SDK_BOOTSTRAP_V1. It references only browser globals (window) + locals —
 *  it must NOT reference module-scope identifiers (it cannot import at runtime in the iframe).
 *  Keep its RPC logic behaviorally identical to makeRpc above. */
function pluginBootstrapV1(): void {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => { resolveReady = r; });
  let port: MessagePort | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  function call(op: unknown): Promise<unknown> {
    if (!port) return Promise.reject(new Error('openldr: not initialized'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port!.postMessage({ id, op });
    });
  }

  // Define window.openldr SYNCHRONOUSLY at bootstrap time, BEFORE the plugin's bundled
  // script runs. The init handshake (port + context) arrives asynchronously on iframe
  // onLoad; until then `port` is null so `call()` rejects, and `ready` stays pending.
  // Screens MUST `await openldr.ready` before issuing host calls. Defining the binding
  // up front avoids a race where a screen mounts and reads `window.openldr` (e.g. via
  // getOpenldr()) before the first 'openldr:init' message is processed.
  const api = {
    pluginId: '',
    capabilities: [] as string[],
    theme: 'light',
    themeTokens: Object.freeze({}) as Readonly<Record<string, string>>,
    locale: 'en',
    site: 'page',
    ready,
    storage: {
      get: (c: string, k: string) => call({ kind: 'storage.get', collection: c, key: k }),
      put: (c: string, k: string, doc: unknown) => call({ kind: 'storage.put', collection: c, key: k, doc }),
      delete: (c: string, k: string) => call({ kind: 'storage.delete', collection: c, key: k }),
      list: (c: string, o?: unknown) => call({ kind: 'storage.list', collection: c, ...((o as object) ?? {}) }),
    },
    invoke: (entrypoint: string, input: unknown) => call({ kind: 'invoke', entrypoint, input }),
    reports: {
      list: () => call({ kind: 'reports.list' }),
      columns: (id: string) => call({ kind: 'reports.columns', id }),
      run: (id: string, params?: Record<string, unknown>) => call({ kind: 'reports.run', id, params }),
      eventSources: () => call({ kind: 'reports.eventSources' }),
    },
    connectors: {
      list: () => call({ kind: 'connectors.list' }),
      test: (id: string) => call({ kind: 'connectors.test', id }),
      metadata: (id: string) => call({ kind: 'connectors.metadata', id }),
      push: (input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }) =>
        call({ kind: 'connectors.push', connectorId: input.connectorId, mapping: input.mapping, orgUnitMap: input.orgUnitMap, period: input.period, dryRun: input.dryRun }),
      validate: (input: { connectorId: string; mapping: unknown }) =>
        call({ kind: 'connectors.validate', connectorId: input.connectorId, mapping: input.mapping }),
    },
    fhir: { facilities: () => call({ kind: 'fhir.facilities' }) },
    schedule: {
      register: (schedule: unknown) => call({ kind: 'schedule.register', schedule }),
      list: () => call({ kind: 'schedule.list' }),
      remove: (id: string) => call({ kind: 'schedule.remove', id }),
    },
    imports: {
      allowed: () => call({ kind: 'import.allowed' }),
      diagnose: (connectorId: string) => call({ kind: 'import.diagnose', connectorId }),
      checks: (input: { connectorId: string; options: Record<string, string> }) =>
        call({ kind: 'import.checks', connectorId: input.connectorId, options: input.options }),
      start: (input: { connectorId: string; options: Record<string, string>; pageSize?: number; limit?: number; dryRun?: boolean }) =>
        call({ kind: 'import.start', connectorId: input.connectorId, options: input.options, pageSize: input.pageSize, limit: input.limit, dryRun: input.dryRun }),
      status: (runId: string) => call({ kind: 'import.status', runId }),
      list: () => call({ kind: 'import.list' }),
      failures: (runId: string) => call({ kind: 'import.failures', runId }),
      stop: (runId: string) => call({ kind: 'import.stop', runId }),
      resume: (runId: string) => call({ kind: 'import.resume', runId }),
      copy: {
        start: (input: { connectorId: string; options: Record<string, string>; pageSize?: number; reread?: boolean }) =>
          call({ kind: 'import.copy.start', connectorId: input.connectorId, options: input.options, pageSize: input.pageSize, reread: input.reread }),
        list: () => call({ kind: 'import.copy.list' }),
        status: (copyId: string) => call({ kind: 'import.copy.status', copyId }),
        stop: (copyId: string) => call({ kind: 'import.copy.stop', copyId }),
        remove: (copyId: string) => call({ kind: 'import.copy.delete', copyId, confirm: true }),
      },
      check: {
        start: (input: { copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number; fromStart?: boolean }) =>
          call({ kind: 'import.check.start', copyId: input.copyId, referenceCopyId: input.referenceCopyId, options: input.options, pageSize: input.pageSize, fromStart: input.fromStart }),
        list: () => call({ kind: 'import.check.list' }),
        status: (runId: string) => call({ kind: 'import.check.status', runId }),
        stop: (runId: string) => call({ kind: 'import.check.stop', runId }),
        held: (input: { copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; offset: number; limit: number }) =>
          call({ kind: 'import.check.held', copyId: input.copyId, reason: input.reason, label: input.label, laboratory: input.laboratory, offset: input.offset, limit: input.limit }),
        heldItem: (input: { copyId: string; key: string }) => call({ kind: 'import.check.heldItem', copyId: input.copyId, key: input.key }),
        correct: (input: { copyId: string; key: string; values: Record<string, string | null>; reason: string }) =>
          call({ kind: 'import.check.correct', copyId: input.copyId, key: input.key, values: input.values, reason: input.reason }),
        recheck: (input: { copyId: string; key: string }) => call({ kind: 'import.check.recheck', copyId: input.copyId, key: input.key }),
        access: () => call({ kind: 'import.check.access' }),
        heldItems: (input: { copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; offset?: number; after?: string | null; limit: number }) =>
          call({ kind: 'import.check.heldItems', copyId: input.copyId, reason: input.reason, label: input.label, laboratory: input.laboratory, offset: input.offset, after: input.after, limit: input.limit }),
      },
    },
    // The studio answers this itself and saves the file in its own document.
    files: {
      download: (input: { filename: string; mime: string; text: string }) =>
        call({ kind: 'host.download', filename: input.filename, mime: input.mime, text: input.text }).then(() => undefined),
    },
  };
  (window as unknown as { openldr: unknown }).openldr = api;

  // The theme variables this page set on its root last time, so a name the host no longer
  // sends can be removed.
  let setNames: string[] = [];

  /** Stamp light or dark on the root. When the host sends tokens, set each `--openldr-*`
   *  variable on the root and remove the ones it stopped sending. No tokens (an older host,
   *  or a message that carries none) leaves the current ones as they are.
   *  setProperty writes the root's inline style, which beats every stylesheet rule, the page's
   *  own included. That is on purpose: the host is the source of truth for these tokens. A
   *  page that wants its own look reads them with a fallback, or does not read them at all. */
  function applyTheme(theme: string, tokens?: unknown): void {
    if (theme === 'light' || theme === 'dark') {
      api.theme = theme;
      try { document.documentElement.setAttribute('data-openldr-theme', theme); } catch { /* no-op */ }
    }
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return;
    const next: Record<string, string> = {};
    for (const name of Object.keys(tokens)) {
      const value = (tokens as Record<string, unknown>)[name];
      if (!/^--openldr-[a-z0-9-]{1,40}$/.test(name)) continue;
      if (typeof value !== 'string' || value.length > 200 || /[<>{};]/.test(value)) continue;
      next[name] = value;
    }
    try {
      const style = document.documentElement.style;
      for (const name of setNames) if (!(name in next)) style.removeProperty(name);
      for (const name of Object.keys(next)) style.setProperty(name, next[name]);
    } catch { /* no-op */ }
    setNames = Object.keys(next);
    api.themeTokens = Object.freeze(next);
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as { type?: string; theme?: string; tokens?: unknown; context?: Record<string, unknown> } | undefined;
    // Live host theme changes (the host posts these when the user toggles dark/light).
    if (data && data.type === 'openldr:theme') { applyTheme(data.theme ?? 'light', data.tokens); return; }
    if (!data || data.type !== 'openldr:init' || port) return;
    port = ev.ports[0];
    if (!port) return;
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as { id?: number; result?: { ok: boolean; data?: unknown; error?: string } };
      if (typeof m?.id !== 'number') return;
      const w = pending.get(m.id);
      if (!w) return;
      pending.delete(m.id);
      if (m.result && m.result.ok) w.resolve(m.result.data);
      else w.reject(new Error(m.result?.error ?? 'plugin host call failed'));
    };
    port.start();
    const ctx = (data.context ?? {}) as { pluginId?: string; capabilities?: string[]; theme?: string; themeTokens?: unknown; locale?: string; site?: string };
    api.pluginId = ctx.pluginId ?? '';
    api.capabilities = ctx.capabilities ?? [];
    applyTheme(ctx.theme ?? 'light', ctx.themeTokens);
    api.locale = ctx.locale ?? 'en';
    // Where the host drew this page: its own page, a dashboard card, or the side panel.
    api.site = ctx.site === 'widget' || ctx.site === 'panel' ? ctx.site : 'page';
    resolveReady();
  });
}

/** The bootstrap source the host inlines as the first <script> in the iframe document. */
export const SDK_BOOTSTRAP_V1: string = `(${pluginBootstrapV1.toString()})();`;
