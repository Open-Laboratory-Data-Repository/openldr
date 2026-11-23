import { beginOp, type Logger } from '@openldr/core';
import type { Capability } from '@openldr/marketplace';
import type { PluginCaller, TableShape } from '@openldr/db';
import type { PluginManifest } from './manifest';
import type { HostFn, PluginRunner, RunnerHostFns } from './runner';
import { hasHostFnCapability, type PluginHost } from './plugin-host';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface SinkInvokeOptions {
  /** Extism config map — the per-call connection/secrets (e.g. baseUrl, username, password). */
  config?: Record<string, string>;
  /** Concrete egress host(s) the connector pins for this call, e.g. ['dhis2.example.org:443'].
   *  Omit/empty for a dry-run (no network). */
  allowedHosts?: string[];
  /** Run the call on a worker thread when the process allows it. For a long call only: a worker
   *  starts for each call, which costs more than a small call takes. */
  offThread?: boolean;
  /** The signed-in person the call is made for, from CE's session. With `host`, it gives the
   *  plugin the host functions its grant allows (db_select, db_write, ce_read, fhir_emit). */
  caller?: PluginCaller;
  /** Builds the host functions for this call. */
  host?: PluginHost;
}

/** A loaded sink plugin: invoke one of its named entrypoints with a JSON request,
 *  get back the parsed JSON response. Mirrors `Converter` for sinks. */
export interface WasmSink {
  id: string;
  version: string;
  entrypoints: string[];
  invoke(entrypoint: string, input: unknown, opts?: SinkInvokeOptions): Promise<unknown>;
  invokeBytes(entrypoint: string, bytes: Uint8Array, opts?: SinkInvokeOptions): Promise<unknown>;
}

export function createWasmSink(
  manifest: PluginManifest,
  wasm: Uint8Array,
  runner: PluginRunner,
  logger: Logger,
  grant?: Capability[],
  /** The tables the stored manifest declares (payload.tables). */
  tables: TableShape[] = [],
): WasmSink {
  const host: RunnerHostFns = {
    log(level, msg) {
      const fn = (logger as unknown as Record<string, (o: unknown, m?: string) => void>)[level] ?? logger.info;
      fn.call(logger, { plugin: manifest.id }, msg);
    },
    progress(done, total) {
      logger.debug({ plugin: manifest.id, done, total }, 'sink progress');
    },
  };
  // `grant === undefined` = a genuinely pre-capability (grandfathered) row -> unrestricted.
  // Any installed sink carries a grant array, so egress is gated on the net-egress capability.
  const enforced = grant !== undefined;
  const hasNetEgress = enforced && grant.some((c) => c.kind === 'net-egress');
  // A plugin that reads CE or its own tables imports those host functions, so it cannot even load
  // without them. Such a call needs a caller.
  const needsCaller = enforced && grant.some((c) => c.kind === 'host:db' || c.kind === 'host:ce-read');

  /** The host functions for this call. The plugin's id, version, grant and tables come from the
   *  stored manifest, and the caller from CE, so nothing the plugin sends can change them. */
  function hostFnsFor(opts: SinkInvokeOptions): Record<string, HostFn> | undefined {
    if (enforced && opts.host && opts.caller && hasHostFnCapability(grant)) {
      const fns = opts.host.forCall({ id: manifest.id, version: manifest.version, capabilities: grant, tables }, opts.caller);
      return Object.keys(fns).length > 0 ? fns : undefined;
    }
    if (needsCaller) {
      throw new Error(`sink ${manifest.id}: this plugin reads CE through host functions, which need a signed-in caller, and this call has none`);
    }
    return undefined;
  }

  async function runEntrypoint(entrypoint: string, inputBytes: Uint8Array, opts: SinkInvokeOptions): Promise<unknown> {
    if (!manifest.entrypoints.includes(entrypoint)) {
      throw new Error(
        `sink ${manifest.id}: unknown entrypoint '${entrypoint}' (declared: ${manifest.entrypoints.join(', ') || 'none'})`,
      );
    }
    // Egress model (deliberately differs from the converter): the connector pins the
    // CONCRETE host at runtime via opts.allowedHosts — trusted host-side config from the
    // resolved connector. The plugin's net-egress capability is an INTENT/presence gate
    // only; its declared allowedHosts list is usually empty ("host decides"), so we must
    // NOT replace opts.allowedHosts with allowedHosts(grant) (that would pin [] = deny-all
    // and break every real push). Extism enforces that only the pinned host is reachable.
    // Fail-closed: a host may only be pinned if the plugin declared net-egress intent.
    if (opts.allowedHosts && opts.allowedHosts.length > 0 && enforced && !hasNetEgress) {
      throw new Error(
        `sink ${manifest.id}: egress to ${opts.allowedHosts.join(', ')} requested but the plugin has no net-egress capability`,
      );
    }
    // Stamp the op as in-flight (pluginId + entrypoint) for the crash-capture trail: if the
    // Extism worker async-crashes the whole process during this call, the uncaughtException
    // handler (apps/server) reads this snapshot so the crash marker names the culprit. Every
    // wasm execution flows through here (broker invoke, connector egress, headless schedule
    // pushes, dry-runs), so this is the single authoritative stamp. Cleared in `finally`.
    const hostFns = hostFnsFor(opts);
    const doneOp = beginOp({ pluginId: manifest.id, op: 'invoke', entrypoint });
    let out: Uint8Array;
    try {
      out = await runner.run(wasm, inputBytes, {
        entrypoint,
        wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs,
        config: opts.config,
        host,
        allowedHosts: opts.allowedHosts,
        offThread: opts.offThread,
        ...(hostFns ? {
          hostFns,
          onHostError: (fn: string, err: unknown) => logger.error({ err, plugin: manifest.id, fn }, 'plugin host function failed'),
        } : {}),
      });
    } finally {
      doneOp();
    }
    const text = decoder.decode(out).trim();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      throw new Error(
        `sink ${manifest.id} entrypoint '${entrypoint}' returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    id: manifest.id,
    version: manifest.version,
    entrypoints: manifest.entrypoints,
    invoke: (entrypoint, input, opts = {}) => runEntrypoint(entrypoint, encoder.encode(JSON.stringify(input ?? {})), opts),
    invokeBytes: (entrypoint, bytes, opts = {}) => runEntrypoint(entrypoint, bytes, opts),
  };
}
