import createPlugin from '@extism/extism';
import type { CurrentPlugin } from '@extism/extism';
import { HOST_FN_MAX_BYTES, type HostFn, type PluginRunner, type RunOptions } from './runner';

/**
 * Real Extism-backed runner (@extism/extism@1.0.3).
 *
 * Sandbox notes:
 * - Isolation is default-deny: `allowedPaths` is left unset, so the plugin gets
 *   no host filesystem access. WASI is opt-in per plugin.
 * - Network egress is restricted to the granted `allowedHosts` list (passed from the
 *   capability grant / connector via `opts.allowedHosts`). An empty list or undefined
 *   means default-deny — no outbound connections are permitted.
 * - Execution path is chosen per call:
 *     - No egress requested (allowedHosts empty) -> FOREGROUND (in-process). Faster (no
 *       worker spawn); used by ingest converters and sink dry-runs. HTTP is unavailable
 *       here — the http_request stub throws if a foreground plugin attempts egress.
 *     - `offThread` asked for, in a process that allows it -> WORKER too, with no egress. Used by
 *       the import check's decode call, which takes over a second a page and would hold the
 *       main thread for that long. A new worker starts for each call (about 20 ms), so a small
 *       call is faster in the foreground and must not ask for this.
 *     - Egress requested (allowedHosts non-empty) -> WORKER (off-thread). The SDK's
 *       HttpContext performs the fetch on the host restricted to allowedHosts and bridges
 *       it back to the synchronous wasm call via SharedArrayBuffer + Atomics. This is the
 *       only path that can do HTTP (a foreground host function can't return a Promise to a
 *       synchronous wasm import). Verified working on Node 22 (prod) + 24 (dev); the older
 *       `ERR_INVALID_URL` data-URL worker bug is fixed in both.
 * - http_request / http_status_code are supplied by the SDK's HttpContext on the worker
 *   path (it overrides ours). http_headers is NOT supplied by HttpContext but IS imported
 *   by newer extism-pdk builds (e.g. dhis2-sink), so we provide it (0n = no response
 *   headers) on both paths so the module always links. On the foreground path our
 *   http_request stub throws loudly (no silent no-op) if egress is attempted.
 * - The 1.0.3 JS SDK exposes no memory-page/timeout option. The watchdog below bounds
 *   async overruns; on the worker path `plugin.close()` terminates the worker (a hard
 *   stop), on the foreground path it cannot interrupt a synchronous runaway.
 *
 * Crash capture: the SDK spawns its worker internally and does not expose the `Worker`
 * instance, so we cannot attach a direct `worker.on('error')` here. A worker that throws
 * *synchronously* surfaces as a rejected `plugin.call` (caught by the caller — a normal
 * failure, not a process crash); a worker that emits an uncaught async 'error' propagates to
 * the main thread and kills the process before any handler in this function can run. That
 * fatal case is captured out-of-band: every wasm call is stamped in the in-flight registry by
 * the call-path wrapper (`createWasmSink` / `createWasmConverter` via `@openldr/core` `beginOp`),
 * and apps/server's `uncaughtException` handler snapshots that registry into a durable crash
 * marker — so the marker names the plugin id + entrypoint that was running when the worker
 * took the process down.
 */
const LOADER_FLAGS = ['--import', '--require', '-r', '--loader', '--experimental-loader'];

/**
 * Whether a plugin call can run on a worker thread in this process. Not when the process was
 * started with a loader flag: the SDK's worker inherits it, and under `tsx` that crashes the whole
 * process (apps/server/dev.mjs says why). The server, the standalone and the CLI start clean.
 */
export function canRunOffThread(execArgv: readonly string[] = process.execArgv): boolean {
  return !execArgv.some((arg) => LOADER_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

/**
 * A fetch that never follows a redirect. The plugin gets the redirect answer itself (its 3xx
 * status) and decides what to do.
 *
 * The SDK checks the host of the address a plugin asks for, then calls fetch. Plain fetch follows
 * a redirect by itself, to any host, and hands the last answer back as if the allowed host had
 * given it. So an allowed host, or anything answering in its place, could send a plugin's call on
 * to a host nobody approved, and the plugin could not tell. Whatever the caller asks for, the
 * redirect mode here is 'manual'.
 */
export function withoutRedirects(base: typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => base(input, { ...init, redirect: 'manual' })) as typeof fetch;
}

/** The status of the answer CE makes when a plugin's network call got no answer at all. */
export const TRANSPORT_STATUS = 599;
/** Why a plugin's network call got no answer. */
export type TransportReason = 'timeout' | 'certificate' | 'unreachable';

/**
 * How long the next network call of one plugin call may take: 10 seconds, or what is left of the
 * whole call less a reserve, when that is lower. Zero when nothing is left. The reserve is 2
 * seconds, or a fifth of the call when the call is shorter than 10 seconds, so a short call still
 * has time for a request. All the network calls of one plugin call share this, so however many it
 * makes, the plugin has its last answer before CE would stop it, and can still record what
 * happened.
 */
export function egressBudget(callLimitMs: number, now: () => number = Date.now): () => number {
  const reserve = Math.min(2_000, Math.floor(callLimitMs / 5));
  const end = now() + callLimitMs - reserve;
  return () => Math.max(0, Math.min(10_000, end - now()));
}

const CERTIFICATE_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/;

function transportReason(err: unknown, timedOut: boolean): TransportReason {
  if (timedOut) return 'timeout';
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const name = (e as { name?: unknown }).name;
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && CERTIFICATE_CODES.test(code)) return 'certificate';
  }
  return 'unreachable';
}

/**
 * A fetch with a time limit that always answers. When the server gives no answer (it is not
 * there, its certificate is not trusted, or it takes too long, also part way through its body),
 * the plugin gets an answer CE made: status 599 and the body `{"openldr":{"transport":"<reason>"}}`.
 * The reason is one word. No address and no error text, which could carry either.
 *
 * Without this a failed call threw inside the SDK and ended the whole plugin call, so a plugin
 * could never record why, and a server that did not answer held the call until CE stopped it.
 * A real answer is handed on as it is, a server's own 5xx included.
 */
export function withTransportAnswer(base: typeof fetch, limitMs: () => number): typeof fetch {
  const answer = (reason: TransportReason): Response =>
    new Response(JSON.stringify({ openldr: { transport: reason } }), { status: TRANSPORT_STATUS, headers: { 'content-type': 'application/json' } });
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const ms = limitMs();
    // Nothing left of the call's time: do not start a request that cannot finish.
    if (ms <= 0) return answer('timeout');
    const limit = AbortSignal.timeout(ms);
    // A signal the caller gave still counts: whichever ends first stops the request.
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    try {
      const res = await base(input, { ...init, signal });
      // The body is read here, under the same limit. Read later, a stalled body would throw in
      // the SDK and end the plugin call after all.
      const body = await res.arrayBuffer();
      const empty = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(empty ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      return answer(transportReason(err, limit.aborted));
    }
  }) as typeof fetch;
}

/** Whether this call takes the worker path: always for pinned hosts, as before; for `offThread`
 *  only where `canRunOffThread` allows it. */
export function usesWorker(opts: Pick<RunOptions, 'allowedHosts' | 'offThread'>, execArgv: readonly string[] = process.execArgv): boolean {
  if ((opts.allowedHosts?.length ?? 0) > 0) return true;
  return opts.offThread === true && canRunOffThread(execArgv);
}

/** The names log and progress already use. A host function may not take them. */
const RESERVED_HOST_NAMES = new Set(['log', 'progress']);

/** Said when a call needs host functions in a process that cannot start a worker (ruling 8). */
export function hostFnsNeedAWorkerMessage(names: string[]): string {
  return `this plugin calls CE host functions (${names.join(', ')}), which run only on a worker thread, `
    + 'and this server was started with a loader (such as tsx) that cannot start one. '
    + 'Start the server without a loader to use this plugin.';
}

type HostFailure = { ok: false; error: { code: string; message: string } };
const failure = (code: string, message: string): HostFailure => ({ ok: false, error: { code, message } });

/** The memory a host function bridge needs: read the plugin's input block, store the answer. */
export interface HostFnMemory {
  read(offset: bigint): { byteLength: number; text(): string } | null;
  store(value: string): bigint;
}

/**
 * Turns one CE host function into an Extism import: reads the plugin's JSON input, calls the
 * function, stores its JSON answer and returns the offset. It never throws: on the worker path a
 * thrown host function closes the plugin and fails the whole call, so every failure becomes a
 * result the plugin reads. Input and output over HOST_FN_MAX_BYTES are refused. An unexpected
 * error's own text is not passed on, since it can name tables or hosts.
 */
export function bridgeHostFn(name: string, fn: HostFn, onError?: (name: string, err: unknown) => void): (cp: HostFnMemory, offset: bigint) => Promise<bigint> {
  const answer = (cp: HostFnMemory, value: unknown): bigint => {
    let text: string;
    try {
      text = JSON.stringify(value === undefined ? null : value);
    } catch {
      text = JSON.stringify(failure('HOST_ERROR', `${name}: the answer could not be written as JSON`));
    }
    if (Buffer.byteLength(text, 'utf8') > HOST_FN_MAX_BYTES) {
      text = JSON.stringify(failure('TOO_LARGE', `${name}: the answer is over ${HOST_FN_MAX_BYTES} bytes; ask for fewer rows`));
    }
    return cp.store(text);
  };
  return async (cp, offset) => {
    const block = cp.read(offset);
    // The size is checked on the block itself, before any of it is decoded.
    if (block && block.byteLength > HOST_FN_MAX_BYTES) {
      return answer(cp, failure('TOO_LARGE', `${name}: the request is over ${HOST_FN_MAX_BYTES} bytes`));
    }
    const raw = block ? block.text() : '';
    let input: unknown;
    try {
      input = raw.trim() === '' ? null : JSON.parse(raw);
    } catch {
      return answer(cp, failure('INVALID_JSON', `${name}: the request is not valid JSON`));
    }
    try {
      return answer(cp, await fn(input));
    } catch (err) {
      onError?.(name, err);
      return answer(cp, failure('HOST_ERROR', `${name} failed inside CE`));
    }
  };
}

export function createExtismRunner(runnerOpts: { execArgv?: readonly string[] } = {}): PluginRunner {
  const execArgv = runnerOpts.execArgv ?? process.execArgv;
  return {
    async run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array> {
      const readStr = (cp: CurrentPlugin, offset: bigint): string => {
        const block = cp.read(offset);
        return block ? block.text() : '';
      };

      // CE host functions are async, and only the worker path awaits an async host function. So a
      // call with any runs there, and fails plainly where no worker can start (ruling 8), rather
      // than running without them.
      const hostFns = opts.hostFns ?? {};
      const hostNames = Object.keys(hostFns);
      for (const n of hostNames) {
        if (RESERVED_HOST_NAMES.has(n)) throw new Error(`host function name '${n}' is reserved`);
      }
      if (hostNames.length > 0 && !canRunOffThread(execArgv)) {
        throw new Error(hostFnsNeedAWorkerMessage(hostNames));
      }
      const userFns: Record<string, (cp: CurrentPlugin, offset: bigint) => Promise<bigint>> = {};
      for (const n of hostNames) {
        // An unexpected error's details go to CE's own logger (onHostError), never to the plugin's
        // log channel.
        const bridged = bridgeHostFn(n, hostFns[n], opts.onHostError);
        userFns[n] = (cp, offset) => bridged(cp as unknown as HostFnMemory, offset);
      }

      // Egress requires the off-thread worker path — the only one that can perform HTTP.
      // No host pinned ⇒ stay in-process (ingest converters, sink dry-runs): faster, no egress.
      // A call that asks for `offThread` takes the worker too, where the process allows it.
      const useWorker = hostNames.length > 0 || usesWorker(opts, execArgv);

      const plugin = await createPlugin(
        { wasm: [{ data: wasm }] },
        {
          useWasi: opts.wasi,
          runInWorker: useWorker,
          config: opts.config ?? {},
          allowedHosts: opts.allowedHosts ?? [],
          // Every HTTP call a plugin makes goes through this. See withoutRedirects.
          fetch: withTransportAnswer(withoutRedirects(fetch), egressBudget(opts.timeoutMs)),
          functions: {
            'extism:host/env': {
              // On the worker path the SDK's HttpContext overrides http_request +
              // http_status_code with real implementations (it does NOT provide
              // http_headers). On the foreground path http_request throws if egress is
              // attempted — never a silent no-op. http_headers (0n = no response headers)
              // is always supplied so newer-extism-pdk modules link on both paths.
              http_request: (_cp: CurrentPlugin, _reqaddr: bigint, _bodyaddr: bigint): bigint => {
                throw new Error('http_request: egress is only available on the worker path (pin an allowedHost)');
              },
              http_status_code: (_cp: CurrentPlugin): number => 0,
              http_headers: (_cp: CurrentPlugin): bigint => 0n,
            },
            'extism:host/user': {
              log(cp: CurrentPlugin, level: bigint, msg: bigint) {
                opts.host.log(readStr(cp, level) || 'info', readStr(cp, msg));
              },
              progress(_cp: CurrentPlugin, done: bigint, total: bigint) {
                opts.host.progress(Number(done), Number(total));
              },
              ...userFns,
            },
          },
        },
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`plugin timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
      });

      try {
        const out: Awaited<ReturnType<typeof plugin.call>> = await Promise.race([plugin.call(opts.entrypoint, input), timeout]);
        return out ? new Uint8Array(out.bytes()) : new Uint8Array();
      } finally {
        if (timer) clearTimeout(timer);
        await plugin.close();
      }
    },
  };
}
