/** The one network call the update check makes, with a hard deadline on it.
 *
 *  ⛔ Why the timeout is not optional. This runs on a clinical install that may sit behind a captive
 *  portal, a filtering proxy, or a firewall that drops packets instead of refusing them. `fetch`
 *  has NO default timeout: a connection that is accepted and then goes silent never settles, so the
 *  poll would hang forever and every later interval would stack another hung request on top of it —
 *  the check would go quiet permanently and leak a socket a day. A clean refusal is the easy case;
 *  hanging is the likely one.
 *
 *  The timer covers the BODY read as well as the response head, because a stalled body stalls the
 *  poll just as effectively.
 */

/** 10s. This is a once-a-day background check, so waiting longer buys nothing an operator wants. */
export const UPDATE_FETCH_TIMEOUT_MS = 10_000;

/** latest.json is a few hundred bytes; anything this far past that is not the manifest.
 *
 *  ⚠ This does NOT guard the read. It is applied AFTER `res.text()` has already buffered the whole
 *  body into memory, and `.length` counts UTF-16 code units, not bytes — a multi-byte body is
 *  larger than this number says. The only thing actually bounding an oversized or endless body is
 *  the abort timer above. What this check buys is refusing to hand an absurd string to JSON.parse. */
const MAX_CHARS = 64 * 1024;

export function createUpdateFetch(
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): (url: string) => Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? UPDATE_FETCH_TIMEOUT_MS;

  return async function fetchText(url: string): Promise<string> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      // `follow`: the published URL is a release-asset redirect. No SSRF check needed here (unlike
      // the marketplace registry) — this URL is a constant, never operator input.
      const res = await fetchImpl(url, { redirect: 'follow', signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_CHARS) throw new Error(`update manifest is too large (${text.length} characters)`);
      return text;
    } catch (err) {
      // The raw abort reads "This operation was aborted", which lands verbatim in `update.lastError`
      // and then in the UI. Say what actually happened instead.
      if (ac.signal.aborted) throw new Error(`update check timed out after ${timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
