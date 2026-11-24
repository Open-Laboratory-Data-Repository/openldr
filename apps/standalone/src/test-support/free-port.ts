import { createServer } from 'node:net';

/**
 * A port on 127.0.0.1 that is free now, from 20000 to 31999. That is below the range the system
 * hands out for port 0 (32768 up on Linux, 49152 up on Windows and macOS), so a server another test
 * file starts on port 0 can never take it. A test can then use it as a port nothing listens on, or
 * listen on it later, without another file's server getting there first.
 */
export async function freeLowPort(avoid: readonly number[] = []): Promise<number> {
  for (let tries = 0; tries < 50; tries++) {
    const port = 20000 + Math.floor(Math.random() * 12000);
    if (avoid.includes(port)) continue;
    const s = createServer();
    const free = await new Promise<boolean>((resolve) => {
      s.once('error', () => resolve(false));
      s.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (free) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
      return port;
    }
  }
  throw new Error('no free port between 20000 and 31999');
}
