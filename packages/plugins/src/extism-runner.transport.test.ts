import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { TRANSPORT_STATUS, withTransportAnswer, withoutRedirects, egressBudget } from './extism-runner';
import { TEST_CERT, TEST_KEY } from './egress-test-cert.fixtures';

const port = (s: { address(): unknown }) => (s.address() as { port: number }).port;
const listening = (s: { listen(p: number, h: string, cb: () => void): unknown }) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const closed = (s: { close(cb: () => void): unknown; closeAllConnections?: () => void }) => new Promise<void>((r) => { s.closeAllConnections?.(); s.close(() => r()); });

/** What a plugin can read of an answer: the status and the body. */
async function read(res: Response) { return { status: res.status, body: await res.text() }; }
const said = (reason: string) => ({ status: TRANSPORT_STATUS, body: JSON.stringify({ openldr: { transport: reason } }) });

describe('withTransportAnswer', () => {
  it('a server that never answers: the plugin gets a timeout answer, within the limit', async () => {
    const server: Server = createServer(() => { /* never answers */ });
    await listening(server);
    try {
      const started = Date.now();
      const res = await withTransportAnswer(fetch, () => 300)(`http://127.0.0.1:${port(server)}/x`, { method: 'POST', body: 'x' });
      expect(await read(res)).toEqual(said('timeout'));
      expect(Date.now() - started).toBeLessThan(2000);
    } finally { await closed(server); }
  });

  it('a server that starts its answer and then stalls: the same timeout answer', async () => {
    const server: Server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.write('part'); /* never ends */ });
    await listening(server);
    try {
      const res = await withTransportAnswer(fetch, () => 300)(`http://127.0.0.1:${port(server)}/x`, {});
      expect(await read(res)).toEqual(said('timeout'));
    } finally { await closed(server); }
  });

  it('nothing listening: unreachable', async () => {
    const tcp = createTcpServer(); await listening(tcp); const free = port(tcp); await closed(tcp);
    const res = await withTransportAnswer(fetch, () => 2000)(`http://127.0.0.1:${free}/x`, {});
    expect(await read(res)).toEqual(said('unreachable'));
  });

  it('a certificate this OpenLDR does not trust: certificate', async () => {
    const server = createTlsServer({ cert: TEST_CERT, key: TEST_KEY }, (_req, res) => { res.writeHead(200); res.end('never read'); });
    await listening(server);
    try {
      const res = await withTransportAnswer(fetch, () => 2000)(`https://127.0.0.1:${port(server)}/x`, {});
      expect(await read(res)).toEqual(said('certificate'));
    } finally { await closed(server); }
  });

  it('says nothing but the reason: no address, no error text', async () => {
    const tcp = createTcpServer(); await listening(tcp); const free = port(tcp); await closed(tcp);
    const res = await withTransportAnswer(fetch, () => 2000)(`http://127.0.0.1:${free}/secret-path?token=abc`, { headers: { authorization: 'Bearer secret' } });
    const body = await res.text();
    expect(body).toBe('{"openldr":{"transport":"unreachable"}}');
    expect([...res.headers.keys()].sort()).toEqual(['content-type']);
  });

  it("a real answer is passed through as it is, a server's own 5xx included", async () => {
    const server: Server = createServer((_req, res) => { res.writeHead(503, { 'content-type': 'application/json', 'x-kept': 'yes' }); res.end('{"down":true}'); });
    await listening(server);
    try {
      const res = await withTransportAnswer(fetch, () => 2000)(`http://127.0.0.1:${port(server)}/x`, {});
      expect(res.headers.get('x-kept')).toBe('yes');
      expect(await read(res)).toEqual({ status: 503, body: '{"down":true}' });
    } finally { await closed(server); }
  });

  it('keeps a redirect answer as it is when used with withoutRedirects', async () => {
    const server: Server = createServer((_req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' }); res.end(); });
    await listening(server);
    try {
      const res = await withTransportAnswer(withoutRedirects(fetch), () => 2000)(`http://127.0.0.1:${port(server)}/x`, {});
      expect(res.status).toBe(302);
    } finally { await closed(server); }
  });
});

describe('egressBudget', () => {
  it('gives each call 10 seconds while the whole call has that much left, less 2 seconds', () => {
    let now = 0;
    const left = egressBudget(60_000, () => now);
    expect(left()).toBe(10_000);
    now = 50_000;
    expect(left()).toBe(8_000);
  });

  it('a second call gets only what the first left, so the plugin is back in time to record it', () => {
    let now = 0;
    const left = egressBudget(15_000, () => now);
    expect(left()).toBe(10_000);
    now = 10_000; // the first call used its whole limit
    expect(left()).toBe(3_000);
    now = 13_500;
    expect(left()).toBe(0);
  });

  it('with nothing left the call is not made, and the plugin gets a timeout answer at once', async () => {
    let called = 0;
    const base = (async () => { called++; return new Response('x'); }) as typeof fetch;
    const res = await withTransportAnswer(base, () => 0)('http://127.0.0.1:9/x', {});
    expect(await read(res)).toEqual(said('timeout'));
    expect(called).toBe(0);
  });
});

// The same through the real runner and a real plugin. reference-plugins/dhis2-sink/plugin.wasm is
// a gitignored build artifact (run `pnpm build:dhis2-sink` first). Absent, this part skips.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe.skipIf(!existsSync(wasmPath))('a plugin call to a server that is not there', () => {
  it('ends with what the plugin made of the 599, not with a failed fetch', async () => {
    const tcp = createTcpServer(); await listening(tcp); const free = port(tcp); await closed(tcp);
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const manifest = parseManifest({ id: 'dhis2-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'], wasmSha256: sha256Hex(wasm), wasi: true });
    const sink = createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
    let outcome: unknown;
    try {
      outcome = await sink.invoke('health_check', {}, { config: { baseUrl: `http://127.0.0.1:${free}`, username: 'admin', password: 'district' }, allowedHosts: ['127.0.0.1'] });
    } catch (err) {
      outcome = { threw: String(err) };
    }
    const text = JSON.stringify(outcome);
    expect(text).not.toContain('fetch failed');
    expect(text).toContain('599');
  });
});
