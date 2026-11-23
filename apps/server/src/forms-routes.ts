import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import AdmZip from 'adm-zip';
import { EntrySiteError, FormAccessError, OrderExists, TEST_CATALOG_SYSTEM, drivesAppPage, findCatalogBand, formOpenRule, repeatMessage, setFormAccess, type AppContext, type ResultBand } from '@openldr/bootstrap';
import { FormEntryRepeat, type FormEntry, type FormEntrySaved } from '@openldr/db';
import { EVERYTHING } from '@openldr/rbac';
import { redact } from '@openldr/core';
import type { ExtractionContext, FormSchema } from '@openldr/forms';
import { FormCreateInputSchema } from '@openldr/forms/pure';
import { entryFacilitiesOf, entryKeyOf, extractorsForForm, isEntityAnswer, labOrderId, linkToOrder, isCodingAnswer, parseTestDetails, toQuestionnaire, toQuestionnaireResponse, toTransactionBundle, validateAnswers, validateReferences } from '@openldr/forms';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';
import { makeCodingSystemResolver } from './coding-system-url';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';
}

const publishInput = z.object({
  versionLabel: z.string().nullish(),
});

const responseInput = z.object({
  answers: z.record(z.unknown()),
});

/** The Corlix fhir-path a capture form binds its patient/subject field to. */
const SUBJECT_FHIR_PATH = 'ServiceRequest.subject';

/**
 * Build the ExtractionContext the extractors need but a QuestionnaireResponse can't carry.
 *
 * ServiceRequestExtractor reads the subject ONLY from this context — it never looks at the
 * response's `ServiceRequest.subject`-bound answer. Passing `{}` (as this route first did) meant
 * every hand-captured order was extracted with `subject: { display: 'Unknown subject' }` and no
 * `authoredOn`, so `lab_requests.patient_id` projected NULL for capture while every CDR-ingested
 * order carried a real patient. The extractor is shared with the ingest path and the CLI, so the
 * lookup lives here rather than widening it.
 */
function extractionContextFor(schema: FormSchema, answers: Record<string, unknown>, authored: string): ExtractionContext {
  const context: ExtractionContext = { authored };
  const subjectField = schema.fields.find((field) => field.fhirPath === SUBJECT_FHIR_PATH);
  const answer = subjectField ? answers[subjectField.id] : undefined;
  // No such field, unanswered, or a non-entity answer (e.g. free text): leave subject undefined
  // so the extractor's own 'Unknown subject' fallback applies rather than emitting a broken ref.
  if (isEntityAnswer(answer)) {
    context.subject = { reference: answer.reference, ...(answer.display ? { display: answer.display } : {}) };
  }
  return context;
}

/** The Corlix fhir-path a Lab order binds its tests to. */
const ORDER_CODE_FHIR_PATH = 'ServiceRequest.code';

/**
 * For each catalog test on the order, the LOINC coding the extractor writes in front of it (test
 * catalog S4, spec 4.5). The warehouse keeps an order's first coding (packages/db/src/relational/extract.ts),
 * so a LOINC-linked test still lands as LOINC. The catalog is asked only when an answer is a catalog test.
 */
async function catalogCodingsBefore(
  ctx: AppContext, schema: FormSchema, answers: Record<string, unknown>,
): Promise<ExtractionContext['codingBefore']> {
  const tests: Array<{ system: string; code: string }> = [];
  for (const field of schema.fields) {
    if (field.fhirPath !== ORDER_CODE_FHIR_PATH) continue;
    const value = answers[field.id];
    for (const v of Array.isArray(value) ? value : [value]) {
      if (isCodingAnswer(v) && v.system === TEST_CATALOG_SYSTEM) tests.push({ system: v.system, code: v.code });
    }
  }
  if (tests.length === 0) return undefined;
  return ctx.testCatalog.loincCodingsFor(tests);
}

/**
 * Each typed result's band, checked against the ranges the catalog holds for that test and parameter
 * (named reference ranges spec, 5), and the matched catalog range for each one that checks out.
 *
 * The sheet sends the range the bench picked, so without the check an edited request could store a
 * range the catalog never had. The extractor must then be handed the CATALOG's copy of that range,
 * never the submitted one field for field: `findCatalogBand` refuses a wrong-typed field rather than
 * coercing it, so a malformed submitted band cannot pass a check that then writes its own values.
 * Skips a rejected test's results, since a rejected test's results are never extracted (its
 * Observation carries the rejection reason instead), so a stale band there must not block the submit.
 * Asks the catalog only when a result carries a band.
 */
async function checkTestBands(
  ctx: AppContext, schema: FormSchema, answers: Record<string, unknown>,
): Promise<{ errors: Array<{ fieldId: string; label: string; reason: string }>; matched: Map<string, ResultBand> }> {
  const checks: Array<{ fieldId: string; label: string; testKey: string; param: { system: string; code: string }; band: unknown }> = [];
  for (const field of schema.fields) {
    if (field.fieldType !== 'testDetails') continue;
    for (const [testKey, detail] of Object.entries(parseTestDetails(answers[field.id]))) {
      if (detail.rejection) continue;
      for (const result of detail.results) {
        if (result.band) checks.push({ fieldId: field.id, label: field.displayLabel, testKey, param: result.param, band: result.band });
      }
    }
  }
  if (checks.length === 0) return { errors: [], matched: new Map() };
  const tests = [...new Set(checks.map((c) => c.testKey))].map((key) => {
    const cut = key.lastIndexOf('|');
    return { system: key.slice(0, cut), code: key.slice(cut + 1) };
  });
  const held = await ctx.testCatalog.resultParamsFor(tests, {});
  const errors: Array<{ fieldId: string; label: string; reason: string }> = [];
  const matched = new Map<string, ResultBand>();
  for (const c of checks) {
    const bands = held.find((t) => `${t.test.system}|${t.test.code}` === c.testKey)
      ?.params.find((p) => p.system === c.param.system && p.code === c.param.code)?.bands ?? [];
    const found = findCatalogBand(c.band, bands);
    if (found) {
      matched.set(`${c.testKey}#${c.param.system}|${c.param.code}`, found);
    } else {
      errors.push({
        fieldId: c.fieldId,
        label: c.label,
        reason: `The reference ranges for ${c.param.code} on ${c.testKey.slice(c.testKey.lastIndexOf('|') + 1)} changed. Reopen the test and pick a range again.`,
      });
    }
  }
  return { errors, matched };
}

/** Id of the seeded ingest graph's Persist Store node — the one that reports what it wrote. */
const PERSIST_NODE_ID = 'persist-1';

/**
 * How many resources this run actually stored, per the Persist Store node's own metadata.
 *
 * Read defensively: the graph is operator-editable, so the node may be renamed, removed, or never
 * reached. Every one of those means "we cannot prove anything was stored", which must read as 0 —
 * the conservative answer, since the advice keyed off this number is whether a clerk may safely
 * resubmit. This runs on the ALREADY-FAILING path, so it must not add a failure of its own.
 */
function persistedCount(nodeMeta: Record<string, unknown> | undefined): number {
  const meta = nodeMeta?.[PERSIST_NODE_ID];
  if (typeof meta !== 'object' || meta === null) return 0;
  const n = (meta as { persisted?: unknown }).persisted;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

// These routes were previously UNGATED (no requireRole at all — any authenticated user could hit
// them). Task 8 adds capability gates per the mapping table: read/fill routes require forms.view
// (held by every system-role preset, including lab_technician — so no preset loses access);
// create/edit/delete/export routes require forms.edit; publish-adjacent routes require
// forms.publish. NOTE: POST /:id/status can transition a form to 'published' (and audits as
// 'form.publish' when it does) — it is therefore gated on forms.publish rather than forms.edit,
// even though a plain draft<->archived toggle is arguably a lesser action. This avoids a custom
// role holding forms.edit-without-forms.publish being able to publish via this side door; no
// system-role preset is harmed since every preset that holds forms.edit also holds forms.publish.
//
// SUBMIT (forms.submit) is separate from VIEW on purpose. POST /:id/responses was a read-only
// echo when the gates above were written — it validated, built a QuestionnaireResponse and
// returned it, storing nothing — so gating it on forms.view cost nothing. It now runs the
// submission through the ingest pipeline and WRITES clinical records to fhir_resources and the
// flat read model, and forms.view is held by every preset including system_auditor
// ("Read-only oversight plus the audit log") and data_analyst. Data entry therefore gets its
// own capability; every other forms route keeps the gate it had.
const VIEW = { preHandler: requireCapability('forms.view') };
const SUBMIT = { preHandler: requireCapability('forms.submit') };
const EDIT = { preHandler: requireCapability('forms.edit') };
const PUBLISH = { preHandler: requireCapability('forms.publish') };

/** A `:version` path segment is a positive 32-bit integer or it is a 400, never a cast. */
function parseVersionParam(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) return null;
  return parsed;
}

const formAccessInput = z.object({
  open: z.array(z.string().min(1).max(100)).max(200),
  submit: z.array(z.string().min(1).max(100)).max(200),
});

/** Per-form access (design 2026-11-18-roles-scope, part 1), by the rule the entries routes and the
 *  CLI share (formOpenRule in @openldr/bootstrap): an editor sees every form, anyone else only the
 *  forms their roles may open. */
export function formOpenRules(ctx: Pick<AppContext, 'formAccess'>) {
  const rule = formOpenRule(ctx.formAccess);
  const formUser = (req: FastifyRequest) => ({ roleIds: req.user?.roleIds ?? [], capabilities: req.user?.capabilities ?? [] });
  const isEditor = (req: FastifyRequest) => rule.isEditor(formUser(req));
  const mayOpen = async (req: FastifyRequest, id: string) => rule.mayOpen(formUser(req), id);
  async function openable<T extends { id: string }>(req: FastifyRequest, forms: T[]): Promise<T[]> {
    if (isEditor(req)) return forms;
    const seen = await rule.openable(formUser(req), forms.map((f) => f.id));
    return forms.filter((f) => seen.has(f.id));
  }
  return { formUser, isEditor, mayOpen, openable };
}

export function registerFormsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const { formUser, isEditor, mayOpen, openable } = formOpenRules(ctx);

  // A form that drives an app page (Users, Facility) is left out of the Forms list for anyone who
  // cannot edit forms; its page loads it through /published?targetPage= (design 2026-11-22-form-entries
  // 5.6). Same rule as the studio's isStandalone: no target page, or the generic 'forms' page.
  app.get('/api/forms', VIEW, async (req) => {
    const forms = await openable(req, await ctx.forms.list());
    return isEditor(req) ? forms : forms.filter((f) => !drivesAppPage(f.targetPages));
  });

  app.get('/api/forms/published', VIEW, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return openable(req, await ctx.forms.listPublished(query.targetPage || undefined));
  });

  // Who may open and submit this form. Empty lists: every role with the permission.
  app.get('/api/forms/:id/access', EDIT, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) { reply.code(404); return { error: 'not found' }; }
    // The role names come with the lists, so an editor without roles.view (Lab Manager) can pick
    // roles in the Access sheet (Codex FR2). Names and slugs only, no capabilities.
    const roles = (await ctx.roles.list()).map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
    return { ...(await ctx.formAccessStore.get(id)), roles };
  });

  app.put('/api/forms/:id/access', EDIT, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const p = formAccessInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    let changed;
    try {
      changed = await setFormAccess({ access: ctx.formAccessStore, forms: ctx.forms, roles: ctx.roles }, id, p.data);
    } catch (err) {
      if (!(err instanceof FormAccessError)) throw err;
      reply.code(err.reason === 'no-form' ? 404 : 400);
      return { error: err.reason === 'no-form' ? 'not found' : err.message };
    }
    const { before, after } = changed;
    await recordAudit(ctx, req, { action: 'form.access.set', entityType: 'form', entityId: id, before, after });
    return after;
  });

  // Starter packs: read-only seeded data for the builder (spec S5). Static segments, so find-my-way
  // matches them before `GET /api/forms/:id`, as it does `/api/forms/published`.
  app.get('/api/forms/starter-packs', VIEW, async (req, reply) => {
    const resourceType = (req.query as { resourceType?: string }).resourceType?.trim();
    if (!resourceType) {
      reply.code(400);
      return { error: 'resourceType is required' };
    }
    return ctx.starterPacks.listForResource(resourceType);
  });

  app.get('/api/forms/starter-packs/:id', VIEW, async (req, reply) => {
    const pack = await ctx.starterPacks.get((req.params as { id: string }).id);
    if (!pack) {
      reply.code(404);
      return { error: 'not found' };
    }
    return pack;
  });

  app.get('/api/forms/:id', VIEW, async (req, reply) => {
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f || !(await mayOpen(req, f.id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    return f;
  });

  app.post('/api/forms', EDIT, async (req, reply) => {
    const p = FormCreateInputSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    try {
      const f = await ctx.forms.create(p.data as never);
      await recordAudit(ctx, req, { action: 'form.create', entityType: 'form', entityId: f.id, before: null, after: f });
      reply.code(201);
      return f;
    } catch (e) {
      reply.code(409);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.put('/api/forms/:id', EDIT, async (req, reply) => {
    const p = FormCreateInputSchema.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    const after = await ctx.forms.update(id, p.data as never);
    await recordAudit(ctx, req, { action: 'form.update', entityType: 'form', entityId: id, before, after });
    return after;
  });

  app.post('/api/forms/:id/status', PUBLISH, async (req, reply) => {
    const status = (req.body as { status?: string }).status;
    if (status !== 'draft' && status !== 'published' && status !== 'archived') {
      reply.code(400);
      return { error: 'status must be draft|published|archived' };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    const after = await ctx.forms.setStatus(id, status);
    await recordAudit(ctx, req, { action: status === 'published' ? 'form.publish' : 'form.status', entityType: 'form', entityId: id, before, after });
    return after;
  });

  app.post('/api/forms/:id/publish', PUBLISH, async (req, reply) => {
    const p = publishInput.safeParse(req.body ?? {});
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    const after = await ctx.forms.publish(id, { versionLabel: p.data.versionLabel ?? null, actorId: req.user?.id ?? null });
    await recordAudit(ctx, req, { action: 'form.publish', entityType: 'form', entityId: id, before, after });
    return after;
  });

  app.post('/api/forms/:id/duplicate', EDIT, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const copy = await ctx.forms.duplicate(id);
    await recordAudit(ctx, req, { action: 'form.duplicate', entityType: 'form', entityId: copy.id, before: null, after: copy, metadata: { sourceFormId: id } });
    reply.code(201);
    return copy;
  });

  app.get('/api/forms/:id/versions', VIEW, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ctx.forms.get(id)) || !(await mayOpen(req, id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    return ctx.forms.listVersions(id);
  });

  app.get('/api/forms/:id/versions/:version', VIEW, async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    const parsedVersion = parseVersionParam(version);
    if (parsedVersion === null) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    if (!(await ctx.forms.get(id)) || !(await mayOpen(req, id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    const snapshot = await ctx.forms.getVersion(id, parsedVersion);
    if (!snapshot) {
      reply.code(404);
      return { error: 'not found' };
    }
    return snapshot;
  });

  // EDIT, not PUBLISH. Restore writes a draft; it releases nothing. The operator publishes
  // afterwards through the normal gate if they want the restored content live.
  app.post('/api/forms/:id/restore/:version', EDIT, async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    const parsedVersion = parseVersionParam(version);
    if (parsedVersion === null) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    if (!(await ctx.forms.getVersion(id, parsedVersion))) {
      reply.code(404);
      return { error: 'version not found' };
    }
    const after = await ctx.forms.restore(id, parsedVersion);
    await recordAudit(ctx, req, {
      action: 'form.restore', entityType: 'form', entityId: id,
      before, after, metadata: { sourceVersion: parsedVersion },
    });
    return after;
  });

  app.delete('/api/forms/:id', EDIT, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    await ctx.forms.delete(id);
    await recordAudit(ctx, req, { action: 'form.delete', entityType: 'form', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });

  app.get('/api/forms/:id/questionnaire', VIEW, async (req, reply) => {
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f || !(await mayOpen(req, f.id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      return toQuestionnaire(f.schema);
    } catch (e) {
      reply.code(500);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.get('/api/forms/:id/export-bundle', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const form = await ctx.forms.get(id);
    if (!form) {
      reply.code(404);
      return { error: 'form not found' };
    }
    const versions = await ctx.forms.listVersions(id);
    if (!versions.length) {
      reply.code(404);
      return { error: 'form has no published version to export' };
    }
    const latest = await ctx.forms.getVersion(id, versions[0].version);
    if (!latest) {
      reply.code(404);
      return { error: 'published version not found' };
    }

    const questionnaireBytes = Buffer.from(JSON.stringify(latest.questionnaire, null, 2), 'utf8');
    const questionnaireSha256 = createHash('sha256').update(questionnaireBytes).digest('hex');
    const artifactId = slug(form.name);
    // The artifact manifest requires strict semver; form versionLabel is free-form
    // (e.g. 'v1'), so fall back to '1.0.0' when it isn't already valid semver.
    const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
    const version = form.versionLabel && SEMVER.test(form.versionLabel) ? form.versionLabel : '1.0.0';
    const manifest = {
      schemaVersion: 1,
      type: 'form-template',
      id: artifactId,
      version,
      description: form.name,
      license: 'UNLICENSED',
      compatibility: { ceVersion: '*' },
      capabilities: [],
      payload: { kind: 'form-template', questionnaireSha256 },
    };

    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    zip.addFile('questionnaire.json', questionnaireBytes);
    const buf = zip.toBuffer();

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${artifactId}-${version}.zip"`);
    return reply.send(buf);
  });

  /** The lab's time zone for the repeat message, or undefined when none is set or it cannot be read. */
  const labTimeZone = async (): Promise<string | undefined> => {
    try {
      return (await ctx.labIdentity?.tokens())?.['lab.timezone'] || undefined;
    } catch {
      return undefined;
    }
  };

  app.post('/api/forms/:id/responses', SUBMIT, async (req, reply) => {
    const formId = (req.params as { id: string }).id;
    // No editor bypass here: seeing every form in the builder does not mean submitting to it (Codex FR1).
    if (!(await ctx.formAccess.maySubmit(formUser(req), formId))) {
      reply.code(403);
      return { error: 'you may not submit this form' };
    }
    const p = responseInput.safeParse(req.body);
    if (!p.success) {
      reply.code(400);
      return { error: p.error.message };
    }
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f) {
      reply.code(404);
      return { error: 'not found' };
    }

    // Validation runs here and nowhere else on this path: `validateAnswers` is pure and
    // catches shape/required/options; `validateReferences` does the I/O-bound existence
    // checks. Before this, the route validated nothing at all.
    const shapeErrors = validateAnswers(f.schema as never, p.data.answers as never);
    if (shapeErrors.length > 0) {
      reply.code(400);
      return { error: 'invalid answers', errors: shapeErrors };
    }

    const referenceErrors = await validateReferences(f.schema as never, p.data.answers as never, {
      validateCode: (input) => ctx.terminology.ops.validateCode(input),
      exists: (resourceType, id) => ctx.fhirStore.exists(resourceType, id),
      // A field bound to `cs-url-LOINC` must accept an answer carrying `http://loinc.org`.
      resolveSystem: makeCodingSystemResolver(ctx),
    });
    if (referenceErrors.length > 0) {
      reply.code(400);
      return { error: 'invalid answers', errors: referenceErrors };
    }

    const { errors: bandErrors, matched: matchedBands } = await checkTestBands(ctx, f.schema, p.data.answers);
    if (bandErrors.length > 0) {
      reply.code(400);
      return { error: 'invalid answers', errors: bandErrors };
    }

    // Manual capture goes through the SAME pipeline as automated ingest, down the FHIR
    // branch: the form branch is hardcoded to one formId and cannot serve multiple
    // capture forms. toTransactionBundle puts the QuestionnaireResponse at entry[0], so
    // the verbatim record of what was typed is persisted alongside what was derived.
    const actor = req.user?.username ?? 'unknown';
    const submittedAt = new Date().toISOString();
    const response = toQuestionnaireResponse(f.schema, p.data.answers as never) as unknown as Record<string, unknown>;
    response.author = { display: actor };

    const questionnaire = toQuestionnaire(f.schema);
    const extractionContext = extractionContextFor(f.schema, p.data.answers, submittedAt);
    const codingBefore = await catalogCodingsBefore(ctx, f.schema, p.data.answers);
    if (codingBefore) extractionContext.codingBefore = codingBefore;
    if (matchedBands.size > 0) extractionContext.testBands = matchedBands;
    // Each test's order gets its fixed id from the picked facility's code (null when none was
    // picked), the requisition number and the test (lab slices 1b and 2, ruling 1), and each test's
    // results point at it. With no number there is no fixed id and linkToOrder mints one.
    const requisition = entryKeyOf(f.schema, p.data.answers);
    if (requisition) {
      const facilityCode = entryFacilitiesOf(f.schema, p.data.answers).order?.facility?.code ?? null;
      extractionContext.orderIdFor = (test) => labOrderId(facilityCode, requisition, test);
    }
    const extracted = extractorsForForm(f.schema as never).flatMap((ex) => ex.extract(response as never, questionnaire as never, extractionContext));
    const orderIds = requisition
      ? extracted.flatMap((r) => (r.resourceType === 'ServiceRequest' && r.id ? [r.id] : []))
      : [];
    // Point every other Observation and Specimen at the orders (2026-10-11 spec, part 1), so
    // lab_results.request_id fills and reports can join a result to its order.
    const resources = linkToOrder(extracted, randomUUID);
    if (resources.length === 0) {
      // A form that produces nothing is a form-configuration bug, so 400 is correct — but the
      // operator has to be able to read a diagnosis out of it. The commonest cause by far is a
      // form bound to a resource type no extractor covers: only Observation (fields flagged
      // observationExtract with a code) and ServiceRequest (the requisition domain) extract
      // today, so the seeded Patient- and Location-bound capture forms land here. Naming the
      // resource type says which extractor is missing instead of posing a riddle.
      const boundType = f.schema.fhirResourceType ?? f.fhirResourceType;
      reply.code(400);
      return {
        error: boundType
          ? boundType === 'Observation'
            ? `form produced no resources: no field on the form is flagged for Observation extraction. ` +
              'Flag at least one field with observationExtract: true and a LOINC code so ObservationExtractor can produce resources.'
            : `form produced no resources: no extractor exists for fhirResourceType '${boundType}'. ` +
              'Only Observation (fields flagged observationExtract with a code) and ServiceRequest ' +
              'are extractable; bind the form to one of those or flag its fields for Observation extraction.'
          : 'form produced no resources: the form declares no fhirResourceType and no field is flagged ' +
            'observationExtract with a code, so no extractor applies.',
        errors: [],
      };
    }

    // Every record gets its id here, so the entry can name what this save stored. Unwrap Bundle
    // keeps an id that is set and mints one only where there is none, so the ids are the same ones
    // it would have stored.
    if (typeof response.id !== 'string' || !response.id) response.id = randomUUID();
    const withIds = resources.map((r) => (typeof r.id === 'string' && r.id ? r : { ...r, id: randomUUID() }));
    const responseId = response.id as string;
    const records = withIds.map((r) => ({ resourceType: r.resourceType, id: r.id as string }));

    // The entry row is written before the save, outside any transaction, so a repeated requisition
    // number is refused before anything is stored (design 2026-11-22-form-entries, 5.1).
    let entry: FormEntry;
    try {
      entry = await ctx.formEntries.begin({
        form: { id: f.id, schema: f.schema },
        answers: p.data.answers,
        user: {
          id: req.user?.id ?? actor,
          name: req.user?.displayName || actor,
          // The dev-bypass and admin users carry EVERYTHING; a missing limit is no limit, as on dashboards.
          dataScope: req.user?.dataScope ?? EVERYTHING,
        },
        orderIds,
      });
    } catch (err) {
      if (err instanceof EntrySiteError) {
        reply.code(403);
        return { error: err.message };
      }
      if (err instanceof OrderExists) {
        reply.code(409);
        return { error: err.message };
      }
      if (err instanceof FormEntryRepeat) {
        const held = err.existing;
        reply.code(409);
        return {
          error: 'entry-repeat',
          message: repeatMessage(held, await labTimeZone()),
          entry: { id: held.id, entryKey: held.entryKey, enteredAt: held.enteredAt, enteredByName: held.enteredByName },
        };
      }
      throw err;
    }

    // Settle the entry once the save is done. A completed save stored every record. A failed one
    // stored only those the FHIR store now holds; `persisted` is the run's own count, which says
    // something was stored even if none of these ids is found. A failure here never changes the
    // answer: the row stays active with no saved records, and the log says so.
    const savedOf = (found: { resourceType: string; id: string }[], qr: boolean): FormEntrySaved =>
      ({ responseId: qr ? responseId : null, resources: found });
    const settle = async (ok: boolean, persisted: number): Promise<void> => {
      try {
        if (ok) {
          await ctx.formEntries.finish(entry.id, { ok: true, stored: savedOf(records, true) });
          return;
        }
        let qr = false;
        const found: { resourceType: string; id: string }[] = [];
        try {
          qr = await ctx.fhirStore.exists('QuestionnaireResponse', responseId);
          for (const r of records) if (await ctx.fhirStore.exists(r.resourceType, r.id)) found.push(r);
        } catch (err) {
          // The store is often down for the same reason the save failed. Not knowing what landed,
          // keep the number held: the row becomes incomplete with no records named.
          req.log.error({ err, entryId: entry.id }, 'could not look up what a failed save stored');
          await ctx.formEntries.finish(entry.id, { ok: false, stored: savedOf([], false), somethingStored: true });
          return;
        }
        await ctx.formEntries.finish(entry.id, {
          ok: false, stored: savedOf(found, qr), somethingStored: persisted > 0 || qr || found.length > 0,
        });
      } catch (err) {
        req.log.error({ err, entryId: entry.id }, 'form entry could not be settled after the save');
      }
    };

    const bundle = toTransactionBundle(response as never, withIds);
    let outcome: Awaited<ReturnType<typeof ctx.workflows.runner.runAndRecord>>;
    try {
      outcome = await ctx.workflows.runner.runAndRecord(
        'wf-ingest',
        'form',
        { method: 'POST', body: bundle, headers: {}, query: {}, __provenance: { sourceSystem: 'form-capture' } },
      );
    } catch (err) {
      // A run-store insert failure throws after the run, so records may exist. Look before freeing the number.
      await settle(false, 0);
      throw err;
    }

    if (!outcome) {
      // runAndRecord returns null when the workflow is missing or disabled: nothing ran.
      await settle(false, 0);
      reply.code(409);
      return { ok: false, error: "capture pipeline unavailable: the 'wf-ingest' workflow is missing or disabled" };
    }
    if (outcome.status !== 'completed') {
      // A failed run does NOT mean nothing was stored. `persist-1` runs before `log-1`, so a
      // failure in the Log node or in the `data.persisted` publish lands here with the resources
      // already written. Telling the clerk only "failed" makes them resubmit. An order with a
      // requisition number has fixed ServiceRequest ids (`order-ids.ts`), so a retry updates those,
      // but the form copy, the results and the Specimen get fresh ids each time (`linkToOrder`,
      // `unwrapBundle`), so the retry writes a SECOND copy of each for the same clinical event.
      // The run's own metadata already knows; say what actually landed.
      //
      // NOT covered here: a run-store insert failure. `deps.runs.record(run)` throws INSIDE
      // runAndRecord, before it builds and returns the outcome object, so `runAndRecord` itself
      // throws, the catch around that call only settles the form entry and rethrows, and the request falls through to
      // the generic error handler — a plain 500 with the raw error, no clerk-facing advice.
      const persisted = persistedCount(outcome.nodeMeta);
      await settle(false, persisted);
      // The clerk-facing sentence. The "already stored" case has real evidence and tells the
      // clerk not to resubmit. The zero case is absence of evidence, not evidence of absence —
      // persist-1 may never have been reached, may have been renamed/removed from the graph, or
      // may have persisted moments after this metadata was captured — so it must not assert the
      // retry is safe. It tells the clerk to check the run instead.
      const message = persisted > 0
        ? `${persisted} resource(s) were stored before this submission failed. Do NOT resubmit. The orders keep their ids, but resubmitting would store a second copy of the form and its results. Quote run ${outcome.runId} when reporting this.`
        : `No stored records were reported for this run. Check run ${outcome.runId} before resubmitting.`;
      // redact, never verbatim: a Persist Store or DB-node failure can carry a connection
      // string, and `redact` masks DSN userinfo, `password=` and Authorization tokens.
      const detail = redact(outcome.error ?? '');
      reply.code(500);
      return {
        ok: false,
        runId: outcome.runId,
        correlationId: outcome.correlationId,
        status: outcome.status,
        persisted,
        message,
        // `message` LEADS `error`, deliberately. The studio's shared error handler surfaces
        // `body.error` (see errorDetail in apps/studio/src/api.ts) and never reads `message`, so
        // a clerk-facing sentence that lived only in `message` would never reach the clerk. The
        // technical detail still follows, for the operator reading the response or the log.
        error: detail ? `${message} (${detail})` : message,
      };
    }

    if (outcome.held) {
      // The run completed, but Map to FHIR held the submission back (the default Ingest sends held
      // items to a Log since 2026-11-20). Not submitted: say so, with the reasons.
      const persisted = persistedCount(outcome.nodeMeta);
      await settle(false, persisted);
      const stored = persisted > 0
        ? ` ${persisted} resource(s) were stored. Do NOT resubmit the whole form; quote run ${outcome.runId}.`
        : ` Fix it and submit again.`;
      reply.code(422);
      return {
        ok: false, runId: outcome.runId, correlationId: outcome.correlationId, status: outcome.status,
        held: outcome.held.count, heldReasons: outcome.held.reasons, persisted,
        error: `This submission was held back and not stored: ${outcome.held.reasons.join('; ')}.${stored}`,
      };
    }

    await settle(true, 0);
    await recordAudit(ctx, req, {
      action: 'form.response.submit', entityType: 'form', entityId: f.id,
      before: null, after: response, metadata: { formId: f.id, runId: outcome.runId },
    });
    reply.code(201);
    return {
      ok: true,
      runId: outcome.runId,
      correlationId: outcome.correlationId,
      resourceTypes: resources.map((r) => (r as { resourceType: string }).resourceType),
      entryId: entry.id,
    };
  });
}
