// The gate that holds serial ports for one load of one plugin page. It enforces every limit and
// never throws. The plugin page sees a handle, never the port. Serial bytes may hold patient
// results, so nothing here goes to the server or to a log.

import {
  checkSerialSettings, checkSerialWrite, clampSerialWait,
  SERIAL_BUFFER_MAX, SERIAL_MAX_OPEN, SERIAL_READ_MAX, SERIAL_WRITE_QUEUE_MAX,
  type PluginHostOp, type PluginRpcResult, type PluginSerialRefusal, type PluginSerialSettings,
} from '@openldr/plugin-ui-sdk';

/** The part of navigator.serial the gate uses. A test passes a fake. */
export interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  addEventListener(type: 'disconnect', listener: (ev: { target: unknown }) => void): void;
  removeEventListener(type: 'disconnect', listener: (ev: { target: unknown }) => void): void;
}

export interface SerialPortLike {
  open(options: { baudRate: number; dataBits: 7 | 8; stopBits: 1 | 2; parity: 'none' | 'even' | 'odd'; flowControl: 'none' | 'hardware'; bufferSize: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

export interface SerialGateDeps {
  /** navigator.serial, or undefined when the browser has none or the page is not a secure context. */
  serial: SerialLike | undefined;
  /** true or false once the studio knows the plugin's grant. undefined while it does not. */
  granted(): boolean | undefined;
  /** The studio's own prompt, then the port list. The prompt asks the browser for the port inside
   *  the button press itself. Resolves with the port, or with why there is none. */
  pick(): Promise<{ port: SerialPortLike } | { refused: 'serial-cancelled' | 'serial-unavailable' | 'serial-busy' | 'serial-failed' }>;
  /** Ports open in any other gate on this page, so one physical port is not opened twice. */
  openElsewhere(port: SerialPortLike): boolean;
  /** Closes a prompt this gate has open. Called by closeAll. */
  cancelPick?(): void;
}

export interface SerialGate {
  /** Answers one serial op. Never throws. */
  handle(op: PluginHostOp): Promise<PluginRpcResult>;
  /** Closes every port and kills every handle. Called when the frame goes away or the grant does. */
  closeAll(): Promise<void>;
  /** The ports this gate holds: open, opening or still closing. A port stays here until it is
   *  really closed, also after its handle was killed, so no other gate opens it meanwhile. */
  open(): readonly SerialPortLike[];
  /** How many writes have not ended. For a test to see that an ended write leaves nothing behind. */
  waitingWrites(): number;
}

/** The size the browser is asked to read ahead by. One read's worth. */
const PORT_BUFFER = SERIAL_READ_MAX;

interface Entry {
  handle: string;
  label: string;
  port: SerialPortLike;
  state: 'closed' | 'opening' | 'open' | 'closing';
  /** Bytes that arrived and were not read yet, oldest first, and their total. */
  chunks: Uint8Array[];
  waitingBytes: number;
  /** Set when unread bytes were dropped. The next read reports it once. */
  lost: boolean;
  /** The read that waits for a first byte. */
  waiter: ((why: 'bytes' | 'timeout' | 'closed') => void) | null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  /** Bytes handed to the writer that it has not taken yet. */
  queued: number;
  /** Goes up at every open and close, so a read loop or a write from before one knows it is old. */
  session: number;
  /** One entry per write that has not ended: it ends that write when the port is let go of. A
   *  write takes its entry out when it ends, so a port that runs for days keeps nothing. */
  waitingWrites: Set<() => void>;
  /** The close that is under way, for a second close to join. */
  closing: Promise<void> | null;
}

const ok = (data: unknown): PluginRpcResult => ({ ok: true, data });
const no = (error: PluginSerialRefusal): PluginRpcResult => ({ ok: false, error });

function randomHandle(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function labelOf(port: SerialPortLike): string {
  try {
    const info = port.getInfo();
    const hex = (n: unknown): string | null => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffff ? n.toString(16).padStart(4, '0') : null);
    const vendor = hex(info?.usbVendorId);
    const product = hex(info?.usbProductId);
    return vendor !== null && product !== null ? `Serial port ${vendor}:${product}` : 'Serial port';
  } catch {
    return 'Serial port';
  }
}

export function createSerialGate(deps: SerialGateDeps): SerialGate {
  const entries = new Map<string, Entry>();
  /** Every entry whose port is not closed yet, also one whose handle was killed. */
  const owned = new Set<Entry>();
  /** Goes up on closeAll. A call that waited across one finds the number changed. */
  let generation = 0;
  let listening = false;

  const alive = (g: number): boolean => g === generation && deps.granted() === true;
  const held = (e: Entry): boolean => e.state !== 'closed';

  const onDisconnect = (ev: { target: unknown }): void => {
    for (const e of entries.values()) if (e.port === ev.target) void lose(e);
  };
  const listen = (): void => {
    if (listening || deps.serial === undefined) return;
    try { deps.serial.addEventListener('disconnect', onDisconnect); listening = true; } catch { /* a browser that cannot say is still usable */ }
  };
  const unlisten = (): void => {
    if (!listening || deps.serial === undefined) return;
    try { deps.serial.removeEventListener('disconnect', onDisconnect); } catch { /* nothing to undo */ }
    listening = false;
  };

  /** Up to one read's worth of the waiting bytes, as one array of exactly that size. */
  function take(e: Entry): Uint8Array {
    const size = Math.min(e.waitingBytes, SERIAL_READ_MAX);
    const out = new Uint8Array(size);
    let at = 0;
    while (at < size) {
      const first = e.chunks[0]!;
      const want = size - at;
      if (first.length <= want) {
        out.set(first, at);
        at += first.length;
        e.chunks.shift();
      } else {
        out.set(first.subarray(0, want), at);
        e.chunks[0] = first.subarray(want);
        at += want;
      }
    }
    e.waitingBytes -= size;
    return out;
  }

  function arrived(e: Entry, bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    if (e.waitingBytes + bytes.length >= SERIAL_BUFFER_MAX) {
      // Too much is waiting. Everything unread goes, these bytes included, so the plugin never
      // gets bytes from both sides of a gap joined together.
      e.chunks = [];
      e.waitingBytes = 0;
      e.lost = true;
    } else {
      // A copy: the stream may reuse what it handed over.
      e.chunks.push(bytes.slice());
      e.waitingBytes += bytes.length;
    }
    e.waiter?.('bytes');
  }

  /** Reads the port into the buffer until the port is closed here or fails. */
  async function pump(e: Entry, reader: ReadableStreamDefaultReader<Uint8Array>, session: number): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (e.session !== session) return;
        if (done) break;
        if (value) arrived(e, value);
      }
    } catch {
      // An error from the port: handled below, like a pulled cable.
    }
    if (e.session === session && e.state === 'open') void lose(e);
  }

  /**
   * Lets go of a port: the waiting read ends, the reader is cancelled, the writer is dropped, both
   * locks are released, then the port is closed. A real port refuses to close while a reader or a
   * writer still holds it. Nothing here waits on a write, because a blocked write never ends.
   */
  function release(e: Entry): Promise<void> {
    // A second call joins the one under way.
    e.closing ??= (async () => {
      e.session++;
      e.state = 'closing';
      e.waiter?.('closed');
      const { reader, writer } = e;
      e.reader = null;
      e.writer = null;
      e.chunks = [];
      e.waitingBytes = 0;
      e.lost = false;
      // A write stuck in the port never ends by itself, and the stream does not end it either.
      for (const drop of Array.from(e.waitingWrites)) drop();
      e.waitingWrites.clear();
      if (reader) {
        try { await reader.cancel(); } catch { /* the port is going anyway */ }
        try { reader.releaseLock(); } catch { /* already released */ }
      }
      if (writer) {
        // Not awaited: with a write stuck in the port, an abort does not end either.
        void writer.abort().catch(() => {});
        try { writer.releaseLock(); } catch { /* already released */ }
      }
      try { await e.port.close(); } catch { /* a port that will not close is still let go of */ }
      e.queued = 0;
      e.state = 'closed';
      e.closing = null;
      settled(e);
    })();
    return e.closing;
  }

  /** A port that is closed and whose handle is dead is no longer this gate's. */
  function settled(e: Entry): void {
    if (e.state === 'closed' && entries.get(e.handle) !== e) owned.delete(e);
  }

  /** A pulled cable or a port error: the handle is forgotten. */
  async function lose(e: Entry): Promise<void> {
    if (entries.get(e.handle) !== e) return;
    entries.delete(e.handle);
    if (e.state === 'open' || e.state === 'closing') await release(e);
    settled(e);
    if (entries.size === 0) unlisten();
  }

  async function choose(): Promise<PluginRpcResult> {
    const g = generation;
    let picked: Awaited<ReturnType<SerialGateDeps['pick']>>;
    try {
      picked = await deps.pick();
    } catch {
      return no('serial-failed');
    }
    // The gate closed, or the grant went, while the list was up. A port given now is dropped as
    // it is. This gate never opened it, and another gate may hold it open, so it is not closed here.
    if (!alive(g)) return no('serial-not-granted');
    if (!('port' in picked)) return no(picked.refused);
    for (const e of entries.values()) if (e.port === picked.port) return ok({ port: e.handle, label: e.label });
    const entry: Entry = {
      handle: randomHandle(), label: labelOf(picked.port), port: picked.port, state: 'closed',
      chunks: [], waitingBytes: 0, lost: false, waiter: null, reader: null, writer: null, queued: 0, session: 0, waitingWrites: new Set(), closing: null,
    };
    entries.set(entry.handle, entry);
    owned.add(entry);
    listen();
    return ok({ port: entry.handle, label: entry.label });
  }

  async function openPort(e: Entry, settings: PluginSerialSettings): Promise<PluginRpcResult> {
    if (checkSerialSettings(settings) !== null) return no('serial-bad-settings');
    if (held(e) || deps.openElsewhere(e.port)) return no('serial-busy');
    let count = 0;
    for (const other of entries.values()) if (held(other)) count++;
    if (count >= SERIAL_MAX_OPEN) return no('serial-too-many');
    const g = generation;
    // The slot is taken now, so a second open cannot slip in while this one waits.
    e.state = 'opening';
    const session = ++e.session;
    try {
      await e.port.open({
        baudRate: settings.baudRate,
        dataBits: settings.dataBits ?? 8,
        stopBits: settings.stopBits ?? 1,
        parity: settings.parity ?? 'none',
        flowControl: settings.flowControl ?? 'none',
        bufferSize: PORT_BUFFER,
      });
    } catch {
      if (e.session === session) e.state = 'closed';
      settled(e);
      return no('serial-failed');
    }
    const forgotten = entries.get(e.handle) !== e;
    if (!alive(g) || e.session !== session || forgotten) {
      // It opened too late: the gate closed, the grant went, or the cable was pulled while it was
      // opening. This gate opened it, so this gate closes it, and owns it until then.
      try { await e.port.close(); } catch { /* let go of either way */ }
      if (e.session === session) e.state = 'closed';
      settled(e);
      return no(alive(g) ? 'serial-closed' : 'serial-not-granted');
    }
    try {
      const readable = e.port.readable;
      const writable = e.port.writable;
      if (!readable || !writable) throw new Error('no streams');
      e.reader = readable.getReader();
      e.writer = writable.getWriter();
    } catch {
      await release(e);
      return no('serial-failed');
    }
    e.chunks = [];
    e.waitingBytes = 0;
    e.lost = false;
    e.queued = 0;
    e.state = 'open';
    void pump(e, e.reader, session);
    return ok(null);
  }

  async function read(e: Entry, waitMs: unknown): Promise<PluginRpcResult> {
    if (e.state !== 'open') return no('serial-unknown-port');
    if (e.waiter !== null) return no('serial-busy');
    const g = generation;
    const answer = (): PluginRpcResult => {
      if (e.lost) {
        e.lost = false;
        return ok({ bytes: new Uint8Array(0), lost: true });
      }
      return ok({ bytes: take(e), lost: false });
    };
    if (e.lost || e.waitingBytes > 0) return answer();
    const wait = clampSerialWait(waitMs);
    if (wait === 0) return answer();
    const why = await new Promise<'bytes' | 'timeout' | 'closed'>((resolve) => {
      const timer = setTimeout(() => done('timeout'), wait);
      const done = (reason: 'bytes' | 'timeout' | 'closed'): void => {
        clearTimeout(timer);
        e.waiter = null;
        resolve(reason);
      };
      e.waiter = done;
    });
    if (!alive(g)) return no('serial-not-granted');
    if (why === 'closed' || e.state !== 'open') return no('serial-closed');
    return answer();
  }

  async function write(e: Entry, bytes: unknown): Promise<PluginRpcResult> {
    if (e.state !== 'open' || e.writer === null) return no('serial-unknown-port');
    if (checkSerialWrite(bytes) !== null) return no('serial-too-large');
    // A copy of just these bytes, taken now: the caller may change its array, and a view may sit on a large buffer.
    const copy = new Uint8Array(bytes as Uint8Array);
    if (e.queued + copy.length > SERIAL_WRITE_QUEUE_MAX) return no('serial-too-large');
    const g = generation;
    const session = e.session;
    e.queued += copy.length;
    try {
      // The stream keeps writes in the order they were given.
      const sent = e.writer.write(copy);
      // If the port is let go of first, the stream may never settle this write. So the gate can
      // end it. The entry goes when the write ends, whichever way.
      let drop: () => void = () => {};
      const dropped = new Promise<'dropped'>((resolve) => { drop = () => resolve('dropped'); });
      e.waitingWrites.add(drop);
      try {
        sent.catch(() => {});
        if ((await Promise.race([sent, dropped])) === 'dropped') throw new Error('dropped');
      } finally {
        e.waitingWrites.delete(drop);
      }
    } catch {
      if (e.session === session) e.queued -= copy.length;
      if (!alive(g)) return no('serial-not-granted');
      // The port was closed here, or lost, while these bytes waited.
      if (e.session !== session || e.state !== 'open') return no('serial-closed');
      // The port itself refused the bytes. It is no longer usable.
      void lose(e);
      return no('serial-failed');
    }
    if (e.session === session) e.queued -= copy.length;
    if (!alive(g)) return no('serial-not-granted');
    return ok(null);
  }

  async function closePort(e: Entry): Promise<PluginRpcResult> {
    if (e.state === 'opening') return no('serial-busy');
    if (e.state === 'open' || e.state === 'closing') await release(e);
    // The handle stays known and can be opened again.
    return ok(null);
  }

  async function answer(op: PluginHostOp): Promise<PluginRpcResult> {
    if (deps.granted() !== true) return no('serial-not-granted');
    if (deps.serial === undefined) return no('serial-unavailable');
    const kind = (op as { kind?: unknown } | null)?.kind;
    if (kind === 'host.serial.ports') return ok(Array.from(entries.values(), (e) => ({ port: e.handle, label: e.label })));
    if (kind === 'host.serial.choose') return choose();
    if (kind !== 'host.serial.open' && kind !== 'host.serial.read' && kind !== 'host.serial.write' && kind !== 'host.serial.close') {
      return { ok: false, error: 'unknown host operation' };
    }
    const fields = op as unknown as { port?: unknown; settings?: unknown; waitMs?: unknown; bytes?: unknown };
    const entry = typeof fields.port === 'string' ? entries.get(fields.port) : undefined;
    if (entry === undefined) return no('serial-unknown-port');
    if (kind === 'host.serial.open') return openPort(entry, fields.settings as PluginSerialSettings);
    if (kind === 'host.serial.read') return read(entry, fields.waitMs);
    if (kind === 'host.serial.write') return write(entry, fields.bytes);
    return closePort(entry);
  }

  return {
    async handle(op) {
      try {
        return await answer(op);
      } catch {
        return no('serial-failed');
      }
    },

    async closeAll() {
      // First, before anything else: no call that is waiting may finish against a dead gate.
      generation++;
      try { deps.cancelPick?.(); } catch { /* a prompt that will not close changes nothing here */ }
      const all = Array.from(entries.values());
      entries.clear();
      unlisten();
      // Every port is let go of now, before any wait: a slow one must not leave another reading.
      // A port that is still opening is closed by its own open call, which sees the new number.
      const closing = all.map((e) => (e.state === 'open' || e.state === 'closing' ? release(e).catch(() => {}) : Promise.resolve()));
      for (const e of all) settled(e);
      await Promise.all(closing);
    },

    open: () => Array.from(owned).filter(held).map((e) => e.port),

    waitingWrites: () => { let n = 0; for (const e of owned) n += e.waitingWrites.size; return n; },
  };
}
