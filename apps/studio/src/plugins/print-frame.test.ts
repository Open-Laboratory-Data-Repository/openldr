import { describe, it, expect, vi } from 'vitest';
import { createPrintGate, printDocument, openPrintFrame, type PrintJob } from './print-frame';
import { wireHostPort, type HostPortLike } from './host-bridge';

// Layer: the print gate, the print frame's document, and the bridge's routing, in jsdom. jsdom
// cannot decode an image or open a print dialog, so the wait for decode, print() and afterprint are
// checked in a real browser, and the printed pages only on a real printer or a saved PDF.

/** A 1 by 1 PNG header, enough for checkPrint, which reads only the header. */
const PAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAAAA';
const op = (over: Record<string, unknown> = {}) => ({ kind: 'host.print', title: 'Shipment SHP-1', paper: 'A4', pages: [PAGE, PAGE], ...over });

function fakeJob(): PrintJob & { finish(): void; fail(e: Error): void; removed: number } {
  let finish!: () => void; let fail!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => { finish = res; fail = rej; });
  const job = { done, finish, fail, removed: 0, remove() { job.removed++; finish(); } };
  return job;
}

describe('createPrintGate', () => {
  it('opens one frame with the title and pages, and answers ok when the dialog closes', async () => {
    const job = fakeJob();
    const open = vi.fn(() => job);
    const gate = createPrintGate({ open });
    let answered: unknown = null;
    const pending = gate.print(op()).then((r) => { answered = r; });
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith('Shipment SHP-1', [PAGE, PAGE]);
    expect(answered).toBeNull();
    job.finish();
    await pending;
    expect(answered).toEqual({ ok: true, data: null });
  });

  it('refuses a bad request with the shared fixed error and opens nothing', async () => {
    const open = vi.fn(fakeJob);
    const gate = createPrintGate({ open });
    expect(await gate.print(op({ pages: [] }))).toEqual({ ok: false, error: 'print refused: no pages' });
    expect(await gate.print(op({ paper: 'Letter' }))).toEqual({ ok: false, error: 'print refused: bad paper' });
    expect(await gate.print(op({ pages: ['data:text/html;base64,PGI+'] }))).toEqual({ ok: false, error: 'print refused: a page is not a PNG' });
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a second print while one is open, and allows one after it closes', async () => {
    const first = fakeJob();
    const open = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(fakeJob());
    const gate = createPrintGate({ open });
    const p1 = gate.print(op());
    expect(await gate.print(op())).toEqual({ ok: false, error: 'print refused: another print is open' });
    first.finish();
    await p1;
    void gate.print(op());
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('passes on the frame\'s fixed error, hides any other, and frees the gate after a failure', async () => {
    const a = fakeJob(); const b = fakeJob();
    const gate = createPrintGate({ open: vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(fakeJob()) });
    const pa = gate.print(op());
    a.fail(new Error('print refused: a page could not be read'));
    expect(await pa).toEqual({ ok: false, error: 'print refused: a page could not be read' });
    const pb = gate.print(op());
    b.fail(new Error('NotAllowedError: something about /home/user/file'));
    expect(await pb).toEqual({ ok: false, error: 'print failed' });
  });

  it('dispose removes an open print frame, and the page gets its answer', async () => {
    const job = fakeJob();
    const gate = createPrintGate({ open: () => job });
    const pending = gate.print(op());
    gate.dispose();
    expect(job.removed).toBe(1);
    expect(await pending).toEqual({ ok: true, data: null });
  });
});

describe('printDocument', () => {
  it('holds only the pages, one sheet each, in order, under a policy that allows data images and no script', () => {
    const html = printDocument('Shipment', [PAGE, PAGE.replace('AAAA', 'BBBB')]);
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html.indexOf('AAAA')).toBeLessThan(html.indexOf('BBBB'));
    expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    expect(html).toContain('@page{size:A4;margin:0}');
    expect(html).not.toContain('<script');
  });

  it('escapes the title', () => {
    const html = printDocument('<script>alert(1)</script> & "x"', [PAGE]);
    expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</title>');
    expect(html).not.toContain('<script>');
  });
});

describe('openPrintFrame', () => {
  it('adds a hidden frame without scripts, and remove takes it away and settles', async () => {
    const job = openPrintFrame('Shipment', [PAGE]);
    const frame = document.querySelector('iframe[title="print"]') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.srcdoc).toContain(PAGE);
    job.remove();
    await expect(job.done).resolves.toBeUndefined();
    expect(document.querySelector('iframe[title="print"]')).toBeNull();
  });
});

describe('wireHostPort: host.print', () => {
  function linked() {
    let onmsg: ((e: { data: unknown }) => void) | null = null;
    const replies: unknown[] = [];
    const host: HostPortLike = {
      set onmessage(fn) { onmsg = fn; }, get onmessage() { return onmsg; },
      postMessage(m) { replies.push(m); }, start() {},
    };
    return { host, replies, post: (m: unknown) => onmsg?.({ data: m }) };
  }

  it('is answered by the host once the dialog closes, and never reaches the broker call', async () => {
    const job = fakeJob();
    const l = linked();
    const call = vi.fn();
    wireHostPort(l.host, { call, print: createPrintGate({ open: () => job }) });
    l.post({ id: 4, op: op() });
    await new Promise((r) => setTimeout(r, 0));
    expect(l.replies).toEqual([]);
    job.finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(l.replies).toEqual([{ id: 4, result: { ok: true, data: null } }]);
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a bad print with a fixed error and forwards nothing', async () => {
    const l = linked();
    const call = vi.fn();
    wireHostPort(l.host, { call, print: createPrintGate({ open: () => { throw new Error('opened'); } }) });
    l.post({ id: 5, op: op({ title: '' }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(l.replies).toEqual([{ id: 5, result: { ok: false, error: 'print refused: bad title' } }]);
    expect(call).not.toHaveBeenCalled();
  });
});
