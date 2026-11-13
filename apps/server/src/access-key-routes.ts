// Routes that list, make and revoke a user's access keys. All three need users.manage. The logic
// is in @openldr/bootstrap, which the CLI calls too. The create answer is the only response that
// ever holds a key.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createAccessKey, listAccessKeys, revokeAccessKey, AccessKeyInputError, UnknownAccessKeyError, type AppContext,
} from '@openldr/bootstrap';
import { resolveAuthCapabilities } from '@openldr/config';
import { redact } from '@openldr/core';
import { requireCapability } from './rbac';
import { actorFromRequest } from './audit-helper';
import { isNotConfigured } from './users-routes';

const MANAGE = { preHandler: requireCapability('users.manage') };
const NOT_FOUND = { error: 'not found' };
const createInput = z.object({ name: z.string(), expiresAt: z.string().nullable().optional() });

/** Who `:id` names. A local row, an account only the directory knows (it never signed in), or
 *  nobody. */
type KeyOwner =
  | { local: true; userId: string }
  | { local: false; subject: string; username: string; enabled: boolean }
  | null;

/** The directory could not be asked. Answered as users-routes.ts answers it. */
type DirectoryFailure = { status: 502 | 503; error: string };

export function registerAccessKeyRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // `:id` is read as users-routes.ts reads it for POST /api/users/:id/status. With identity admin,
  // Studio lists users from the directory, so `:id` is the provider's id, which the local row keeps
  // as `subject`. Local sign-in counts as identity admin, and a local row's subject is its id.
  // Without identity admin, Studio lists local rows, so `:id` is the local id.
  //
  // With identity admin, a row with no subject is also found by its local id: the dev actor, a row
  // from an older install, or a row the CLI made. Only a row with no subject, so a linked account
  // keeps one id here, its subject. A provider id cannot select some other row this way: a row with
  // no subject has no provider id, and local ids are random UUIDs.
  async function findOwner(id: string): Promise<KeyOwner | DirectoryFailure> {
    if (!resolveAuthCapabilities(ctx.cfg).identityAdmin) {
      const u = await ctx.users.get(id);
      return u ? { local: true, userId: u.id } : null;
    }
    const bySubject = await ctx.users.getBySubject(id);
    if (bySubject) return { local: true, userId: bySubject.id };
    const byId = await ctx.users.get(id);
    if (byId && byId.subject === null) return { local: true, userId: byId.id };
    try {
      const d = await ctx.auth.directory.get(id);
      return d ? { local: false, subject: id, username: d.username, enabled: d.enabled } : null;
    } catch (e) {
      if (isNotConfigured(e)) return { status: 503, error: 'identity provider admin client is not configured' };
      return { status: 502, error: redact(e instanceof Error ? e.message : String(e)) };
    }
  }

  // A directory account that never signed in has no local row, and a key needs one. This writes it
  // with setSubjectStatus, the store's writer for an account that has never signed in, under the
  // same subject lock setAccountStatus holds around it. The status copies the directory's, except
  // that making a key never turns a disabled row back on: setSubjectStatus links a row with the
  // same username and no subject, and writes the status it is given onto that row. Read inside the
  // lock, after the re-check, so no other caller can change the row between the read and the write.
  async function localRowFor(owner: Exclude<KeyOwner, null>): Promise<string> {
    if (owner.local) return owner.userId;
    return ctx.users.withSubjectLock(owner.subject, async (users) => {
      const current = await users.getBySubject(owner.subject);
      if (current) return current.id;
      const linkable = await users.getByUsername(owner.username);
      const keepDisabled = linkable !== undefined && linkable.subject === null && linkable.status === 'disabled';
      const status = keepDisabled || !owner.enabled ? 'disabled' : 'active';
      const made = await users.setSubjectStatus({ subject: owner.subject, username: owner.username }, status);
      return made.id;
    });
  }

  app.get('/api/users/:id/keys', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const owner = await findOwner(id);
    if (owner && 'status' in owner) return reply.code(owner.status).send({ error: owner.error });
    if (!owner) return reply.code(404).send(NOT_FOUND);
    if (!owner.local) return reply.send({ keys: [] });
    return reply.send({ keys: await listAccessKeys(ctx, owner.userId) });
  });

  app.post('/api/users/:id/keys', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const owner = await findOwner(id);
    if (owner && 'status' in owner) return reply.code(owner.status).send({ error: owner.error });
    if (!owner) return reply.code(404).send(NOT_FOUND);
    let userId: string;
    try {
      userId = await localRowFor(owner);
    } catch (e) {
      // Another change holds the subject lock. Retryable.
      if (e instanceof Error && e.name === 'AccountStatusConflictError') {
        return reply.code(409).send({ error: 'another change to this account is in progress; try again' });
      }
      throw e;
    }
    try {
      const { key, record } = await createAccessKey(ctx, actorFromRequest(req), { userId, ...parsed.data });
      // The only answer that holds a key. No cache may keep it.
      reply.header('cache-control', 'no-store');
      return reply.code(201).send({ key, record });
    } catch (e) {
      if (e instanceof AccessKeyInputError) {
        if (e.reason === 'unknown_user') return reply.code(404).send(NOT_FOUND);
        return reply.code(400).send({ error: e.message });
      }
      // Never the raw error: on Postgres a duplicate-key error quotes the key's hash in its detail.
      const code = (e as { code?: unknown } | null)?.code;
      ctx.logger.error({ code: typeof code === 'string' ? code : undefined }, 'could not create an access key');
      return reply.code(500).send({ error: 'could not create the access key' });
    }
  });

  app.delete('/api/users/:id/keys/:keyId', MANAGE, async (req, reply) => {
    const { id, keyId } = req.params as { id: string; keyId: string };
    const owner = await findOwner(id);
    if (owner && 'status' in owner) return reply.code(owner.status).send({ error: owner.error });
    // An account with no local row has no keys, so its key is not there either.
    if (!owner || !owner.local) return reply.code(404).send(NOT_FOUND);
    try {
      await revokeAccessKey(ctx, actorFromRequest(req), { userId: owner.userId, keyId });
    } catch (e) {
      // One answer for another user's key, an unknown key and an already revoked key.
      if (e instanceof UnknownAccessKeyError) return reply.code(404).send(NOT_FOUND);
      throw e;
    }
    return reply.code(204).send();
  });
}
