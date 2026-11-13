import type { FastifyReply, FastifyRequest } from 'fastify';

/** preHandler guard: requires the request actor to hold at least one of `roles`. */
export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!req.user.roles.some((r) => roles.includes(r))) {
      reply.code(403);
      return reply.send({ error: 'insufficient role' });
    }
  };
}

/** True when the signed-in actor holds `cap`. The one test behind requireCapability. */
export function holdsCapability(user: { capabilities?: string[] }, cap: string): boolean {
  return (user.capabilities ?? []).includes(cap);
}

/** preHandler guard: requires the request actor to hold `cap`. */
export function requireCapability(cap: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!holdsCapability(req.user, cap)) {
      reply.code(403);
      return reply.send({ error: 'insufficient capability' });
    }
  };
}

/** preHandler guard: requires the request actor to hold at least one of `caps`. */
export function requireAnyCapability(...caps: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      reply.code(401);
      return reply.send({ error: 'authentication required' });
    }
    if (!caps.some((c) => holdsCapability(req.user!, c))) {
      reply.code(403);
      return reply.send({ error: 'insufficient capability' });
    }
  };
}
