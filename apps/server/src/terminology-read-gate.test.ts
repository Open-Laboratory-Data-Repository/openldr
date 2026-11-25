import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { gateTerminologyReads, TERMINOLOGY_READ_CAPABILITIES } from './terminology-read-gate';
import { requireCapability } from './rbac';
import './auth-plugin'; // pulls in the req.user type augmentation

function appWith(capabilities: string[] | null) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (capabilities) req.user = { id: 'a', username: 'a', displayName: null, roles: [], capabilities };
  });
  gateTerminologyReads(app);
  app.get('/api/terminology/ValueSet/$expand', async () => ({ ok: true }));
  app.get('/api/terminology/systems', async () => ({ ok: true }));
  app.get('/api/terminology/publishers/:id/distribution/job', { preHandler: requireCapability('terminology.manage') }, async () => ({ ok: true }));
  app.post('/api/terminology/systems', async () => ({ ok: true }));
  app.get('/api/other', async () => ({ ok: true }));
  return app;
}

describe('terminology reads', () => {
  it('open to a person whose page reads terminology', async () => {
    for (const cap of TERMINOLOGY_READ_CAPABILITIES) {
      const res = await appWith([cap]).inject({ method: 'GET', url: '/api/terminology/ValueSet/$expand' });
      expect(res.statusCode, cap).toBe(200);
    }
  });

  it('refused to a person holding none of those permissions', async () => {
    const app = appWith(['reports.view']);
    for (const url of ['/api/terminology/ValueSet/$expand', '/api/terminology/systems']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toEqual({ error: 'insufficient capability' });
    }
  });

  // Fastify adds a HEAD route for each GET, which answers the status and the body size. Gated too.
  it('a HEAD request is refused as its GET is', async () => {
    const res = await appWith(['reports.view']).inject({ method: 'HEAD', url: '/api/terminology/ValueSet/$expand' });
    expect(res.statusCode).toBe(403);
    expect((await appWith(['forms.submit']).inject({ method: 'HEAD', url: '/api/terminology/systems' })).statusCode).toBe(200);
  });

  it('401 with no one signed in', async () => {
    const res = await appWith(null).inject({ method: 'GET', url: '/api/terminology/systems' });
    expect(res.statusCode).toBe(401);
  });

  it('keeps a read that has its own gate, and leaves writes and other routes alone', async () => {
    const reader = appWith(['forms.submit']);
    expect((await reader.inject({ method: 'GET', url: '/api/terminology/publishers/p/distribution/job' })).statusCode).toBe(403);
    expect((await appWith(['terminology.manage']).inject({ method: 'GET', url: '/api/terminology/publishers/p/distribution/job' })).statusCode).toBe(200);
    const none = appWith(['reports.view']);
    expect((await none.inject({ method: 'POST', url: '/api/terminology/systems' })).statusCode).toBe(200);
    expect((await none.inject({ method: 'GET', url: '/api/other' })).statusCode).toBe(200);
  });
});
