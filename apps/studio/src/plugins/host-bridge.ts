import { checkDownload, type PluginBrokerOp, type PluginOp, type PluginRpcResult } from '@openldr/plugin-ui-sdk';

export interface HostPortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
}

export interface HostBridgeDeps {
  /** Forward an op to the server broker; resolves to a structured result. The bridge also
   *  defends against a thrown call by replying ok:false. */
  call(op: PluginBrokerOp): Promise<PluginRpcResult>;
  /** Save a text file in the studio's document. Injectable for tests; defaults to saveTextFile. */
  save?: (filename: string, mime: string, text: string) => void;
  /** Injectable clock for the download limit. */
  now?: () => number;
}

/** The shortest time between two downloads from one frame. */
const DOWNLOAD_GAP_MS = 1000;

/** How long a saved file's Blob URL lives. The browser reads it when the save starts, which is
 *  after the click returns, so it cannot be revoked at once. */
const REVOKE_AFTER_MS = 30_000;

/** Save text as a file from the studio's own document: a Blob URL on a temporary link that is
 *  clicked, then removed. The studio never reads or runs the text. */
export function saveTextFile(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}

/** Wire the host end of the plugin MessagePort: plugin posts { id, op }; we call the broker
 *  and post back { id, result }. A thrown call becomes ok:false so the plugin RPC never hangs.
 *  An op whose kind starts with `host.` is answered here and never reaches the server: a
 *  download's text can hold patient values. One wiring is one frame, so the download limit
 *  is per frame. */
export function wireHostPort(port: HostPortLike, deps: HostBridgeDeps): void {
  const save = deps.save ?? saveTextFile;
  const now = deps.now ?? Date.now;
  let lastDownloadAt: number | null = null;

  function hostOp(op: PluginOp): PluginRpcResult {
    if (op.kind !== 'host.download') return { ok: false, error: 'unknown host operation' };
    const refused = checkDownload(op);
    if (refused) return { ok: false, error: refused };
    const at = now();
    if (lastDownloadAt !== null && at - lastDownloadAt < DOWNLOAD_GAP_MS) {
      return { ok: false, error: 'download refused: one download per second' };
    }
    try {
      save(op.filename, op.mime, op.text);
    } catch {
      // The browser's message could name the file; the page gets a fixed one.
      return { ok: false, error: 'download failed' };
    }
    lastDownloadAt = at;
    return { ok: true, data: null };
  }

  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; op?: PluginOp };
    if (typeof msg?.id !== 'number' || !msg.op) return;
    const id = msg.id;
    const kind = (msg.op as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind.startsWith('host.')) {
      port.postMessage({ id, result: hostOp(msg.op) });
      return;
    }
    deps
      .call(msg.op as PluginBrokerOp)
      .then((result) => port.postMessage({ id, result }))
      .catch((err: unknown) => port.postMessage({ id, result: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
  };
  port.start?.();
}
