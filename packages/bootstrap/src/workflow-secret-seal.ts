import { forEachSecretField, mapSecretFieldsAsync, isSecretRef } from '@openldr/workflows';
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

/** The secret row ids a definition names. */
export function secretRefsOf(definition: unknown): string[] {
  const ids: string[] = [];
  if (definition) forEachSecretField(definition, (f) => { if (isSecretRef(f.value)) ids.push(f.value.secretRef); });
  return ids;
}

/**
 * A save's secrets, sealed but not yet tidied. Nothing is deleted before the workflow is stored.
 *
 * - `commit`, after the write succeeded, drops only the rows `previous` (the version this save
 *   replaced) named and the new version does not. It never touches rows another save made, and,
 *   because the store writes only over the version the save read (`expectedVersion`), no stored or
 *   later version can still name what it drops.
 * - `abort`, after the write was refused, drops only the rows this save sealed.
 *
 * So a refused save leaves the stored workflow and its secrets as they were, and a slow save's
 * clean-up cannot remove a newer save's secrets.
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
  previous: unknown,
): Promise<SealedSave> {
  const { out, kept, created } = await seal(definition, workflowId, secretStore, key);
  const replaced = secretRefsOf(previous).filter((id) => !kept.includes(id));
  return {
    definition: out,
    commit: () => secretStore.deleteIds(workflowId, replaced),
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
