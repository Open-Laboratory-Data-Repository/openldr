import { describe, it, expect } from 'vitest';
import * as tedious from 'tedious';
import { buildMssqlDialectConfig, createMssqlStore } from './index';

const cfg = { host: '127.0.0.1', port: 1433, database: 'openldr', user: 'sa', password: 'x', encrypt: false, trustServerCertificate: true };

describe('createMssqlStore', () => {
  it('resets pooled connections before another operation can acquire them', () => {
    expect(buildMssqlDialectConfig(cfg, tedious.Request).resetConnectionsOnRelease).toBe(true);
  });
  it('reports up when the ping succeeds', async () => {
    const store = createMssqlStore(cfg, { ping: async () => {} });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    await store.close();
  });
  it('reports down when the ping throws', async () => {
    const store = createMssqlStore(cfg, { ping: async () => { throw new Error('ECONNREFUSED'); } });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
    await store.close();
  });
  it('exposes operation-scoped request deadlines', async () => {
    const store = createMssqlStore(cfg, { ping: async () => {} });
    await expect(store.withRequestTimeout(250, async () => 'bounded')).resolves.toBe('bounded');
    await store.close();
  });
});

describe('buildMssqlDialectConfig connection options', () => {
  // Records the config tedious would receive, without opening a socket.
  function captured(extra: Record<string, unknown>) {
    const seen: Array<Record<string, any>> = [];
    class FakeConnection { constructor(c: Record<string, any>) { seen.push(c); } }
    const dialect = buildMssqlDialectConfig({ ...cfg, ...extra }, tedious.Request, FakeConnection as unknown as typeof tedious.Connection);
    (dialect as unknown as { tedious: { connectionFactory: () => unknown } }).tedious.connectionFactory();
    return seen[0];
  }
  it('uses a SQL login when no domain is set', () => {
    expect(captured({}).authentication).toEqual({ type: 'default', options: { userName: 'sa', password: 'x' } });
  });
  it('uses a Windows (NTLM) login when a domain is set', () => {
    expect(captured({ domain: 'LAB' }).authentication).toEqual({ type: 'ntlm', options: { userName: 'sa', password: 'x', domain: 'LAB' } });
  });
  it('passes the instance name and drops the port, which tedious refuses together', () => {
    const c = captured({ instanceName: 'SQLEXPRESS' });
    expect(c.options.instanceName).toBe('SQLEXPRESS');
    expect(c.options).not.toHaveProperty('port');
  });
  it('keeps the port when there is no instance name', () => {
    expect(captured({}).options.port).toBe(1433);
  });
});
