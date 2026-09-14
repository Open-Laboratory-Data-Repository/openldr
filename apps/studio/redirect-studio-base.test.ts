import { describe, it, expect, vi } from 'vitest';
import type { Connect, ViteDevServer } from 'vite';
import { redirectStudioBase } from './redirect-studio-base';

// Runs the plugin's dev middleware against one request and reports what it did.
function run(method: string, url: string) {
  let handler: Connect.NextHandleFunction | undefined;
  const server = { middlewares: { use: (fn: Connect.NextHandleFunction) => { handler = fn; } } };
  const plugin = redirectStudioBase();
  (plugin.configureServer as (s: ViteDevServer) => void)(server as unknown as ViteDevServer);
  const res = { statusCode: 200, writeHead: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  handler!({ method, url } as Connect.IncomingMessage, res as never, next);
  return { res, next };
}

describe('redirectStudioBase', () => {
  it('answers HEAD / with 200, so the desktop preview readiness check passes', () => {
    const { res, next } = run('HEAD', '/');
    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
  });

  it('leaves GET / to Vite, which redirects it to /studio/', () => {
    const { res, next } = run('GET', '/');
    expect(next).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('still redirects a bare /studio to /studio/, keeping the query', () => {
    const { res } = run('GET', '/studio?x=1');
    expect(res.writeHead).toHaveBeenCalledWith(302, { Location: '/studio/?x=1' });
  });
});
