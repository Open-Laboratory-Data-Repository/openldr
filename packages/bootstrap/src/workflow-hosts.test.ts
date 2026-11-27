import { describe, expect, it } from 'vitest';
import type { TrustActor } from './network-trust';
import { guardedFetch } from '@openldr/workflows';
import { BAD_HOST, createWorkflowHosts, KEY_HOSTS, KEY_SELF, selfOrigin, SERVER_HOST, WorkflowHostAuditFailed, type WorkflowHostsDeps } from './workflow-hosts';

const ACTOR: TrustActor = { actorType: 'user', actorId: 'u1', actorName: 'ada' };

/** One stored table that several services can share, as the server and a CLI command share the database. */
function table() {
  const rows = new Map<string, string>();
  const store: WorkflowHostsDeps['appSettings'] = {
    get: async (key) => (rows.has(key) ? { key, value: rows.get(key)!, updatedAt: new Date(0), updatedBy: null } : null),
    getAll: async () => [],
    set: async (key, value) => void rows.set(key, value),
    // The real one holds a row lock for this step: app-settings-store.live.test.ts.
    update: async (key, change) => void rows.set(key, change(rows.get(key) ?? null)),
  };
  return { rows, store };
}

function make(o: { serverList?: string; listenHost?: string; port?: number; store?: ReturnType<typeof table>; auditFails?: boolean } = {}) {
  const t = o.store ?? table();
  const audits: Array<{ action: string; actor: TrustActor; detail: string }> = [];
  const svc = createWorkflowHosts({
    appSettings: t.store,
    serverList: o.serverList ?? '',
    listenHost: o.listenHost ?? '0.0.0.0',
    port: o.port ?? 3000,
    audit: async (action, actor, detail) => {
      if (o.auditFails) throw new Error('audit down');
      audits.push({ action, actor, detail });
    },
  });
  return { svc, audits, rows: t.rows, table: t };
}

describe('workflow hosts', () => {
  it('starts empty with the switch off', async () => {
    const m = make();
    expect(await m.svc.list()).toEqual([]);
    expect(await m.svc.self()).toEqual({ on: false, origin: 'http://127.0.0.1:3000' });
    expect(await m.svc.rule()).toEqual({ hosts: [], origins: [] });
  });

  it('merges the server list and the stored list, each host once', async () => {
    const m = make({ serverList: 'Z.example, a.example' });
    m.rows.set(KEY_HOSTS, JSON.stringify(['a.example', 'c.example', 'b.example']));
    expect(await m.svc.list()).toEqual([
      { host: 'a.example', source: 'server' },
      { host: 'z.example', source: 'server' },
      { host: 'b.example', source: 'setting' },
      { host: 'c.example', source: 'setting' },
    ]);
    expect((await m.svc.rule()).hosts.sort()).toEqual(['a.example', 'b.example', 'c.example', 'z.example']);
  });

  it('adds a host in lower case and audits it', async () => {
    const m = make();
    await m.svc.add('Hub.District ', ACTOR);
    expect(await m.svc.list()).toEqual([{ host: 'hub.district', source: 'setting' }]);
    expect(m.audits).toEqual([{ action: 'network.workflow_host.add', actor: ACTOR, detail: 'hub.district' }]);
    expect(JSON.parse(m.rows.get(KEY_HOSTS)!)).toEqual(['hub.district']);
  });

  it('adding a host twice writes one audit row', async () => {
    const m = make();
    await m.svc.add('hub.district', ACTOR);
    await m.svc.add('HUB.district', ACTOR);
    expect(m.audits).toHaveLength(1);
    expect(await m.svc.list()).toHaveLength(1);
  });

  it('adding a host the server setting already names does nothing', async () => {
    const m = make({ serverList: 'a.example' });
    await m.svc.add('a.example', ACTOR);
    expect(m.audits).toEqual([]);
    expect(m.rows.has(KEY_HOSTS)).toBe(false);
  });

  it.each(['10.0.0.5', '::1', '[::1]', 'fe80::1', 'localhost', 'a-b.example', 'xn--80ak6aa92e.com'])('takes %j as a host', async (host) => {
    const m = make();
    await m.svc.add(host, ACTOR);
    expect((await m.svc.list())[0]!.host).toBe(host.replace(/^\[|\]$/g, ''));
  });

  it.each(['http://x', 'x:8080', 'x/y', 'a b', '', '   ', '[::1]:3000', 'a..b', '-a.example', 'a.example.', 'x?y', 'x#y', 'user@x', '*.example', `${'a'.repeat(254)}`, `${'a'.repeat(64)}.example`])(
    'refuses %j as a host',
    async (host) => {
      const m = make();
      await expect(m.svc.add(host, ACTOR)).rejects.toThrow(BAD_HOST);
      expect(m.rows.size).toBe(0);
      expect(m.audits).toEqual([]);
    },
  );

  it('removes a stored host and audits it', async () => {
    const m = make();
    await m.svc.add('a.example', ACTOR);
    await m.svc.add('b.example', ACTOR);
    await m.svc.remove(' A.example', ACTOR);
    expect(await m.svc.list()).toEqual([{ host: 'b.example', source: 'setting' }]);
    expect(m.audits.at(-1)).toEqual({ action: 'network.workflow_host.remove', actor: ACTOR, detail: 'a.example' });
  });

  it('removing a host that is not there does nothing and audits nothing', async () => {
    const m = make();
    await m.svc.remove('a.example', ACTOR);
    expect(m.audits).toEqual([]);
  });

  it('refuses to remove a host that comes from the server setting', async () => {
    const m = make({ serverList: 'a.example' });
    m.rows.set(KEY_HOSTS, JSON.stringify(['a.example']));
    await expect(m.svc.remove('a.example', ACTOR)).rejects.toThrow(SERVER_HOST);
    expect(JSON.parse(m.rows.get(KEY_HOSTS)!)).toEqual(['a.example']);
    expect(m.audits).toEqual([]);
  });

  it('a removed host is gone from the very next rule', async () => {
    const m = make();
    await m.svc.add('a.example', ACTOR);
    expect((await m.svc.rule()).hosts).toEqual(['a.example']);
    await m.svc.remove('a.example', ACTOR);
    expect((await m.svc.rule()).hosts).toEqual([]);
  });

  it('the switch adds exactly this OpenLDR origin', async () => {
    const m = make({ port: 3000 });
    await m.svc.setSelf(true, ACTOR);
    expect(await m.svc.self()).toEqual({ on: true, origin: 'http://127.0.0.1:3000' });
    expect(await m.svc.rule()).toEqual({ hosts: [], origins: ['http://127.0.0.1:3000'] });
    expect(m.audits).toEqual([{ action: 'network.workflow_self.set', actor: ACTOR, detail: 'on' }]);
    await m.svc.setSelf(false, ACTOR);
    expect(await m.svc.rule()).toEqual({ hosts: [], origins: [] });
    expect(m.audits.at(-1)!.detail).toBe('off');
  });

  it('the switch answers with what it applied, without reading the setting again', async () => {
    const t = table();
    let reads = 0;
    const get = t.store.get;
    t.store.get = async (key) => {
      reads++;
      return get(key);
    };
    const m = make({ store: t });
    expect(await m.svc.setSelf(true, ACTOR)).toEqual({ on: true, origin: 'http://127.0.0.1:3000' });
    expect(await m.svc.setSelf(false, ACTOR)).toEqual({ on: false, origin: 'http://127.0.0.1:3000' });
    expect(reads).toBe(0);
  });

  it('setting the switch to what it already is audits nothing', async () => {
    const m = make();
    await m.svc.setSelf(false, ACTOR);
    await m.svc.setSelf(true, ACTOR);
    await m.svc.setSelf(true, ACTOR);
    expect(m.audits).toHaveLength(1);
  });

  it('the switch does not name this OpenLDR as a host, so its other ports stay closed', async () => {
    const m = make();
    await m.svc.setSelf(true, ACTOR);
    expect((await m.svc.rule()).hosts).toEqual([]);
  });

  it.each([
    ['0.0.0.0', 'http://127.0.0.1:3000'],
    ['127.0.0.1', 'http://127.0.0.1:3000'],
    ['localhost', 'http://127.0.0.1:3000'],
    ['::', 'http://127.0.0.1:3000'],
    ['::1', 'http://[::1]:3000'],
    ['192.168.1.20', 'http://192.168.1.20:3000'],
    ['fd00::20', 'http://[fd00::20]:3000'],
  ])('works out this OpenLDR from a server listening on %s', (host, origin) => {
    expect(selfOrigin(host, 3000)).toBe(origin);
    expect(new URL(origin).origin).toBe(origin);
  });

  it('keeps both hosts when two services add at once', async () => {
    const shared = table();
    const [a, b] = [make({ store: shared }), make({ store: shared })];
    await Promise.all([a.svc.add('a.example', ACTOR), b.svc.add('b.example', ACTOR)]);
    expect((await a.svc.list()).map((r) => r.host)).toEqual(['a.example', 'b.example']);
  });

  it('reads the database on every rule call', async () => {
    const m = make();
    expect((await m.svc.rule()).hosts).toEqual([]);
    m.rows.set(KEY_HOSTS, JSON.stringify(['late.example']));
    m.rows.set(KEY_SELF, 'true');
    expect(await m.svc.rule()).toEqual({ hosts: ['late.example'], origins: ['http://127.0.0.1:3000'] });
  });

  it.each(['{ not json', '"a.example"', '{"a":1}', '[1,2]', '["ok.example", 5]'])('reads a damaged stored list %j as no stored hosts', async (stored) => {
    const m = make({ serverList: 'a.example' });
    m.rows.set(KEY_HOSTS, stored);
    expect(await m.svc.rule()).toEqual({ hosts: ['a.example'], origins: [] });
  });

  it('drops a stored entry that is not a host name, so a hand-edited row cannot widen the rule', async () => {
    const m = make();
    m.rows.set(KEY_HOSTS, JSON.stringify(['ok.example', 'http://x', 'B.example', '*']));
    expect((await m.svc.rule()).hosts).toEqual(['b.example', 'ok.example']);
  });

  it('says the change is made and the audit row is not, when the audit row cannot be written', async () => {
    const m = make({ auditFails: true });
    const added = await m.svc.add('a.example', ACTOR).catch((e: unknown) => e);
    expect(added).toBeInstanceOf(WorkflowHostAuditFailed);
    expect(added).toMatchObject({ action: 'network.workflow_host.add', detail: 'a.example', actor: ACTOR });
    expect((added as WorkflowHostAuditFailed).cause).toMatchObject({ message: 'audit down' });
    expect((await m.svc.rule()).hosts).toEqual(['a.example']);
    expect(await m.svc.remove('a.example', ACTOR).catch((e: unknown) => e)).toMatchObject({ action: 'network.workflow_host.remove', detail: 'a.example' });
    expect(await m.svc.setSelf(true, ACTOR).catch((e: unknown) => e)).toMatchObject({ action: 'network.workflow_self.set', detail: 'on' });
    expect(await m.svc.rule()).toEqual({ hosts: [], origins: ['http://127.0.0.1:3000'] });
    // A second try changes nothing, so it has no audit row to fail on.
    await m.svc.setSelf(true, ACTOR);
  });

  it.each([
    ['0:0:0:0:0:0:0:1', '::1'],
    ['[0:0:0:0:0:0:0:1]', '::1'],
    ['FD00:0000:0000:0000:0000:0000:0000:0020', 'fd00::20'],
    ['::ffff:10.0.0.5', '::ffff:a00:5'],
  ])('stores the IPv6 address %s the way a URL writes it, %s', async (typed, kept) => {
    const m = make();
    await m.svc.add(typed, ACTOR);
    expect(await m.svc.list()).toEqual([{ host: kept, source: 'setting' }]);
    // Typed again in any form, it is the same host.
    await m.svc.add(typed.toUpperCase(), ACTOR);
    expect(m.audits).toHaveLength(1);
    await m.svc.remove(typed, ACTOR);
    expect(await m.svc.list()).toEqual([]);
  });

  it('an IPv6 host added in long form lets the HTTP step reach it', async () => {
    const m = make();
    await m.svc.add('fd00:0:0:0:0:0:0:20', ACTOR);
    const ok = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(guardedFetch({ url: 'http://[fd00::20]:8080/x' }, await m.svc.rule(), ok)).resolves.toBeDefined();
    await expect(guardedFetch({ url: 'http://[FD00:0000::0020]/x' }, await m.svc.rule(), ok)).resolves.toBeDefined();
    await expect(guardedFetch({ url: 'http://[fd00::21]/x' }, await m.svc.rule(), ok)).rejects.toThrow(/not allowed/);
  });

  it('an IPv6 host in the server setting, in long form, is matched too', async () => {
    const m = make({ serverList: '0:0:0:0:0:0:0:1, [FD00:0:0:0:0:0:0:20]' });
    expect((await m.svc.list()).map((r) => r.host)).toEqual(['::1', 'fd00::20']);
    const ok = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(guardedFetch({ url: 'http://[::1]:9/x' }, await m.svc.rule(), ok)).resolves.toBeDefined();
    await expect(m.svc.remove('::1', ACTOR)).rejects.toThrow(SERVER_HOST);
  });

  it.each(['010.0.0.1', '2130706433', '0x7f.0.0.1', '127.1'])('refuses %j, which a URL would read as another address', async (host) => {
    const m = make();
    await expect(m.svc.add(host, ACTOR)).rejects.toThrow(BAD_HOST);
  });
});
