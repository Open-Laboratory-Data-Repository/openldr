import type { FastifyRequest } from 'fastify';
import { recordAuditEvent, type AuditActor, type AuditDetails } from '@openldr/bootstrap';
import type { AppContext } from '@openldr/bootstrap';

export type { AuditDetails };

export function actorFromRequest(req: FastifyRequest): AuditActor {
  if (!req.user) return { actorType: 'system', actorId: null, actorName: 'System' };
  const actor: AuditActor = { actorType: 'user', actorId: req.user.id, actorName: req.user.username };
  // A request signed in with an access key says so, with the key's name. Never the key itself.
  if (req.user.accessKey) return { ...actor, origin: { via: 'access-key', keyName: req.user.accessKey.name } };
  return actor;
}

/** Best-effort audit recorder for HTTP routes — a thin wrapper over the shared recordAuditEvent. */
export async function recordAudit(ctx: AppContext, req: FastifyRequest, d: AuditDetails): Promise<void> {
  await recordAuditEvent(ctx, actorFromRequest(req), d);
}
