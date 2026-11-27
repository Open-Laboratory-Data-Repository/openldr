import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { SDK_BOOTSTRAP_V1, makeRpc } from './bootstrap';

describe('SDK_BOOTSTRAP_V1', () => {
  it('is a self-invoking script string referencing the init handshake + api surface', () => {
    expect(typeof SDK_BOOTSTRAP_V1).toBe('string');
    expect(SDK_BOOTSTRAP_V1.length).toBeGreaterThan(100);
    expect(SDK_BOOTSTRAP_V1).toContain('openldr:init');
    expect(SDK_BOOTSTRAP_V1).toContain('window.openldr');
    expect(SDK_BOOTSTRAP_V1).toMatch(/ready/);
    expect(SDK_BOOTSTRAP_V1).toMatch(/ports\[0\]/);
  });
  it('carries the import calls, and none of them takes SQL', () => {
    for (const kind of ['import.allowed', 'import.diagnose', 'import.checks', 'import.start', 'import.status', 'import.list', 'import.failures', 'import.stop', 'import.resume']) {
      expect(SDK_BOOTSTRAP_V1).toContain(kind);
    }
    const imports = SDK_BOOTSTRAP_V1.slice(SDK_BOOTSTRAP_V1.indexOf('imports:'));
    expect(imports).not.toMatch(/sql/i);
  });

  it('the SDK sends each copy call as its op', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { imports: { copy: Record<string, (...a: unknown[]) => Promise<unknown>> } } }).openldr;
    const sent: Array<{ id: number; op: unknown }> = [];
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      // Answer every call at once, so each promise settles.
      postMessage(m: { id: number; op: unknown }) { sent.push(m); queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: true, data: m.op } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });

    const copy = api.imports.copy;
    await copy.start({ connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, reread: true });
    await copy.list();
    await copy.status('cp1');
    await copy.stop('cp1');
    await copy.remove('cp1');
    expect(sent.map((m) => m.op)).toEqual([
      { kind: 'import.copy.start', connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, reread: true },
      { kind: 'import.copy.list' },
      { kind: 'import.copy.status', copyId: 'cp1' },
      { kind: 'import.copy.stop', copyId: 'cp1' },
      { kind: 'import.copy.delete', copyId: 'cp1', confirm: true },
    ]);
  });

  it('the SDK sends each check call as its op', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { imports: { check: Record<string, (...a: unknown[]) => Promise<unknown>> } } }).openldr;
    const sent: Array<{ id: number; op: unknown }> = [];
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage(m: { id: number; op: unknown }) { sent.push(m); queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: true, data: m.op } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });

    const check = api.imports.check;
    await check.start({ copyId: 'cp1', referenceCopyId: null, options: { tz: '+02:00' }, pageSize: 200 });
    await check.list();
    await check.status('ck1');
    await check.stop('ck1');
    await check.held({ copyId: 'cp1', reason: 'held', label: 'odd_age', laboratory: 'LAB-1', offset: 20, limit: 10 });
    await check.heldItem({ copyId: 'cp1', key: 'REQ1' });
    await check.heldItems({ copyId: 'cp1', reason: 'error', label: 'odd_age', laboratory: 'LAB-2', offset: 200, limit: 200 });
    await check.start({ copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: true });
    await check.heldItems({ copyId: 'cp1', label: 'odd_age', after: null, limit: 200 });
    await check.heldItems({ copyId: 'cp1', after: 'REQ9', limit: 200 });
    await check.correct({ copyId: 'cp1', key: 'REQ1', values: { dob_age: '2023-03-11', sex: null }, reason: 'typed wrong' });
    await check.recheck({ copyId: 'cp1', key: 'REQ1' });
    await check.access();
    await check.choices({ copyId: 'cp1' });
    await check.heldCodes({ copyId: 'cp1', laboratory: 'LAB-1' });
    await check.held({ copyId: 'cp1', finding: 'specimen_missing', offset: 0, limit: 10 });
    expect(sent.map((m) => m.op)).toEqual([
      { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: { tz: '+02:00' }, pageSize: 200 },
      { kind: 'import.check.list' },
      { kind: 'import.check.status', runId: 'ck1' },
      { kind: 'import.check.stop', runId: 'ck1' },
      { kind: 'import.check.held', copyId: 'cp1', reason: 'held', label: 'odd_age', laboratory: 'LAB-1', offset: 20, limit: 10 },
      { kind: 'import.check.heldItem', copyId: 'cp1', key: 'REQ1' },
      { kind: 'import.check.heldItems', copyId: 'cp1', reason: 'error', label: 'odd_age', laboratory: 'LAB-2', offset: 200, limit: 200 },
      { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: {}, fromStart: true },
      { kind: 'import.check.heldItems', copyId: 'cp1', label: 'odd_age', after: null, limit: 200 },
      { kind: 'import.check.heldItems', copyId: 'cp1', after: 'REQ9', limit: 200 },
      { kind: 'import.check.correct', copyId: 'cp1', key: 'REQ1', values: { dob_age: '2023-03-11', sex: null }, reason: 'typed wrong' },
      { kind: 'import.check.recheck', copyId: 'cp1', key: 'REQ1' },
      { kind: 'import.check.access' },
      { kind: 'import.check.choices', copyId: 'cp1' },
      { kind: 'import.check.heldCodes', copyId: 'cp1', laboratory: 'LAB-1' },
      { kind: 'import.check.held', copyId: 'cp1', finding: 'specimen_missing', offset: 0, limit: 10 },
    ]);
    // After is sent as given, a null included: null asks for the first page.
    expect(sent.at(-8)!.op).toHaveProperty('after', null);
  });

  it('files.download sends the host operation and resolves with nothing', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { files: { download(i: unknown): Promise<unknown> } } }).openldr;
    const sent: Array<{ id: number; op: unknown }> = [];
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      // The host answers a download with ok and null data.
      postMessage(m: { id: number; op: unknown }) { sent.push(m); queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: true, data: null } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });
    await expect(api.files.download({ filename: 'held.csv', mime: 'text/csv', text: 'a,b\n1,2\n' })).resolves.toBeUndefined();
    expect(sent.map((m) => m.op)).toEqual([{ kind: 'host.download', filename: 'held.csv', mime: 'text/csv', text: 'a,b\n1,2\n' }]);
  });

  it('files.download rejects with the host error when the host refuses', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { files: { download(i: unknown): Promise<unknown> } } }).openldr;
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage(m: { id: number }) { queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: false, error: 'download refused: bad file name' } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });
    await expect(api.files.download({ filename: '../x.csv', mime: 'text/csv', text: '' })).rejects.toThrow('download refused: bad file name');
  });

  it('invoke names a connector only when the page passes one', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { invoke(e: string, i: unknown, o?: unknown): Promise<unknown> } }).openldr;
    const sent: Array<{ id: number; op: unknown }> = [];
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage(m: { id: number; op: unknown }) { sent.push(m); queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: true, data: null } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });
    await api.invoke('send', { a: 1 });
    await api.invoke('send', { a: 1 }, { connectorId: 'c1' });
    expect(sent.map((m) => m.op)).toEqual([
      { kind: 'invoke', entrypoint: 'send', input: { a: 1 } },
      { kind: 'invoke', entrypoint: 'send', input: { a: 1 }, connectorId: 'c1' },
    ]);
  });

  it('print.pages sends the host operation and resolves with nothing once the host answers', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { print: { pages(i: unknown): Promise<unknown> } } }).openldr;
    const sent: Array<{ id: number; op: unknown }> = [];
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      // The host answers when the print dialog closes, with ok and null data.
      postMessage(m: { id: number; op: unknown }) { sent.push(m); queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: true, data: null } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });
    const pages = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
    await expect(api.print.pages({ title: 'Manifest', paper: 'A4', pages })).resolves.toBeUndefined();
    expect(sent.map((m) => m.op)).toEqual([{ kind: 'host.print', title: 'Manifest', paper: 'A4', pages }]);
  });

  it('print.pages rejects with the host error when the host refuses', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: { print: { pages(i: unknown): Promise<unknown> } } }).openldr;
    const port = {
      start: () => {},
      onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage(m: { id: number }) { queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: { ok: false, error: 'print refused: no pages' } } })); },
    };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });
    await expect(api.print.pages({ title: 'Manifest', paper: 'A4', pages: [] })).rejects.toThrow('print refused: no pages');
  });

  describe('serial', () => {
    type Serial = {
      ports(): Promise<unknown>;
      choose(): Promise<unknown>;
      open(port: string, settings: unknown): Promise<unknown>;
      read(port: string, waitMs?: number): Promise<{ bytes: Uint8Array; lost: boolean }>;
      write(port: string, bytes: Uint8Array): Promise<unknown>;
      close(port: string): Promise<unknown>;
    };
    /** The toolkit text run as the frame runs it, with a fake port whose answers the test gives. */
    function frame(answer: (op: { kind: string }) => { ok: true; data: unknown } | { ok: false; error: string }) {
      let handler: ((ev: unknown) => void) | undefined;
      const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('window', SDK_BOOTSTRAP_V1)(win);
      const sent: Array<{ kind: string } & Record<string, unknown>> = [];
      const port = {
        start: () => {},
        onmessage: null as null | ((e: { data: unknown }) => void),
        postMessage(m: { id: number; op: { kind: string } & Record<string, unknown> }) { sent.push(m.op); queueMicrotask(() => port.onmessage?.({ data: { id: m.id, result: answer(m.op) } })); },
      };
      handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [port] });
      return { serial: (win as unknown as { openldr: { serial: Serial } }).openldr.serial, sent };
    }

    it('sends each serial call as its host op', async () => {
      const { serial, sent } = frame((op) => ({ ok: true, data: op.kind === 'host.serial.read' ? { bytes: new Uint8Array(0), lost: false } : op.kind === 'host.serial.ports' ? [] : op.kind === 'host.serial.choose' ? { port: 'h1', label: 'COM3' } : null }));
      await expect(serial.ports()).resolves.toEqual([]);
      await expect(serial.choose()).resolves.toEqual({ port: 'h1', label: 'COM3' });
      await expect(serial.open('h1', { baudRate: 9600, parity: 'even' })).resolves.toBeUndefined();
      await serial.read('h1', 250);
      await serial.read('h1');
      await expect(serial.write('h1', new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
      await expect(serial.close('h1')).resolves.toBeUndefined();
      expect(sent).toEqual([
        { kind: 'host.serial.ports' },
        { kind: 'host.serial.choose' },
        { kind: 'host.serial.open', port: 'h1', settings: { baudRate: 9600, parity: 'even' } },
        { kind: 'host.serial.read', port: 'h1', waitMs: 250 },
        // No wait given: what is there now.
        { kind: 'host.serial.read', port: 'h1', waitMs: 0 },
        { kind: 'host.serial.write', port: 'h1', bytes: new Uint8Array([1, 2, 3]) },
        { kind: 'host.serial.close', port: 'h1' },
      ]);
    });

    it('gives null when the person cancelled the choice', async () => {
      const { serial } = frame(() => ({ ok: false, error: 'serial-cancelled' }));
      await expect(serial.choose()).resolves.toBeNull();
    });

    it('rejects with the refusal code for any other refusal', async () => {
      const { serial } = frame(() => ({ ok: false, error: 'serial-not-granted' }));
      await expect(serial.choose()).rejects.toThrow('serial-not-granted');
      await expect(serial.ports()).rejects.toThrow('serial-not-granted');
      await expect(serial.open('h1', { baudRate: 9600 })).rejects.toThrow('serial-not-granted');
      await expect(serial.read('h1')).rejects.toThrow('serial-not-granted');
      await expect(serial.write('h1', new Uint8Array([1]))).rejects.toThrow('serial-not-granted');
      await expect(serial.close('h1')).rejects.toThrow('serial-not-granted');
      // A cancelled answer is turned into null only for the choice.
      const cancelled = frame(() => ({ ok: false, error: 'serial-cancelled' }));
      await expect(cancelled.serial.read('h1')).rejects.toThrow('serial-cancelled');
    });

    it('passes read bytes through as a Uint8Array', async () => {
      const { serial } = frame(() => ({ ok: true, data: { bytes: new Uint8Array([0, 127, 128, 255]), lost: true } }));
      const got = await serial.read('h1');
      expect(got.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(got.bytes)).toEqual([0, 127, 128, 255]);
      expect(got.lost).toBe(true);
    });

    it('is not changed by a later change to the caller\'s array', async () => {
      const { serial, sent } = frame(() => ({ ok: true, data: null }));
      const mine = new Uint8Array([1, 2, 3]);
      await serial.write('h1', mine);
      mine[0] = 99;
      expect(Array.from(sent[0]!.bytes as Uint8Array)).toEqual([1, 2, 3]);
    });

    /** The toolkit text across a real MessageChannel, with a host on the other port that keeps what it gets. */
    function realChannel() {
      let handler: ((ev: unknown) => void) | undefined;
      const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('window', SDK_BOOTSTRAP_V1)(win);
      const channel = new MessageChannel();
      const got: Array<{ kind: string } & Record<string, unknown>> = [];
      channel.port1.onmessage = (ev: MessageEvent) => {
        const { id, op } = ev.data as { id: number; op: { kind: string } & Record<string, unknown> };
        got.push(op);
        const data = op.kind === 'host.serial.read' ? { bytes: new Uint8Array([0, 255]), lost: false } : op.kind === 'host.serial.ports' ? [{ port: 'h1', label: 'COM3' }] : op.kind === 'host.serial.choose' ? { port: 'h1', label: 'COM3' } : null;
        channel.port1.postMessage({ id, result: { ok: true, data } });
      };
      handler!({ data: { type: 'openldr:init', context: { pluginId: 'p' } }, ports: [channel.port2] });
      const close = () => { channel.port1.close(); channel.port2.close(); };
      return { serial: (win as unknown as { openldr: { serial: Serial } }).openldr.serial, got, close };
    }

    it('works when the emitted toolkit text runs across a real MessageChannel', async () => {
      const { serial, got, close } = realChannel();
      try {
        await expect(serial.ports()).resolves.toEqual([{ port: 'h1', label: 'COM3' }]);
        await expect(serial.choose()).resolves.toEqual({ port: 'h1', label: 'COM3' });
        await expect(serial.open('h1', { baudRate: 9600 })).resolves.toBeUndefined();
        await expect(serial.write('h1', new Uint8Array([7, 8]))).resolves.toBeUndefined();
        const read = await serial.read('h1', 10);
        expect(Array.from(read.bytes)).toEqual([0, 255]);
        await expect(serial.close('h1')).resolves.toBeUndefined();
        expect(got.map((op) => op.kind)).toEqual(['host.serial.ports', 'host.serial.choose', 'host.serial.open', 'host.serial.write', 'host.serial.read', 'host.serial.close']);
      } finally { close(); }
    });

    it('sends only the bytes of a view, not its whole buffer', async () => {
      const { serial, got, close } = realChannel();
      try {
        const big = new Uint8Array(1024 * 1024);
        big.set([5, 6, 7], 10);
        await serial.write('h1', big.subarray(10, 13));
        const bytes = got[0]!.bytes as Uint8Array;
        expect(Array.from(bytes)).toEqual([5, 6, 7]);
        expect(bytes.buffer.byteLength).toBe(3);
      } finally { close(); }
    });

    it('sends only the bytes of a view made in another frame', async () => {
      const { serial, got, close } = realChannel();
      try {
        // A Uint8Array from another realm, as a plugin gets from a nested frame or a worker. It is
        // not an instance of this realm's Uint8Array.
        const foreign = runInNewContext('const big = new Uint8Array(1024 * 1024); big.set([5, 6, 7], 10); big.subarray(10, 13)') as Uint8Array;
        expect(foreign instanceof Uint8Array).toBe(false);
        await serial.write('h1', foreign);
        const bytes = got[0]!.bytes as Uint8Array;
        expect(Array.from(bytes)).toEqual([5, 6, 7]);
        expect(bytes.buffer.byteLength).toBe(3);
      } finally { close(); }
    });

    it('keeps bytes 0 and 255 as they are', async () => {
      const { serial, got, close } = realChannel();
      try {
        await serial.write('h1', new Uint8Array([0, 255, 0, 255]));
        expect(Array.from(got[0]!.bytes as Uint8Array)).toEqual([0, 255, 0, 255]);
        expect(Array.from((await serial.read('h1')).bytes)).toEqual([0, 255]);
      } finally { close(); }
    });
  });

  it('defines window.openldr SYNCHRONOUSLY (before any openldr:init) so screens never race the injection', () => {
    // Run the bootstrap IIFE against a controlled fake window, capturing the message handler.
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);

    // The binding + its api surface + the ready promise exist immediately — no init yet.
    const api = (win as unknown as { openldr?: Record<string, unknown> }).openldr;
    expect(api).toBeTruthy();
    expect(api!.ready).toBeInstanceOf(Promise);
    expect(typeof (api!.storage as Record<string, unknown>).get).toBe('function');
    expect(typeof (api!.connectors as Record<string, unknown>).metadata).toBe('function');
    expect(api!.pluginId).toBe(''); // placeholder until init populates context
    expect(handler).toBeTypeOf('function');
  });

  it('populates context + resolves ready when openldr:init arrives', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: Record<string, unknown> }).openldr;

    const port = { start: () => {}, postMessage: () => {}, onmessage: null as unknown };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'dhis2-sink', locale: 'fr', capabilities: ['host:connectors'] } }, ports: [port] });

    await expect(api.ready).resolves.toBeUndefined();
    expect(api.pluginId).toBe('dhis2-sink');
    expect(api.locale).toBe('fr');
    expect(api.capabilities).toEqual(['host:connectors']);
  });

  it('openldr.site is page until init, then the place the host drew it in; junk falls back to page', async () => {
    const boot = () => {
      let handler: ((ev: unknown) => void) | undefined;
      const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('window', SDK_BOOTSTRAP_V1)(win);
      const api = (win as unknown as { openldr: Record<string, unknown> }).openldr;
      const init = (context: Record<string, unknown>) =>
        handler!({ data: { type: 'openldr:init', context }, ports: [{ start: () => {}, postMessage: () => {}, onmessage: null }] });
      return { api, init };
    };
    const a = boot();
    expect(a.api.site).toBe('page');
    a.init({ pluginId: 'p' });
    expect(a.api.site).toBe('page');
    const b = boot();
    b.init({ pluginId: 'p', site: 'widget' });
    expect(b.api.site).toBe('widget');
    const c = boot();
    c.init({ pluginId: 'p', site: 'toast' });
    expect(c.api.site).toBe('page');
  });

  it('updates api.theme when the host posts an openldr:theme message', () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: Record<string, unknown> }).openldr;
    expect(api.theme).toBe('light');
    handler!({ data: { type: 'openldr:theme', theme: 'dark' } });
    expect(api.theme).toBe('dark');
    handler!({ data: { type: 'openldr:theme', theme: 'light' } });
    expect(api.theme).toBe('light');
  });
});

describe('SDK_BOOTSTRAP_V1 theme tokens', () => {
  // A fake <html> that records what the bootstrap sets on it.
  function bootWithDocument() {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string) => { attrs.set(k, v); },
        style: {
          setProperty: (k: string, v: string) => { props.set(k, v); },
          removeProperty: (k: string) => { props.delete(k); return ''; },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', 'document', SDK_BOOTSTRAP_V1)(win, doc);
    const api = (win as unknown as { openldr: { theme: string; themeTokens: Record<string, string> } }).openldr;
    const send = (data: unknown) => handler!({ data, ports: [{ start: () => {}, postMessage: () => {}, onmessage: null }] });
    return { api, props, attrs, send };
  }

  it('applyTheme sets each token on the root, and removes one the host no longer sends', () => {
    const b = bootWithDocument();
    expect(b.api.themeTokens).toEqual({});
    b.send({ type: 'openldr:init', context: { pluginId: 'p', theme: 'dark', themeTokens: { '--openldr-bg': 'rgb(1, 1, 1)', '--openldr-text': 'rgb(2, 2, 2)' } } });
    expect(b.attrs.get('data-openldr-theme')).toBe('dark');
    expect(Object.fromEntries(b.props)).toEqual({ '--openldr-bg': 'rgb(1, 1, 1)', '--openldr-text': 'rgb(2, 2, 2)' });
    expect(b.api.themeTokens).toEqual({ '--openldr-bg': 'rgb(1, 1, 1)', '--openldr-text': 'rgb(2, 2, 2)' });

    b.send({ type: 'openldr:theme', theme: 'light', tokens: { '--openldr-bg': 'rgb(9, 9, 9)' } });
    expect(b.api.theme).toBe('light');
    expect(Object.fromEntries(b.props)).toEqual({ '--openldr-bg': 'rgb(9, 9, 9)' });
    expect(b.api.themeTokens).toEqual({ '--openldr-bg': 'rgb(9, 9, 9)' });
  });

  it('themeTokens is read-only to the page', () => {
    const b = bootWithDocument();
    b.send({ type: 'openldr:init', context: { pluginId: 'p', themeTokens: { '--openldr-bg': 'rgb(1, 1, 1)' } } });
    expect(Object.isFrozen(b.api.themeTokens)).toBe(true);
    expect(() => { (b.api.themeTokens as Record<string, string>)['--openldr-bg'] = 'red'; }).toThrow();
  });

  it('refuses a bad name or a bad value', () => {
    const b = bootWithDocument();
    b.send({ type: 'openldr:init', context: { pluginId: 'p', themeTokens: {
      '--openldr-bg': 'rgb(1, 1, 1)',
      'color': 'red',
      '--other-bg': 'red',
      '--openldr-Bad': 'red',
      '--openldr-x;y': 'red',
      [`--openldr-${'a'.repeat(41)}`]: 'red',
      '--openldr-text': 'red}body{display:none',
      '--openldr-border': 'a<b',
      '--openldr-danger': 'x'.repeat(201),
      '--openldr-success': 42,
    } } });
    expect(Object.fromEntries(b.props)).toEqual({ '--openldr-bg': 'rgb(1, 1, 1)' });
    expect(b.api.themeTokens).toEqual({ '--openldr-bg': 'rgb(1, 1, 1)' });
  });

  it('an init message without tokens still works, and a theme message without tokens keeps them', async () => {
    const b = bootWithDocument();
    b.send({ type: 'openldr:init', context: { pluginId: 'p', theme: 'dark' } });
    await expect((b.api as unknown as { ready: Promise<void> }).ready).resolves.toBeUndefined();
    expect(b.api.theme).toBe('dark');
    expect(b.api.themeTokens).toEqual({});
    expect(b.props.size).toBe(0);

    b.send({ type: 'openldr:theme', theme: 'light', tokens: { '--openldr-bg': 'rgb(1, 1, 1)' } });
    b.send({ type: 'openldr:theme', theme: 'dark' });
    expect(b.api.theme).toBe('dark');
    expect(Object.fromEntries(b.props)).toEqual({ '--openldr-bg': 'rgb(1, 1, 1)' });
  });
});

describe('makeRpc', () => {
  it('correlates RPC by id and resolves per the host result', async () => {
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: true, data: [{ id: 'r1' }] } } });
    expect(await p).toEqual([{ id: 'r1' }]);
  });
  it('rejects when the host result is not ok', async () => {
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: false, error: 'denied' } } });
    await expect(p).rejects.toThrow(/denied/);
  });
  it('ignores replies with no matching id', async () => {
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    fakePort.onmessage?.({ data: { id: 999, result: { ok: true, data: 'wrong' } } }); // unknown id, ignored
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: true, data: 'right' } } });
    expect(await p).toBe('right');
  });
});
