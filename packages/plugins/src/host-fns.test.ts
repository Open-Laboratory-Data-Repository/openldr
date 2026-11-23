import { describe, it, expect, vi } from 'vitest';
import { bridgeHostFn, createExtismRunner, hostFnsNeedAWorkerMessage, usesWorker, type HostFnMemory } from './extism-runner';
import { HOST_FN_MAX_BYTES } from './runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { hasHostFnCapability, type PluginHost } from './plugin-host';
import type { PluginRunner } from './runner';

/** Plugin memory with one input block at offset 1; the stored answer is kept. */
function memory(input: string): HostFnMemory & { stored: string[] } {
  const stored: string[] = [];
  return {
    stored,
    read: (offset) => (offset === 1n ? { byteLength: Buffer.byteLength(input), text: () => input } : null),
    store: (v) => { stored.push(v); return 99n; },
  };
}

describe('host function bridge', () => {
  it('reads the JSON input, calls the function and stores its JSON answer', async () => {
    const fn = vi.fn(async (i: unknown) => ({ ok: true, result: i }));
    const mem = memory('{"table":"orders"}');
    expect(await bridgeHostFn('db_select', fn)(mem, 1n)).toBe(99n);
    expect(fn).toHaveBeenCalledWith({ table: 'orders' });
    expect(JSON.parse(mem.stored[0])).toEqual({ ok: true, result: { table: 'orders' } });
  });

  it('answers bad JSON without calling the function', async () => {
    const fn = vi.fn(async () => ({}));
    const mem = memory('{not json');
    await bridgeHostFn('db_select', fn)(mem, 1n);
    expect(fn).not.toHaveBeenCalled();
    expect(JSON.parse(mem.stored[0])).toEqual({ ok: false, error: { code: 'INVALID_JSON', message: 'db_select: the request is not valid JSON' } });
  });

  it('refuses an input over the limit', async () => {
    const fn = vi.fn(async () => ({}));
    const mem = memory(JSON.stringify({ v: 'x'.repeat(HOST_FN_MAX_BYTES) }));
    await bridgeHostFn('db_write', fn)(mem, 1n);
    expect(fn).not.toHaveBeenCalled();
    expect(JSON.parse(mem.stored[0]).error.code).toBe('TOO_LARGE');
  });

  it('checks the block size before decoding it', async () => {
    const fn = vi.fn(async () => ({}));
    const text = vi.fn(() => '{}');
    const stored: string[] = [];
    const mem: HostFnMemory = { read: () => ({ byteLength: HOST_FN_MAX_BYTES + 1, text }), store: (v) => { stored.push(v); return 1n; } };
    await bridgeHostFn('db_write', fn)(mem, 1n);
    expect(text).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
    expect(JSON.parse(stored[0]).error.code).toBe('TOO_LARGE');
  });

  it('refuses an answer over the limit', async () => {
    const mem = memory('{}');
    await bridgeHostFn('db_select', async () => ({ rows: ['x'.repeat(HOST_FN_MAX_BYTES)] }))(mem, 1n);
    expect(JSON.parse(mem.stored[0]).error.code).toBe('TOO_LARGE');
  });

  it('turns a throw into a plain result, never a crash, and logs the text', async () => {
    const onError = vi.fn();
    const mem = memory('{}');
    await bridgeHostFn('ce_read', async () => { throw new Error('secret host 10.0.0.5'); }, onError)(mem, 1n);
    expect(mem.stored[0]).not.toMatch(/10\.0\.0\.5/);
    expect(JSON.parse(mem.stored[0])).toEqual({ ok: false, error: { code: 'HOST_ERROR', message: 'ce_read failed inside CE' } });
    expect(onError).toHaveBeenCalled();
  });
});

describe('ruling 8: host functions run only on the worker path', () => {
  const host = { log: vi.fn(), progress: vi.fn() };
  const opts = { entrypoint: 'run', wasi: false, memoryMb: 64, timeoutMs: 1000, host };

  it('fails with a plain message on a dev loader, rather than running without them', async () => {
    const runner = createExtismRunner({ execArgv: ['--import', 'tsx'] });
    const run = runner.run(new Uint8Array(), new Uint8Array(), { ...opts, hostFns: { db_select: async () => ({}) } });
    await expect(run).rejects.toThrow(hostFnsNeedAWorkerMessage(['db_select']));
    await expect(runner.run(new Uint8Array(), new Uint8Array(), { ...opts, hostFns: { db_select: async () => ({}) } }))
      .rejects.toThrow(/run only on a worker thread.*Start the server without a loader/);
  });

  it('refuses a host function named like log or progress', async () => {
    const runner = createExtismRunner({ execArgv: [] });
    await expect(runner.run(new Uint8Array(), new Uint8Array(), { ...opts, hostFns: { log: async () => ({}) } }))
      .rejects.toThrow(/reserved/);
  });
});

describe('sink: host functions for a call', () => {
  const manifest = parseManifest({ id: 'lab', version: '0.2.0', kind: 'sink', entrypoints: ['orders_list'], wasmSha256: 'a'.repeat(64) });
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
  const caller = { userId: 'u1', displayName: 'U', capabilities: [], facilities: ['fac-1'] as string[] };
  const tables = [{ name: 'orders', columns: [{ name: 'id', type: 'uuid' as const }], primaryKey: ['id'] }];
  const runner = (): PluginRunner => ({ run: vi.fn(async () => new TextEncoder().encode('{}')) });
  const fakeHost = (): PluginHost => ({ forCall: vi.fn(() => ({ db_select: async () => ({ ok: true }) })) });

  it('builds host functions from the stored id, version, grant and tables, with the CE caller', async () => {
    const r = runner();
    const host = fakeHost();
    const grant = [{ kind: 'host:db' } as const];
    const sink = createWasmSink(manifest, new Uint8Array(), r, logger, grant, tables);
    await sink.invoke('orders_list', { pluginId: 'other', caller: { facilities: '*' } }, { caller, host });
    expect(host.forCall).toHaveBeenCalledWith({ id: 'lab', version: '0.2.0', capabilities: grant, tables }, caller);
    const opts = (r.run as any).mock.calls[0][2];
    expect(Object.keys(opts.hostFns)).toEqual(['db_select']);
  });

  it('sends a host function failure to CE logger with the plugin id, not the plugin log channel', async () => {
    const r = runner();
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
    const sink = createWasmSink(manifest, new Uint8Array(), r, log, [{ kind: 'host:db' }], tables);
    await sink.invoke('orders_list', {}, { caller, host: fakeHost() });
    const opts = (r.run as any).mock.calls[0][2];
    const err = new Error('boom at 10.0.0.5');
    opts.onHostError('db_select', err);
    expect(log.error).toHaveBeenCalledWith({ err, plugin: 'lab', fn: 'db_select' }, 'plugin host function failed');
  });

  it('refuses a host:db plugin call with no caller', async () => {
    const r = runner();
    const sink = createWasmSink(manifest, new Uint8Array(), r, logger, [{ kind: 'host:db' }], tables);
    await expect(sink.invoke('orders_list', {})).rejects.toThrow(/need a signed-in caller/);
    expect(r.run).not.toHaveBeenCalled();
  });

  it('gives no host functions to a plugin without the capabilities, or to a legacy row', async () => {
    for (const grant of [[], undefined]) {
      const r = runner();
      const host = fakeHost();
      const sink = createWasmSink(manifest, new Uint8Array(), r, logger, grant as any, tables);
      await sink.invoke('orders_list', {}, { caller, host });
      expect(host.forCall).not.toHaveBeenCalled();
      expect((r.run as any).mock.calls[0][2].hostFns).toBeUndefined();
    }
  });

  it('an emit-fhir-only plugin gets no host functions and no worker, even with a caller and host', async () => {
    for (const opts of [{}, { caller, host: fakeHost() }] as Array<{ caller?: typeof caller; host?: PluginHost }>) {
      const r = runner();
      const sink = createWasmSink(manifest, new Uint8Array(), r, logger, [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
      await sink.invoke('orders_list', {}, opts);
      const runOpts = (r.run as any).mock.calls[0][2];
      expect(runOpts.hostFns).toBeUndefined();
      expect(usesWorker(runOpts, ['--import', 'tsx'])).toBe(false);
      if (opts.host) expect(opts.host.forCall).not.toHaveBeenCalled();
    }
    expect(hasHostFnCapability([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }])).toBe(false);
    expect(hasHostFnCapability([{ kind: 'host:db' }])).toBe(true);
    expect(hasHostFnCapability([{ kind: 'host:ce-read' }])).toBe(true);
  });
});
