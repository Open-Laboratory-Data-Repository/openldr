import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { codingKey, rankCodeSuggestions, tallyFormCodes } from '@openldr/forms';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

/**
 * Suggested codes for a field in the form builder (spec S7, row A7). Ported from corlix
 * `apps/desktop/src/main/code-suggestions.ts`, with two sources instead of three: the stored codes
 * of a ValueSet, and the codes other forms put on the same FHIR path.
 *
 * Import and undo are their own routes because the term routes do the wrong thing here. The term
 * POST is an upsert (`terms.create`), so importing a code CE already holds would overwrite its
 * curated display, status and properties. The term DELETE removes any term, so an Undo could
 * remove one someone else curated. These insert only when absent, and delete only a term they
 * added (operator ruling, 2026-09-14).
 */

/** Marks a term the builder added, in its metadata. Undo deletes only terms that carry it. */
export const SUGGESTION_TAG = 'code-suggestion';

const VIEW = { preHandler: requireCapability('forms.view') };
// Adding a code to the terminology is a terminology change, so it takes the term routes' gate.
const MANAGE = { preHandler: requireCapability('terminology.manage') };

const importInput = z.object({ system: z.string().min(1), code: z.string().min(1), display: z.string().optional() });
const undoInput = z.object({ system: z.string().min(1), code: z.string().min(1) });

export function registerCodeSuggestionRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const admin = ctx.terminology.admin;

  app.get('/api/forms/code-suggestions', VIEW, async (req, reply) => {
    const q = req.query as { fhirPath?: string; valueSetUrl?: string; formId?: string };
    const path = q.fhirPath?.trim();
    if (!path) {
      reply.code(400);
      return { error: 'fhirPath is required' };
    }
    // The panel sends the field's own set, or FHIR's standard binding for the element. The server
    // cannot look that binding up itself: it has no @openldr/fhir dependency.
    const bound = q.valueSetUrl ? await admin.valueSets.getByUrl(q.valueSetUrl) : null;
    const binding = bound ? await admin.valueSets.storedCodes(bound.id) : [];
    const yourForms = tallyFormCodes(await ctx.forms.listDefinitions(), path, q.formId || null);
    const pairs = [...binding, ...yourForms].map((c) => ({ system: c.system, code: c.code }));
    const known = new Set((await admin.terms.existing(pairs)).map((t) => codingKey(t.system, t.code)));
    return rankCodeSuggestions({ binding, yourForms, known });
  });

  app.post('/api/forms/code-suggestions/import', MANAGE, async (req, reply) => {
    const parsed = importInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const { system, code, display } = parsed.data;
    if (!(await admin.codingSystems.getByUrl(system))) {
      reply.code(422);
      return { error: 'unknown-system' };
    }
    const term = await admin.terms.createIfAbsent({
      system, code, display: display?.trim() || code, status: 'ACTIVE', metadata: { addedBy: SUGGESTION_TAG },
    });
    if (!term) {
      reply.code(409);
      return { error: 'already-present' };
    }
    await recordAudit(ctx, req, { action: 'term.create', entityType: 'term', entityId: code, before: null, after: term, metadata: { system, via: SUGGESTION_TAG } });
    reply.code(201);
    return term;
  });

  app.post('/api/forms/code-suggestions/undo', MANAGE, async (req, reply) => {
    const parsed = undoInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const { system, code } = parsed.data;
    if (!(await admin.terms.deleteIfAddedBy(system, code, SUGGESTION_TAG))) {
      reply.code(409);
      return { error: 'not-added-here' };
    }
    await recordAudit(ctx, req, { action: 'term.delete', entityType: 'term', entityId: code, before: null, after: null, metadata: { system, via: SUGGESTION_TAG } });
    reply.code(204);
    return null;
  });
}
