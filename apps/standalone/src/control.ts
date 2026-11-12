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
/** A connection must send its whole request line within this time of being accepted. */
const REQUEST_DEADLINE_MS = 2000;
const DEFAULT_PING_MS = 2000;
/** How long a stop answer that is written waits for the asker to hang up before it is dropped. */
const FLUSH_MS = 2000;
/**
 * Most connections held that have not sent a request yet. A new one past this drops the oldest,
 * so idle connections from another local process can never keep a real request out.
 */
const MAX_WAITING = 16;

/** 24 random bytes in base64url. */
export function newControlToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Listens on 127.0.0.1, on a free port the OS picks. */
export function startControl(opts: { token: string; onStop: () => Promise<StopResult> }): Promise<ControlServer> {
  const expected = Buffer.from(opts.token, 'utf8');
  const sockets = new Set<Socket>();
  /** Sockets that have not sent a request yet, oldest first. */
  const waiting = new Set<Socket>();
  /** Sockets that asked to stop, each with a promise that resolves when that socket has closed. */
  const answering = new Map<Socket, Promise<void>>();
  let stopping: Promise<StopResult> | undefined;
  let listenerClosed = false;

  const stopOnce = (): Promise<StopResult> => (stopping ??= Promise.resolve().then(() => opts.onStop()));

  const tokenMatches = (given: string): boolean => {
    const g = Buffer.from(given, 'utf8');
    return g.length === expected.length && timingSafeEqual(g, expected);
  };

  const server = createServer((sock) => {
    if (waiting.size >= MAX_WAITING) {
      const oldest = waiting.values().next().value as Socket;
      waiting.delete(oldest);
      oldest.destroy();
    }
    sockets.add(sock);
    waiting.add(sock);
    // An absolute deadline from accept, not an idle timer: a byte now and then does not extend it.
    const deadline = setTimeout(() => sock.destroy(), REQUEST_DEADLINE_MS);
    sock.on('close', () => {
      clearTimeout(deadline);
      sockets.delete(sock);
      waiting.delete(sock);
      answering.delete(sock);
    });
    sock.on('error', () => {});

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
      clearTimeout(deadline);
      waiting.delete(sock);
      if (nl > MAX_LINE) return void sock.destroy();
      const parts = buf.subarray(0, nl).toString('utf8').split(' ');
      if (parts.length !== 2 || !tokenMatches(parts[1]!)) return void sock.destroy();
      if (parts[0] === 'ping') return void sock.end('pong\n');
      if (parts[0] !== 'stop') return void sock.destroy();
      answering.set(sock, new Promise<void>((resolve) => sock.once('close', () => resolve())));
      stopOnce().then(
        (result) =>
          // The asker hangs up once it has read the answer. If it never does, drop it.
          sock.end(`${result}\n`, () => void setTimeout(() => sock.destroy(), FLUSH_MS).unref()),
        () => sock.destroy(),
      );
    });
  });

  /**
   * Stops listening and drops connections that have not asked to stop. Every call, the first or
   * a later one, then waits until each stop asker has had its answer and hung up, or was dropped.
   * So it can be called inside onStop and awaited again after onStop returns. Awaiting it inside
   * onStop never resolves: it waits for the answer, and the answer waits for onStop.
   */
  const close = async (): Promise<void> => {
    if (!listenerClosed) {
      listenerClosed = true;
      server.close();
      for (const sock of sockets) if (!answering.has(sock)) sock.destroy();
    }
    await Promise.all(answering.values());
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port: 0 }, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({ port, close });
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
