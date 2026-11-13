// Routes that list, make and revoke a user's access keys. All three need users.manage. The logic
// is in @openldr/bootstrap, which the CLI calls too. The create answer is the only response that
// ever holds a key.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createAccessKey, listAccessKeys, revokeAccessKey, AccessKeyInputError, UnknownAccessKeyError, type AppContext,
} from '@openldr/bootstrap';
import { requireCapability } from './rbac';
import { actorFromRequest } from './audit-helper';

const MANAGE = { preHandler: requireCapability('users.manage') };
const NOT_FOUND = { error: 'not found' };
const createInput = z.object({ name: z.string(), expiresAt: z.string().nullable().optional() });

export function registerAccessKeyRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const userExists = async (id: string) => !!(await ctx.users.get(id));

  app.get('/api/users/:id/keys', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await userExists(id))) return reply.code(404).send(NOT_FOUND);
    return reply.send({ keys: await listAccessKeys(ctx, id) });
  });

  app.post('/api/users/:id/keys', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    try {
      const { key, record } = await createAccessKey(ctx, actorFromRequest(req), { userId: id, ...parsed.data });
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
    if (!(await userExists(id))) return reply.code(404).send(NOT_FOUND);
    try {
      await revokeAccessKey(ctx, actorFromRequest(req), { userId: id, keyId });
    } catch (e) {
      // One answer for another user's key, an unknown key and an already revoked key.
      if (e instanceof UnknownAccessKeyError) return reply.code(404).send(NOT_FOUND);
      throw e;
    }
    return reply.code(204).send();
  });
}
