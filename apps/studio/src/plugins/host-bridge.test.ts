import { describe, it, expect, vi, afterEach } from 'vitest';
import { wireHostPort, saveTextFile, createDownloadGate, DOWNLOAD_PENDING_MAX_BYTES, REVOKE_AFTER_MS, type HostPortLike } from './host-bridge';

// Hand-rolled linked port pair (no MessageChannel polyfill needed).
function linkedPorts(): [HostPortLike, { post(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null }] {
  let aOnmessage: ((e: { data: unknown }) => void) | null = null;
  const peer = { onmessage: null as null | ((e: { data: unknown }) => void), post(m: unknown) { aOnmessage?.({ data: m }); } };
  const host: HostPortLike = {
    set onmessage(fn) { aOnmessage = fn; },
    get onmessage() { return aOnmessage; },
    postMessage(m: unknown) { peer.onmessage?.({ data: m }); },
    start() {},
  };
  return [host, peer];
}

describe('wireHostPort', () => {
  it('forwards a plugin op to the broker call and replies with the result, correlated by id', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true as const, data: [{ id: 'r1' }] }));
    wireHostPort(host, { call });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    peer.post({ id: 7, op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(call).toHaveBeenCalledWith({ kind: 'reports.list' });
    expect(replies).toEqual([{ id: 7, result: { ok: true, data: [{ id: 'r1' }] } }]);
  });

  it('a thrown/rejected call still replies ok:false (never leaves the plugin hanging)', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => { throw new Error('boom'); });
    wireHostPort(host, { call });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    peer.post({ id: 1, op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(replies[0]).toEqual({ id: 1, result: { ok: false, error: 'boom' } });
  });

  it('ignores malformed messages (no id)', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true as const, data: null }));
    wireHostPort(host, { call });
    peer.post({ op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(call).not.toHaveBeenCalled();
  });
});

// Layer: the host end of the port and the save in jsdom. jsdom cannot perform a download, so these
// tests stop at the link and the Blob. Only a real browser shows that a file is saved.
describe('wireHostPort: host.download', () => {
  const op = (over: Record<string, unknown> = {}) => ({ kind: 'host.download', filename: 'held.csv', mime: 'text/csv', text: 'key,reason\nREQ1,held\n', ...over });
  function wired(opts: { now?: () => number; save?: ReturnType<typeof vi.fn> } = {}) {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true as const, data: null }));
    const save = opts.save ?? vi.fn();
    wireHostPort(host, { call, gate: createDownloadGate({ save, now: opts.now ?? (() => 1_000_000) }) });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    return { peer, call, save, replies };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('is answered by the host, saved once, and never reaches the broker call', async () => {
    const w = wired();
    w.peer.post({ id: 3, op: op() });
    await flush();
    expect(w.call).not.toHaveBeenCalled();
    expect(w.save).toHaveBeenCalledTimes(1);
    expect(w.save).toHaveBeenCalledWith('held.csv', 'text/csv', 'key,reason\nREQ1,held\n', expect.any(Function));
    expect(w.replies).toEqual([{ id: 3, result: { ok: true, data: null } }]);
  });

  it('refuses each bad request with a short fixed error, saves nothing, and forwards nothing', async () => {
    const w = wired({ now: (() => { let t = 0; return () => (t += 5000); })() });
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ filename: '../etc/held.csv' }, 'download refused: bad file name'],
      [{ filename: 'dir/held.csv' }, 'download refused: bad file name'],
      [{ filename: 'held.html' }, 'download refused: bad file name'],
      [{ filename: 5 }, 'download refused: bad file name'],
      [{ mime: 'text/html' }, 'download refused: bad type'],
      [{ filename: 'held.json' }, 'download refused: the name does not fit the type'],
      [{ text: { a: 1 } }, 'download refused: bad text'],
      [{ text: 'a'.repeat(64 * 1024 * 1024 + 1) }, 'download refused: the text is over 64 MB'],
    ];
    let id = 0;
    for (const [over] of cases) w.peer.post({ id: ++id, op: op(over) });
    await flush();
    expect(w.replies).toEqual(cases.map(([, error], i) => ({ id: i + 1, result: { ok: false, error } })));
    expect(w.save).not.toHaveBeenCalled();
    expect(w.call).not.toHaveBeenCalled();
    // The error never quotes the page's name or text.
    expect(JSON.stringify(w.replies)).not.toMatch(/etc|REQ1|held\.html/);
  });

  it('refuses a second download within one second from the same frame, and allows one after', async () => {
    let t = 10_000;
    const w = wired({ now: () => t });
    w.peer.post({ id: 1, op: op() });
    t += 999;
    w.peer.post({ id: 2, op: op() });
    t += 1; // one second after the first save
    w.peer.post({ id: 3, op: op() });
    await flush();
    expect(w.replies).toEqual([
      { id: 1, result: { ok: true, data: null } },
      { id: 2, result: { ok: false, error: 'download refused: one download per second' } },
      { id: 3, result: { ok: true, data: null } },
    ]);
    expect(w.save).toHaveBeenCalledTimes(2);
    // A refused request does not use up the second: only a save starts it.
    t += 1000;
    w.peer.post({ id: 4, op: op({ mime: 'text/html' }) });
    w.peer.post({ id: 5, op: op() });
    await flush();
    expect(w.replies.slice(3).map((r) => r.result.ok)).toEqual([false, true]);
    // Another frame has its own limit.
    const other = wired({ now: () => t });
    other.peer.post({ id: 1, op: op() });
    await flush();
    expect(other.replies).toEqual([{ id: 1, result: { ok: true, data: null } }]);
  });

  it('a save that throws becomes a fixed error, and the plugin is not left waiting', async () => {
    const w = wired({ save: vi.fn(() => { throw new Error('REQ1 quota'); }) });
    w.peer.post({ id: 1, op: op() });
    await flush();
    expect(w.replies).toEqual([{ id: 1, result: { ok: false, error: 'download failed' } }]);
  });

  it('an unknown host operation is refused here and never forwarded', async () => {
    const w = wired();
    w.peer.post({ id: 1, op: { kind: 'host.open', url: 'https://example.org' } });
    await flush();
    expect(w.call).not.toHaveBeenCalled();
    expect(w.replies).toEqual([{ id: 1, result: { ok: false, error: 'unknown host operation' } }]);
  });

  it('a broker op still goes to the broker call beside a download', async () => {
    const w = wired();
    w.peer.post({ id: 1, op: { kind: 'import.check.heldItems', copyId: 'cp1', offset: 0, limit: 200 } });
    await flush();
    expect(w.call).toHaveBeenCalledWith({ kind: 'import.check.heldItems', copyId: 'cp1', offset: 0, limit: 200 });
    expect(w.save).not.toHaveBeenCalled();
  });
});

describe('createDownloadGate', () => {
  const MiB = 1024 * 1024;
  const big = 'a'.repeat(64 * MiB);
  const op = (text: string) => ({ kind: 'host.download' as const, filename: 'held.csv', mime: 'text/csv' as const, text });

  it('one gate shared by two wirings, as across a reload of one frame, keeps one limit', async () => {
    let t = 50_000;
    const gate = createDownloadGate({ save: vi.fn(), now: () => t });
    const first = linkedPorts();
    wireHostPort(first[0], { call: vi.fn(), gate });
    const replies: any[] = [];
    first[1].onmessage = (e) => replies.push(e.data);
    first[1].post({ id: 1, op: op('a') });
    // The page reloads: a new port, the same gate.
    const second = linkedPorts();
    wireHostPort(second[0], { call: vi.fn(), gate });
    second[1].onmessage = (e) => replies.push(e.data);
    t += 500;
    second[1].post({ id: 2, op: op('a') });
    expect(replies).toEqual([
      { id: 1, result: { ok: true, data: null } },
      { id: 2, result: { ok: false, error: 'download refused: one download per second' } },
    ]);
  });

  it('refuses a download that would hold more than 128 MiB in Blobs not yet revoked, and accepts one after a revoke', () => {
    expect(DOWNLOAD_PENDING_MAX_BYTES).toBe(128 * MiB);
    let t = 0;
    const releases: Array<() => void> = [];
    const save = vi.fn((_f: string, _m: string, _x: string, released: () => void) => { releases.push(released); });
    const gate = createDownloadGate({ save, now: () => (t += 2000) });
    expect(gate.download(op(big))).toEqual({ ok: true, data: null });
    expect(gate.download(op(big))).toEqual({ ok: true, data: null });
    // 128 MiB wait now. One byte more is refused, with a fixed error and no save.
    expect(gate.download(op('x'))).toEqual({ ok: false, error: 'download refused: too many files waiting' });
    expect(save).toHaveBeenCalledTimes(2);
    releases[0]!();
    // A second call of the same release frees nothing more.
    releases[0]!();
    expect(gate.download(op(big))).toEqual({ ok: true, data: null });
    expect(gate.download(op('x'))).toEqual({ ok: false, error: 'download refused: too many files waiting' });
    releases[1]!();
    expect(gate.download(op('x'))).toEqual({ ok: true, data: null });
  });

  it('counts the UTF-8 bytes of the text, and frees them when the save throws', () => {
    let t = 0;
    const gate = createDownloadGate({ save: () => { throw new Error('quota'); }, now: () => (t += 2000) });
    for (let i = 0; i < 5; i++) expect(gate.download(op(big))).toEqual({ ok: false, error: 'download failed' });
    const kept = createDownloadGate({ save: vi.fn(), now: () => (t += 2000) });
    // 'é' is two bytes, so 32 Mi of them is 64 MiB, and two such files fill the 128 MiB.
    const accents = 'é'.repeat(32 * MiB);
    expect(kept.download(op(accents))).toEqual({ ok: true, data: null });
    expect(kept.download(op(accents))).toEqual({ ok: true, data: null });
    expect(kept.download(op('x'))).toEqual({ ok: false, error: 'download refused: too many files waiting' });
  });
});

describe('saveTextFile', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('saves through a temporary link with the name and a Blob URL, then removes it and revokes the URL', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => { blobs.push(b); return 'blob:studio/0001'; });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: Array<{ download: string; href: string; inBody: boolean; display: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.getAttribute('href') ?? '', inBody: document.body.contains(this), display: this.style.display });
    });
    const before = document.body.children.length;

    const released = vi.fn();
    saveTextFile('held.csv', 'text/csv', 'key,name\nREQ1,Maria Gonçalves\n', released);

    expect(create).toHaveBeenCalledTimes(1);
    expect(blobs[0]!.type).toBe('text/csv');
    expect(clicked).toEqual([{ download: 'held.csv', href: 'blob:studio/0001', inBody: true, display: 'none' }]);
    // The link is gone at once. The URL lives a short while so the browser can start the save.
    expect(document.body.children.length).toBe(before);
    expect(revoke).not.toHaveBeenCalled();
    expect(REVOKE_AFTER_MS).toBe(10_000);
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:studio/0001');
    expect(released).toHaveBeenCalledTimes(1);
    // Read after the clock is real again: jsdom's FileReader waits on a timer.
    vi.useRealTimers();
    expect(await readBlob(blobs[0]!)).toBe('key,name\nREQ1,Maria Gonçalves\n');
  });

  it('a click that throws revokes the URL at once and frees the bytes', () => {
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: () => 'blob:y', revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('blocked'); });
    const released = vi.fn();
    const before = document.body.children.length;
    expect(() => saveTextFile('held.csv', 'text/csv', 'a', released)).toThrow();
    expect(revoke).toHaveBeenCalledWith('blob:y');
    expect(released).toHaveBeenCalledTimes(1);
    expect(document.body.children.length).toBe(before);
  });

  it('keeps the mime of a JSON file', async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:x'; }, revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    saveTextFile('held.json', 'application/json', '[{"a":1}]', () => {});
    expect(blobs[0]!.type).toBe('application/json');
    expect(await readBlob(blobs[0]!)).toBe('[{"a":1}]');
  });
});

/** jsdom's Blob may lack text(); FileReader reads it on every version. */
function readBlob(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}
