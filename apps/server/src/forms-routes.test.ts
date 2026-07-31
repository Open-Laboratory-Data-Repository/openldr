import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import AdmZip from 'adm-zip';
import type { AppContext } from '@openldr/bootstrap';
import type { FormDefinition, FormInput, FormVersion, FormVersionSummary } from '@openldr/forms';
import { registerFormsRoutes } from './forms-routes';
import './auth-plugin';

// forms.submit joined this list when POST /:id/responses stopped being a read-only echo and
// started writing clinical records (see the SUBMIT gate in forms-routes.ts). These helpers exist
// to give pre-existing BEHAVIOURAL tests every forms capability; the RBAC coverage for the split
// itself is the dedicated 'capability gates' cases below.
const ALL_FORMS_CAPS = ['forms.view', 'forms.submit', 'forms.edit', 'forms.publish'];

function appWithForms(ctx: Record<string, unknown>, roles: string[] = ['lab_admin'], capabilities: string[] = ALL_FORMS_CAPS) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles, capabilities } as never;
  });
  registerFormsRoutes(app, ctx as never);
  return app;
}

/** Forms routes were previously ungated; tests below drive them directly without appWithForms.
 *  authedApp grants every forms.* capability so pre-existing behavioral coverage (not RBAC
 *  coverage) is unaffected by the new gates. */
function authedApp(ctx: AppContext, capabilities: string[] = ALL_FORMS_CAPS) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities } as never;
  });
  registerFormsRoutes(app, ctx);
  return app;
}

type AuditInput = Parameters<AppContext['audit']['record']>[0];

const NOW = '2026-01-01T00:00:00.000Z';

// Bound to ServiceRequest (→ the 'requisition' domain → ServiceRequestExtractor) so its
// /responses submissions clear the route's "produced no resources" guard. It previously carried
// `observationExtract: true` with an invented LOINC code 'patient-id', which modelled a patient
// identifier as an Observation — clinically wrong, and it pinned that wrong modelling as this
// route's expected output. Its `patientId` is plain text (no ServiceRequest.subject binding), so
// this fixture is also the case that proves the route falls back to the extractor's
// 'Unknown subject' rather than fabricating a Reference.
const sampleSchema = {
  id: 'specimen-intake',
  name: 'Specimen intake',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: 'ServiceRequest',
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'patientId',
      fhirPath: null,
      displayLabel: 'Patient ID',
      description: null,
      fieldType: 'text' as const,
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 1, max: '1' },
      section: 'main',
    },
  ],
  sections: [{ id: 'main', label: 'Main', order: 0 }],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft' as const,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies FormInput['schema'];

// A minimal schema with one coding-bound field (ValueSet), used to exercise the
// `validateCode` dependency closure independently of the entity/`exists` path above.
const codingSchema = {
  id: 'organism-report',
  name: 'Organism report',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'organism',
      fhirPath: null,
      displayLabel: 'Organism',
      description: null,
      fieldType: 'organism' as const,
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 1, max: '1' },
      section: 'main',
      valueSetUrl: 'http://example.org/fhir/ValueSet/organisms',
    },
  ],
  sections: [{ id: 'main', label: 'Main', order: 0 }],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft' as const,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies FormInput['schema'];

// A minimal schema with one required reference field, used to exercise the submit-time
// reference-validation path (Task 9) independently of sampleSchema's plain text field.
//
// It is bound to ServiceRequest (→ the 'requisition' domain → ServiceRequestExtractor), which is
// the shape a realistic capture form actually takes: a patient picker bound to
// ServiceRequest.subject. It previously carried `observationExtract: true` plus an invented
// LOINC code 'lab-order-patient' purely to satisfy the route's "produced no resources" guard —
// that modelled a patient identifier as an Observation, which is clinically wrong and pinned
// that wrong modelling as expected output.
const referenceSchema = {
  id: 'lab-order',
  name: 'Lab order',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: 'ServiceRequest',
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'patient',
      fhirPath: 'ServiceRequest.subject',
      displayLabel: 'Patient',
      description: null,
      fieldType: 'reference' as const,
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 1, max: '1' },
      section: 'main',
      referenceTarget: 'Patient',
    },
  ],
  sections: [{ id: 'main', label: 'Main', order: 0 }],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft' as const,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies FormInput['schema'];

// Task 9: fakeCtx() previously provided no fhirStore/terminology stubs because nothing
// needed them — the second validator wired into POST /responses (`validateReferences`)
// was never actually exercised. These record what they were called with (not merely
// that they were called) so a test can prove argument order, catching e.g. a swapped
// `exists(resourceType, id)` call site that no type checker would flag (both params
// are `string`).
interface FakeFhirStoreCall { resourceType: string; id: string }
interface FakeValidateCodeCall { valueSetUrl?: string; system?: string; code: string }

// Fix 4: the two seeded entity capture forms (form-sample-patient → Patient, form-sample-facility
// → Location) are published to the Forms page but have no extractor — there is no
// PatientExtractor/LocationExtractor in packages/forms/src/extract, and writing one is deferred
// S5 work. `extractorsForForm` gives them only ObservationExtractor and they carry no
// observationExtract field, so they yield zero resources. The 400 is CORRECT behaviour (a form
// that produces nothing is a form-configuration bug); this fixture pins that the message names
// the resource type so an operator reads a diagnosis rather than a riddle.
const patientBoundSchema = {
  id: 'patient-intake',
  name: 'Patient intake',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: 'Patient',
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'familyName',
      fhirPath: 'Patient.name.family',
      displayLabel: 'Family name',
      description: null,
      fieldType: 'text' as const,
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 1, max: '1' },
      section: 'main',
    },
  ],
  sections: [{ id: 'main', label: 'Main', order: 0 }],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft' as const,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies FormInput['schema'];

function fakeCtx(): AppContext & {
  audits: AuditInput[];
  fhirStoreCalls: FakeFhirStoreCall[];
  fhirStoreExists: { value: boolean };
  validateCodeCalls: FakeValidateCodeCall[];
  validateCodeResult: { value: { result: boolean; message: string } };
} {
  const forms: FormDefinition[] = [];
  const versions = new Map<string, FormVersion[]>();
  const audits: AuditInput[] = [];
  const fhirStoreCalls: FakeFhirStoreCall[] = [];
  const fhirStoreExists = { value: true };
  const validateCodeCalls: FakeValidateCodeCall[] = [];
  const validateCodeResult = { value: { result: true, message: '' } };
  let seq = 0;
  const now = '2026-01-01T00:00:00.000Z';

  return {
    logger: {
      error: () => {},
    },
    forms: {
      create: async (input: FormInput) => {
        const form: FormDefinition = {
          id: `form-${++seq}`,
          name: input.name,
          versionLabel: input.versionLabel ?? null,
          fhirResourceType: input.fhirResourceType ?? null,
          fhirVersion: input.fhirVersion ?? null,
          fhirProfileUrl: input.fhirProfileUrl ?? null,
          facilityId: input.facilityId ?? null,
          status: input.status ?? 'draft',
          active: input.active ?? true,
          schema: input.schema,
          targetPages: input.targetPages ?? null,
          createdAt: now,
          updatedAt: now,
        };
        forms.push(form);
        return form;
      },
      list: async () =>
        forms.map((form) => ({
          id: form.id,
          name: form.name,
          versionLabel: form.versionLabel,
          status: form.status,
          active: form.active,
          fhirResourceType: form.fhirResourceType,
          fhirVersion: form.fhirVersion,
          fhirProfileUrl: form.fhirProfileUrl,
          facilityId: form.facilityId,
          fieldCount: form.schema.fields.length,
          updatedAt: form.updatedAt,
        })),
      listPublished: async (targetPage?: string) =>
        forms
          .filter((form) => form.status === 'published' && form.active && (!targetPage || form.targetPages?.includes(targetPage)))
          .map((form) => ({
            id: form.id,
            name: form.name,
            versionLabel: form.versionLabel,
            status: form.status,
            active: form.active,
            fhirResourceType: form.fhirResourceType,
            fhirVersion: form.fhirVersion,
            fhirProfileUrl: form.fhirProfileUrl,
            facilityId: form.facilityId,
            fieldCount: form.schema.fields.length,
            updatedAt: form.updatedAt,
          })),
      get: async (id: string) => forms.find((form) => form.id === id) ?? null,
      update: async (id: string, input: FormInput) => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        Object.assign(form, {
          name: input.name,
          versionLabel: input.versionLabel ?? null,
          fhirResourceType: input.fhirResourceType ?? null,
          fhirVersion: input.fhirVersion ?? null,
          fhirProfileUrl: input.fhirProfileUrl ?? null,
          facilityId: input.facilityId ?? null,
          schema: input.schema,
          targetPages: input.targetPages ?? null,
        });
        return form;
      },
      setStatus: async (id: string, status: 'draft' | 'published' | 'archived') => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        form.status = status;
        return form;
      },
      publish: async (id: string, input?: { versionLabel?: string | null }) => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        const existing = versions.get(id) ?? [];
        const version = existing.length + 1;
        form.status = 'published';
        form.versionLabel = input?.versionLabel ?? null;
        const snapshot: FormVersion = {
          id: `fv-${version}`,
          formId: id,
          version,
          versionLabel: form.versionLabel,
          name: form.name,
          fhirResourceType: form.fhirResourceType,
          fhirVersion: form.fhirVersion,
          fhirProfileUrl: form.fhirProfileUrl,
          facilityId: form.facilityId,
          schema: form.schema,
          targetPages: form.targetPages,
          questionnaire: {},
          publishedAt: now,
          publishedBy: null,
        };
        versions.set(id, [...existing, snapshot]);
        return form;
      },
      duplicate: async (id: string) => {
        const source = forms.find((item) => item.id === id);
        if (!source) throw new Error('not found');
        const copy: FormDefinition = {
          ...source,
          id: `form-${++seq}`,
          name: `${source.name} copy`,
          status: 'draft',
          versionLabel: null,
          createdAt: now,
          updatedAt: now,
        };
        forms.push(copy);
        return copy;
      },
      listVersions: async (id: string): Promise<FormVersionSummary[]> =>
        (versions.get(id) ?? []).map(({ id: versionId, formId, version, versionLabel, name, fhirResourceType, fhirVersion, fhirProfileUrl, facilityId, targetPages, publishedAt, publishedBy }) => ({
          id: versionId,
          formId,
          version,
          versionLabel,
          name,
          fhirResourceType,
          fhirVersion,
          fhirProfileUrl,
          facilityId,
          targetPages,
          publishedAt,
          publishedBy,
        })),
      getVersion: async (id: string, version: number) => versions.get(id)?.find((item) => item.version === version) ?? null,
      delete: async (id: string) => {
        const index = forms.findIndex((item) => item.id === id);
        if (index >= 0) forms.splice(index, 1);
      },
    },
    audit: {
      record: async (input: AuditInput) => {
        audits.push(input);
        return { ...input, id: `audit-${audits.length}`, occurredAt: now };
      },
      list: async () => [],
      count: async () => 0,
      get: async () => undefined,
    },
    fhirStore: {
      exists: async (resourceType: string, id: string) => {
        fhirStoreCalls.push({ resourceType, id });
        return fhirStoreExists.value;
      },
    },
    terminology: {
      ops: {
        validateCode: async (input: FakeValidateCodeCall) => {
          validateCodeCalls.push(input);
          return validateCodeResult.value;
        },
      },
    },
    // Task S2-T2: POST /:id/responses now routes accepted submissions through
    // ctx.workflows.runner.runAndRecord. Every pre-existing test in this file that posts a
    // valid submission needs a stub here or it crashes on `ctx.workflows` being undefined;
    // tests that care about the outcome override `(ctx as any).workflows` themselves.
    workflows: {
      runner: {
        runAndRecord: async () => ({ runId: 'run-default', correlationId: null, status: 'completed', error: null }),
      },
    },
    audits,
    fhirStoreCalls,
    fhirStoreExists,
    validateCodeCalls,
    validateCodeResult,
  } as unknown as AppContext & {
    audits: AuditInput[];
    fhirStoreCalls: FakeFhirStoreCall[];
    fhirStoreExists: { value: boolean };
    validateCodeCalls: FakeValidateCodeCall[];
    validateCodeResult: { value: { result: boolean; message: string } };
  };
}

describe('forms routes', () => {
  it('creates, lists, publishes, exports questionnaires, and validates responses', async () => {
    const app = authedApp(fakeCtx());

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: {
        name: 'Specimen intake',
        versionLabel: 'v1',
        fhirResourceType: 'Questionnaire',
        schema: sampleSchema,
        targetPages: ['forms'],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const list = await app.inject({ method: 'GET', url: '/api/forms' });
    expect(list.json()).toMatchObject([{ id, name: 'Specimen intake', fieldCount: 1 }]);

    const published = await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'published' } });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published' });

    const publishedList = await app.inject({ method: 'GET', url: '/api/forms/published?targetPage=forms' });
    expect(publishedList.json()).toMatchObject([{ id, status: 'published' }]);

    const questionnaire = await app.inject({ method: 'GET', url: `/api/forms/${id}/questionnaire` });
    expect(questionnaire.statusCode).toBe(200);
    expect(questionnaire.json()).toMatchObject({ resourceType: 'Questionnaire', title: 'Specimen intake', item: [{ linkId: 'main' }] });

    // Task S2-T2: POST /responses now persists through the ingest workflow instead of
    // returning the bare QuestionnaireResponse — the response body is the run outcome.
    const response = await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: { patientId: 'P-100' } } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ ok: true, runId: 'run-default', resourceTypes: ['ServiceRequest'] });

    // A required field that is absent must be rejected. This previously returned 201 —
    // the assertion encoded the bug that reference pickers exist to fix.
    const emptyResponse = await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: {} } });
    expect(emptyResponse.statusCode).toBe(400);
    expect(emptyResponse.json().errors).toContainEqual(
      expect.objectContaining({ fieldId: 'patientId', reason: 'required' }),
    );
  });

  it('rejects an unresolved reference answer', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`, payload: { answers: { patient: 'asdf' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(
      expect.objectContaining({ fieldId: 'patient', reason: 'must be selected from the list' }),
    );
  });

  // Task 9 gap: the test above submits a bare string, which `validateAnswers` (the FIRST
  // validator) rejects before `validateReferences` — and its injected `exists`/`validateCode`
  // closures — are ever reached. These three tests submit a well-formed reference/coding
  // answer so the route's second validator, and its dependency wiring, actually run.

  it('rejects a well-formed entity reference answer when the target does not exist', async () => {
    const ctx = fakeCtx();
    ctx.fhirStoreExists.value = false;
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/ghost', display: null } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(
      expect.objectContaining({ fieldId: 'patient', reason: 'Patient/ghost does not exist' }),
    );
  });

  it('calls ctx.fhirStore.exists with (resourceType, id) in that order — not swapped', async () => {
    const ctx = fakeCtx();
    ctx.fhirStoreExists.value = true;
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });
    expect(res.statusCode).toBe(201);
    // Exact, not "was called": the wiring at the route's call site reads
    // `exists: (resourceType, id) => ctx.fhirStore.exists(resourceType, id)`. If those two
    // arguments were ever swapped to `ctx.fhirStore.exists(id, resourceType)`, this fake's
    // `exists(resourceType, id)` would receive 'p1' as its first (resourceType) parameter
    // and 'Patient' as its second (id) parameter, and the recorded call would come out as
    // `{ resourceType: 'p1', id: 'Patient' }` — failing this exact match. Both parameters
    // are plain `string`, so only a behavioral assertion like this one (not the type
    // checker) can catch that swap.
    expect(ctx.fhirStoreCalls).toEqual([{ resourceType: 'Patient', id: 'p1' }]);
  });

  it('validates a coding-bound answer through the injected validateCode dependency', async () => {
    const ctx = fakeCtx();
    ctx.validateCodeResult.value = { result: false, message: 'not a recognized organism code' };
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Organism report', schema: codingSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/forms/${formId}/responses`,
      payload: { answers: { organism: { system: 'http://example.org/fhir/CodeSystem/organisms', code: 'ECOLI', display: null } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toContainEqual(
      expect.objectContaining({ fieldId: 'organism', reason: 'not a recognized organism code' }),
    );
    expect(ctx.validateCodeCalls).toEqual([
      { valueSetUrl: 'http://example.org/fhir/ValueSet/organisms', code: 'ECOLI', system: 'http://example.org/fhir/CodeSystem/organisms' },
    ]);
  });

  it('publishes, duplicates, and returns form versions', async () => {
    const app = authedApp(fakeCtx());

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    const published = await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published', versionLabel: 'v1' });

    const versions = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions` });
    expect(versions.statusCode).toBe(200);
    expect(versions.json()).toMatchObject([{ version: 1, versionLabel: 'v1' }]);

    const version = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ version: 1, schema: sampleSchema });

    const duplicate = await app.inject({ method: 'POST', url: `/api/forms/${id}/duplicate` });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toMatchObject({ status: 'draft' });
  });

  it('rejects malformed form version route params', async () => {
    const app = authedApp(fakeCtx());

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });

    for (const version of ['1abc', '1.5', '0', '2147483648']) {
      const response = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/${version}` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'version must be a positive integer' });
    }
  });

  it('audits published status changes as publish events', async () => {
    const ctx = fakeCtx();
    const app = authedApp(ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    ctx.audits.length = 0;

    const published = await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'published' } });
    expect(published.statusCode).toBe(200);
    expect(ctx.audits.map((event) => event.action)).toEqual(['form.publish']);
    expect(ctx.audits[0]).toMatchObject({ entityId: id });
  });

  it('audits draft and archived status changes as status events', async () => {
    const ctx = fakeCtx();
    const app = authedApp(ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    ctx.audits.length = 0;

    const archived = await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'archived' } });
    expect(archived.statusCode).toBe(200);
    const draft = await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'draft' } });
    expect(draft.statusCode).toBe(200);
    expect(ctx.audits.map((event) => event.action)).toEqual(['form.status', 'form.status']);
  });

  it('records audit events for form lifecycle operations', async () => {
    const ctx = fakeCtx();
    const app = authedApp(ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    await app.inject({
      method: 'PUT',
      url: `/api/forms/${id}`,
      payload: { name: 'Updated intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
    const duplicate = await app.inject({ method: 'POST', url: `/api/forms/${id}/duplicate` });
    const duplicateId = duplicate.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/status`, payload: { status: 'archived' } });
    await app.inject({ method: 'POST', url: `/api/forms/${id}/responses`, payload: { answers: { patientId: 'P-100' } } });
    await app.inject({ method: 'DELETE', url: `/api/forms/${id}` });

    expect(ctx.audits.map((event) => event.action)).toEqual([
      'form.create',
      'form.update',
      'form.publish',
      'form.duplicate',
      'form.status',
      'form.response.submit',
      'form.delete',
    ]);
    expect(ctx.audits.find((event) => event.action === 'form.create')).toMatchObject({ entityId: id, before: null });
    expect(ctx.audits.find((event) => event.action === 'form.create')?.after).toMatchObject({ id });
    expect(ctx.audits.find((event) => event.action === 'form.duplicate')).toMatchObject({
      entityId: duplicateId,
      before: null,
      metadata: { sourceFormId: id },
    });
    expect(ctx.audits.find((event) => event.action === 'form.duplicate')?.after).toMatchObject({ id: duplicateId });
    expect(ctx.audits.find((event) => event.action === 'form.response.submit')).toMatchObject({
      entityId: id,
      before: null,
      metadata: { formId: id },
    });
    expect(ctx.audits.find((event) => event.action === 'form.delete')).toMatchObject({
      entityId: id,
      after: null,
    });
    expect(ctx.audits.find((event) => event.action === 'form.delete')?.before).toMatchObject({ id });
  });

  it('records the real request actor (not System) on form events', async () => {
    const app = Fastify();
    const ctx = fakeCtx();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'u-forms', username: 'former', displayName: null, roles: ['lab_admin'], capabilities: ['forms.edit'] };
    });
    registerFormsRoutes(app, ctx);

    await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });

    const createEvent = ctx.audits.find((e) => e.action === 'form.create');
    expect(createEvent).toBeDefined();
    expect(createEvent).toMatchObject({ actorType: 'user', actorId: 'u-forms', actorName: 'former' });
  });

  it('does not audit missing deletes', async () => {
    const ctx = fakeCtx();
    const app = authedApp(ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    expect(created.statusCode).toBe(201);
    ctx.audits.length = 0;

    const missingDelete = await app.inject({ method: 'DELETE', url: '/api/forms/missing' });
    expect(missingDelete.statusCode).toBe(404);
    expect(missingDelete.json()).toMatchObject({ error: 'not found' });
    expect(ctx.audits).toEqual([]);
  });

  it('returns 404 for missing lifecycle resources', async () => {
    const app = authedApp(fakeCtx());

    const publish = await app.inject({ method: 'POST', url: '/api/forms/missing/publish', payload: { versionLabel: 'v1' } });
    expect(publish.statusCode).toBe(404);

    const duplicate = await app.inject({ method: 'POST', url: '/api/forms/missing/duplicate' });
    expect(duplicate.statusCode).toBe(404);

    const versions = await app.inject({ method: 'GET', url: '/api/forms/missing/versions' });
    expect(versions.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    const snapshot = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
    expect(snapshot.statusCode).toBe(404);
  });

  it('exports a published form as an unsigned form-template bundle zip', async () => {
    const questionnaire = { resourceType: 'Questionnaire', status: 'active', title: 'Intake', item: [] };
    const forms = {
      get: async (id: string) => (id === 'form-1' ? { id, name: 'Specimen Intake', versionLabel: '2.0.0' } : null),
      listVersions: async () => [{ version: 3 }, { version: 2 }],
      getVersion: async (_id: string, v: number) => (v === 3 ? { questionnaire } : null),
    };
    const app = appWithForms({ forms });
    const res = await app.inject({ method: 'GET', url: '/api/forms/form-1/export-bundle' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('zip');
    const zip = new AdmZip(res.rawPayload as Buffer);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual(['manifest.json', 'questionnaire.json']);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(manifest).toMatchObject({ type: 'form-template', id: 'specimen-intake', version: '2.0.0' });
    expect(manifest.payload).toMatchObject({ kind: 'form-template' });
    const qBytes = zip.readFile('questionnaire.json') as Buffer;
    const { createHash } = await import('node:crypto');
    expect(manifest.payload.questionnaireSha256).toBe(createHash('sha256').update(qBytes).digest('hex'));
    expect(manifest.publisher).toBeUndefined();
    expect(manifest.signature).toBeUndefined();
  });

  it('404s when the form has no published version', async () => {
    const forms = { get: async () => ({ id: 'form-2', name: 'Draft', versionLabel: null }), listVersions: async () => [], getVersion: async () => null };
    const app = appWithForms({ forms });
    const res = await app.inject({ method: 'GET', url: '/api/forms/form-2/export-bundle' });
    expect(res.statusCode).toBe(404);
  });

  it('coerces a non-semver versionLabel to 1.0.0 (manifest requires semver)', async () => {
    const questionnaire = { resourceType: 'Questionnaire', status: 'active', title: 'Intake', item: [] };
    const forms = {
      get: async () => ({ id: 'form-3', name: 'Intake', versionLabel: 'v1' }),
      listVersions: async () => [{ version: 1 }],
      getVersion: async () => ({ questionnaire }),
    };
    const app = appWithForms({ forms });
    const res = await app.inject({ method: 'GET', url: '/api/forms/form-3/export-bundle' });
    expect(res.statusCode).toBe(200);
    const zip = new AdmZip(res.rawPayload as Buffer);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(manifest.version).toBe('1.0.0');
  });

  it('returns 404 for orphaned version snapshots after the parent form is deleted', async () => {
    const ctx = fakeCtx();
    const app = authedApp(ctx);

    const created = await app.inject({
      method: 'POST',
      url: '/api/forms',
      payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: { versionLabel: 'v1' } });
    await app.inject({ method: 'DELETE', url: `/api/forms/${id}` });
    const auditCount = ctx.audits.length;

    const snapshot = await app.inject({ method: 'GET', url: `/api/forms/${id}/versions/1` });
    expect(snapshot.statusCode).toBe(404);
    expect(snapshot.json()).toMatchObject({ error: 'not found' });
    expect(ctx.audits).toHaveLength(auditCount);
  });

  it('persists a submission through the ingest workflow', async () => {
    const ctx = fakeCtx();
    const runs: { workflowId: string; source: string; input: any }[] = [];
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async (workflowId: string, source: string, input: any) => {
          runs.push({ workflowId, source, input });
          return { runId: 'run-1', correlationId: null, status: 'completed', error: null };
        },
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, runId: 'run-1' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId).toBe('wf-ingest');
    expect(runs[0]!.source).toBe('form');
    // Routed down the FHIR branch: the body is a transaction Bundle.
    expect(runs[0]!.input.body.resourceType).toBe('Bundle');
    expect(runs[0]!.input.body.type).toBe('transaction');
    // The QuestionnaireResponse rides along as entry[0].
    expect(runs[0]!.input.body.entry[0].resource.resourceType).toBe('QuestionnaireResponse');
    // Provenance override is top-level, not inside body.
    expect(runs[0]!.input.__provenance.sourceSystem).toBe('form-capture');
  });

  // Fix 1: ServiceRequestExtractor takes the subject ONLY from the ExtractionContext, so the
  // route must resolve it from the ServiceRequest.subject-bound field. With the `{}` context this
  // route shipped with, every hand-captured order extracted as `subject: { display: 'Unknown
  // subject' }` with no authoredOn — projecting lab_requests.patient_id NULL for capture while
  // every CDR-ingested order carried a real patient id.
  it('carries the subject-bound answer onto the derived ServiceRequest', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().resourceTypes).toEqual(['ServiceRequest']);
    const serviceRequest = runs[0].body.entry
      .map((e: any) => e.resource)
      .find((r: any) => r.resourceType === 'ServiceRequest');
    expect(serviceRequest).toBeDefined();
    expect(serviceRequest.subject.reference).toBe('Patient/p1');
    expect(serviceRequest.subject.display).toBe('Doe Jane');
    expect(serviceRequest.authoredOn).toEqual(expect.any(String));
    expect(serviceRequest.authoredOn.length).toBeGreaterThan(0);
  });

  // The other half of Fix 1: a form with no ServiceRequest.subject binding (or an unanswered /
  // non-entity one) must leave ctx.subject undefined so ServiceRequestExtractor's own fallback
  // applies — the route must not fabricate a Reference out of a free-text answer.
  it('falls back to the extractor default when no field is bound to ServiceRequest.subject', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Specimen intake', schema: sampleSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({ method: 'POST', url: `/api/forms/${formId}/responses`, payload: { answers: { patientId: 'P-100' } } });

    expect(res.statusCode).toBe(201);
    const serviceRequest = runs[0].body.entry
      .map((e: any) => e.resource)
      .find((r: any) => r.resourceType === 'ServiceRequest');
    expect(serviceRequest.subject).toEqual({ display: 'Unknown subject' });
    // authoredOn is still stamped — it comes from the submission time, not the subject binding.
    expect(serviceRequest.authoredOn).toEqual(expect.any(String));
  });

  it('records the submitting user as the QuestionnaireResponse author', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(runs[0].body.entry[0].resource.author).toMatchObject({ display: 'admin' });
  });

  it('reports a specific error when the ingest workflow is disabled', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = { runner: { runAndRecord: async () => null } };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('wf-ingest');
    expect(res.json().error).toMatch(/disabled|not enabled|unavailable/i);
  });

  it('reports a failed run rather than success', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: { runAndRecord: async () => ({ runId: 'run-2', correlationId: null, status: 'failed', error: 'persist blew up' }) },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-2' });
  });

  // `persist-1` runs before `log-1`, and runAndRecord records the run AFTER the engine returns,
  // so a failure in the Log node, in the data.persisted publish, or in the run-store insert
  // arrives here with the resources ALREADY written. `unwrapBundle` mints a fresh randomUUID()
  // per entry on every submission, so a clerk who resubmits creates a second ServiceRequest and
  // QuestionnaireResponse for the same clinical event.
  it('tells the clerk NOT to resubmit when a run persisted and then failed', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async () => ({
          runId: 'run-partial', correlationId: null, status: 'failed', error: 'log node blew up',
          nodeMeta: { 'persist-1': { persisted: 2, flattened: { written: 2, skipped: 0, degraded: 0 }, resourceTypes: ['QuestionnaireResponse', 'ServiceRequest'] } },
        }),
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    // Still a failure — the run did not complete and the status must not be softened.
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-partial', persisted: 2 });
    expect(res.json().message).toMatch(/do not resubmit/i);
    expect(res.json().message).toContain('run-partial');
    // The studio's shared error handler reads `error`, not `message` — the warning has to be
    // there or the clerk never sees it.
    expect(res.json().error).toMatch(/do not resubmit/i);
    expect(res.json().error).toContain('log node blew up');
  });

  it('says a retry is safe when the failed run stored nothing', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async () => ({
          runId: 'run-none', correlationId: null, status: 'failed', error: 'persist blew up', nodeMeta: {},
        }),
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, persisted: 0 });
    expect(res.json().message).toMatch(/safely be retried/i);
  });

  // The graph is operator-editable: the Persist Store node can be renamed or removed. "We cannot
  // prove anything was stored" must read as 0 — the answer that does not invite a duplicate.
  it('reports 0 persisted when the run carries no persist metadata at all', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async () => ({ runId: 'run-x', correlationId: null, status: 'failed', error: 'boom' }),
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().persisted).toBe(0);
  });

  it('rejects a form whose resource type has no extractor, naming the resource type', async () => {
    const ctx = fakeCtx();
    const runs: unknown[] = [];
    (ctx as any).workflows = { runner: { runAndRecord: async (...args: unknown[]) => { runs.push(args); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } } };
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Patient intake', fhirResourceType: 'Patient', schema: patientBoundSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { familyName: 'Doe' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Patient');
    expect(res.json().error).toMatch(/no extractor/i);
    // Nothing was submitted to the pipeline.
    expect(runs).toEqual([]);
  });

  it('tells an Observation-bound form to flag a field, not that the extractor is missing', async () => {
    const ctx = fakeCtx();
    const runs: unknown[] = [];
    (ctx as any).workflows = { runner: { runAndRecord: async (...args: unknown[]) => { runs.push(args); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } } };
    const app = authedApp(ctx);

    // Observation-bound schema with no fields flagged for extraction
    const observationBoundSchema = {
      id: 'vital-signs',
      name: 'Vital signs',
      versionLabel: null,
      fhirVersion: null,
      fhirResourceType: 'Observation',
      fhirProfileUrl: null,
      facilityId: null,
      fields: [
        {
          id: 'temperature',
          fhirPath: null,
          displayLabel: 'Temperature',
          description: null,
          fieldType: 'text' as const,
          required: true,
          enabled: true,
          order: 0,
          cardinality: { min: 1, max: '1' },
          section: 'main',
          // Note: observationExtract is NOT set, so this field will not be extracted
        },
      ],
      sections: [{ id: 'main', label: 'Main', order: 0 }],
      targetPages: [],
      languages: ['en'],
      version: 1,
      active: true,
      status: 'draft' as const,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies FormInput['schema'];

    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Vital signs', fhirResourceType: 'Observation', schema: observationBoundSchema, targetPages: ['forms'] },
    });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { temperature: '37.5' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Observation');
    expect(res.json().error).toContain('flagged for Observation extraction');
    // Should NOT claim the extractor is missing
    expect(res.json().error).not.toMatch(/no extractor/i);
    // Nothing was submitted to the pipeline.
    expect(runs).toEqual([]);
  });

  // Fix 3: the run error reaches the client, and a Persist Store / DB-node failure can carry a
  // connection string. The code this route replaced ran errors through `redact()`; returning
  // `outcome.error` verbatim was a real regression.
  it('redacts credentials out of a failed run error', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async () => ({
          runId: 'run-3',
          correlationId: null,
          status: 'failed',
          error: 'connect ECONNREFUSED postgres://openldr:sup3rs3cret@db:5432/openldr (password=sup3rs3cret)',
        }),
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).not.toContain('sup3rs3cret');
    expect(res.json().error).toContain('***');
    // Still diagnosable: only the credentials are masked, not the whole message.
    expect(res.json().error).toContain('ECONNREFUSED');
  });

  // Submission is gated on forms.submit, NOT forms.view. forms.view is held by every system-role
  // preset — including system_auditor, described as "Read-only oversight plus the audit log" —
  // and this route now writes clinical records to fhir_resources and the flat read model.
  describe('forms.submit capability gate', () => {
    async function seedFormWith(ctx: AppContext): Promise<string> {
      const created = await authedApp(ctx).inject({
        method: 'POST', url: '/api/forms',
        payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] },
      });
      return created.json().id as string;
    }

    it('refuses a submission from a role holding forms.view but not forms.submit', async () => {
      const ctx = fakeCtx();
      const runs: unknown[] = [];
      (ctx as any).workflows = { runner: { runAndRecord: async (...args: unknown[]) => { runs.push(args); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } } };
      const formId = await seedFormWith(ctx);

      const res = await authedApp(ctx, ['forms.view']).inject({
        method: 'POST', url: `/api/forms/${formId}/responses`,
        payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
      });

      expect(res.statusCode).toBe(403);
      // Nothing reached the pipeline: the guard runs before any extraction or persistence.
      expect(runs).toEqual([]);
    });

    it('accepts a submission from a role holding forms.submit', async () => {
      const ctx = fakeCtx();
      const runs: unknown[] = [];
      (ctx as any).workflows = { runner: { runAndRecord: async (...args: unknown[]) => { runs.push(args); return { runId: 'run-sub', correlationId: null, status: 'completed', error: null }; } } };
      const formId = await seedFormWith(ctx);

      const res = await authedApp(ctx, ['forms.view', 'forms.submit']).inject({
        method: 'POST', url: `/api/forms/${formId}/responses`,
        payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ ok: true, runId: 'run-sub' });
      expect(runs).toHaveLength(1);
    });

    it('still lets a forms.view-only role read the form it may not submit', async () => {
      const ctx = fakeCtx();
      const formId = await seedFormWith(ctx);
      const res = await authedApp(ctx, ['forms.view']).inject({ method: 'GET', url: `/api/forms/${formId}` });
      expect(res.statusCode).toBe(200);
    });
  });
});
