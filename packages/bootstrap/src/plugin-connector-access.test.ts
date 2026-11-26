import { describe, it, expect, vi } from 'vitest';
import { createPluginConnectorAccess, declaresConnectors } from './plugin-connector-access';
import { CONNECTOR_ALLOWED } from './import-run';

// Layer: the approval list and who is offered for a connector, over an in-memory plugin data store.
// Not covered: the route, the broker's use of the list (plugin-broker.test.ts), or a real database.

function memData() {
  const m = new Map<string, unknown>();
  const k = (p: string, c: string, key: string) => `${p} ${c} ${key}`;
  return {
    async get(p: string, c: string, key: string) { return m.has(k(p, c, key)) ? m.get(k(p, c, key)) : null; },
    async put(p: string, c: string, key: string, doc: unknown) { m.set(k(p, c, key), doc); },
    async delete(p: string, c: string, key: string) { m.delete(k(p, c, key)); },
    async list(p: string, c: string) { return [...m.entries()].filter(([kk]) => kk.startsWith(`${p} ${c} `)).map(([kk, doc]) => ({ collection: c, key: kk.split(' ')[2], doc, updatedAt: new Date(0) })); },
  };
}

const plugin = (id: string, caps: unknown[] | undefined, over: Record<string, unknown> = {}) =>
  ({ id, version: '1.0.0', enabled: true, active: true, manifest: caps === undefined ? {} : { capabilities: caps }, ...over });

function setup(opts: { type?: string | null; exists?: boolean } = {}) {
  const data = memData();
  const audit = vi.fn(async () => {});
  const imports = {
    readers: vi.fn(async () => [{ id: 'cdr-source', version: '0.1.8', connectorTypes: ['microsoft-sql'] }]),
    allow: vi.fn(async (p: string, c: string) => { await data.put(p, CONNECTOR_ALLOWED, c, { connectorId: c }); }),
    revoke: vi.fn(async (p: string, c: string) => { await data.delete(p, CONNECTOR_ALLOWED, c); }),
  };
  const plugins = [
    plugin('dhis2-lab-results', [{ kind: 'host:connectors' }, { kind: 'net-egress', allowedHosts: [] }]),
    plugin('lab-bench', [{ kind: 'host:db' }]),
    plugin('old-legacy', undefined),
    plugin('switched-off', [{ kind: 'host:connectors' }], { enabled: false }),
    plugin('inactive-version', [{ kind: 'host:connectors' }], { active: false }),
  ];
  const access = createPluginConnectorAccess({
    plugins: { list: async () => plugins },
    connectors: { get: async () => (opts.exists === false ? null : { type: opts.type ?? null }) },
    pluginData: data,
    imports,
    audit,
    now: () => new Date('2026-11-26T19:00:00.000Z'),
  });
  return { access, data, audit, imports };
}

const actor = { type: 'user' as const, id: 'u1', name: 'dev-admin' };

describe('plugin connector access', () => {
  it('offers every active plugin that declares host:connectors, for a connector of any kind', async () => {
    const { access } = setup({ type: null });
    expect(await access.candidates('c1')).toEqual([{ id: 'dhis2-lab-results', version: '1.0.0', use: 'connector', allowed: false }]);
  });

  it('also offers an import plugin for a database connector of a type it reads, as before', async () => {
    const { access } = setup({ type: 'microsoft-sql' });
    expect((await access.candidates('c1')).map((c) => [c.id, c.use])).toEqual([['cdr-source', 'import'], ['dhis2-lab-results', 'connector']]);
  });

  it('offers nothing for a connector that does not exist', async () => {
    expect(await setup({ exists: false }).access.candidates('nope')).toEqual([]);
  });

  it('switches a connector plugin on with an audit row first, and off again', async () => {
    const { access, audit } = setup();
    await access.allow('dhis2-lab-results', 'c1', actor);
    expect(await access.allowed('dhis2-lab-results')).toEqual(['c1']);
    expect((await access.candidates('c1'))[0]!.allowed).toBe(true);
    expect(audit).toHaveBeenCalledWith({ action: 'connector.allow', pluginId: 'dhis2-lab-results', connectorId: 'c1', actor });
    await access.revoke('dhis2-lab-results', 'c1', actor);
    expect(await access.allowed('dhis2-lab-results')).toEqual([]);
    expect(audit).toHaveBeenLastCalledWith({ action: 'connector.revoke', pluginId: 'dhis2-lab-results', connectorId: 'c1', actor });
  });

  it('changes nothing when the audit row cannot be written', async () => {
    const { access, audit } = setup();
    audit.mockRejectedValueOnce(new Error('db down'));
    await expect(access.allow('dhis2-lab-results', 'c1', actor)).rejects.toThrow('the audit log could not be written');
    expect(await access.allowed('dhis2-lab-results')).toEqual([]);
  });

  it('passes an import plugin to the import service, which keeps its own checks', async () => {
    const { access, imports } = setup({ type: 'microsoft-sql' });
    await access.allow('cdr-source', 'c1', actor);
    expect(imports.allow).toHaveBeenCalledWith('cdr-source', 'c1', actor);
    await access.revoke('cdr-source', 'c1', actor);
    expect(imports.revoke).toHaveBeenCalledWith('cdr-source', 'c1', actor);
  });

  it('refuses a plugin that is not offered: no host:connectors, legacy, switched off or not active', async () => {
    const { access, data } = setup();
    for (const id of ['lab-bench', 'old-legacy', 'switched-off', 'inactive-version', 'unknown']) {
      await expect(access.allow(id, 'c1', actor)).rejects.toThrow(`plugin ${id} cannot use connector c1`);
      expect(await data.get(id, CONNECTOR_ALLOWED, 'c1')).toBeNull();
    }
  });

  it('declaresConnectors reads the stored grant', () => {
    expect(declaresConnectors({ capabilities: [{ kind: 'host:connectors' }] })).toBe(true);
    expect(declaresConnectors({ capabilities: [{ kind: 'net-egress', allowedHosts: [] }] })).toBe(false);
    expect(declaresConnectors({})).toBe(false);
  });
});
