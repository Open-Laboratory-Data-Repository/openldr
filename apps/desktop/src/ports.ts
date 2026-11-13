// Choosing the port OpenLDR listens on. 3000 when it is free; otherwise a free port the app
// remembers, so the address stays the same from then on.

import { createServer } from 'node:net';

export const PREFERRED_PORT = 3000;

/** True when a listener can take the port on this host now. */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** A port the system says is free on this host now. */
export function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address();
      const port = address !== null && typeof address === 'object' ? address.port : undefined;
      server.close(() => (port === undefined ? reject(new Error('The system gave no port.')) : resolve(port)));
    });
  });
}

/**
 * The remembered port when it is free. Else 3000 when nothing is remembered and 3000 is free.
 * Else a free port, with `remember: true` so the caller saves it.
 */
export async function choosePort(
  remembered: number | undefined,
  deps: { isPortFree: typeof isPortFree; findFreePort: typeof findFreePort } = { isPortFree, findFreePort },
): Promise<{ port: number; remember: boolean }> {
  const wanted = remembered ?? PREFERRED_PORT;
  if (await deps.isPortFree(wanted)) return { port: wanted, remember: false };
  return { port: await deps.findFreePort(), remember: true };
}
