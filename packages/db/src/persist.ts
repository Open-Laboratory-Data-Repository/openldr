import { type Logger, OpenLdrError, appError } from '@openldr/core';
import { validateResource, validateBatch, type ValidateBatchOpts, type FhirResource } from '@openldr/fhir';
import type { FhirStore } from './fhir-store';
import type { Provenance } from './provenance';

export interface PersistResult {
  saved: boolean;
  flattened: 'written' | 'skipped' | 'degraded' | 'deferred';
  externalError?: string;
}

export interface PersistDeps {
  fhirStore: FhirStore;
  logger: Logger;
}

/** `skipUnchanged` is handed to `fhirStore.saveMany`: a record whose content is already the latest
 *  stored version is not written again. Only the import check sets it. */
export type PersistOpts = ValidateBatchOpts & { skipUnchanged?: boolean; ownedBy?: string };

// Projection is asynchronous (R2): persist writes the canonical resource + change_log (via
// fhirStore.save) and returns immediately; the projection worker tails change_log and updates the
// external read-model out of band. `flattened: 'deferred'` reflects that decoupling.
export async function persistResource(
  deps: PersistDeps,
  resource: unknown,
  provenance: Provenance = {},
  opts?: PersistOpts,
): Promise<PersistResult> {
  return (await persistResources(deps, [resource], provenance, opts))[0];
}

export async function persistResources(
  deps: PersistDeps,
  resources: unknown[],
  provenance: Provenance = {},
  opts?: PersistOpts,
): Promise<PersistResult[]> {
  if (opts) {
    const v = await validateBatch(resources, opts);
    if (!v.ok) throw appError('VA0002', { details: { outcome: v.outcome } });
    return saveAll(deps, v.resources, provenance, { skipUnchanged: opts.skipUnchanged === true, ownedBy: opts.ownedBy });
  }
  // Back-compat path (no opts): per-resource structural validation, as before. Every resource is
  // checked before any is saved.
  const valid: FhirResource[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    valid.push(validation.resource);
  }
  return saveAll(deps, valid, provenance, {});
}

// One transaction for the whole list (item 16): a database error on any resource saves none of
// them, so a request is never left half-saved.
async function saveAll(deps: PersistDeps, resources: FhirResource[], provenance: Provenance, opts: { skipUnchanged?: boolean; ownedBy?: string }): Promise<PersistResult[]> {
  const save: { skipUnchanged?: true; ownedBy?: string } = {};
  if (opts.skipUnchanged) save.skipUnchanged = true;
  if (opts.ownedBy !== undefined) save.ownedBy = opts.ownedBy;
  if (Object.keys(save).length > 0) await deps.fhirStore.saveMany(resources, provenance, save);
  else await deps.fhirStore.saveMany(resources, provenance);
  return resources.map(() => ({ saved: true, flattened: 'deferred' as const }));
}

/** One request of a page: the key the caller knows it by, and its records. */
export interface PersistRequest { key: string; resources: unknown[] }
/** How one request of a page ended. `error` is what `persistResources` would have thrown for it. */
export interface PersistRequestResult { key: string; error?: unknown }

/**
 * Saves the requests of one page with one `saveMany` call (item 16). Each request is still
 * checked on its own, in the order given, as `persistResources` checks it. A result sees the
 * orders already stored and the orders of earlier requests of the page, never of later ones: that
 * is what it would see if the earlier requests had been saved first, one by one.
 *
 * If the one call fails, nothing of the page is stored, and each request is then saved alone with
 * `persistResources`, in order. So one bad request fails alone, and a request that leaned on the
 * order of a request that failed is refused, exactly as when requests are saved one by one.
 */
export async function persistRequests(
  deps: PersistDeps,
  requests: PersistRequest[],
  provenance: Provenance,
  opts: PersistOpts,
): Promise<PersistRequestResult[]> {
  const out: PersistRequestResult[] = requests.map((r) => ({ key: r.key }));
  const staged = new Set<string>();
  const valid: Array<{ at: number; resources: FhirResource[] }> = [];
  for (let at = 0; at < requests.length; at++) {
    const v = await validateBatch(requests[at].resources, {
      level: opts.level,
      resolveServiceRequest: async (id) => staged.has(id) || opts.resolveServiceRequest(id),
    });
    if (!v.ok) {
      out[at].error = appError('VA0002', { details: { outcome: v.outcome } });
      continue;
    }
    valid.push({ at, resources: v.resources });
    for (const r of v.resources) {
      const id = (r as { id?: string }).id;
      if (r.resourceType === 'ServiceRequest' && id) staged.add(id);
    }
  }
  if (valid.length === 0) return out;
  const all: FhirResource[] = [];
  for (const v of valid) for (const r of v.resources) all.push(r);
  try {
    if (opts.skipUnchanged === true) await deps.fhirStore.saveMany(all, provenance, { skipUnchanged: true });
    else await deps.fhirStore.saveMany(all, provenance);
    return out;
  } catch (err) {
    deps.logger.warn({ err, requests: valid.length }, 'saving a page of requests failed; saving each request alone');
  }
  // Every request again, alone and in order, with only what is stored to lean on. A request refused
  // above stays refused: nothing stored changed for it.
  for (const v of valid) {
    try {
      await persistResources(deps, requests[v.at].resources, provenance, opts);
    } catch (err) {
      out[v.at].error = err;
    }
  }
  return out;
}
