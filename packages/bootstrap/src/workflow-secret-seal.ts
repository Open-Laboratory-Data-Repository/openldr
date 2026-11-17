import { mapSecretFieldsAsync, isSecretRef } from '@openldr/workflows';
import type { WorkflowSecretStore } from '@openldr/db';

/**
 * Seal every plaintext secret in `definition` into `secretStore` (SEC-06) — the SINGLE
 * seal implementation shared by BOTH the save path (`extractWorkflowSecrets` in
 * apps/server/src/workflows-routes.ts) and the boot migration (`migrateWorkflowSecrets`).
 * Having one impl is the security-relevant guarantee that a migrated `{ secretRef }` is
 * byte-identical to a saved one: the emptiness check, the JSON.stringify-object-before-put,
 * the `put` → ref replacement, and the orphan GC can never drift between the two call sites.
 *
 * Walk the definition through the shared secret-field locator; for each field:
 *  - already a `{ secretRef }` → keep the row, seal nothing (kept for GC);
 *  - empty (raw-shape: null/undefined, empty string, or empty plain object) → drop the field;
 *  - plaintext → seal into the store (string as-is, non-string JSON.stringify'd) → `{ secretRef }`.
 * After the walk, GC any rows no longer referenced by this workflow (empty `kept` → drop all).
 *
 * The ref-only definition is built FULLY before returning, so a fail-closed `ConfigError`
 * thrown by `put` (SECRETS_ENCRYPTION_KEY unset) aborts BEFORE the caller persists anything —
 * no partial/plaintext definition ever lands.
 */
export async function sealDefinitionSecrets(
  definition: unknown,
  workflowId: string,
  secretStore: WorkflowSecretStore,
  key: string | undefined,
): Promise<unknown> {
  const { out, kept } = await seal(definition, workflowId, secretStore, key);
  // GC any secrets no longer referenced by the sealed definition (empty kept → drop all).
  await secretStore.deleteExcept(workflowId, kept);
  return out;
}

/**
 * A save's secrets, sealed but not yet tidied. The old rows stay until the workflow is stored:
 * `commit` (after the write succeeded) drops the ones the new definition no longer names, `abort`
 * (after the write was refused) drops only the rows this save just sealed. So a refused save, such
 * as a webhook path another enabled workflow took a moment earlier, leaves the stored workflow and
 * every secret it names exactly as they were.
 */
export interface SealedSave {
  definition: unknown;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export async function sealForSave(
  definition: unknown,
  workflowId: string,
  secretStore: WorkflowSecretStore,
  key: string | undefined,
): Promise<SealedSave> {
  const { out, kept, created } = await seal(definition, workflowId, secretStore, key);
  return {
    definition: out,
    commit: () => secretStore.deleteExcept(workflowId, kept),
    abort: () => secretStore.deleteIds(workflowId, created),
  };
}

async function seal(
  definition: unknown,
  workflowId: string,
  secretStore: WorkflowSecretStore,
  key: string | undefined,
): Promise<{ out: unknown; kept: string[]; created: string[] }> {
  const kept: string[] = [];
  const created: string[] = [];
  const out = await mapSecretFieldsAsync(definition, async (f) => {
    // Unchanged, already-sealed ref → keep the row, touch nothing.
    if (isSecretRef(f.value)) {
      kept.push(f.value.secretRef);
      return;
    }
    // Emptiness is decided on the RAW value shape, NOT the serialized string, so a
    // legitimate secret whose literal value is the string 'null' or '{}' is still sealed
    // (for a string, JSON serialization would falsely match those sentinels).
    const v = f.value;
    const isEmpty =
      v == null ||
      (typeof v === 'string' && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
    if (isEmpty) {
      f.set(undefined); // empty → drop the field entirely
      return;
    }
    // Plaintext: webhook `secret` is a string; the HTTP `config.headers` blob may be a
    // string OR an object — JSON.stringify the non-string form before sealing (the resolver
    // returns the string, which the HTTP node parses).
    const plaintext = typeof v === 'string' ? v : JSON.stringify(v);
    const id = await secretStore.put(workflowId, plaintext, key);
    kept.push(id);
    created.push(id);
    f.set({ secretRef: id });
  });
  return { out, kept, created };
}
