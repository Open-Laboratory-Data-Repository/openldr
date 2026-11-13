import { safeRecord, type AuditStore, type AuditEventInput } from '@openldr/audit';
import type { Logger } from '@openldr/core';

/** `origin` says the actor came through an access key or the CLI. The store writes it into the
 *  row's metadata. */
export type AuditActor = Pick<AuditEventInput, 'actorType' | 'actorId' | 'actorName' | 'origin'>;

export interface AuditDetails {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** `metadata.origin` is a reserved name: the store overwrites it with the actor's `origin`. */
  metadata?: Record<string, unknown>;
}

/** Request-free audit recorder shared by the server's recordAudit wrapper and the CLI. Best-effort:
 *  a store failure is logged, never thrown into the audited operation. */
export async function recordAuditEvent(
  ctx: { audit: AuditStore; logger: Logger },
  actor: AuditActor,
  d: AuditDetails,
): Promise<void> {
  await safeRecord(ctx.audit, ctx.logger, { ...actor, ...d });
}
