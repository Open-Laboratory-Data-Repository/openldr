export interface RunnerHostFns {
  log(level: string, msg: string): void;
  progress(done: number, total: number): void;
}

/** A CE host function a plugin can call: one JSON value in, one JSON value out. It never throws on
 *  purpose; a failure is a result the plugin reads (`{ ok: false, error: { code, message } }`). */
export type HostFn = (input: unknown) => Promise<unknown>;

/** The largest JSON a host function takes in or gives back, in bytes. Larger is refused. */
export const HOST_FN_MAX_BYTES = 1_000_000;

export interface RunOptions {
  entrypoint: string;
  wasi: boolean;
  memoryMb: number;
  timeoutMs: number;
  host: RunnerHostFns;
  config?: Record<string, string>;
  allowedHosts?: string[]; // net-egress allowlist; undefined/[] = default-deny (no egress)
  /** Runs the call on a worker thread when the process allows it (see `canRunOffThread`). */
  offThread?: boolean;
  /** CE host functions for this call, by name, registered beside log and progress. Host functions
   *  are async, so a call that has any runs on the worker path, and fails with a plain message
   *  where the process cannot start a worker. */
  hostFns?: Record<string, HostFn>;
  /** Told when a host function throws unexpectedly. The caller logs it to CE's own logger. */
  onHostError?: (name: string, err: unknown) => void;
}

/**
 * Executes a wasm plugin once and returns its raw output bytes. The only
 * abstraction over the Extism host SDK — everything else is tested against a
 * fake implementation of this interface.
 */
export interface PluginRunner {
  run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array>;
}
