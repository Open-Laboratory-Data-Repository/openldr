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
