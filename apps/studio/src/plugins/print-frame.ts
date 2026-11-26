import { checkPrint, type PluginRpcResult } from '@openldr/plugin-ui-sdk';

/** The print frame's own policy: images from data URLs and its inline style, nothing else. It runs
 *  no script, and the studio drives it from outside. */
const PRINT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/** One A4 sheet per page. Each image is fitted inside its sheet with its shape kept, so a page that
 *  carries its own white margins prints with them. The sheet is a hair under 297 mm, so rounding
 *  never spills one sheet onto a second, blank one. */
const PRINT_STYLE = `@page{size:A4;margin:0}
html,body{margin:0;padding:0;background:#fff}
.sheet{width:210mm;height:296.5mm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff;break-after:page;page-break-after:always}
.sheet:last-child{break-after:auto;page-break-after:auto}
.sheet img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The print frame's document. `pages` must have passed checkPrint: each is then a PNG data URL of
 *  base64 characters only, so it cannot leave the src attribute. */
export function printDocument(title: string, pages: readonly string[]): string {
  const sheets = pages.map((src) => `<div class="sheet"><img alt="" src="${src}"></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}"><title>${escapeHtml(title)}</title><style>${PRINT_STYLE}</style></head><body>${sheets}</body></html>`;
}

/** A print frame that is open. `done` settles once, when the dialog closes or the frame is removed. */
export interface PrintJob {
  done: Promise<void>;
  remove(): void;
}

/** Add a hidden frame holding only the pages, wait until every image is decoded, then open the
 *  browser's print dialog for that frame. The frame is removed when the dialog closes, printed or
 *  cancelled. A browser that sends no `afterprint` closes it when the studio window has focus again.
 *  `done` rejects with a fixed error when an image cannot be decoded or the dialog cannot open. */
export function openPrintFrame(title: string, pages: readonly string[], doc: Document = document): PrintJob {
  const frame = doc.createElement('iframe');
  // Same origin so the studio can reach the frame to wait for its images and call print(); modals so
  // that print() may open. No scripts: the frame runs nothing of its own.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = 'print';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = printDocument(title, pages);

  let settle: (err?: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    settle = (err) => {
      if (settled) return;
      settled = true;
      doc.defaultView?.removeEventListener('focus', onFocus);
      frame.remove();
      if (err) reject(err); else resolve();
    };
  });
  // Set only once print() has returned: a focus before that is not the dialog closing.
  let printing = false;
  const onFocus = () => { if (printing) settle(); };

  frame.addEventListener('load', () => {
    void (async () => {
      const win = frame.contentWindow;
      const inner = frame.contentDocument;
      if (!win || !inner) { settle(new Error('print failed')); return; }
      try {
        await Promise.all(Array.from(inner.images).map((img) => img.decode()));
      } catch {
        settle(new Error('print refused: a page could not be read'));
        return;
      }
      win.addEventListener('afterprint', () => settle(), { once: true });
      try {
        win.focus();
        win.print();
      } catch {
        settle(new Error('print failed'));
        return;
      }
      printing = true;
      doc.defaultView?.addEventListener('focus', onFocus);
    })();
  }, { once: true });
  doc.body.appendChild(frame);
  return { done, remove: () => settle() };
}

/** One frame's print limit: one print open at a time. */
export interface PrintGate {
  /** Check a page's print, then print it. Answers when the dialog closes, with a short fixed error or ok. */
  print(op: unknown): Promise<PluginRpcResult>;
  /** Remove an open print frame, as when the plugin's frame goes away. */
  dispose(): void;
}

export function createPrintGate(opts: { open?: (title: string, pages: readonly string[]) => PrintJob } = {}): PrintGate {
  const open = opts.open ?? ((title, pages) => openPrintFrame(title, pages));
  let current: PrintJob | null = null;
  return {
    async print(op) {
      const refused = checkPrint(op);
      if (refused) return { ok: false, error: refused };
      if (current) return { ok: false, error: 'print refused: another print is open' };
      const { title, pages } = op as { title: string; pages: string[] };
      let job: PrintJob;
      try {
        job = open(title, pages);
      } catch {
        return { ok: false, error: 'print failed' };
      }
      current = job;
      try {
        await job.done;
        return { ok: true, data: null };
      } catch (err) {
        // The frame's errors are fixed sentences; anything else gets a fixed one too.
        const message = err instanceof Error && err.message.startsWith('print ') ? err.message : 'print failed';
        return { ok: false, error: message };
      } finally {
        if (current === job) current = null;
      }
    },
    dispose() {
      current?.remove();
      current = null;
    },
  };
}
