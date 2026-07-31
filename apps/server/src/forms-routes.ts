import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import AdmZip from 'adm-zip';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import type { ExtractionContext, FormSchema } from '@openldr/forms';
import { extractorsForForm, isEntityAnswer, toQuestionnaire, toQuestionnaireResponse, toTransactionBundle, validateAnswers, validateReferences } from '@openldr/forms';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';
import { makeCodingSystemResolver } from './coding-system-url';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';
}

const formInput = z.object({
  name: z.string().min(1),
  versionLabel: z.string().nullish(),
  fhirResourceType: z.string().nullish(),
  fhirVersion: z.string().nullish(),
  fhirProfileUrl: z.string().nullish(),
  facilityId: z.string().nullish(),
  status: z.string().optional(),
  active: z.boolean().optional(),
  schema: z.unknown(),
  targetPages: z.array(z.string()).nullish(),
});

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

export function registerFormsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/forms', VIEW, async () => ctx.forms.list());

  app.get('/api/forms/published', VIEW, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return ctx.forms.listPublished(query.targetPage || undefined);
  });

  app.get('/api/forms/:id', VIEW, async (req, reply) => {
    const f = await ctx.forms.get((req.params as { id: string }).id);
    if (!f) {
      reply.code(404);
      return { error: 'not found' };
    }
    return f;
  });

  app.post('/api/forms', EDIT, async (req, reply) => {
    const p = formInput.safeParse(req.body);
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
    const p = formInput.safeParse(req.body);
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
    if (!(await ctx.forms.get(id))) {
      reply.code(404);
      return { error: 'not found' };
    }
    return ctx.forms.listVersions(id);
  });

  app.get('/api/forms/:id/versions/:version', VIEW, async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    if (!/^[1-9]\d*$/.test(version)) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    const parsedVersion = Number(version);
    if (!Number.isSafeInteger(parsedVersion) || parsedVersion > 2147483647) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    if (!(await ctx.forms.get(id))) {
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
    if (!f) {
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

  app.post('/api/forms/:id/responses', SUBMIT, async (req, reply) => {
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
    const resources = extractorsForForm(f.schema as never)
      .flatMap((ex) => ex.extract(response as never, questionnaire as never, extractionContext));
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

    const bundle = toTransactionBundle(response as never, resources);
    const outcome = await ctx.workflows.runner.runAndRecord(
      'wf-ingest',
      'form',
      { method: 'POST', body: bundle, headers: {}, query: {}, __provenance: { sourceSystem: 'form-capture' } },
    );

    if (!outcome) {
      // runAndRecord returns null when the workflow is missing or disabled: nothing ran.
      reply.code(409);
      return { ok: false, error: "capture pipeline unavailable: the 'wf-ingest' workflow is missing or disabled" };
    }
    if (outcome.status !== 'completed') {
      reply.code(500);
      // redact, never verbatim: a Persist Store or DB-node failure can carry a connection
      // string, and `redact` masks DSN userinfo, `password=` and Authorization tokens.
      return { ok: false, runId: outcome.runId, correlationId: outcome.correlationId, status: outcome.status, error: redact(outcome.error ?? '') };
    }

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
    };
  });
}
