// The one way this client makes an HTTP request: node:http and node:https, not fetch. node:http
// never follows a redirect, so a key, a password or a session cookie is never carried to another
// host. run-through-app.ts streams through sendRequest; sign-in uses requestOnce, which reads a
// small answer whole.

import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Printed for any 3xx answer. Nothing is sent to the other address. */
export const REDIRECT_MESSAGE = 'OpenLDR answered with a redirect, which this client does not follow. Check the address.';
/** Printed for a 401 from a route that needs an account. */
export const SIGN_IN_FIRST = 'Sign in first: openldr login, or set OPENLDR_KEY.';

/** The address with this path under it. Any query or fragment on the address is dropped. */
export function endpoint(base: string, path: string): URL {
  const u = new URL(base);
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  u.search = '';
  u.hash = '';
  return new URL(path, u);
}

/** The address for a message: origin and path, never a query. assertSafeUrl refused any user name. */
export function shown(base: string): string {
  const u = new URL(base);
  return `${u.origin}${u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')}`;
}

export function sendRequest(target: URL, options: RequestOptions): ClientRequest {
  // agent: false gives each request its own connection. node:http never follows a redirect.
  const opts: RequestOptions = { ...options, agent: false };
  return target.protocol === 'https:' ? httpsRequest(target, opts) : httpRequest(target, opts);
}

/** Text from the server, safe for a terminal: no control characters, at most 500 characters. */
export const clean = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500);

/** A refused connection or a failed name lookup: nothing answered at the address. */
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);
/** The connection was made and then went: a reset, or a broken pipe while sending. */
const LOST = new Set(['ECONNRESET', 'EPIPE']);

/** The message for a request that got no answer, from the error's code. Never quotes a value sent. */
export function connectionMessage(url: string, code: string | undefined): string {
  if (code && UNREACHABLE.has(code)) return `Cannot reach OpenLDR at ${shown(url)}. Is it running?`;
  if (code && !LOST.has(code)) return `Cannot reach OpenLDR at ${shown(url)}: ${code}.`;
  return 'The connection to OpenLDR was lost.';
}

/** The code of an error from a request, such as ECONNREFUSED. */
export const errorCode = (e: unknown): string | undefined => {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : undefined;
};

/** A small answer that was read whole. body is null when it was larger than the limit. */
export interface Answer { status: number; headers: IncomingHttpHeaders; body: Buffer | null }

/** A sign-in answer is a few hundred bytes. Anything over this is not read. */
const MAX_ANSWER_BYTES = 64 * 1024;

/**
 * One request with a small body, its answer read whole. Rejects with the request's own error when
 * no answer came: read the message with connectionMessage(url, errorCode(e)). The error never holds
 * the body that was sent.
 */
export function requestOnce(
  base: string, path: string, init: { method: 'GET' | 'POST'; headers?: Record<string, string>; json?: unknown },
): Promise<Answer> {
  const body = init.json === undefined ? null : Buffer.from(JSON.stringify(init.json), 'utf8');
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  if (body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(body.length);
  } else if (init.method === 'POST') {
    headers['content-length'] = '0';
  }
  return new Promise<Answer>((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => { if (!settled) { settled = true; reject(e); } };
    const req = sendRequest(endpoint(base, path), { method: init.method, headers });
    req.on('error', fail);
    req.on('response', (res) => {
      const parts: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_ANSWER_BYTES) {
          settled = true;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: null });
          res.destroy();
          return;
        }
        parts.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) });
      });
      res.on('error', fail);
      res.on('close', () => fail(Object.assign(new Error('closed'), { code: 'ECONNRESET' })));
    });
    req.end(body ?? undefined);
  });
}

/** The answer's body as a JSON object, or null. */
export function jsonOf(answer: Answer): Record<string, unknown> | null {
  if (!answer.body) return null;
  try {
    const v = JSON.parse(answer.body.toString('utf8')) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
