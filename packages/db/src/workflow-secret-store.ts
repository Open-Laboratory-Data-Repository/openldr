import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seal, open, parseSecretKey, ConfigError, OpenLdrError } from '@openldr/core';
import type { InternalSchema } from './schema/internal';

// Fail-closed: a workflow secret can only be sealed/opened with the AES-256 key. Without it we
// refuse rather than store/return plaintext. Mirrors connector-store's keyOf idiom.
function keyOf(key: string | undefined): Buffer {
  if (!key) {
    throw new ConfigError('SECRETS_ENCRYPTION_KEY is required to store workflow secrets but is not set');
  }
  return parseSecretKey(key);
}

export interface WorkflowSecretStore {
  /** Seal `plaintext` for a workflow; returns the opaque ref id ('wsec_<uuid>'). */
  put(workflowId: string, plaintext: string, key: string | undefined): Promise<string>;
  /** Resolve a ref id back to plaintext. Throws on unknown id or wrong/absent key. */
  resolve(id: string, key: string | undefined): Promise<string>;
  /** Missing or unreadable credentials return null. Database errors propagate. */
  resolveIfAvailable(id: string, key: string | undefined): Promise<string | null>;
  /** Remove every secret belonging to a workflow (delete-cascade). */
  deleteForWorkflow(workflowId: string): Promise<void>;
  /** Orphan GC: drop a workflow's secrets except the ids still referenced. */
  deleteExcept(workflowId: string, keepIds: string[]): Promise<void>;
}

export function createWorkflowSecretStore(db: Kysely<InternalSchema>): WorkflowSecretStore {
  const read = (id: string) => db.selectFrom('workflow_secrets')
    .select('sealed_value').where('id', '=', id).executeTakeFirst();
  const decrypt = (sealed: string, key: string | undefined) => open(sealed, keyOf(key));
  return {
    async put(workflowId, plaintext, key) {
      const id = `wsec_${randomUUID()}`;
      await db
        .insertInto('workflow_secrets')
        .values({ id, workflow_id: workflowId, sealed_value: seal(plaintext, keyOf(key)) })
        .execute();
      return id;
    },

    async resolve(id, key) {
      const r = await read(id);
      if (!r) throw new OpenLdrError(`workflow secret not found: ${id}`);
      return decrypt(r.sealed_value, key);
    },

    async resolveIfAvailable(id, key) {
      const r = await read(id);
      if (!r) return null;
      try { return decrypt(r.sealed_value, key); } catch { return null; }
    },

    async deleteForWorkflow(workflowId) {
      await db.deleteFrom('workflow_secrets').where('workflow_id', '=', workflowId).execute();
    },

    async deleteExcept(workflowId, keepIds) {
      let q = db.deleteFrom('workflow_secrets').where('workflow_id', '=', workflowId);
      if (keepIds.length) q = q.where('id', 'not in', keepIds);
      await q.execute();
    },
  };
}
