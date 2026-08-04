import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { splitFacilityAnswers } from '@openldr/db';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const VIEW = { preHandler: requireCapability('facilities.view') };
const MANAGE = { preHandler: requireCapability('facilities.manage') };

// The client submits ANSWERS, never a pre-split record: deciding which answers become indexed
// columns is the server's call, and duplicating the core-key list client-side would let the two
// drift. `id` is deliberately absent — see the POST handler.
const SubmitSchema = z.object({
  answers: z.record(z.unknown()),
  formSchemaId: z.string().nullish(),
  formVersion: z.number().nullish(),
});

/** Resolve the submitted form's field list so `apiProperty` can be read per answer. */
async function fieldsOf(ctx: AppContext, formSchemaId: string | null | undefined): Promise<{ id: string; apiProperty?: string | null }[]> {
  if (!formSchemaId) return [];
  const def = await ctx.forms.get(formSchemaId);
  const schema = def?.schema as { fields?: { id: string; apiProperty?: string | null }[] } | undefined;
  return schema?.fields ?? [];
}

export function registerFacilitiesRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/facilities', VIEW, async (req) => {
    const q = req.query as { region?: string; district?: string; council?: string; status?: string; limit?: string };
    return ctx.facilityRegistry.list({
      region: q.region, district: q.district, council: q.council, status: q.status,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  app.get('/api/facilities/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await ctx.facilityRegistry.get(id);
    if (!rec) { reply.code(404); return { error: 'not found' }; }
    return rec;
  });

  app.post('/api/facilities', MANAGE, async (req, reply) => {
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const fields = await fieldsOf(ctx, p.data.formSchemaId);
    const { record, extras } = splitFacilityAnswers(fields, p.data.answers);

    // ⛔ The id is ALWAYS generated here. The CSV importer derives ids deterministically from
    // sha256(nationalSystem|nationalCode), so a client-chosen id could collide with an imported
    // row and silently overwrite it.
    const created = await ctx.facilityRegistry.upsert({
      ...record,
      id: randomUUID(),
      name: String(record.name ?? ''),
      extras,
      // Lab-authored: managedOrigin stays NULL. Only the sync applier stamps 'central'.
      source: 'manual',
    } as never);

    await recordAudit(ctx, req, { action: 'facility.create', entityType: 'facility', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }

    const fields = await fieldsOf(ctx, p.data.formSchemaId);
    const { record, extras } = splitFacilityAnswers(fields, p.data.answers);

    const after = await ctx.facilityRegistry.upsert({
      ...before, ...record, id, name: String(record.name ?? before.name), extras,
      // An edit never changes who manages the row.
      managedOrigin: before.managedOrigin, source: before.source,
    } as never);

    await recordAudit(ctx, req, { action: 'facility.update', entityType: 'facility', entityId: id, before, after });
    return after;
  });

  app.delete('/api/facilities/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.facilityRegistry.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.facilityRegistry.remove(id);
    await recordAudit(ctx, req, { action: 'facility.delete', entityType: 'facility', entityId: id, before, after: null });
    return { ok: true };
  });
}
