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
