import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { freeLowPort } from './free-port';

describe('freeLowPort', () => {
  it('gives a port the system never hands to a server on port 0', async () => {
    // Test files run side by side. A port from the port-0 range can go to another file's server
    // between the moment a test picks it and the moment the test uses it.
    const port = await freeLowPort();
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(32000);
  });

  it('gives a port that is free to listen on', async () => {
    const port = await freeLowPort();
    const s = createServer();
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  it('never gives a port it was told to avoid', async () => {
    const first = await freeLowPort();
    for (let i = 0; i < 20; i++) expect(await freeLowPort([first])).not.toBe(first);
  });
});
