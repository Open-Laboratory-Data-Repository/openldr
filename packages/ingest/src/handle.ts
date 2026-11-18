import { type Logger, errorMessage, redact } from '@openldr/core';
import type { BlobStoragePort, EventEnvelope } from '@openldr/ports';
import type { JobInterruptionStore, Provenance, PersistResult } from '@openldr/db';
import type { ConverterResolver } from './resolver';
import type { BatchStore } from './batch-store';

/** Audit hook — a structural callback so ingest stays decoupled from @openldr/audit. */
export type AuditHook = (e: {
  actorType: 'system';
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resources: unknown[], provenance: Provenance) => Promise<PersistResult[]>;
  resolver: ConverterResolver;
  batches: BatchStore;
  logger: Logger;
  audit?: AuditHook;
  /** Records a batch the queue hands back while still `processing`: its worker died mid-batch
   *  (design 2026-11-18-interrupted-jobs). Absent, nothing is recorded. */
  interruptions?: { store: Pick<JobInterruptionStore, 'record' | 'resolve'>; now: () => Date };
  onBatchDone?: (info: { batchId: string; source: string; converter: string; count: number; blobKey: string; byteSize: number }) => Promise<void>;
}

interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
  config?: Record<string, string> | null;
}

export async function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void> {
  const { batchId, blobKey, source, converter, config } = event.payload as IngestPayload;
  await recordRedelivery(deps, batchId);
  await deps.batches.markProcessing(batchId);
  try {
    const raw = await deps.blob.get(blobKey);
    const c = await deps.resolver.resolve(converter);
    if (!c) throw new Error(`unknown converter: ${converter}`);
    const resources = await c.convert(raw, { source, batchId, config: config ?? undefined });
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    await deps.persist(resources, provenance);
    await deps.batches.markDone(batchId, resources.length);
    deps.logger.info({ batchId, source, converter, count: resources.length }, 'ingest batch persisted');
    await deps.audit?.({
      actorType: 'system',
      actorName: 'system',
      action: 'ingest.batch.done',
      entityType: 'batch',
      entityId: batchId,
      metadata: { source, converter, pluginId: c.id, pluginVersion: c.version, count: resources.length },
    });
    await deps.onBatchDone?.({ batchId, source, converter, count: resources.length, blobKey, byteSize: raw.byteLength });
  } catch (err) {
    const msg = redact(errorMessage(err));
    await deps.batches.markFailed(batchId, msg);
    deps.logger.error({ batchId, error: msg }, 'ingest batch failed');
    await deps.audit?.({
      actorType: 'system',
      actorName: 'system',
      action: 'ingest.batch.failed',
      entityType: 'batch',
      entityId: batchId,
      metadata: { source, converter, error: msg },
    });
    throw err;
  }
}

/** A batch still `processing` when its event arrives was cut off: the queue took the event back
 *  after the worker that held it died, and this delivery carries it on. The cut is recorded, and a
 *  failure to record never stops the batch. */
async function recordRedelivery(deps: HandleDeps, batchId: string): Promise<void> {
  if (!deps.interruptions) return;
  try {
    const before = await deps.batches.get(batchId);
    if (before?.status !== 'processing') return;
    const { id, inserted } = await deps.interruptions.store.record('ingest-batch', batchId, {
      at: new Date(before.updated_at), cause: 'lease-expired', phase: null,
    });
    if (inserted) await deps.interruptions.store.resolve(id, { resumedBy: 'self', resumedAt: deps.interruptions.now() });
  } catch {
    // The batch runs either way; the page then shows no record of this cut.
  }
}
