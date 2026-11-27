import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createTrustService, createWorkflowHosts, type AppContext, type LoadedTrust } from '@openldr/bootstrap';
import { CERT_A, CERT_B, FAKE_KEY } from '../../../packages/bootstrap/src/network-trust.fixtures';
import { registerNetworkRoutes } from './network-routes';

// These tests pin the wire shape. The two services are the real ones, on a temp file and an
// in-memory settings table, so a refusal here is the service's own refusal.
const FP_A = new X509Certificate(CERT_A).fingerprint256;
const FP_B = new X509Certificate(CERT_B).fingerprint256;

type Audit = { action: string; actorId: string | null | undefined; detail: string };

function setup(o: { content?: string; managed?: boolean; peer?: string; loaded?: LoadedTrust; capabilities?: string[]; auditFails?: boolean; serverList?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'net-routes-'));
  const file = join(dir, 'ca.pem');
  writeFileSync(file, o.content ?? '');
  const audits: Audit[] = [];
  const asked: Array<[string, number]> = [];
  const note = async (action: string, actorId: string | null | undefined, detail: string): Promise<void> => {
    if (o.auditFails) throw new Error('audit down');
    audits.push({ action, actorId, detail });
  };
  let tail: Promise<unknown> = Promise.resolve();
  const trust = createTrustService({
    file: o.managed === false ? undefined : file,
    nodeExtraCaFile: o.managed === false ? undefined : file,
    loaded: async () => o.loaded ?? { known: true, pems: [], since: '2026-11-30T00:00:00.000Z' },
    readPeer: async (host, port) => {
      asked.push([host, port]);
      return o.peer;
    },
    transition: (work) => {
      const run = tail.then(work, work);
      tail = run.catch(() => {});
      return run;
    },
    lockWaitMs: 150,
    audit: (action, actor, fingerprint) => note(action, actor.actorId, fingerprint),
    now: () => new Date('2026-12-01T00:00:00Z'),
  });
  const rows = new Map<string, string>();
  const workflowHosts = createWorkflowHosts({
    appSettings: {
      get: async (key) => (rows.has(key) ? { key, value: rows.get(key)!, updatedAt: new Date(0), updatedBy: null } : null),
      getAll: async () => [],
      set: async (key, value) => void rows.set(key, value),
      update: async (key, change) => void rows.set(key, change(rows.get(key) ?? null)),
    },
    serverList: o.serverList ?? '',
    listenHost: '0.0.0.0',
    port: 3000,
    audit: (action, actor, detail) => note(action, actor.actorId, detail),
  });
  const errors: unknown[] = [];
  const ctx = { trust, workflowHosts, logger: { error: (...a: unknown[]) => void errors.push(a), warn() {}, info() {}, debug() {} } } as unknown as AppContext;
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'u-ada', username: 'ada', displayName: null, roles: ['lab_admin'], capabilities: o.capabilities ?? ['network.manage'] } as never;
  });
  registerNetworkRoutes(app, ctx);
  return { app, file, dir, audits, asked, errors, lock: `${file}.lock` };
}

const ROUTES: Array<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: unknown }> = [
  { method: 'GET', url: '/api/network/trust' },
  { method: 'POST', url: '/api/network/trust/preview', payload: { text: CERT_A } },
  { method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } },
  { method: 'DELETE', url: `/api/network/trust/${encodeURIComponent(FP_A)}` },
  { method: 'POST', url: '/api/network/trust/unlock' },
  { method: 'GET', url: '/api/network/workflow-hosts' },
  { method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'a.example' } },
  { method: 'DELETE', url: '/api/network/workflow-hosts/a.example' },
  { method: 'PUT', url: '/api/network/workflow-hosts/self', payload: { on: true } },
];

describe('network routes', () => {
  it('refuses every route without network.manage, and changes nothing', async () => {
    const s = setup({ capabilities: ['connectors.manage', 'settings.manage'], content: CERT_A });
    for (const r of ROUTES) {
      const res = await s.app.inject(r as never);
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
    expect(s.audits).toEqual([]);
  });

  it('refuses every route when nobody is signed in', async () => {
    const app = Fastify();
    registerNetworkRoutes(app, {} as AppContext);
    for (const r of ROUTES) expect((await app.inject(r as never)).statusCode, `${r.method} ${r.url}`).toBe(401);
  });

  it('lists certificates with the mode, and never the PEM', async () => {
    const s = setup({ content: CERT_A, loaded: { known: true, pems: [CERT_A], since: 'x' } });
    const res = await s.app.inject({ method: 'GET', url: '/api/network/trust' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toEqual({
      mode: 'editable',
      certificates: [{ fingerprint: FP_A, subject: 'test-a.example', validTo: expect.any(String), expired: false, state: 'in-use' }],
    });
  });

  it('shows a lock left behind in the list answer', async () => {
    const s = setup();
    writeFileSync(s.lock, 'held');
    const past = new Date(Date.now() - 60_000);
    utimesSync(s.lock, past, past);
    expect((await s.app.inject({ method: 'GET', url: '/api/network/trust' })).json()).toMatchObject({ mode: 'editable', lock: { since: expect.any(String), stuck: true } });
  });

  it('previews pasted text and returns the same PEM back', async () => {
    const s = setup();
    const res = await s.app.inject({ method: 'POST', url: '/api/network/trust/preview', payload: { text: `${CERT_A}\n${CERT_B}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().certificates.map((c: { pem: string; fingerprint: string }) => [c.pem, c.fingerprint])).toEqual([[CERT_A, FP_A], [CERT_B, FP_B]]);
    expect(readFileSync(s.file, 'utf8')).toBe('');
  });

  it('previews an address', async () => {
    const s = setup({ peer: CERT_A });
    const res = await s.app.inject({ method: 'POST', url: '/api/network/trust/preview', payload: { address: 'hub.district:8443' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().certificates).toMatchObject([{ fingerprint: FP_A, pem: CERT_A }]);
    expect(s.asked).toEqual([['hub.district', 8443]]);
  });

  it('answers 400 no-answer when nothing answers at the address, and 400 with the message for a bad address', async () => {
    const s = setup();
    const silent = await s.app.inject({ method: 'POST', url: '/api/network/trust/preview', payload: { address: 'hub.district' } });
    expect([silent.statusCode, silent.json()]).toEqual([400, { error: 'no-answer' }]);
    const bad = await s.app.inject({ method: 'POST', url: '/api/network/trust/preview', payload: { address: 'https://hub.district/x' } });
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'Type a host name, or a host name and a port.' }]);
    expect(s.asked).toEqual([['hub.district', 443]]);
  });

  it.each([{}, { address: 'a', text: 'b' }, { address: '' }, { text: 5 }, { other: 1 }, null])('answers 400 for the preview body %j', async (payload) => {
    const res = await setup().app.inject({ method: 'POST', url: '/api/network/trust/preview', payload: payload as never });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a private key with code private-key and echoes nothing', async () => {
    const s = setup();
    for (const [url, payload] of [
      ['/api/network/trust/preview', { text: FAKE_KEY }],
      ['/api/network/trust/preview', { text: CERT_A + FAKE_KEY }],
      ['/api/network/trust', { pem: CERT_A + FAKE_KEY }],
    ] as const) {
      const res = await s.app.inject({ method: 'POST', url, payload });
      expect([res.statusCode, res.json()]).toEqual([400, { error: 'private-key' }]);
      for (const line of FAKE_KEY.split('\n').filter((l) => l && !l.startsWith('-----'))) expect(res.body).not.toContain(line);
    }
    expect(readFileSync(s.file, 'utf8')).toBe('');
    expect(JSON.stringify(s.errors)).not.toContain('VGhpcyBpcyBub3Q');
  });

  it('adds the previewed certificate and answers 201 with its state', async () => {
    const s = setup();
    const res = await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ fingerprint: FP_A, subject: 'test-a.example', validTo: expect.any(String), expired: false, state: 'added' });
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
    const again = await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } });
    expect([again.statusCode, again.json()]).toEqual([400, { error: 'duplicate' }]);
  });

  it('answers 409 read-only when the file is not managed', async () => {
    const s = setup({ managed: false });
    const add = await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } });
    expect([add.statusCode, add.json()]).toEqual([409, { error: 'read-only' }]);
    const del = await s.app.inject({ method: 'DELETE', url: `/api/network/trust/${encodeURIComponent(FP_A)}` });
    expect([del.statusCode, del.json()]).toEqual([409, { error: 'read-only' }]);
    expect((await s.app.inject({ method: 'GET', url: '/api/network/trust' })).json()).toEqual({ mode: 'not-configured', certificates: [] });
  });

  it('answers 409 damaged when the file is damaged', async () => {
    const s = setup({ content: `${CERT_A}garbage` });
    const add = await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_B } });
    expect([add.statusCode, add.json()]).toEqual([409, { error: 'damaged' }]);
  });

  it('answers 409 busy when a lock is held, and unlock is refused until it is stuck', async () => {
    const s = setup();
    writeFileSync(s.lock, 'held');
    const add = await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } });
    expect([add.statusCode, add.json()]).toEqual([409, { error: 'busy' }]);
    const early = await s.app.inject({ method: 'POST', url: '/api/network/trust/unlock' });
    expect([early.statusCode, early.json()]).toEqual([409, { error: 'busy' }]);
    expect(existsSync(s.lock)).toBe(true);
  });

  it('unlocks a stuck lock, says whether it removed one, and audits it', async () => {
    const s = setup();
    writeFileSync(s.lock, 'held');
    const past = new Date(Date.now() - 60_000);
    utimesSync(s.lock, past, past);
    const res = await s.app.inject({ method: 'POST', url: '/api/network/trust/unlock' });
    expect([res.statusCode, res.json()]).toEqual([200, { removed: true }]);
    expect(existsSync(s.lock)).toBe(false);
    expect((await s.app.inject({ method: 'POST', url: '/api/network/trust/unlock' })).json()).toEqual({ removed: false });
    expect(s.audits).toEqual([{ action: 'network.trust.unlock', actorId: 'u-ada', detail: 'lock' }]);
  });

  it('removes a certificate and answers 204, and 404 for one that is not there', async () => {
    const s = setup({ content: CERT_A });
    const gone = await s.app.inject({ method: 'DELETE', url: `/api/network/trust/${encodeURIComponent(FP_A)}` });
    expect([gone.statusCode, gone.body]).toEqual([204, '']);
    expect(readFileSync(s.file, 'utf8')).toBe('');
    const missing = await s.app.inject({ method: 'DELETE', url: `/api/network/trust/${encodeURIComponent(FP_A)}` });
    expect([missing.statusCode, missing.json()]).toEqual([404, { error: 'not-found' }]);
  });

  it('lists workflow hosts with the switch', async () => {
    const s = setup({ serverList: 'z.example' });
    await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'A.example' } });
    const res = await s.app.inject({ method: 'GET', url: '/api/network/workflow-hosts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      self: { on: false, origin: 'http://127.0.0.1:3000' },
      hosts: [{ host: 'z.example', source: 'server' }, { host: 'a.example', source: 'setting' }],
    });
  });

  it('adds and removes a host', async () => {
    const s = setup();
    const add = await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'hub.district' } });
    expect([add.statusCode, add.body]).toEqual([204, '']);
    const v6 = await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'fd00:0:0:0:0:0:0:20' } });
    expect(v6.statusCode).toBe(204);
    expect((await s.app.inject({ method: 'GET', url: '/api/network/workflow-hosts' })).json().hosts.map((h: { host: string }) => h.host)).toEqual(['fd00::20', 'hub.district']);
    const del = await s.app.inject({ method: 'DELETE', url: `/api/network/workflow-hosts/${encodeURIComponent('fd00::20')}` });
    expect([del.statusCode, del.body]).toEqual([204, '']);
    expect((await s.app.inject({ method: 'GET', url: '/api/network/workflow-hosts' })).json().hosts).toEqual([{ host: 'hub.district', source: 'setting' }]);
  });

  it('answers 400 with the message for a bad host, and 409 for one the server setting names', async () => {
    const s = setup({ serverList: 'z.example' });
    const bad = await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'http://x' } });
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'Type a host name or an IP address, with no port and no path.' }]);
    const none = await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: {} });
    expect(none.statusCode).toBe(400);
    const fixed = await s.app.inject({ method: 'DELETE', url: '/api/network/workflow-hosts/z.example' });
    expect([fixed.statusCode, fixed.json()]).toEqual([409, { error: 'This host comes from the server setting WORKFLOW_HTTP_ALLOWLIST.' }]);
  });

  it('turns the switch on and returns the origin', async () => {
    const s = setup();
    const on = await s.app.inject({ method: 'PUT', url: '/api/network/workflow-hosts/self', payload: { on: true } });
    expect([on.statusCode, on.json()]).toEqual([200, { on: true, origin: 'http://127.0.0.1:3000' }]);
    const off = await s.app.inject({ method: 'PUT', url: '/api/network/workflow-hosts/self', payload: { on: false } });
    expect(off.json()).toEqual({ on: false, origin: 'http://127.0.0.1:3000' });
    for (const payload of [{}, { on: 'yes' }, { on: 1 }]) {
      expect((await s.app.inject({ method: 'PUT', url: '/api/network/workflow-hosts/self', payload })).statusCode).toBe(400);
    }
  });

  it('writes an audit row for each change, in the name of the signed-in user', async () => {
    const s = setup();
    await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } });
    await s.app.inject({ method: 'DELETE', url: `/api/network/trust/${encodeURIComponent(FP_A)}` });
    await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'a.example' } });
    await s.app.inject({ method: 'DELETE', url: '/api/network/workflow-hosts/a.example' });
    await s.app.inject({ method: 'PUT', url: '/api/network/workflow-hosts/self', payload: { on: true } });
    await s.app.inject({ method: 'GET', url: '/api/network/trust' });
    await s.app.inject({ method: 'POST', url: '/api/network/trust/preview', payload: { text: CERT_A } });
    expect(s.audits).toEqual([
      { action: 'network.trust.add', actorId: 'u-ada', detail: FP_A },
      { action: 'network.trust.remove', actorId: 'u-ada', detail: FP_A },
      { action: 'network.workflow_host.add', actorId: 'u-ada', detail: 'a.example' },
      { action: 'network.workflow_host.remove', actorId: 'u-ada', detail: 'a.example' },
      { action: 'network.workflow_self.set', actorId: 'u-ada', detail: 'on' },
    ]);
  });

  it('says the change is made when only the audit row failed', async () => {
    const s = setup({ auditFails: true });
    const add = await s.app.inject({ method: 'POST', url: '/api/network/trust', payload: { pem: CERT_A } });
    expect([add.statusCode, add.json()]).toEqual([500, { error: 'audit-failed', changed: true }]);
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
    const host = await s.app.inject({ method: 'POST', url: '/api/network/workflow-hosts', payload: { host: 'a.example' } });
    expect([host.statusCode, host.json()]).toEqual([500, { error: 'audit-failed', changed: true }]);
    expect((await s.app.inject({ method: 'GET', url: '/api/network/workflow-hosts' })).json().hosts).toEqual([{ host: 'a.example', source: 'setting' }]);
  });
});
