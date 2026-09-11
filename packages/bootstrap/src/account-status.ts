import type { AuthPort } from '@openldr/ports';
import type { UserStore, User } from '@openldr/users';
import { recordAuditEvent, type AuditActor, type AuditDetails } from './record-audit';

type Context = Parameters<typeof recordAuditEvent>[0] & {
  users: UserStore;
  auth: Pick<AuthPort, 'directory'>;
};

export class AccountNotFoundError extends Error {
  constructor() { super('user not found'); this.name = 'AccountNotFoundError'; }
}

/** Both callers use explicit identifiers: HTTP supplies a provider subject, CLI a local id. */
export async function setAccountStatus(
  ctx: Context,
  target: { localId: string } | { providerSubject: string },
  enabled: boolean,
  actor: AuditActor,
) {
  let local: User | undefined;
  let subject: string | null;
  if ('localId' in target) {
    local = await ctx.users.get(target.localId);
    if (!local) throw new AccountNotFoundError();
    subject = local.subject;
  } else {
    subject = target.providerSubject;
    local = await ctx.users.getBySubject(subject);
  }
  let audit: AuditDetails | undefined;
  const record = async (event: AuditDetails) => { audit = event; };
  try {
    if (subject) {
      return await ctx.users.withSubjectLock(subject, async users => {
        const current = await users.getBySubject(subject!);
        return applyAccountStatus({ ...ctx, users }, current, subject, enabled, record);
      });
    }
    return await applyAccountStatus(ctx, local, subject, enabled, record);
  } catch (error) {
    if (!audit || audit.action === 'user.status') {
      audit = {
        action: 'user.status.failed', entityType: 'user', entityId: subject ?? local!.id,
        metadata: { enabled, reason: error instanceof Error && error.name === 'AccountStatusConflictError' ? 'concurrent-change' : 'lock-failed' },
      };
    }
    throw error;
  } finally {
    // Release the pinned status connection before the audit store reserves one.
    if (audit) await recordAuditEvent(ctx, actor, audit);
  }
}

async function applyAccountStatus(ctx: Context, local: User | undefined, subject: string | null, enabled: boolean, record: (event: AuditDetails) => Promise<void>) {
  const status = enabled ? 'active' : 'disabled';
  const entityId = subject ?? local!.id;
  const backend = subject ? 'provider' : 'local';
  const before = local ? { id: local.id, subject: local.subject, status: local.status } : null;
  let localStatus = local?.status ?? null;
  let providerUpdated = false;
  let subjectBlocked = false;
  try {
    if (!subject) {
      await ctx.users.setStatus(local!.id, status);
      localStatus = status;
    } else {
      // The block is independent of provisioning, so provider outages cannot
      // create a competing local account or bypass access on a first token.
      await ctx.users.blockSubject(subject);
      subjectBlocked = true;
      if (!enabled && local) {
        await ctx.users.setStatus(local.id, 'disabled');
        localStatus = 'disabled';
      }
      const provider = await ctx.auth.directory.get(subject);
      if (!provider) throw new AccountNotFoundError();
      if (!enabled) {
        local = await ctx.users.setSubjectStatus({ subject, username: provider.username }, 'disabled');
        localStatus = 'disabled';
      }
      await ctx.auth.directory.update(subject, { enabled });
      providerUpdated = true;
      if (enabled) {
        local = await ctx.users.setSubjectStatus({ subject, username: provider.username }, 'active');
        localStatus = 'active';
        await ctx.users.unblockSubject(subject);
        subjectBlocked = false;
      }
      await record({
        action: 'user.status', entityType: 'user', entityId, before,
        after: { status, enabled }, metadata: { enabled, backend, localId: local!.id },
      });
      return { localId: local!.id, status, directory: { ...provider, enabled } };
    }
    await record({
      action: 'user.status', entityType: 'user', entityId, before,
      after: { status }, metadata: { enabled, backend },
    });
    return { localId: local!.id, status, directory: null };
  } catch (error) {
    await record({
      action: 'user.status.failed', entityType: 'user', entityId, before,
      metadata: { enabled, backend, localStatus, providerUpdated, subjectBlocked },
    });
    if (error instanceof AccountNotFoundError) throw error;
    if (error instanceof Error && error.name === 'IdentityAdminNotConfiguredError') throw error;
    if (!enabled && subjectBlocked) {
      throw new Error('local account is disabled; provider status could not be confirmed. Retry the status change.', { cause: error });
    }
    if (enabled && providerUpdated) {
      throw new Error('provider was enabled but the local access update failed. Local access remains blocked; retry enabling.', { cause: error });
    }
    throw error;
  }
}
