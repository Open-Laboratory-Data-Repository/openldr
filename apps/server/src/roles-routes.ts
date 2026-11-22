import type { FastifyInstance } from 'fastify';
import { DataScopeError, dataScopeChoices, readScopeRegistryRows, setUserDataScope, type AppContext } from '@openldr/bootstrap';
import { redact, OpenLdrError } from '@openldr/core';
import { CAPABILITY_GROUPS } from '@openldr/rbac';
import { z } from 'zod';
import { requireAnyCapability, requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const roleInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().nullish(),
  capabilities: z.array(z.string()).default([]),
});
const assignInput = z.object({ roleIds: z.array(z.string()) });
// A user's data limit (roles part 3): Everything, or Limited to places picked from the register.
const name = z.string().min(1).max(200);
const dataScopeInput = z.discriminatedUnion('limited', [
  z.object({ limited: z.literal(false) }),
  z.object({
    limited: z.literal(true),
    facilities: z.array(name).max(1000),
    districts: z.array(z.object({ region: name, district: name })).max(1000),
    regions: z.array(name).max(1000),
  }),
]);

function isInvariant(e: unknown): e is OpenLdrError {
  return e instanceof OpenLdrError;
}

// ---------------------------------------------------------------------------
// Route registration — role CRUD, capability catalog, user-role assignment.
// All mutations are capability-gated (roles.manage) and audited; reads
// require roles.view. Store invariant violations (OpenLdrError) map to
// 400/409 depending on the route; unexpected errors map to 500 + redact().
// ---------------------------------------------------------------------------
export function registerRolesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const VIEW = { preHandler: requireCapability('roles.view') };
  const MANAGE = { preHandler: requireCapability('roles.manage') };

  // ownerPack names the content pack that made the role, so an admin knows the pack's next update
  // overwrites an edit (profile packs design 5.2).
  app.get('/api/roles', VIEW, async () => {
    const owners = await ctx.packItems.owners('role');
    return (await ctx.roles.list()).map((r) => ({ ...r, ownerPack: owners.get(r.id) ?? null }));
  });

  app.get('/api/roles/catalog', VIEW, async () => ({ groups: CAPABILITY_GROUPS }));

  app.get('/api/roles/:id', VIEW, async (req, reply) => {
    const r = await ctx.roles.get((req.params as { id: string }).id);
    if (!r) {
      reply.code(404);
      return { error: 'not found' };
    }
    return r;
  });

  app.post('/api/roles', MANAGE, async (req, reply) => {
    const p = roleInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      const created = await ctx.roles.create(p.data);
      await recordAudit(ctx, req, {
        action: 'role.create',
        entityType: 'role',
        entityId: created.id,
        before: null,
        after: created as unknown as Record<string, unknown>,
      });
      reply.code(201);
      return created;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/roles/:id', MANAGE, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const p = roleInput.partial().safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const before = await ctx.roles.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      const after = await ctx.roles.update(id, p.data);
      await recordAudit(ctx, req, {
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.delete('/api/roles/:id', MANAGE, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await ctx.roles.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      await ctx.roles.remove(id);
      await recordAudit(ctx, req, {
        action: 'role.delete',
        entityType: 'role',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: null,
      });
      reply.code(204);
      return null;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(409);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.get(
    '/api/users/:id/roles',
    { preHandler: requireAnyCapability('roles.view', 'users.view') },
    async (req) => ctx.roles.rolesForUser((req.params as { id: string }).id),
  );

  // What a data limit may name: the register's regions, districts and facilities (roles part 3).
  app.get('/api/data-scope/choices', MANAGE, async () => dataScopeChoices(await readScopeRegistryRows(ctx.internalDb)));

  // A user's data limit, by role subject (roles part 3).
  app.get(
    '/api/users/:id/data-scope',
    { preHandler: requireAnyCapability('roles.view', 'users.view') },
    async (req) => ctx.dataScopes.get((req.params as { id: string }).id),
  );

  app.put('/api/users/:id/data-scope', MANAGE, async (req, reply) => {
    const subject = (req.params as { id: string }).id;
    const p = dataScopeInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      // Before and after come from the save itself, read under its lock (roles review FR10).
      const { before, after } = await setUserDataScope(ctx, subject, p.data);
      await recordAudit(ctx, req, {
        action: 'user.data_scope.set',
        entityType: 'user',
        entityId: subject,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    } catch (e) {
      if (e instanceof DataScopeError) {
        reply.code(e.reason === 'no-user' ? 404 : 400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/users/:id/roles', MANAGE, async (req, reply) => {
    const subject = (req.params as { id: string }).id;
    const p = assignInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const before = await ctx.roles.rolesForUser(subject);
    try {
      await ctx.roles.setUserRoles(subject, p.data.roleIds);
      const after = await ctx.roles.rolesForUser(subject);
      await recordAudit(ctx, req, {
        action: 'user.assign_role',
        entityType: 'user',
        entityId: subject,
        // A jsonb column on real Postgres refuses a bare array, so the lists go in an object
        // (the dashboard share audit does the same).
        before: { roles: before },
        after: { roles: after },
      });
      return after;
    } catch (e) {
      if (isInvariant(e)) {
        reply.code(400);
        return { error: e.message };
      }
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
