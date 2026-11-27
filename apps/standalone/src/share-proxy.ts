// The HTTPS front for `start --share`. It listens on the lab network with the sharing
// certificate and passes every request to the server, which keeps listening on 127.0.0.1 over
// plain HTTP. The server trusts this front's forwarded headers and no one else's
// (TRUST_PROXY=127.0.0.1), so the front removes whatever the client sent under those names.

import http, { type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { AddressInfo, Socket } from 'node:net';

export interface ShareProxy {
  port: number;
  close(): Promise<void>;
}

/** What a client may not say about itself. The front writes these. */
const FORWARDED = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'forwarded'];
/** Headers that belong to one connection, not to the message. Never passed on, either way. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

export const NOT_ANSWERING = 'OpenLDR is not answering.';

/** The names a Connection header lists, in lower case. */
function namedByConnection(value: string | string[] | undefined): string[] {
  const text = Array.isArray(value) ? value.join(',') : (value ?? '');
  return text
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== '');
}

/** The headers without those of one connection. Arrays, such as several Set-Cookie, stay arrays. */
function messageHeaders(headers: IncomingHttpHeaders, alsoDrop: readonly string[] = []): OutgoingHttpHeaders {
  const drop = new Set([...HOP_BY_HOP, ...namedByConnection(headers.connection), ...alsoDrop]);
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !drop.has(name)) out[name] = value;
  }
  return out;
}

function pass(req: IncomingMessage, res: ServerResponse, upstreamPort: number): void {
  const headers = messageHeaders(req.headers, FORWARDED);
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';
  if (req.headers.host !== undefined) headers['x-forwarded-host'] = req.headers.host;

  const up = http.request({
    host: '127.0.0.1',
    port: upstreamPort,
    method: req.method,
    path: req.url,
    headers,
    // One connection to the server for each request: a stream that is cut cuts only itself.
    agent: false,
  });

  up.on('response', (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.statusMessage, messageHeaders(answer.headers));
    // Headers go out now, so the first piece of an event stream is not held back.
    res.flushHeaders();
    answer.pipe(res);
    // The server broke off after its headers: end the client's connection too.
    answer.on('error', () => res.destroy());
    answer.on('aborted', () => res.destroy());
  });

  up.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(NOT_ANSWERING);
  });

  // The client went away: stop the request to the server, which then stops its own work.
  res.on('close', () => {
    if (!res.writableFinished) up.destroy();
  });
  req.on('error', () => up.destroy());
  req.pipe(up);
}

/**
 * An HTTPS server on host:port that passes every request to http://127.0.0.1:upstreamPort.
 * Resolves once it is listening. Rejects with the listen error (EADDRINUSE and others).
 */
export function startShareProxy(opts: { host: string; port: number; certPem: string; keyPem: string; upstreamPort: number }): Promise<ShareProxy> {
  const server = https.createServer({ cert: opts.certPem, key: opts.keyPem }, (req, res) => pass(req, res, opts.upstreamPort));
  // The server has no websockets. An upgrade is never passed on.
  server.on('upgrade', (_req, socket) => socket.destroy());
  // A client that breaks the TLS or HTTP rules gets its socket closed, with no stack in a log.
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('tlsClientError', (_err, socket) => socket.destroy());

  // Every accepted socket, from the TCP connection on. closeAllConnections() knows a connection
  // only once its TLS handshake is done, so a client that has connected and not yet finished
  // the handshake would hold a stop for up to Node's 120 second handshake limit.
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return new Promise<ShareProxy>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: opts.host, port: opts.port }, () => {
      server.off('error', reject);
      let closing: Promise<void> | undefined;
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => {
          closing ??= new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
            for (const socket of sockets) socket.destroy();
          });
          return closing;
        },
      });
    });
  });
}
