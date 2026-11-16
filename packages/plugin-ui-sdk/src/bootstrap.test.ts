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
    await check.held({ copyId: 'cp1', reason: 'held', label: 'odd_age', offset: 20, limit: 10 });
    await check.heldItem({ copyId: 'cp1', key: 'REQ1' });
    expect(sent.map((m) => m.op)).toEqual([
      { kind: 'import.check.start', copyId: 'cp1', referenceCopyId: null, options: { tz: '+02:00' }, pageSize: 200 },
      { kind: 'import.check.list' },
      { kind: 'import.check.status', runId: 'ck1' },
      { kind: 'import.check.stop', runId: 'ck1' },
      { kind: 'import.check.held', copyId: 'cp1', reason: 'held', label: 'odd_age', offset: 20, limit: 10 },
      { kind: 'import.check.heldItem', copyId: 'cp1', key: 'REQ1' },
    ]);
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
