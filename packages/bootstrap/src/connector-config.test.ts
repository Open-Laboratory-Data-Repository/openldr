import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { createConnectorStore } from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { inspectConnectorConfig, updateConnectorConfig, createHostConnector, testHostConnector, removeConnector, hostConnectorCreateSchema } from './connector-config';

it('reads and updates the existing MySQL certificate verification setting', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    const key = randomBytes(32).toString('base64');
    await store.create({ id: 'mysql', name: 'MySQL', type: 'mysql', kind: 'database', config: {
      host: 'db.example.test', ssl: 'true', sslRejectUnauthorized: 'false', password: 'stored-secret',
    } }, key);
    expect((await inspectConnectorConfig(store, 'mysql', key))?.config.sslRejectUnauthorized).toBe('false');
    await updateConnectorConfig(store, 'mysql', { config: { sslRejectUnauthorized: 'true' } }, key);
    expect(await store.getDecryptedConfig('mysql', key)).toMatchObject({ sslRejectUnauthorized: 'true', password: 'stored-secret' });
  } finally { await db.destroy(); }
});

it('preserves encrypted legacy credentials, unknown settings and blank secrets during ordinary edits', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    const key = randomBytes(32).toString('base64');
    await store.create({ id: 'pg', name: 'PG', type: 'postgres', kind: 'database', config: {
      host: 'old', database: 'lab', password: 'original', url: 'postgres://u:hidden@host/db', legacy: 'hidden',
    } }, key);
    await updateConnectorConfig(store, 'pg', { name: 'Renamed' }, undefined);
    await updateConnectorConfig(store, 'pg', { config: { host: 'new', password: '' } }, key);
    expect(await store.getDecryptedConfig('pg', key)).toEqual({ host: 'new', database: 'lab', password: 'original', url: 'postgres://u:hidden@host/db', legacy: 'hidden' });
    expect(await inspectConnectorConfig(store, 'pg', key)).toEqual({ config: { host: 'new', database: 'lab' }, secretsSet: { password: true } });
    await expect(updateConnectorConfig(store, 'pg', { config: { legacy: 'replacement' } }, key)).rejects.toThrow('unsupported connector configuration field');
    await updateConnectorConfig(store, 'pg', { config: { password: 'rotated' } }, key);
    expect((await store.getDecryptedConfig('pg', key)).password).toBe('rotated');
  } finally { await db.destroy(); }
});

it('omits plugin URL credentials and returns null for missing connectors', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    const key = randomBytes(32).toString('base64');
    await store.create({ id: 'plugin', name: 'Plugin', pluginId: 'sink', kind: 'sink', config: { baseUrl: 'https://example.test/?token=hidden', password: 'hidden' } }, key);
    expect(await inspectConnectorConfig(store, 'plugin', key)).toEqual({ config: {}, secretsSet: {} });
    expect(await inspectConnectorConfig(store, 'missing', key)).toBeNull();
  } finally { await db.destroy(); }
});

it('accepts the SQL Server instance name and Windows domain', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    const key = randomBytes(32).toString('base64');
    await store.create({ id: 'ms', name: 'MS', type: 'microsoft-sql', kind: 'database', config: { host: 'LABSRV', password: 'p' } }, key);
    await updateConnectorConfig(store, 'ms', { config: { instanceName: 'SQLEXPRESS', domain: 'LAB' } }, key);
    expect((await inspectConnectorConfig(store, 'ms', key))?.config).toMatchObject({ instanceName: 'SQLEXPRESS', domain: 'LAB' });
  } finally { await db.destroy(); }
});

it('adds a database connector with its secret sealed, and refuses unknown fields or types', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    const key = randomBytes(32).toString('base64');
    const input = hostConnectorCreateSchema.parse({ name: 'Warehouse', type: 'postgres', config: { host: 'db', database: 'lab', user: 'ro', password: 's3cret' } });
    const id = await createHostConnector(store, input, key);
    expect((await store.get(id))?.type).toBe('postgres');
    expect(await inspectConnectorConfig(store, id, key)).toEqual({ config: { host: 'db', database: 'lab', user: 'ro' }, secretsSet: { password: true } });
    await expect(createHostConnector(store, { ...input, config: { host: 'db', url: 'postgres://x' } }, key)).rejects.toThrow('unsupported connector configuration field');
    await expect(createHostConnector(store, { ...input, type: 'oracle' }, key)).rejects.toThrow('unsupported connector configuration type');
  } finally { await db.destroy(); }
});

it('tests a database connector with its stored credentials and reports the failure', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    const key = randomBytes(32).toString('base64');
    await store.create({ id: 'pg', name: 'PG', type: 'postgres', kind: 'database', config: { host: 'db', password: 'p' } }, key);
    const seen: Record<string, string>[] = [];
    expect(await testHostConnector(store, 'pg', key, async (_t, config) => { seen.push(config); })).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ host: 'db', password: 'p' });
    expect(await testHostConnector(store, 'pg', key, async () => { throw new Error('connection refused'); })).toEqual({ ok: false, error: 'connection refused' });
    await expect(testHostConnector(store, 'missing', key, async () => {})).rejects.toThrow('connector not found');
  } finally { await db.destroy(); }
});

it('removes a connector and hands back what it removed', async () => {
  const db = await makeMigratedDb();
  try {
    const store = createConnectorStore(db);
    await store.create({ id: 'pg', name: 'PG', type: 'postgres', kind: 'database', config: { host: 'db' } }, randomBytes(32).toString('base64'));
    expect((await removeConnector(store, 'pg'))?.name).toBe('PG');
    expect(await store.get('pg')).toBeNull();
    expect(await removeConnector(store, 'pg')).toBeNull();
  } finally { await db.destroy(); }
});
