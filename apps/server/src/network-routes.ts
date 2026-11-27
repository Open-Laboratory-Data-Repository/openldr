import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { BAD_ADDRESS, BAD_HOST, SERVER_HOST, TrustAuditFailed, TrustRefused, WorkflowHostAuditFailed, type TrustError } from '@openldr/bootstrap';
import { requireCapability } from './rbac';
import { actorFromRequest } from './audit-helper';

/**
 * Settings > Network: the trusted certificates and the hosts a workflow may call. All behind
 * `network.manage`. The rules live in the two services (`ctx.trust`, `ctx.workflowHosts`), which
 * `openldr trust` and `openldr workflows hosts` call too. These routes only carry the answers.
 */

// The larger of the two is a pasted bundle of certificates. A certificate is about 2 KB.
const previewInput = z.union([z.object({ address: z.string().min(1).max(300) }).strict(), z.object({ text: z.string().min(1).max(200_000) }).strict()]);
const addInput = z.object({ pem: z.string().min(1).max(20_000) }).strict();
const hostInput = z.object({ host: z.string().max(300) }).strict();
const selfInput = z.object({ on: z.boolean() }).strict();

/** not-found is 404. A state that a retry or a fix elsewhere clears is 409. The rest is the caller's input: 400. */
const STATUS: Record<TrustError, number> = {
  'not-a-certificate': 400,
  'private-key': 400,
  duplicate: 400,
  'no-answer': 400,
  'not-found': 404,
  'read-only': 409,
  damaged: 409,
  busy: 409,
};

/** Turns a service error into the answer, or rethrows what it does not know. Never echoes input. */
function refused(reply: FastifyReply, err: unknown): { error: string; changed?: true } {
  if (err instanceof TrustRefused) {
    reply.code(STATUS[err.code]);
    return { error: err.code };
  }
  if (err instanceof TrustAuditFailed || err instanceof WorkflowHostAuditFailed) {
    // The change stands. The service's caller already logged who changed what.
    reply.code(500);
    return { error: 'audit-failed', changed: true };
  }
  if (err instanceof Error && (err.message === BAD_ADDRESS || err.message === BAD_HOST)) {
    reply.code(400);
    return { error: err.message };
  }
  if (err instanceof Error && err.message === SERVER_HOST) {
    reply.code(409);
    return { error: err.message };
  }
  throw err;
}

export function registerNetworkRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const guard = { preHandler: requireCapability('network.manage') };

  app.get('/api/network/trust', guard, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const [status, certificates] = await Promise.all([ctx.trust.status(), ctx.trust.list()]);
    return { ...status, certificates };
  });

  // Reads a certificate and changes nothing: from pasted text, or from one TLS connection to the
  // address. The person compares the fingerprint before adding it.
  app.post('/api/network/trust/preview', guard, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = previewInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid input' };
    }
    try {
      if ('address' in parsed.data) return { certificates: [await ctx.trust.preview(parsed.data.address)] };
      return { certificates: ctx.trust.read(parsed.data.text) };
    } catch (err) {
      return refused(reply, err);
    }
  });

  app.post('/api/network/trust', guard, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = addInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid input' };
    }
    try {
      const added = await ctx.trust.add(parsed.data.pem, actorFromRequest(req));
      reply.code(201);
      return added;
    } catch (err) {
      return refused(reply, err);
    }
  });

  // Removes a lock a stopped change left behind. The service refuses one younger than 30 seconds.
  app.post('/api/network/trust/unlock', guard, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return { removed: await ctx.trust.unlock(actorFromRequest(req)) };
    } catch (err) {
      return refused(reply, err);
    }
  });

  app.delete('/api/network/trust/:fingerprint', guard, async (req, reply) => {
    const { fingerprint } = req.params as { fingerprint: string };
    try {
      await ctx.trust.remove(fingerprint, actorFromRequest(req));
      reply.code(204);
      return null;
    } catch (err) {
      return refused(reply, err);
    }
  });

  app.get('/api/network/workflow-hosts', guard, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const [self, hosts] = await Promise.all([ctx.workflowHosts.self(), ctx.workflowHosts.list()]);
    return { self, hosts };
  });

  app.post('/api/network/workflow-hosts', guard, async (req, reply) => {
    const parsed = hostInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid input' };
    }
    try {
      await ctx.workflowHosts.add(parsed.data.host, actorFromRequest(req));
      reply.code(204);
      return null;
    } catch (err) {
      return refused(reply, err);
    }
  });

  app.put('/api/network/workflow-hosts/self', guard, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = selfInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid input' };
    }
    try {
      await ctx.workflowHosts.setSelf(parsed.data.on, actorFromRequest(req));
      return await ctx.workflowHosts.self();
    } catch (err) {
      return refused(reply, err);
    }
  });

  app.delete('/api/network/workflow-hosts/:host', guard, async (req, reply) => {
    const { host } = req.params as { host: string };
    try {
      await ctx.workflowHosts.remove(host, actorFromRequest(req));
      reply.code(204);
      return null;
    } catch (err) {
      return refused(reply, err);
    }
  });
}
