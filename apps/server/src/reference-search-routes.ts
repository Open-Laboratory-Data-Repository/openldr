import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { resolveReferenceSource, type FormField, type ReferenceSource } from '@openldr/forms';
import { ENTITY_TARGETS, type EntityRow, type EntitySearchResolver } from '@openldr/db';
import { z } from 'zod';
import { requireCapability } from './rbac';
import { makeCodingSystemResolver } from './coding-system-url';

const VIEW = { preHandler: requireCapability('forms.view') };
const MANAGE = { preHandler: requireCapability('forms.edit') };

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MIN_QUERY = 2;

const previewInput = z.object({
  field: z.record(z.unknown()),
  q: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export interface CodingRow { system: string; code: string; display: string | null }
export type ReferenceSearchResponse =
  | { kind: 'coding'; rows: CodingRow[]; total: number }
  | { kind: 'entity'; rows: EntityRow[]; total: number };

export function registerReferenceSearchRoutes(
  app: FastifyInstance<any, any, any, any>,
  ctx: AppContext,
  entityResolvers: Record<string, EntitySearchResolver>,
): void {
  const resolveSystem = makeCodingSystemResolver(ctx);

  async function run(
    source: ReferenceSource, q: string, limit: number, offset: number, reply: FastifyReply,
  ): Promise<ReferenceSearchResponse | { error: string }> {
    if (source.kind === 'entity') {
      const resolver = entityResolvers[source.target];
      if (!resolver) {
        reply.code(400);
        return { error: `no resolver registered for entity target '${source.target}' (known: ${ENTITY_TARGETS.join(', ')})` };
      }
      if (q.length < MIN_QUERY) return { kind: 'entity', rows: [], total: 0 };
      const out = await resolver.search(q, limit, offset);
      return { kind: 'entity', rows: out.rows, total: out.total };
    }

    if (q.length < MIN_QUERY) return { kind: 'coding', rows: [], total: 0 };

    if (source.mode === 'valueset') {
      const vs = await ctx.terminology.ops.expand(source.url, { filter: q, count: limit, offset });
      return {
        kind: 'coding',
        rows: (vs.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null })),
        total: vs.expansion?.total ?? 0,
      };
    }

    // `terms.search` filters on terminology_concepts.system, which holds the CANONICAL URL.
    // A field authored per the documented `cs-url-*` convention would otherwise match nothing,
    // silently and forever.
    const system = await resolveSystem(source.system);
    const found = await ctx.terminology.admin.terms.search(system, { query: q, limit, offset });
    return {
      kind: 'coding',
      rows: found.rows.map((r) => ({ system: r.system, code: r.code, display: r.display })),
      total: found.total,
    };
  }

  function clampLimit(raw: string | number | undefined): number {
    const n = Number(raw ?? DEFAULT_LIMIT);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(n), MAX_LIMIT);
  }

  // Mirrors clampLimit: non-finite (NaN/Infinity), negative, or non-numeric input becomes 0
  // rather than reaching the database as `OFFSET NaN` or silently emptying a ValueSet page.
  function clampOffset(raw: string | number | undefined): number {
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.trunc(n);
  }

  // Search is scoped to a FIELD, not to a target: the server derives the source from the
  // stored schema, so a caller cannot search patients unless a form declares a
  // patient-bound field.
  app.get('/api/forms/:formId/fields/:fieldId/reference-search', VIEW, async (req, reply) => {
    const { formId, fieldId } = req.params as { formId: string; fieldId: string };
    const form = await ctx.forms.get(formId);
    // A draft/archived form is treated exactly like a missing one: the response must not let a
    // caller distinguish "no such form" from "exists but isn't published yet".
    if (!form || form.status !== 'published') { reply.code(404); return { error: 'form not found' }; }

    const field = form.schema.fields.find((f) => f.id === fieldId);
    if (!field) { reply.code(404); return { error: 'field not found' }; }

    const resolved = resolveReferenceSource(field);
    if (!resolved.ok) { reply.code(400); return { error: `field '${fieldId}' declares no reference source` }; }

    const query = req.query as { q?: string; limit?: string; offset?: string };
    // No try/catch here: a store or terminology failure is an infrastructure error, not a client
    // one. Let it propagate to the central error handler (registerErrorHandler) so it is
    // classified, logged, and answered with the right status — instead of being flattened into a
    // 400 with a raw driver message, as it was before.
    return run(resolved.source, (query.q ?? '').trim(), clampLimit(query.limit), clampOffset(query.offset), reply);
  });

  // The builder previews unsaved schemas, so this one takes the field inline. Gated on
  // forms.edit — it is the only path that can search a source no stored form declares.
  app.post('/api/forms/reference-search/preview', MANAGE, async (req, reply) => {
    const parsed = previewInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }

    const resolved = resolveReferenceSource(parsed.data.field as unknown as FormField);
    if (!resolved.ok) { reply.code(400); return { error: 'field declares no reference source' }; }

    // See the GET route above: infrastructure failures propagate to the central error handler
    // rather than being caught and reported as a client 400.
    return run(resolved.source, (parsed.data.q ?? '').trim(), clampLimit(parsed.data.limit), clampOffset(parsed.data.offset), reply);
  });
}
