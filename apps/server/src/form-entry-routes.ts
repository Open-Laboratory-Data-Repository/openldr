import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext, EntryViewer } from '@openldr/bootstrap';
import type { FormEntry } from '@openldr/db';
import { EVERYTHING } from '@openldr/rbac';
import { entryAnswersOfResponse, type FormSchema } from '@openldr/forms';
import { z } from 'zod';
import { requireCapability } from './rbac';
import { formOpenRules } from './forms-routes';
import { actorFromRequest } from './audit-helper';

// The entries of a form (design 2026-11-22-form-entries, 5.2 and 5.3). A limited user sees the
// entries inside the limit and the entries they made. An entry the caller may not see answers 404,
// the same as one that does not exist, so its existence never leaks.

const VIEW = { preHandler: requireCapability('forms.view') };
const VOID = { preHandler: requireCapability('forms.void_entries') };
const NOT_FOUND = { error: 'not found' };

/** An empty value, as a query string sends a cleared box, counts as left out. */
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional());

const listQuery = z.object({
  limit: opt(z.coerce.number().int().min(1).max(100)).transform((v) => v ?? 25),
  offset: opt(z.coerce.number().int().min(0)).transform((v) => v ?? 0),
  status: opt(z.enum(['active', 'incomplete', 'entered-in-error'])),
  enteredBy: opt(z.string().max(200)),
  search: opt(z.string().max(100)),
});

const voidBody = z.object({ reason: z.string().trim().min(1).max(500) });

/** The caller as the entries rules see them. A missing limit is no limit, as on the submit route. */
const viewerOf = (req: FastifyRequest): EntryViewer => ({
  id: req.user?.id ?? '',
  dataScope: req.user?.dataScope ?? EVERYTHING,
});

export function registerFormEntryRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const { mayOpen } = formOpenRules(ctx);

  /** The form, when it exists and the caller may open it. */
  const openForm = async (req: FastifyRequest, id: string) => {
    const form = await ctx.forms.get(id);
    return form && (await mayOpen(req, form.id)) ? form : null;
  };

  /** Every answer from the entry's saved form copy, with the labels it was saved under where it carries
   *  them. Null when there is none or it cannot be read. */
  const answersOf = async (entry: FormEntry, schema: FormSchema) => {
    const id = entry.saved?.responseId;
    if (!id) return null;
    try {
      const qr = await ctx.fhirStore.get('QuestionnaireResponse', id);
      if (!qr) return null;
      return entryAnswersOfResponse(schema, qr as never);
    } catch (err) {
      ctx.logger.warn({ err, entryId: entry.id }, 'form entry: the saved form copy could not be read');
      return null;
    }
  };

  app.get('/api/forms/:id/entries', VIEW, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) { reply.code(400); return { error: q.error.message }; }
    const form = await openForm(req, (req.params as { id: string }).id);
    if (!form) { reply.code(404); return NOT_FOUND; }
    return ctx.formEntries.list({ formId: form.id, user: viewerOf(req), ...q.data });
  });

  app.get('/api/forms/:id/entry-context', VIEW, async (req, reply) => {
    const form = await openForm(req, (req.params as { id: string }).id);
    if (!form) { reply.code(404); return NOT_FOUND; }
    return ctx.formEntries.context(viewerOf(req));
  });

  app.get('/api/forms/entries/:entryId', VIEW, async (req, reply) => {
    const entry = await ctx.formEntries.get((req.params as { entryId: string }).entryId, viewerOf(req));
    const form = entry ? await openForm(req, entry.formId) : null;
    if (!entry || !form) { reply.code(404); return NOT_FOUND; }
    return { ...entry, answers: await answersOf(entry, form.schema) };
  });

  // Design 5.5: mark an entry entered in error. The row is marked first; a failed re-save of its
  // records comes back as `warning`, with the row still marked.
  app.post('/api/forms/entries/:entryId/void', VOID, async (req, reply) => {
    const b = voidBody.safeParse(req.body ?? {});
    if (!b.success) { reply.code(400); return { error: 'a reason of 1 to 500 characters is required' }; }
    const entryId = (req.params as { entryId: string }).entryId;
    const viewer = viewerOf(req);
    // The same rule as reading it: an entry of a form the caller may not open is not there.
    const seen = await ctx.formEntries.get(entryId, viewer);
    if (!seen || !(await openForm(req, seen.formId))) { reply.code(404); return NOT_FOUND; }
    const result = await ctx.formEntries.voidEntry({
      entryId, reason: b.data.reason, actor: actorFromRequest(req), user: viewer,
    });
    if (result === 'not-found') { reply.code(404); return NOT_FOUND; }
    if (result === 'already-void') { reply.code(409); return { error: 'already-void' }; }
    return result;
  });
}
