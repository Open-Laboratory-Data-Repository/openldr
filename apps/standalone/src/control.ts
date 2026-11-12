// A small control channel for a running launcher.
//
// The launcher listens on 127.0.0.1, on a port the OS picks, and writes that port and a random
// token into the lock file. `status` asks it "ping" and `stop` asks it "stop". A launcher counts
// as alive only when something on that port answers with the right token. A recorded process ID
// is not proof: after a power cut and a reboot, the same ID can belong to another program.
//
// Protocol: one request per connection, one line, `ping <token>` or `stop <token>`.
// Replies are one line: `pong`, `clean` or `forced`. Anything else gets the connection closed
// with no reply. The token never goes into an error message or a log line.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

export interface ControlServer {
  port: number;
  close(): Promise<void>;
}

export interface ControlTarget {
  controlPort: number;
  token: string;
}

type StopResult = 'clean' | 'forced';

const HOST = '127.0.0.1';
/** Longest request or reply line, in bytes, without its newline. */
const MAX_LINE = 256;
/** A connection that sends no request within this time is closed. */
const IDLE_MS = 5000;
const DEFAULT_PING_MS = 2000;
/** How long close() waits for a stop answer that is already on its way out. */
const FLUSH_MS = 2000;

/** 24 random bytes in base64url. */
export function newControlToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Listens on 127.0.0.1, on a free port the OS picks. */
export function startControl(opts: { token: string; onStop: () => Promise<StopResult> }): Promise<ControlServer> {
  const expected = Buffer.from(opts.token, 'utf8');
  const sockets = new Set<Socket>();
  /** Sockets that asked to stop and wait for the answer. */
  const answering = new Set<Socket>();
  let stopping: Promise<StopResult> | undefined;
  let stopSettled = false;
  let closing: Promise<void> | undefined;

  const stopOnce = (): Promise<StopResult> =>
    (stopping ??= Promise.resolve()
      .then(() => opts.onStop())
      .finally(() => {
        stopSettled = true;
      }));

  const tokenMatches = (given: string): boolean => {
    const g = Buffer.from(given, 'utf8');
    return g.length === expected.length && timingSafeEqual(g, expected);
  };

  const server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => {
      sockets.delete(sock);
      answering.delete(sock);
    });
    sock.on('error', () => {});
    sock.setTimeout(IDLE_MS, () => sock.destroy());

    let buf = Buffer.alloc(0);
    let handled = false;
    sock.on('data', (chunk: Buffer) => {
      if (handled) return;
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl === -1) {
        if (buf.length > MAX_LINE) sock.destroy();
        return;
      }
      handled = true;
      sock.setTimeout(0);
      if (nl > MAX_LINE) return void sock.destroy();
      const parts = buf.subarray(0, nl).toString('utf8').split(' ');
      if (parts.length !== 2 || !tokenMatches(parts[1]!)) return void sock.destroy();
      if (parts[0] === 'ping') return void sock.end('pong\n');
      if (parts[0] !== 'stop') return void sock.destroy();
      answering.add(sock);
      stopOnce().then(
        (result) => sock.end(`${result}\n`),
        () => sock.destroy(),
      );
    });
  });

  const close = async (): Promise<void> => {
    server.close();
    const waits: Promise<void>[] = [];
    for (const sock of sockets) {
      if (!answering.has(sock)) {
        sock.destroy();
      } else if (stopSettled) {
        // The answer is written or about to be. Let it reach the asker, briefly.
        waits.push(
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => sock.destroy(), FLUSH_MS);
            sock.once('close', () => {
              clearTimeout(timer);
              resolve();
            });
          }),
        );
      }
      // A stop still running is left alone: close() is often called from inside onStop, and
      // the answer is sent when onStop returns.
    }
    await Promise.all(waits);
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port: 0 }, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({ port, close: () => (closing ??= close()) });
    });
  });
}

/** Sends one request line and resolves with the one reply line. Errors never name the token. */
function exchange(target: ControlTarget, word: 'ping' | 'stop', timeoutMs: number): Promise<string> {
  const port = target.controlPort;
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reject(new Error(`Not a control port number: ${port}`));
      return;
    }
    let settled = false;
    let buf = Buffer.alloc(0);
    const sock = connect({ host: HOST, port });
    const finish = (err: Error | null, line?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err);
      else resolve(line!);
    };
    const timer = setTimeout(
      () => finish(new Error(`The launcher's control port ${port} did not answer within ${timeoutMs} ms.`)),
      timeoutMs,
    );
    sock.on('connect', () => sock.write(`${word} ${target.token}\n`));
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl === -1) {
        if (buf.length > MAX_LINE) finish(new Error(`The launcher's control port ${port} sent an answer that is too long.`));
        return;
      }
      finish(null, buf.subarray(0, nl).toString('utf8'));
    });
    sock.on('error', (e) => finish(new Error(`Could not reach the launcher's control port ${port}: ${e.message}`)));
    sock.on('close', () =>
      finish(new Error(`The launcher's control port ${port} closed the connection without an answer.`)),
    );
  });
}

/** True only when a launcher holding this token answers. Default timeout 2000 ms. */
export function pingControl(target: ControlTarget, timeoutMs = DEFAULT_PING_MS): Promise<boolean> {
  return exchange(target, 'ping', timeoutMs).then(
    (line) => line === 'pong',
    () => false,
  );
}

/** Asks the launcher to stop and resolves with how it went. Rejects on timeout or a dropped connection. */
export async function requestStop(target: ControlTarget, timeoutMs: number): Promise<StopResult> {
  const line = await exchange(target, 'stop', timeoutMs);
  if (line === 'clean' || line === 'forced') return line;
  throw new Error(`The launcher's control port ${target.controlPort} gave an answer stop does not know.`);
}
