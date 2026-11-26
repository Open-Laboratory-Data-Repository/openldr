import { checkDownload, utf8ByteLength, type PluginBrokerOp, type PluginOp, type PluginRpcResult } from '@openldr/plugin-ui-sdk';
import { createPrintGate, type PrintGate } from './print-frame';

export interface HostPortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
  close?(): void;
}

export interface HostBridgeDeps {
  /** Forward an op to the server broker; resolves to a structured result. The bridge also
   *  defends against a thrown call by replying ok:false. */
  call(op: PluginBrokerOp): Promise<PluginRpcResult>;
  /** The frame's download limit. PluginFrame keeps one per mounted frame, so it holds across
   *  the frame's reloads. Absent, this wiring gets its own. */
  gate?: DownloadGate;
  edition?(key: string, open: boolean): Promise<boolean>;
  /** The frame's print limit, kept across its reloads like `gate`. Absent, this wiring gets its own. */
  print?: PrintGate;
}

/** The shortest time between two downloads from one frame. */
const DOWNLOAD_GAP_MS = 1000;

/** The most one frame may hold in Blobs whose URL is not yet revoked: two files at the 64 MiB
 *  limit. A Blob is memory or disk the browser may not give back until its URL is revoked. */
export const DOWNLOAD_PENDING_MAX_BYTES = 128 * 1024 * 1024;

/** How long a saved file's Blob URL lives. The browser resolves the URL when the download
 *  starts, a moment after the click returns, and a revoke after that does not stop the save. So
 *  the URL cannot be revoked at once, but it need not live long. 10 s leaves a slow phone time
 *  to start the save, and with the byte cap it bounds what one frame holds. */
export const REVOKE_AFTER_MS = 10_000;

/** Save text as a file from the studio's own document: a Blob URL on a temporary link that is
 *  clicked, then removed. The studio never reads or runs the text. `released` is called once,
 *  when the URL is revoked. If the click throws, the URL is revoked at once. */
export function saveTextFile(filename: string, mime: string, text: string, released: () => void): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const revoke = () => { URL.revokeObjectURL(url); released(); };
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } catch (err) {
    a.remove();
    revoke();
    throw err;
  }
  a.remove();
  setTimeout(revoke, REVOKE_AFTER_MS);
}

export interface DownloadGate {
  /** Check a page's download, then save it. Answers with a short fixed error or ok. */
  download(op: unknown): PluginRpcResult;
}

/** One frame's download limit: one save a second, and no more than DOWNLOAD_PENDING_MAX_BYTES
 *  in Blobs not yet revoked. Only a save that went through uses up the second. */
export function createDownloadGate(opts: { save?: typeof saveTextFile; now?: () => number } = {}): DownloadGate {
  const save = opts.save ?? saveTextFile;
  const now = opts.now ?? Date.now;
  let lastDownloadAt: number | null = null;
  let pendingBytes = 0;
  return {
    download(op) {
      const refused = checkDownload(op);
      if (refused) return { ok: false, error: refused };
      const { filename, mime, text } = op as { filename: string; mime: string; text: string };
      const at = now();
      if (lastDownloadAt !== null && at - lastDownloadAt < DOWNLOAD_GAP_MS) {
        return { ok: false, error: 'download refused: one download per second' };
      }
      // A Blob holds the text as UTF-8.
      const bytes = utf8ByteLength(text);
      if (pendingBytes + bytes > DOWNLOAD_PENDING_MAX_BYTES) return { ok: false, error: 'download refused: too many files waiting' };
      pendingBytes += bytes;
      let freed = false;
      const release = () => { if (!freed) { freed = true; pendingBytes -= bytes; } };
      try {
        save(filename, mime, text, release);
      } catch {
        release();
        // The browser's message could name the file; the page gets a fixed one.
        return { ok: false, error: 'download failed' };
      }
      lastDownloadAt = at;
      return { ok: true, data: null };
    },
  };
}

/** Wire the host end of the plugin MessagePort: plugin posts { id, op }; we call the broker
 *  and post back { id, result }. A thrown call becomes ok:false so the plugin RPC never hangs.
 *  An op whose kind starts with `host.` is answered here and never reaches the server: a
 *  download's text and a print's pages can hold patient values. */
export function wireHostPort(port: HostPortLike, deps: HostBridgeDeps): void {
  const gate = deps.gate ?? createDownloadGate();
  const printGate = deps.print ?? createPrintGate();

  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; op?: PluginOp };
    if (typeof msg?.id !== 'number' || !msg.op) return;
    const id = msg.id;
    const kind = (msg.op as { kind?: unknown }).kind;
    const op = msg.op;
    if (typeof kind === 'string' && kind.startsWith('host.')) {
      if (op.kind === 'host.edition' && deps.edition &&
          typeof op.edition === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/.test(op.edition) &&
          typeof op.open === 'boolean') {
        void deps.edition(op.edition, op.open)
          .then(data => port.postMessage({ id, result: { ok: true, data } }))
          .catch(() => port.postMessage({ id, result: { ok: false, error: 'Report lookup failed' } }));
      } else if (op.kind === 'host.print') {
        // Answered when the print dialog closes. The gate never throws.
        void printGate.print(op).then((result) => port.postMessage({ id, result }));
      } else {
        const result = op.kind === 'host.download' ? gate.download(op) : { ok: false, error: 'unknown host operation' };
        port.postMessage({ id, result });
      }
      return;
    }
    deps
      .call(msg.op as PluginBrokerOp)
      .then((result) => port.postMessage({ id, result }))
      .catch((err: unknown) => port.postMessage({ id, result: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
  };
  port.start?.();
}
