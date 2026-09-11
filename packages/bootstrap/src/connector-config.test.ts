import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { createConnectorStore } from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { inspectConnectorConfig, updateConnectorConfig } from './connector-config';

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
