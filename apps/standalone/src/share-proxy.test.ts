import { once } from 'node:events';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeCert } from './share-cert';
import { startShareProxy, type ShareProxy } from './share-proxy';

let certPem = '';
let keyPem = '';
beforeAll(async () => {
  ({ certPem, keyPem } = await makeCert({ dns: ['localhost'], ips: ['127.0.0.1'] }, new Date(Date.now() - 60_000), 2));
});

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** The stand-in for OpenLDR: a plain HTTP server on a free port of 127.0.0.1. */
async function upstream(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; server: Server }> {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port: (server.address() as AddressInfo).port, server };
}

async function front(upstreamPort: number): Promise<ShareProxy> {
  const proxy = await startShareProxy({ host: '127.0.0.1', port: 0, certPem, keyPem, upstreamPort });
  cleanup.push(() => proxy.close());
  return proxy;
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(port: number, opts: https.RequestOptions = {}, body?: string, trust = true): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: '/', ...(trust ? { ca: certPem } : {}), agent: false, ...opts }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

function within<T>(ms: number, p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_r, reject) => setTimeout(() => reject(new Error(`not within ${ms} ms`)), ms))]);
}

function gate(): { open: () => void; opened: Promise<void> } {
  let open = (): void => {};
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

describe('startShareProxy', () => {
  it('passes a GET through with its status, headers and body', async () => {
    const up = await upstream((req, res) => {
      res.writeHead(201, { 'x-test': '1', 'content-type': 'text/plain' });
      res.end(`hello ${req.method} ${req.url}`);
    });
    const proxy = await front(up.port);
    const a = await call(proxy.port, { path: '/studio/x?y=1' });
    expect(a.status).toBe(201);
    expect(a.headers['x-test']).toBe('1');
    expect(a.body).toBe('hello GET /studio/x?y=1');
  });

  it('passes a POST body through', async () => {
    const up = await upstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => res.end(Buffer.concat(chunks)));
    });
    const proxy = await front(up.port);
    const a = await call(proxy.port, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 'a=1');
    expect(a.body).toBe('a=1');
  });

  it('writes its own forwarded headers and drops the ones the client sent', async () => {
    let seen: http.IncomingHttpHeaders = {};
    const up = await upstream((req, res) => {
      seen = req.headers;
      res.end('ok');
    });
    const proxy = await front(up.port);
    await call(proxy.port, {
      // The client checks the certificate against this name, not against the Host header.
      servername: 'localhost',
      headers: {
        host: 'lab:9',
        'x-forwarded-for': '6.6.6.6',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'evil',
        'x-forwarded-port': '1',
        forwarded: 'for=6.6.6.6',
        'x-keep': 'yes',
      },
    });
    expect(seen['x-forwarded-proto']).toBe('https');
    expect(['127.0.0.1', '::ffff:127.0.0.1']).toContain(seen['x-forwarded-for']);
    expect(seen['x-forwarded-host']).toBe('lab:9');
    expect(seen['x-forwarded-port']).toBeUndefined();
    expect(seen.forwarded).toBeUndefined();
    expect(seen.host).toBe('lab:9');
    expect(seen['x-keep']).toBe('yes');
  });

  it('delivers an event stream piece by piece', async () => {
    const release = gate();
    const up = await upstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('one\n');
      void release.opened.then(() => res.end('two\n'));
    });
    const proxy = await front(up.port);
    const first = gate();
    let got = '';
    const done = new Promise<void>((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port: proxy.port, path: '/', ca: certPem, agent: false }, (res) => {
        res.on('data', (c: Buffer) => {
          got += c.toString();
          first.open();
        });
        res.on('end', resolve);
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    await within(2000, first.opened);
    expect(got).toBe('one\n');
    release.open();
    await within(2000, done);
    expect(got).toBe('one\ntwo\n');
  });

  it('answers 502 when OpenLDR is not answering', async () => {
    const up = await upstream((_req, res) => res.end());
    const closedPort = up.port;
    up.server.close();
    await once(up.server, 'close');
    const proxy = await front(closedPort);
    const a = await call(proxy.port);
    expect(a.status).toBe(502);
    expect(a.body).toBe('OpenLDR is not answering.');
  });

  it('closes at once while an event stream is open, and the server side sees the close', async () => {
    const upstreamClosed = gate();
    const up = await upstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('one\n');
      req.on('close', upstreamClosed.open);
    });
    const proxy = await front(up.port);
    const first = gate();
    const req = https.request({ host: '127.0.0.1', port: proxy.port, path: '/', ca: certPem, agent: false }, (res) => {
      res.on('data', first.open);
      res.on('error', () => {});
    });
    req.on('error', () => {});
    req.end();
    await within(2000, first.opened);
    await within(2000, proxy.close());
    await within(2000, upstreamClosed.opened);
  });

  it('closes the request to the server when the client goes away', async () => {
    const upstreamClosed = gate();
    const up = await upstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('one\n');
      req.on('close', upstreamClosed.open);
    });
    const proxy = await front(up.port);
    const first = gate();
    const req = https.request({ host: '127.0.0.1', port: proxy.port, path: '/', ca: certPem, agent: false }, (res) => {
      res.on('data', first.open);
      res.on('error', () => {});
    });
    req.on('error', () => {});
    req.end();
    await within(2000, first.opened);
    req.destroy();
    await within(2000, upstreamClosed.opened);
  });

  it('ends the client connection when the server breaks off mid-stream', async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('one\n', () => res.socket?.destroy());
    });
    const proxy = await front(up.port);
    const ended = new Promise<string>((resolve) => {
      const req = https.request({ host: '127.0.0.1', port: proxy.port, path: '/', ca: certPem, agent: false }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve('end'));
        res.on('error', () => resolve('error'));
        res.on('close', () => resolve('close'));
      });
      req.on('error', () => resolve('request error'));
      req.end();
    });
    expect(['end', 'error', 'close', 'request error']).toContain(await within(2000, ended));
  });

  it('drops per-connection headers in both directions and keeps two cookies apart', async () => {
    let seen: http.IncomingHttpHeaders = {};
    const up = await upstream((req, res) => {
      seen = req.headers;
      res.writeHead(200, {
        connection: 'keep-alive, x-up-drop',
        'keep-alive': 'timeout=99',
        'x-up-drop': '1',
        'x-up-keep': '1',
        'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
      });
      res.end('ok');
    });
    const proxy = await front(up.port);
    const a = await call(proxy.port, {
      headers: { connection: 'keep-alive, x-drop-me', 'keep-alive': 'timeout=5', 'x-drop-me': '1', te: 'trailers', 'x-keep': 'yes' },
    });
    expect(seen['x-drop-me']).toBeUndefined();
    expect(seen['keep-alive']).toBeUndefined();
    expect(seen.te).toBeUndefined();
    expect(seen['x-keep']).toBe('yes');
    expect(a.headers['x-up-drop']).toBeUndefined();
    // The front may state its own keep-alive for its own connection. It never passes the server's on.
    expect(a.headers['keep-alive']).not.toBe('timeout=99');
    expect(a.headers['x-up-keep']).toBe('1');
    expect(a.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('rejects when the port is taken', async () => {
    const up = await upstream((_req, res) => res.end());
    const proxy = await front(up.port);
    await expect(startShareProxy({ host: '127.0.0.1', port: proxy.port, certPem, keyPem, upstreamPort: up.port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });

  it('refuses a client that does not trust the certificate', async () => {
    const up = await upstream((_req, res) => res.end('ok'));
    const proxy = await front(up.port);
    await expect(call(proxy.port, {}, undefined, false)).rejects.toThrow(/self[- ]signed|certificate/i);
  });

  it('destroys the socket of an upgrade request', async () => {
    let reached = false;
    const up = await upstream((_req, res) => {
      reached = true;
      res.end('ok');
    });
    up.server.on('upgrade', () => (reached = true));
    const proxy = await front(up.port);
    const outcome = new Promise<string>((resolve) => {
      const req = https.request({
        host: '127.0.0.1',
        port: proxy.port,
        path: '/',
        ca: certPem,
        agent: false,
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      });
      req.on('upgrade', () => resolve('upgraded'));
      req.on('response', () => resolve('response'));
      req.on('error', () => resolve('error'));
      req.on('close', () => resolve('close'));
      req.end();
    });
    expect(['error', 'close']).toContain(await within(2000, outcome));
    expect(reached).toBe(false);
  });

  it('closes at once while a client has connected and not yet finished the TLS handshake', async () => {
    const up = await upstream((_req, res) => res.end('ok'));
    const proxy = await startShareProxy({ host: '127.0.0.1', port: 0, certPem, keyPem, upstreamPort: up.port });
    // A plain TCP connection that never speaks TLS. It has no HTTP request for the front to close.
    const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
    socket.on('error', () => {});
    await once(socket, 'connect');
    await new Promise((r) => setTimeout(r, 50));
    const closed = once(socket, 'close');
    await within(2000, proxy.close());
    await within(2000, closed);
  });

  it('close can be called twice', async () => {
    const up = await upstream((_req, res) => res.end('ok'));
    const proxy = await startShareProxy({ host: '127.0.0.1', port: 0, certPem, keyPem, upstreamPort: up.port });
    await proxy.close();
    await proxy.close();
  });
});
