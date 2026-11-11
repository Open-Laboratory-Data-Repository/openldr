import { randomUUID } from 'node:crypto';
import type { ConnectorPatch, ConnectorRecord, ConnectorStore } from '@openldr/db';
import { testConnector } from './connector-test';
import { z } from 'zod';

export const hostConnectorPatchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string()).optional(),
}).strict();

const sqlFields = ['host', 'port', 'database', 'user', 'ssl'];
const ordinaryFields: Record<string, readonly string[]> = {
  postgres: sqlFields,
  mysql: [...sqlFields, 'sslRejectUnauthorized'],
  'microsoft-sql': ['host', 'instanceName', 'port', 'database', 'domain', 'user', 'encrypt', 'trustServerCertificate'],
  mongodb: ['host', 'port', 'database', 'user', 'authSource'],
  redis: ['host', 'port', 'db'],
  smtp: ['host', 'port', 'user', 'secure'],
  imap: ['host', 'port', 'user', 'tls'],
  gmail: ['user', 'clientId'],
  outlook: ['user', 'clientId', 'tenant'],
  sftp: ['host', 'port', 'user'],
};
function secretFields(type: string): readonly string[] {
  return type === 'gmail' || type === 'outlook' ? ['clientSecret', 'refreshToken'] : ['password'];
}

export interface ConnectorConfigView {
  config: Record<string, string>;
  secretsSet: Record<string, boolean>;
}

/** URLs, plugin configuration and unknown keys never enter the public view. */
export async function inspectConnectorConfig(store: ConnectorStore, id: string, key: string | undefined): Promise<ConnectorConfigView | null> {
  const record = await store.get(id);
  if (!record) return null;
  const fields = record.type ? ordinaryFields[record.type] : undefined;
  if (!fields) return { config: {}, secretsSet: {} };
  const stored = await store.getDecryptedConfig(id, key);
  const config: Record<string, string> = {};
  for (const field of fields) {
    if (Object.hasOwn(stored, field) && typeof stored[field] === 'string') config[field] = stored[field];
  }
  const secretsSet: Record<string, boolean> = {};
  for (const field of secretFields(record.type!)) secretsSet[field] = Boolean(stored[field]);
  return { config, secretsSet };
}

/** Merge host patches before resealing so omitted credentials remain stored. */
export async function updateConnectorConfig(store: ConnectorStore, id: string, patch: ConnectorPatch, key: string | undefined): Promise<void> {
  const record = await store.get(id);
  if (!record) throw new Error('connector not found');
  if (!record.type || patch.config === undefined) {
    await store.update(id, patch, key);
    return;
  }
  const fields = ordinaryFields[record.type];
  if (!fields) throw new Error('unsupported connector configuration type');
  const secrets = secretFields(record.type);
  const allowed = new Set([...fields, ...secrets]);
  if (Object.keys(patch.config).some((field) => !allowed.has(field))) throw new Error('unsupported connector configuration field');
  const config = { ...await store.getDecryptedConfig(id, key) };
  for (const [field, value] of Object.entries(patch.config)) {
    if (secrets.includes(field) && value === '') continue;
    config[field] = value;
  }
  await store.update(id, { ...patch, config }, key);
}

/** A database (host) connector from the CLI or the route: a name, one of the supported types, and
 *  its settings. The route keeps its own plugin (sink) path. */
export const hostConnectorCreateSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string()),
}).strict();
export type HostConnectorInput = z.infer<typeof hostConnectorCreateSchema>;

/** Add a database connector. Only the type's own settings and secret are accepted, so a URL or an
 *  unknown key never lands in the sealed config. Returns the new id. */
export async function createHostConnector(store: ConnectorStore, input: HostConnectorInput, key: string | undefined): Promise<string> {
  const fields = ordinaryFields[input.type];
  if (!fields) throw new Error('unsupported connector configuration type');
  const allowed = new Set([...fields, ...secretFields(input.type)]);
  if (Object.keys(input.config).some((field) => !allowed.has(field))) throw new Error('unsupported connector configuration field');
  const id = randomUUID();
  await store.create({ id, name: input.name, type: input.type, kind: 'database', config: input.config }, key);
  return id;
}

/** Open a test connection to a database connector with its stored credentials. Changes nothing. */
export async function testHostConnector(
  store: ConnectorStore, id: string, key: string | undefined,
  test: (type: string, config: Record<string, string>) => Promise<unknown> = testConnector,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const record = await store.get(id);
  if (!record) throw new Error('connector not found');
  if (!record.type) throw new Error('host connector required');
  try {
    await test(record.type, await store.getDecryptedConfig(id, key));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Remove a connector. Returns what was removed, or null when there was nothing to remove. */
export async function removeConnector(store: ConnectorStore, id: string): Promise<ConnectorRecord | null> {
  const existing = await store.get(id);
  if (!existing) return null;
  await store.remove(id);
  return existing;
}
