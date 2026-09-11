import type { ConnectorPatch, ConnectorStore } from '@openldr/db';
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
  'microsoft-sql': ['host', 'port', 'database', 'user', 'encrypt', 'trustServerCertificate'],
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
