import { createServer, type Server } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { choosePort, findFreePort, isPortFree, PREFERRED_PORT } from './ports';

/** A real listener on a port the system picks, on 127.0.0.1. Never a fixed port. */
function listenOnAnyPort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      resolve({ server, port: address.port });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('PREFERRED_PORT', () => {
  it('is 3000', () => {
    expect(PREFERRED_PORT).toBe(3000);
  });
});

describe('isPortFree and findFreePort, with real sockets on 127.0.0.1', () => {
  it('says a port with a listener is taken, and free once it closes', async () => {
    const { server, port } = await listenOnAnyPort();
    try {
      expect(await isPortFree(port)).toBe(false);
      expect(await isPortFree(port, '127.0.0.1')).toBe(false);
    } finally {
      await close(server);
    }
    expect(await isPortFree(port)).toBe(true);
  });

  it('finds a port that is free', async () => {
    const port = await findFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
    expect(await isPortFree(port)).toBe(true);
  });
});

describe('choosePort', () => {
  function deps(free: (port: number) => boolean, found = 41234) {
    return {
      isPortFree: vi.fn(async (port: number) => free(port)),
      findFreePort: vi.fn(async () => found),
    };
  }

  it('gives back a remembered port that is free, and remembers nothing new', async () => {
    const d = deps(() => true);
    expect(await choosePort(3995, d)).toEqual({ port: 3995, remember: false });
    expect(d.isPortFree).toHaveBeenCalledWith(3995);
    expect(d.findFreePort).not.toHaveBeenCalled();
  });

  it('gives a free port to remember when the remembered one is taken', async () => {
    const d = deps((p) => p !== 3995);
    expect(await choosePort(3995, d)).toEqual({ port: 41234, remember: true });
    expect(d.findFreePort).toHaveBeenCalledTimes(1);
  });

  it('gives 3000 and remembers nothing when nothing is remembered and 3000 is free', async () => {
    const d = deps(() => true);
    expect(await choosePort(undefined, d)).toEqual({ port: 3000, remember: false });
    expect(d.isPortFree).toHaveBeenCalledWith(3000);
    expect(d.findFreePort).not.toHaveBeenCalled();
  });

  it('gives a free port to remember when nothing is remembered and 3000 is taken', async () => {
    const d = deps((p) => p !== 3000);
    expect(await choosePort(undefined, d)).toEqual({ port: 41234, remember: true });
  });
});
