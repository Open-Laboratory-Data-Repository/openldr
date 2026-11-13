import { createServer, connect, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { newControlToken, pingControl, requestStop, startControl, type ControlServer } from './control.js';
import { isLockLive } from './state.js';

const controls: ControlServer[] = [];
const others: Server[] = [];
const otherSockets: Socket[] = [];

afterEach(async () => {
  await Promise.all(controls.splice(0).map((c) => c.close()));
  // A server that never reads never sees the client hang up, so close its sockets by hand.
  for (const s of otherSockets.splice(0)) s.destroy();
  await Promise.all(
    others.splice(0).map((s) => new Promise<void>((resolve) => (s.listening ? s.close(() => resolve()) : resolve()))),
  );
});

async function control(token: string, onStop: () => Promise<'clean' | 'forced'> = async () => 'clean') {
  const c = await startControl({ token, onStop });
  controls.push(c);
  return c;
}

/** A plain TCP server that does not speak the control protocol. */
async function stranger(onConnection: (sock: Socket) => void): Promise<number> {
  const s = createServer((sock) => {
    otherSockets.push(sock);
    onConnection(sock);
  });
  others.push(s);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  return (s.address() as AddressInfo).port;
}

/** A port that nothing listens on: bind it, then let it go. */
async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

/** Sends raw bytes and collects everything the server sends until it closes the connection. */
function raw(port: number, text: string | null): Promise<{ reply: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1');
    let reply = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => (reply += d));
    sock.on('error', () => {});
    sock.on('close', () => resolve({ reply, ms: Date.now() - started }));
    sock.on('connect', () => {
      if (text !== null) sock.write(text);
    });
    setTimeout(() => {
      sock.destroy();
      reject(new Error('the server kept the connection open'));
    }, 9000).unref();
  });
}

/** Opens `n` connections one after another that never send anything, as a hostile local process would. */
async function hostile(port: number, n: number): Promise<{ sock: Socket; closed: boolean }[]> {
  const held: { sock: Socket; closed: boolean }[] = [];
  for (let i = 0; i < n; i += 1) {
    const sock = connect(port, '127.0.0.1');
    otherSockets.push(sock);
    const h = { sock, closed: false };
    sock.on('error', () => {});
    sock.on('close', () => (h.closed = true));
    sock.resume();
    await new Promise<void>((r) => {
      sock.once('connect', () => r());
      sock.once('close', () => r());
    });
    held.push(h);
  }
  return held;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('control channel', () => {
  it('makes tokens of 24 random bytes in base64url', () => {
    const a = newControlToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(24);
    expect(newControlToken()).not.toBe(a);
  });

  it('answers pong to the right token', async () => {
    const token = newControlToken();
    const c = await control(token);
    expect(await pingControl({ controlPort: c.port, token })).toBe(true);
    expect(await raw(c.port, `ping ${token}\n`)).toMatchObject({ reply: 'pong\n' });
  });

  it('gives false for a wrong token', async () => {
    const c = await control(newControlToken());
    expect(await pingControl({ controlPort: c.port, token: newControlToken() })).toBe(false);
    expect((await raw(c.port, `ping ${newControlToken()}\n`)).reply).toBe('');
  });

  it('gives false fast when nothing listens on the port', async () => {
    const port = await deadPort();
    const started = Date.now();
    expect(await pingControl({ controlPort: port, token: newControlToken() })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('gives false for a port that is not a port number', async () => {
    expect(await pingControl({ controlPort: 0, token: newControlToken() })).toBe(false);
    expect(await pingControl({ controlPort: 70000, token: newControlToken() })).toBe(false);
  });

  it('gives false for a server on that port that does not speak the protocol', async () => {
    const http = await stranger((s) => s.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
    expect(await pingControl({ controlPort: http, token: newControlToken() })).toBe(false);
    const silent = await stranger(() => {});
    const started = Date.now();
    expect(await pingControl({ controlPort: silent, token: newControlToken() }, 300)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('closes an unknown word, a missing token and an overlong line with no reply', async () => {
    const token = newControlToken();
    const c = await control(token);
    expect((await raw(c.port, `hello ${token}\n`)).reply).toBe('');
    expect((await raw(c.port, 'ping\n')).reply).toBe('');
    expect((await raw(c.port, `ping ${token} extra\n`)).reply).toBe('');
    expect((await raw(c.port, `ping ${token}${'x'.repeat(300)}`)).reply).toBe('');
    expect((await raw(c.port, `ping ${'x'.repeat(300)}\n`)).reply).toBe('');
  });

  it('closes a connection that sends nothing within 2 seconds', async () => {
    const c = await control(newControlToken());
    const { reply, ms } = await raw(c.port, null);
    expect(reply).toBe('');
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(ms).toBeLessThan(3000);
  });

  it('closes a connection that trickles one byte every 500 ms at 2 seconds', async () => {
    const c = await control(newControlToken());
    const started = Date.now();
    const sock = connect(c.port, '127.0.0.1');
    otherSockets.push(sock);
    sock.on('error', () => {});
    const timer = setInterval(() => sock.write('p'), 500);
    const ms = await new Promise<number>((resolve) => {
      sock.on('close', () => resolve(Date.now() - started));
      setTimeout(() => resolve(-1), 4000);
    });
    clearInterval(timer);
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(ms).toBeLessThan(2600);
  });

  it('runs onStop on stop and returns its result', async () => {
    const token = newControlToken();
    let calls = 0;
    const c = await control(token, async () => {
      calls += 1;
      return 'forced';
    });
    expect(await requestStop({ controlPort: c.port, token }, 2000)).toBe('forced');
    expect(calls).toBe(1);
  });

  it('runs onStop once for two stop requests at once, and both get its answer', async () => {
    const token = newControlToken();
    const gate = deferred<void>();
    let calls = 0;
    const c = await control(token, async () => {
      calls += 1;
      await gate.promise;
      return 'clean';
    });
    const first = requestStop({ controlPort: c.port, token }, 5000);
    const second = requestStop({ controlPort: c.port, token }, 5000);
    await new Promise((r) => setTimeout(r, 100));
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual(['clean', 'clean']);
    expect(await requestStop({ controlPort: c.port, token }, 2000)).toBe('clean');
    expect(calls).toBe(1);
  });

  it('never runs onStop for a wrong token, and the error does not show either token', async () => {
    const token = newControlToken();
    const wrong = newControlToken();
    let calls = 0;
    const c = await control(token, async () => {
      calls += 1;
      return 'clean';
    });
    const err = await requestStop({ controlPort: c.port, token: wrong }, 2000).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(wrong);
    expect((err as Error).message).not.toContain(token);
    expect(calls).toBe(0);
  });

  it('rejects a stop request on timeout and when nothing listens', async () => {
    const silent = await stranger(() => {});
    await expect(requestStop({ controlPort: silent, token: newControlToken() }, 300)).rejects.toThrow(/did not answer/);
    const port = await deadPort();
    await expect(requestStop({ controlPort: port, token: newControlToken() }, 2000)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('stops listening on close()', async () => {
    const token = newControlToken();
    const c = await control(token);
    expect(await pingControl({ controlPort: c.port, token })).toBe(true);
    await c.close();
    expect(await pingControl({ controlPort: c.port, token })).toBe(false);
    await c.close(); // a second close does nothing
  });

  it('waits for the stop answer on a later close() when onStop already called close()', async () => {
    const token = newControlToken();
    let c!: ControlServer;
    const returned = deferred<void>();
    c = await control(token, async () => {
      void c.close();
      returned.resolve();
      return 'clean';
    });
    let answer: string | undefined;
    const stop = requestStop({ controlPort: c.port, token }, 5000).then((a) => (answer = a));
    await returned.promise;
    await c.close();
    // The launcher exits right after this await. The answer must already be with the asker.
    expect(answer).toBe('clean');
    await stop;
  });

  it('resolves close() during a stop only after the answer reached the asker', async () => {
    const token = newControlToken();
    const gate = deferred<void>();
    const started = deferred<void>();
    const c = await control(token, async () => {
      started.resolve();
      await gate.promise;
      return 'forced';
    });
    let answer: string | undefined;
    const stop = requestStop({ controlPort: c.port, token }, 5000).then((a) => (answer = a));
    await started.promise;
    let closed = false;
    const closing = c.close().then(() => (closed = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    gate.resolve();
    await closing;
    expect(answer).toBe('forced');
    await stop;
  });

  it('still answers ping and stop while 16 idle connections are held open', async () => {
    const token = newControlToken();
    const c = await control(token);
    const idle = await hostile(c.port, 16);
    await new Promise((r) => setTimeout(r, 50));
    expect(idle.filter((h) => h.closed)).toEqual([]);
    expect(await pingControl({ controlPort: c.port, token })).toBe(true);
    expect(await isLockLive({ pid: 1, address: 'a', startedAt: 's', controlPort: c.port, token })).toBe(true);
    expect(await requestStop({ controlPort: c.port, token }, 2000)).toBe('clean');
    // The ping was the 17th connection waiting, so the oldest idle one made room for it. The
    // ping's own connection was answered before the next request came, so no other was dropped.
    await new Promise((r) => setTimeout(r, 50));
    expect(idle.map((h, i) => (h.closed ? i : -1)).filter((i) => i >= 0)).toEqual([0]);
  });

  it('holds at most 16 connections that have not sent a request', async () => {
    const c = await control(newControlToken());
    const idle = await hostile(c.port, 40);
    await new Promise((r) => setTimeout(r, 200));
    const open = idle.filter((h) => !h.closed);
    expect(open.length).toBe(16);
    // The oldest were dropped first.
    expect(idle.slice(24).every((h) => !h.closed)).toBe(true);
  });

  it('never drops a stop asker waiting for its answer when idle connections pile up', async () => {
    const token = newControlToken();
    const gate = deferred<void>();
    const started = deferred<void>();
    const c = await control(token, async () => {
      started.resolve();
      await gate.promise;
      return 'clean';
    });
    const stop = requestStop({ controlPort: c.port, token }, 5000);
    await started.promise;
    await hostile(c.port, 20);
    await new Promise((r) => setTimeout(r, 50));
    // The control port is still reachable during the stop, and the asker is still there.
    expect(await pingControl({ controlPort: c.port, token })).toBe(true);
    gate.resolve();
    expect(await stop).toBe('clean');
  });

  it('still sends the stop answer when onStop itself calls close()', async () => {
    const token = newControlToken();
    let c!: ControlServer;
    const closed = deferred<void>();
    c = await control(token, async () => {
      // The launcher closes the control server as part of stopping. It must not hang.
      void c.close().then(() => closed.resolve());
      return 'clean';
    });
    expect(await requestStop({ controlPort: c.port, token }, 2000)).toBe('clean');
    await closed.promise;
  });
});
