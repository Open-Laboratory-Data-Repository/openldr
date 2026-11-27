import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createExtismRunner, withoutRedirects } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

/** A server that records what reaches it. `answer` decides the reply. */
async function listen(answer: (url: string) => { status: number; headers?: Record<string, string>; body?: string }) {
  const seen: Array<{ method: string; url: string; body: string; authorization: string | undefined }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString(), authorization: req.headers.authorization });
      const a = answer(req.url ?? '');
      res.writeHead(a.status, a.headers ?? {});
      res.end(a.body ?? '');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { seen, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('withoutRedirects', () => {
  it.each([301, 302, 303, 307, 308])('does not follow a %i, and hands the answer back as it is', async (status) => {
    const other = await listen(() => ({ status: 200, body: 'reached' }));
    const first = await listen(() => ({ status, headers: { location: `http://127.0.0.1:${other.port}/taken` } }));
    try {
      const res = await withoutRedirects(fetch)(`http://127.0.0.1:${first.port}/send`, {
        method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ patient: 'Test Patient' }),
      });
      await res.arrayBuffer();
      // The caller sees the redirect itself. Nothing went to the second server.
      expect(res.status).toBe(status);
      expect(first.seen).toHaveLength(1);
      expect(other.seen).toEqual([]);
    } finally { await first.close(); await other.close(); }
  });

  it('does not follow a redirect back to the same host either', async () => {
    let hits = 0;
    const first = await listen((url) => (url === '/send' ? { status: 307, headers: { location: '/elsewhere' } } : { status: 200, body: `hit ${++hits}` }));
    try {
      const res = await withoutRedirects(fetch)(`http://127.0.0.1:${first.port}/send`, { method: 'POST', body: 'x' });
      await res.arrayBuffer();
      expect(res.status).toBe(307);
      expect(first.seen.map((s) => s.url)).toEqual(['/send']);
    } finally { await first.close(); }
  });

  it('leaves an ordinary answer alone', async () => {
    const first = await listen(() => ({ status: 200, body: 'ok' }));
    try {
      const res = await withoutRedirects(fetch)(`http://127.0.0.1:${first.port}/x`, { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    } finally { await first.close(); }
  });

  it('cannot be told to follow by the caller', async () => {
    const other = await listen(() => ({ status: 200, body: 'reached' }));
    const first = await listen(() => ({ status: 302, headers: { location: `http://127.0.0.1:${other.port}/taken` } }));
    try {
      const res = await withoutRedirects(fetch)(`http://127.0.0.1:${first.port}/send`, { redirect: 'follow' });
      await res.arrayBuffer();
      expect(res.status).toBe(302);
      expect(other.seen).toEqual([]);
    } finally { await first.close(); await other.close(); }
  });
});

// The same rule through the real runner and a real plugin. reference-plugins/dhis2-sink/plugin.wasm
// is a gitignored build artifact (run `pnpm build:dhis2-sink` first). Absent, this part skips; the
// part above always runs.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe.skipIf(!existsSync(wasmPath))('a plugin call that is answered with a redirect', () => {
  it('sends nothing to the place the redirect names', async () => {
    const other = await listen(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESS', importCount: { imported: 2, updated: 0, ignored: 0, deleted: 0 }, conflicts: [] }) }));
    // The allowed host answers every call with a redirect to another server. That server is on
    // this PC as well, so a followed redirect would really arrive there.
    // A 302, because that is the one plain Node follows today: it turns the POST into a GET with
    // no body, calls the other server, and hands its answer back as if the allowed host had given
    // it. (On Node 24.1 a 307 or 308 with a body fails by itself; that is an accident of that
    // version, not a rule.)
    const first = await listen((url) => ({ status: 302, headers: { location: `http://127.0.0.1:${other.port}${url}` } }));
    try {
      const wasm = new Uint8Array(readFileSync(wasmPath));
      const manifest = parseManifest({ id: 'dhis2-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'], wasmSha256: sha256Hex(wasm), wasi: true });
      const sink = createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
      const input = {
        rows: [{ facility: 'fac-1', tested: 4 }],
        mapping: { orgUnitColumn: 'facility', columns: [{ column: 'tested', dataElement: 'DE_TESTED' }] },
        orgUnitMap: { 'fac-1': 'OU_AAA' }, period: '2026Q1', dryRun: false,
      };
      let outcome: unknown;
      try {
        outcome = await sink.invoke('push_aggregate', input, { config: { baseUrl: `http://127.0.0.1:${first.port}`, username: 'admin', password: 'district' }, allowedHosts: ['127.0.0.1'] });
      } catch (err) {
        outcome = { threw: String(err) };
      }
      // The allowed host got the call. The other host got nothing at all, not even a bare GET.
      expect(first.seen.length).toBeGreaterThan(0);
      expect(other.seen).toEqual([]);
      // And the other host's answer was not taken for the allowed host's: no success was reported.
      expect(JSON.stringify(outcome)).not.toContain('"imported":2');
    } finally { await first.close(); await other.close(); }
  });
});
