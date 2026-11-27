import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginHostOp, PluginRpcResult } from '@openldr/plugin-ui-sdk';
import { createSerialGate, type SerialGateDeps, type SerialLike, type SerialPortLike } from './serial-gate';

/** Lets every pending promise run. Streams settle over several turns. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r));
}

type Listener = (ev: { target: unknown }) => void;

/** A port whose incoming bytes the test pushes, and whose writes it records. */
function fakePort(o: { info?: { usbVendorId?: number; usbProductId?: number }; openFails?: boolean; closeFails?: boolean } = {}) {
  const events: string[] = [];
  const written: number[][] = [];
  let push: (bytes: Uint8Array) => void = () => {};
  let fail: (err: Error) => void = () => {};
  /** While set, a write does not finish until it is called. */
  let unblock: (() => void) | null = null;
  let blockWrites = false;
  let holdOpen: Promise<void> | null = null;
  let holdClose: Promise<void> | null = null;
  const opened: unknown[] = [];
  const port: SerialPortLike & { __name?: string } = {
    readable: null,
    writable: null,
    async open(options) {
      events.push('open');
      opened.push(options);
      if (holdOpen) await holdOpen;
      if (o.openFails) throw Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' });
      port.readable = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (bytes) => controller.enqueue(bytes);
          fail = (err) => controller.error(err);
        },
        cancel() { events.push('reader.cancel'); },
      }, { highWaterMark: 0 });
      port.writable = new WritableStream<Uint8Array>({
        write(chunk) {
          written.push(Array.from(chunk));
          if (!blockWrites) return undefined;
          return new Promise<void>((resolve) => { unblock = resolve; });
        },
        abort() { events.push('writer.abort'); },
      });
    },
    async close() {
      if (port.readable?.locked) throw Object.assign(new Error('The port is locked.'), { name: 'InvalidStateError' });
      if (port.writable?.locked) throw Object.assign(new Error('The port is locked.'), { name: 'InvalidStateError' });
      events.push('port.close');
      if (holdClose) await holdClose;
      events.push('port.closed');
      port.readable = null;
      port.writable = null;
      if (o.closeFails) throw new Error('close failed');
    },
    getInfo: () => o.info ?? {},
  };
  return {
    port, events, written, opened,
    push: (bytes: number[] | Uint8Array) => push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    fail: (err: Error) => fail(err),
    blockWrites: () => { blockWrites = true; },
    unblock: () => unblock?.(),
    holdOpen: () => { let release = () => {}; holdOpen = new Promise<void>((r) => { release = r; }); return release; },
    holdClose: () => { let release = () => {}; holdClose = new Promise<void>((r) => { release = r; }); return release; },
  };
}

function harness(o: { granted?: boolean | undefined; noSerial?: boolean; elsewhere?: (p: SerialPortLike) => boolean } = {}) {
  const state = { granted: 'granted' in o ? o.granted : true as boolean | undefined };
  const listeners: Listener[] = [];
  const serial: SerialLike = {
    requestPort: async () => { throw new Error('the gate never asks the browser itself'); },
    addEventListener: (_t, l) => void listeners.push(l),
    removeEventListener: (_t, l) => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); },
  };
  /** What the next pick() answers. A test may hold it open. */
  const picks: Array<Awaited<ReturnType<SerialGateDeps['pick']>> | Promise<Awaited<ReturnType<SerialGateDeps['pick']>>>> = [];
  let pickCalls = 0;
  let cancels = 0;
  const gate = createSerialGate({
    serial: o.noSerial ? undefined : serial,
    granted: () => state.granted,
    pick: async () => { pickCalls++; const next = picks.shift(); if (next === undefined) throw new Error('no pick prepared'); return next; },
    openElsewhere: (p) => o.elsewhere?.(p) ?? false,
    cancelPick: () => void cancels++,
  });
  const call = (op: PluginHostOp): Promise<PluginRpcResult> => gate.handle(op);
  /** Chooses `fake` and returns its handle. */
  const choose = async (fake: { port: SerialPortLike }): Promise<string> => {
    picks.push({ port: fake.port });
    const r = await call({ kind: 'host.serial.choose' });
    if (!r.ok) throw new Error(`choose refused: ${r.error}`);
    return (r.data as { port: string }).port;
  };
  const openPort = async (fake: { port: SerialPortLike }, settings: Record<string, unknown> = { baudRate: 9600 }): Promise<string> => {
    const handle = await choose(fake);
    const r = await call({ kind: 'host.serial.open', port: handle, settings: settings as never });
    if (!r.ok) throw new Error(`open refused: ${r.error}`);
    return handle;
  };
  const read = async (handle: string, waitMs = 0) => {
    const r = await call({ kind: 'host.serial.read', port: handle, waitMs });
    if (!r.ok) throw new Error(r.error);
    return r.data as { bytes: Uint8Array; lost: boolean };
  };
  const disconnect = (p: SerialPortLike) => { for (const l of [...listeners]) l({ target: p }); };
  return { gate, call, choose, openPort, read, picks, state, listeners, disconnect, pickCalls: () => pickCalls, cancels: () => cancels };
}

const refused = (error: string): PluginRpcResult => ({ ok: false, error });
const ALL_OPS: PluginHostOp[] = [
  { kind: 'host.serial.ports' },
  { kind: 'host.serial.choose' },
  { kind: 'host.serial.open', port: 'x', settings: { baudRate: 9600 } },
  { kind: 'host.serial.read', port: 'x', waitMs: 0 },
  { kind: 'host.serial.write', port: 'x', bytes: new Uint8Array([1]) },
  { kind: 'host.serial.close', port: 'x' },
];

afterEach(() => { vi.useRealTimers(); });

describe('serial gate: who may call', () => {
  it('refuses every op until the grant is known, and when it is false', async () => {
    for (const granted of [undefined, false]) {
      const h = harness({ granted });
      for (const op of ALL_OPS) expect(await h.call(op), `${String(granted)} ${op.kind}`).toEqual(refused('serial-not-granted'));
      expect(h.pickCalls()).toBe(0);
    }
  });

  it('refuses every op when the browser has no serial feature, and shows no prompt', async () => {
    const h = harness({ noSerial: true });
    for (const op of ALL_OPS) expect(await h.call(op), op.kind).toEqual(refused('serial-unavailable'));
    expect(h.pickCalls()).toBe(0);
  });

  it('says not granted before it says unavailable', async () => {
    const h = harness({ granted: false, noSerial: true });
    expect(await h.call({ kind: 'host.serial.ports' })).toEqual(refused('serial-not-granted'));
  });

  it('refuses an op that is not a serial one', async () => {
    const h = harness();
    expect((await h.call({ kind: 'host.print', title: 't', paper: 'A4', pages: [] })).ok).toBe(false);
  });
});

describe('serial gate: choosing a port', () => {
  it('passes on each refusal from the prompt as it is', async () => {
    const h = harness();
    for (const why of ['serial-cancelled', 'serial-unavailable', 'serial-busy', 'serial-failed'] as const) {
      h.picks.push({ refused: why });
      expect(await h.call({ kind: 'host.serial.choose' })).toEqual(refused(why));
    }
  });

  it('gives a handle of 16 hex characters and a label with the maker and product numbers', async () => {
    const h = harness();
    h.picks.push({ port: fakePort({ info: { usbVendorId: 0x0403, usbProductId: 0x6001 } }).port });
    const r = await h.call({ kind: 'host.serial.choose' });
    expect(r.ok).toBe(true);
    const data = (r as { data: { port: string; label: string } }).data;
    expect(data.port).toMatch(/^[0-9a-f]{16}$/);
    expect(data.label).toBe('Serial port 0403:6001');
    h.picks.push({ port: fakePort().port });
    const plain = await h.call({ kind: 'host.serial.choose' });
    expect((plain as { data: { label: string } }).data.label).toBe('Serial port');
  });

  it('returns the same handle when the same port is chosen twice', async () => {
    const h = harness();
    const a = fakePort();
    expect(await h.choose(a)).toBe(await h.choose(a));
    expect(await h.choose(fakePort())).not.toBe(await h.choose(a));
  });

  it('lists only its own handles', async () => {
    const one = harness();
    const two = harness();
    const a = await one.choose(fakePort({ info: { usbVendorId: 1, usbProductId: 2 } }));
    await two.choose(fakePort());
    expect(await one.call({ kind: 'host.serial.ports' })).toEqual({ ok: true, data: [{ port: a, label: 'Serial port 0001:0002' }] });
  });

  it('refuses a handle it did not make', async () => {
    const one = harness();
    const two = harness();
    const foreign = await two.choose(fakePort());
    await one.choose(fakePort());
    expect(await one.call({ kind: 'host.serial.open', port: foreign, settings: { baudRate: 9600 } })).toEqual(refused('serial-unknown-port'));
    expect(await one.call({ kind: 'host.serial.read', port: foreign, waitMs: 0 })).toEqual(refused('serial-unknown-port'));
    expect(await one.call({ kind: 'host.serial.write', port: foreign, bytes: new Uint8Array([1]) })).toEqual(refused('serial-unknown-port'));
    expect(await one.call({ kind: 'host.serial.close', port: foreign })).toEqual(refused('serial-unknown-port'));
  });

  it('drops a port that was picked after the gate was closed, without closing it', async () => {
    const h = harness();
    const late = fakePort();
    let give: (v: { port: SerialPortLike }) => void = () => {};
    h.picks.push(new Promise((r) => { give = r; }));
    const answer = h.call({ kind: 'host.serial.choose' });
    await settle();
    await h.gate.closeAll();
    expect(h.cancels()).toBe(1);
    give({ port: late.port });
    expect(await answer).toEqual(refused('serial-not-granted'));
    // Discarded as it is. The gate never opened it, so it is not the gate's to close.
    expect(late.events).toEqual([]);
    expect(await h.call({ kind: 'host.serial.ports' })).toEqual({ ok: true, data: [] });
  });
});

describe('serial gate: a port it was given too late', () => {
  it('leaves alone a port that another gate holds open', async () => {
    const other = harness();
    const shared = fakePort();
    const theirs = await other.openPort(shared);
    const h = harness();
    let give: (v: { port: SerialPortLike }) => void = () => {};
    h.picks.push(new Promise((r) => { give = r; }));
    const answer = h.call({ kind: 'host.serial.choose' });
    await settle();
    await h.gate.closeAll();
    give({ port: shared.port });
    expect(await answer).toEqual(refused('serial-not-granted'));
    expect(shared.events).toEqual(['open']);
    // The other gate still reads from it.
    shared.push([1, 2]);
    await settle();
    expect(Array.from((await other.read(theirs)).bytes)).toEqual([1, 2]);
  });

  it('leaves it alone when the grant went while the list was up', async () => {
    const h = harness();
    const late = fakePort();
    let give: (v: { port: SerialPortLike }) => void = () => {};
    h.picks.push(new Promise((r) => { give = r; }));
    const answer = h.call({ kind: 'host.serial.choose' });
    await settle();
    h.state.granted = false;
    give({ port: late.port });
    expect(await answer).toEqual(refused('serial-not-granted'));
    expect(late.events).toEqual([]);
  });
});

describe('serial gate: opening', () => {
  it('opens with the defaults filled in', async () => {
    const h = harness();
    const a = fakePort();
    await h.openPort(a, { baudRate: 9600 });
    expect(a.opened).toEqual([{ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 65_536 }]);
    const b = fakePort();
    await h.openPort(b, { baudRate: 115200, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' });
    expect(b.opened).toEqual([{ baudRate: 115200, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware', bufferSize: 65_536 }]);
  });

  it('refuses bad settings without touching the port', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.choose(a);
    for (const settings of [{ baudRate: 100 }, { baudRate: 9600, parity: 'mark' }, { baudRate: 9600, dtr: true }, null]) {
      expect(await h.call({ kind: 'host.serial.open', port: handle, settings: settings as never })).toEqual(refused('serial-bad-settings'));
    }
    expect(a.events).toEqual([]);
  });

  it('refuses a port that is already open here', async () => {
    const h = harness();
    const handle = await h.openPort(fakePort());
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual(refused('serial-busy'));
  });

  it('refuses a third open port', async () => {
    const h = harness();
    await h.openPort(fakePort());
    await h.openPort(fakePort());
    const third = fakePort();
    const handle = await h.choose(third);
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual(refused('serial-too-many'));
    expect(third.events).toEqual([]);
    expect(h.gate.open()).toHaveLength(2);
  });

  it('counts a port that is still opening against the limit of two', async () => {
    const h = harness();
    const slow = fakePort();
    const release = slow.holdOpen();
    const slowHandle = await h.choose(slow);
    const opening = h.call({ kind: 'host.serial.open', port: slowHandle, settings: { baudRate: 9600 } });
    await settle();
    await h.openPort(fakePort());
    const third = await h.choose(fakePort());
    expect(await h.call({ kind: 'host.serial.open', port: third, settings: { baudRate: 9600 } })).toEqual(refused('serial-too-many'));
    // The same port, asked for again while it opens.
    expect(await h.call({ kind: 'host.serial.open', port: slowHandle, settings: { baudRate: 9600 } })).toEqual(refused('serial-busy'));
    expect(h.gate.open()).toContain(slow.port);
    release();
    expect(await opening).toEqual({ ok: true, data: null });
  });

  it('refuses a port that is open in another gate', async () => {
    const shared = fakePort();
    const h = harness({ elsewhere: (p) => p === shared.port });
    const handle = await h.choose(shared);
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual(refused('serial-busy'));
    expect(shared.events).toEqual([]);
  });

  it('gives serial-failed when the port refuses to open, and frees the slot', async () => {
    const h = harness();
    const bad = fakePort({ openFails: true });
    const handle = await h.choose(bad);
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual(refused('serial-failed'));
    expect(h.gate.open()).toEqual([]);
    await h.openPort(fakePort());
    await h.openPort(fakePort());
    expect(h.gate.open()).toHaveLength(2);
  });

  it('closes a port that finished opening after the grant was taken away', async () => {
    const h = harness();
    const slow = fakePort();
    const release = slow.holdOpen();
    const handle = await h.choose(slow);
    const opening = h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } });
    await settle();
    h.state.granted = false;
    release();
    expect(await opening).toEqual(refused('serial-not-granted'));
    expect(slow.events).toEqual(['open', 'port.close', 'port.closed']);
    expect(h.gate.open()).toEqual([]);
  });

  it('closes a port that finished opening after the gate was closed', async () => {
    const h = harness();
    const slow = fakePort();
    const release = slow.holdOpen();
    const handle = await h.choose(slow);
    const opening = h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } });
    await settle();
    await h.gate.closeAll();
    release();
    expect(await opening).toEqual(refused('serial-not-granted'));
    expect(slow.events).toEqual(['open', 'port.close', 'port.closed']);
  });
});

describe('serial gate: reading', () => {
  it('refuses a read on a port that is known but not open', async () => {
    const h = harness();
    const handle = await h.choose(fakePort());
    expect(await h.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual(refused('serial-unknown-port'));
    expect(await h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) })).toEqual(refused('serial-unknown-port'));
  });

  it('returns bytes that arrived, in order, at most 65536 at a time', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    a.push([1, 2, 3]);
    a.push([4, 5]);
    await settle();
    expect(Array.from((await h.read(handle)).bytes)).toEqual([1, 2, 3, 4, 5]);
    const big = new Uint8Array(70_000).map((_v, i) => i % 251);
    a.push(big);
    await settle();
    const first = await h.read(handle);
    expect(first.bytes.length).toBe(65_536);
    expect(first.lost).toBe(false);
    const second = await h.read(handle);
    expect(second.bytes.length).toBe(70_000 - 65_536);
    expect(Array.from(first.bytes.slice(0, 5))).toEqual([0, 1, 2, 3, 4]);
    expect(second.bytes[0]).toBe(65_536 % 251);
    expect((await h.read(handle)).bytes.length).toBe(0);
  });

  it('returns a compact copy of the bytes', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const big = new Uint8Array(4096);
    big.set([9, 8, 7], 100);
    a.push(big.subarray(100, 103));
    await settle();
    const got = await h.read(handle);
    expect(Array.from(got.bytes)).toEqual([9, 8, 7]);
    expect(got.bytes.buffer.byteLength).toBe(got.bytes.length);
  });

  it('waits for the first byte, then returns', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    let got: { bytes: Uint8Array; lost: boolean } | undefined;
    void h.read(handle, 5_000).then((r) => { got = r; });
    await settle();
    expect(got).toBeUndefined();
    a.push([42]);
    await settle();
    expect(Array.from(got!.bytes)).toEqual([42]);
  });

  it('returns empty when the wait ends with nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    const handle = await h.openPort(fakePort());
    let got: { bytes: Uint8Array; lost: boolean } | undefined;
    void h.read(handle, 250).then((r) => { got = r; });
    await settle();
    await vi.advanceTimersByTimeAsync(249);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(got).toEqual({ bytes: new Uint8Array(0), lost: false });
  });

  it('never waits longer than 30 seconds, whatever it is asked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    const handle = await h.openPort(fakePort());
    let done = false;
    void h.read(handle, 10 * 60_000).then(() => { done = true; });
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(done).toBe(true);
  });

  it('refuses a second read while one waits', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const waiting = h.read(handle, 5_000);
    await settle();
    expect(await h.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual(refused('serial-busy'));
    a.push([1]);
    expect(Array.from((await waiting).bytes)).toEqual([1]);
  });

  it('drops what was unread when the buffer fills, and reports the loss once', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    a.push(new Uint8Array(1_048_576).fill(7));
    await settle();
    a.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await settle();
    expect(await h.read(handle)).toEqual({ bytes: new Uint8Array(0), lost: true });
    const after = await h.read(handle);
    expect(Array.from(after.bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(after.lost).toBe(false);
    expect(await h.read(handle)).toEqual({ bytes: new Uint8Array(0), lost: false });
  });

  it('reports a second overflow as a second loss', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    a.push(new Uint8Array(1_048_576));
    await settle();
    expect((await h.read(handle)).lost).toBe(true);
    expect((await h.read(handle)).lost).toBe(false);
    a.push(new Uint8Array(600_000));
    a.push(new Uint8Array(448_576));
    await settle();
    expect(await h.read(handle)).toEqual({ bytes: new Uint8Array(0), lost: true });
    expect((await h.read(handle)).lost).toBe(false);
  });

  it('does not report a loss at one byte under the limit', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    a.push(new Uint8Array(1_048_575));
    await settle();
    const got = await h.read(handle);
    expect(got.lost).toBe(false);
    expect(got.bytes.length).toBe(65_536);
  });

  it('tells a waiting read about a loss, not about bytes from before it', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const waiting = h.read(handle, 5_000);
    await settle();
    a.push(new Uint8Array(1_048_576));
    expect(await waiting).toEqual({ bytes: new Uint8Array(0), lost: true });
  });
});

describe('serial gate: writing', () => {
  it('sends writes in order', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const results = await Promise.all([
      h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1, 2]) }),
      h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([3]) }),
      h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([0, 255]) }),
    ]);
    expect(results).toEqual([{ ok: true, data: null }, { ok: true, data: null }, { ok: true, data: null }]);
    expect(a.written).toEqual([[1, 2], [3], [0, 255]]);
  });

  it('refuses bytes that are not bytes, are empty, or are over the limit for one write', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    for (const bytes of ['abc', [1, 2], new Uint8Array(0), new Uint8Array(65_537)]) {
      expect(await h.call({ kind: 'host.serial.write', port: handle, bytes: bytes as never })).toEqual(refused('serial-too-large'));
    }
    expect(a.written).toEqual([]);
  });

  it('refuses a write that would pass the send queue limit', async () => {
    const h = harness();
    const a = fakePort();
    a.blockWrites();
    const handle = await h.openPort(a);
    const held: Array<Promise<PluginRpcResult>> = [];
    // Sixteen writes of 65,536 bytes fill the queue: none finishes while the port is blocked.
    for (let i = 0; i < 16; i++) held.push(h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array(65_536) }));
    await settle();
    expect(await h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) })).toEqual(refused('serial-too-large'));
    await h.call({ kind: 'host.serial.close', port: handle });
    expect(await Promise.all(held)).toEqual(Array.from({ length: 16 }, () => refused('serial-closed')));
  });

  it('does not see a later change to the bytes it was given', async () => {
    const h = harness();
    const a = fakePort();
    a.blockWrites();
    const handle = await h.openPort(a);
    void h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) });
    const mine = new Uint8Array([5, 6]);
    void h.call({ kind: 'host.serial.write', port: handle, bytes: mine });
    mine[0] = 99;
    await settle();
    a.unblock();
    await settle();
    expect(a.written[1]).toEqual([5, 6]);
  });
});

describe('serial gate: closing and losing a port', () => {
  it('cancels the reader and settles the writer before it closes the port', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    expect(await h.call({ kind: 'host.serial.close', port: handle })).toEqual({ ok: true, data: null });
    expect(a.events).toEqual(['open', 'reader.cancel', 'writer.abort', 'port.close', 'port.closed']);
    expect(h.gate.open()).toEqual([]);
  });

  it('can open a port again after closing it', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    a.push([1, 2, 3]);
    await settle();
    await h.call({ kind: 'host.serial.close', port: handle });
    expect(await h.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual(refused('serial-unknown-port'));
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 19200 } })).toEqual({ ok: true, data: null });
    // Nothing from before the close is left.
    expect((await h.read(handle)).bytes.length).toBe(0);
    a.push([4]);
    await settle();
    expect(Array.from((await h.read(handle)).bytes)).toEqual([4]);
  });

  it('closing twice is not an error', async () => {
    const h = harness();
    const handle = await h.openPort(fakePort());
    await h.call({ kind: 'host.serial.close', port: handle });
    expect(await h.call({ kind: 'host.serial.close', port: handle })).toEqual({ ok: true, data: null });
  });

  it('closes while a write is blocked, and fails that write with serial-closed', async () => {
    const h = harness();
    const a = fakePort();
    a.blockWrites();
    const handle = await h.openPort(a);
    const write = h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) });
    await settle();
    expect(await h.call({ kind: 'host.serial.close', port: handle })).toEqual({ ok: true, data: null });
    expect(await write).toEqual(refused('serial-closed'));
    expect(a.events).toContain('port.close');
  });

  it('ends a waiting read with serial-closed when the port is closed', async () => {
    const h = harness();
    const handle = await h.openPort(fakePort());
    const waiting = h.call({ kind: 'host.serial.read', port: handle, waitMs: 5_000 });
    await settle();
    await h.call({ kind: 'host.serial.close', port: handle });
    expect(await waiting).toEqual(refused('serial-closed'));
  });

  it('ends a waiting read with serial-closed when the cable is pulled', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const waiting = h.call({ kind: 'host.serial.read', port: handle, waitMs: 5_000 });
    await settle();
    h.disconnect(a.port);
    expect(await waiting).toEqual(refused('serial-closed'));
  });

  it('forgets the handle after a disconnect', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    h.disconnect(a.port);
    await settle();
    for (const op of [
      { kind: 'host.serial.read', port: handle, waitMs: 0 },
      { kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) },
      { kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } },
      { kind: 'host.serial.close', port: handle },
    ] as PluginHostOp[]) expect(await h.call(op), op.kind).toEqual(refused('serial-unknown-port'));
    expect(await h.call({ kind: 'host.serial.ports' })).toEqual({ ok: true, data: [] });
    expect(h.gate.open()).toEqual([]);
  });

  it('does not keep a port whose cable was pulled while it was opening', async () => {
    const h = harness();
    const slow = fakePort();
    const release = slow.holdOpen();
    const handle = await h.choose(slow);
    const opening = h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } });
    await settle();
    h.disconnect(slow.port);
    release();
    expect(await opening).toEqual(refused('serial-closed'));
    expect(slow.events).toEqual(['open', 'port.close', 'port.closed']);
    expect(h.gate.open()).toEqual([]);
    expect(await h.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual(refused('serial-unknown-port'));
  });

  it('ignores a disconnect of a port it does not hold', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    h.disconnect(fakePort().port);
    a.push([1]);
    await settle();
    expect(Array.from((await h.read(handle)).bytes)).toEqual([1]);
  });

  it('fails queued writes with serial-closed on a disconnect', async () => {
    const h = harness();
    const a = fakePort();
    a.blockWrites();
    const handle = await h.openPort(a);
    const writes = [
      h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) }),
      h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([2]) }),
    ];
    await settle();
    h.disconnect(a.port);
    expect(await Promise.all(writes)).toEqual([refused('serial-closed'), refused('serial-closed')]);
  });

  it('treats an error from the port while reading as a lost port', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const waiting = h.call({ kind: 'host.serial.read', port: handle, waitMs: 5_000 });
    await settle();
    a.fail(Object.assign(new Error('The device has been lost.'), { name: 'NetworkError' }));
    expect(await waiting).toEqual(refused('serial-closed'));
    await settle();
    expect(await h.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual(refused('serial-unknown-port'));
  });

  it('lets go of every port at once, without waiting for a slow one', async () => {
    const h = harness();
    const slow = fakePort();
    const quick = fakePort();
    const releaseSlow = slow.holdClose();
    await h.openPort(slow);
    const hq = await h.openPort(quick);
    const write = h.call({ kind: 'host.serial.write', port: hq, bytes: new Uint8Array([1]) });
    let closed = false;
    void h.gate.closeAll().then(() => { closed = true; });
    await settle();
    // The slow port is still closing. The quick one is already cancelled and closed.
    expect(closed).toBe(false);
    expect(slow.events).toEqual(['open', 'reader.cancel', 'writer.abort', 'port.close']);
    expect(quick.events).toEqual(['open', 'reader.cancel', 'writer.abort', 'port.close', 'port.closed']);
    await write;
    // Bytes that arrive on the quick port now go nowhere.
    // The gate still owns the slow port until it is really closed, so no other gate may open it.
    expect(h.gate.open()).toEqual([slow.port]);
    releaseSlow();
    await settle();
    expect(closed).toBe(true);
    expect(h.gate.open()).toEqual([]);
  });

  it('still owns a port that is opening when it is closed, until that port is closed', async () => {
    const h = harness();
    const slow = fakePort();
    const release = slow.holdOpen();
    const handle = await h.choose(slow);
    const opening = h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } });
    await settle();
    await h.gate.closeAll();
    expect(h.gate.open()).toEqual([slow.port]);
    release();
    await opening;
    expect(h.gate.open()).toEqual([]);
  });

  it('a second close joins one that is under way', async () => {
    const h = harness();
    const a = fakePort();
    const release = a.holdClose();
    const handle = await h.openPort(a);
    const first = h.call({ kind: 'host.serial.close', port: handle });
    await settle();
    const second = h.call({ kind: 'host.serial.close', port: handle });
    let secondDone = false;
    void second.then(() => { secondDone = true; });
    await settle();
    expect(secondDone).toBe(false);
    // Not open and not free: it cannot be opened again until the close has ended.
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual(refused('serial-busy'));
    release();
    expect(await first).toEqual({ ok: true, data: null });
    expect(await second).toEqual({ ok: true, data: null });
    expect(a.events.filter((e) => e === 'port.close')).toHaveLength(1);
  });

  it('keeps nothing for a write once it has ended', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    for (let i = 0; i < 50; i++) await h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([i]) });
    expect(h.gate.waitingWrites()).toBe(0);
    a.blockWrites();
    void h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([1]) });
    void h.call({ kind: 'host.serial.write', port: handle, bytes: new Uint8Array([2]) });
    await settle();
    expect(h.gate.waitingWrites()).toBe(2);
    await h.call({ kind: 'host.serial.close', port: handle });
    expect(h.gate.waitingWrites()).toBe(0);
  });

  it('does not open a port again while its old close is still under way', async () => {
    const h = harness();
    const a = fakePort();
    const release = a.holdClose();
    await h.openPort(a);
    void h.gate.closeAll();
    await settle();
    // The grant still stands, so the page may choose again at once.
    const again = await h.choose(a);
    expect(await h.call({ kind: 'host.serial.open', port: again, settings: { baudRate: 9600 } })).toEqual(refused('serial-busy'));
    expect(a.events.filter((e) => e === 'open')).toHaveLength(1);
    release();
    await settle();
    expect(await h.call({ kind: 'host.serial.open', port: again, settings: { baudRate: 9600 } })).toEqual({ ok: true, data: null });
  });

  it('counts ports that are still closing against the limit of two', async () => {
    const h = harness();
    const a = fakePort();
    const b = fakePort();
    const releaseA = a.holdClose();
    const releaseB = b.holdClose();
    await h.openPort(a);
    await h.openPort(b);
    void h.gate.closeAll();
    await settle();
    const third = fakePort();
    const handle = await h.choose(third);
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual(refused('serial-too-many'));
    expect(third.events).toEqual([]);
    releaseA();
    await settle();
    expect(await h.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual({ ok: true, data: null });
    releaseB();
  });

  it('counts a port that was opening when the gate closed against the limit, until it is closed', async () => {
    const h = harness();
    const slow = fakePort();
    const release = slow.holdOpen();
    const first = await h.choose(slow);
    const opening = h.call({ kind: 'host.serial.open', port: first, settings: { baudRate: 9600 } });
    await settle();
    await h.gate.closeAll();
    await h.openPort(fakePort());
    const third = await h.choose(fakePort());
    expect(await h.call({ kind: 'host.serial.open', port: third, settings: { baudRate: 9600 } })).toEqual(refused('serial-too-many'));
    release();
    await opening;
    expect(await h.call({ kind: 'host.serial.open', port: third, settings: { baudRate: 9600 } })).toEqual({ ok: true, data: null });
  });

  it('closeAll closes every port and removes its listener', async () => {
    const h = harness();
    const a = fakePort();
    const b = fakePort();
    const ha = await h.openPort(a);
    await h.openPort(b);
    expect(h.listeners).toHaveLength(1);
    const waiting = h.call({ kind: 'host.serial.read', port: ha, waitMs: 5_000 });
    await settle();
    await h.gate.closeAll();
    expect(await waiting).toEqual(refused('serial-not-granted'));
    expect(a.events).toContain('port.close');
    expect(b.events).toContain('port.close');
    expect(h.listeners).toHaveLength(0);
    expect(h.gate.open()).toEqual([]);
    expect(await h.call({ kind: 'host.serial.read', port: ha, waitMs: 0 })).toEqual(refused('serial-unknown-port'));
    expect(await h.call({ kind: 'host.serial.ports' })).toEqual({ ok: true, data: [] });
  });

  it('works again after closeAll, with new handles', async () => {
    const h = harness();
    const a = fakePort();
    const old = await h.openPort(a);
    await h.gate.closeAll();
    const again = await h.openPort(a);
    expect(again).not.toBe(old);
    expect(h.listeners).toHaveLength(1);
  });

  it('answers a read that was waiting when the grant went away with serial-not-granted', async () => {
    const h = harness();
    const a = fakePort();
    const handle = await h.openPort(a);
    const waiting = h.call({ kind: 'host.serial.read', port: handle, waitMs: 5_000 });
    await settle();
    h.state.granted = false;
    a.push([1, 2, 3]);
    expect(await waiting).toEqual(refused('serial-not-granted'));
  });

  it('never throws, whatever the fake port does', async () => {
    const h = harness();
    const bad = fakePort({ closeFails: true });
    const handle = await h.openPort(bad);
    await expect(h.call({ kind: 'host.serial.close', port: handle })).resolves.toEqual({ ok: true, data: null });
    await expect(h.gate.closeAll()).resolves.toBeUndefined();
    // A port whose getInfo throws still gets a plain label.
    const odd = fakePort();
    odd.port.getInfo = () => { throw new Error('no info'); };
    h.picks.push({ port: odd.port });
    expect(((await h.call({ kind: 'host.serial.choose' })) as { data: { label: string } }).data.label).toBe('Serial port');
    // A prompt that throws is a refusal, not a crash.
    await expect(h.call({ kind: 'host.serial.choose' })).resolves.toEqual(refused('serial-failed'));
    // Junk in place of an op.
    await expect(h.call({ kind: 'host.serial.read' } as never)).resolves.toMatchObject({ ok: false });
    await expect(h.call(null as never)).resolves.toMatchObject({ ok: false });
  });
});
