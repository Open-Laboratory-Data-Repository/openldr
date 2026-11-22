import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import AdmZip from 'adm-zip';
import type { AppContext } from '@openldr/bootstrap';
import { sampleForms, type FormDefinition, type FormInput, type FormVersion, type FormVersionSummary } from '@openldr/forms';
import { projectServiceRequest } from '@openldr/db';
import { formAccess } from '@openldr/bootstrap';
import { registerFormsRoutes } from './forms-routes';
import { registerFormEntryRoutes } from './form-entry-routes';

/** No form limited to any role: today's rule for every form (design 2026-11-18-roles-scope). */
const noLists = {
  async get() { return { open: [], submit: [] }; },
  async set() { return { before: { open: [], submit: [] }, after: { open: [], submit: [] } }; },
  async forForms() { return new Map(); },
  async removeRole() {},
};
const withAccess = <T extends object>(ctx: T): T => ({ formAccessStore: noLists, formAccess: formAccess({ access: noLists }), ...ctx });
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
  registerFormsRoutes(app, withAccess(ctx) as never);
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
  registerFormsRoutes(app, withAccess(ctx));
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

// Test catalog S4: a Lab order whose Tests field binds this lab's test list.
const catalogOrderSchema = {
  ...referenceSchema,
  id: 'catalog-order',
  fields: [
    ...referenceSchema.fields,
    {
      id: 'tests',
      fhirPath: 'ServiceRequest.code',
      displayLabel: 'Tests',
      description: null,
      fieldType: 'reference' as const,
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 1, max: '*' },
      referenceMultiple: true,
      section: 'main',
      valueSetUrl: 'urn:openldr:valueset:lab-tests',
    },
  ],
} satisfies FormInput['schema'];

// Bench result entry: the same order, plus the field that holds what the bench typed.
const resultOrderSchema = {
  ...catalogOrderSchema,
  id: 'result-order',
  fields: [
    ...catalogOrderSchema.fields,
    {
      id: 'details',
      fhirPath: null,
      displayLabel: 'Results',
      description: null,
      fieldType: 'testDetails' as const,
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
      referenceDependsOn: 'tests',
      section: 'main',
    },
  ],
} satisfies FormInput['schema'];

// 2026-10-11 spec: the same order, plus the field that holds an order-level rejection.
const rejectableOrderSchema = {
  ...resultOrderSchema,
  id: 'rejectable-order',
  fields: [
    ...resultOrderSchema.fields,
    {
      id: 'rej',
      fhirPath: 'ServiceRequest.extension',
      fhirDiscriminator: { url: 'urn:openldr:ext:rejection' },
      displayLabel: 'Order rejection',
      description: null,
      fieldType: 'reference' as const,
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
      section: 'main',
      valueSetUrl: 'urn:openldr:valueset:order-reject-reason',
    },
  ],
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
          targetPages: form.targetPages,
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
      restore: async (id: string, version: number) => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        // `versions` at line 212 is a Map<string, FormVersion[]> keyed by form id, NOT an array.
        const snapshot = (versions.get(id) ?? []).find((item) => item.version === version);
        if (!snapshot) throw new Error('version not found');
        form.name = snapshot.name;
        form.versionLabel = snapshot.versionLabel;
        form.schema = snapshot.schema;
        form.targetPages = snapshot.targetPages;
        form.status = 'draft';
        return form;
      },
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
    // The submit route writes a form entry before the save (design 2026-11-22-form-entries). Tests
    // that care use the real service on a migrated database ('form entries on submit' below).
    formEntries: {
      facilityIdsOf: async () => null,
      begin: async () => ({ id: 'entry-stub' }),
      finish: async () => null,
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
  // demo.4 item 2: a schema with no sections was stored, then publish answered 500 from
  // toQuestionnaire. The schema is checked on the way in, so the caller gets a 400 instead.
  it('refuses a form schema without fields or sections lists, on create and on update', async () => {
    const app = authedApp(fakeCtx());
    const { sections: _s, ...noSections } = sampleSchema as Record<string, unknown>;
    const { fields: _f, ...noFields } = sampleSchema as Record<string, unknown>;
    for (const schema of [noSections, noFields, { ...sampleSchema, sections: [null] }, 'not a schema']) {
      const res = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Bad', schema } });
      expect(res.statusCode).toBe(400);
    }
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Good', schema: sampleSchema } });
    expect(created.statusCode).toBe(201);
    const updated = await app.inject({ method: 'PUT', url: `/api/forms/${created.json().id}`, payload: { name: 'Good', schema: noSections } });
    expect(updated.statusCode).toBe(400);
  });

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

  it('restores a version and audits it as form.restore', async () => {
    const ctx = fakeCtx();
    const app = authedApp(ctx);
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [], sections: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: {} });

    const res = await app.inject({ method: 'POST', url: `/api/forms/${id}/restore/1`, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
    expect(ctx.audits.find((event) => event.action === 'form.restore')).toMatchObject({
      entityId: id,
      metadata: { sourceVersion: 1 },
    });
  });

  it('rejects a version path segment that is not a positive integer', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [], sections: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    const res = await app.inject({ method: 'POST', url: `/api/forms/${id}/restore/abc`, payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/positive integer/);
  });

  it('404s a version the form does not have', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [], sections: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    const res = await app.inject({ method: 'POST', url: `/api/forms/${id}/restore/9`, payload: {} });

    expect(res.statusCode).toBe(404);
  });

  it('404s an unknown form', async () => {
    const app = authedApp(fakeCtx());

    const res = await app.inject({ method: 'POST', url: '/api/forms/nope/restore/1', payload: {} });

    expect(res.statusCode).toBe(404);
  });

  it('refuses a restore from a role holding forms.view but not forms.edit', async () => {
    const ctx = fakeCtx();
    const created = await authedApp(ctx).inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [], sections: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await authedApp(ctx).inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: {} });

    const res = await authedApp(ctx, ['forms.view']).inject({
      method: 'POST', url: `/api/forms/${id}/restore/1`, payload: {},
    });

    expect(res.statusCode).toBe(403);
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

  it('writes each catalog test LOINC coding in front of it on the derived ServiceRequest', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    const asked: unknown[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async (tests: unknown) => {
        asked.push(tests);
        return new Map([['urn:openldr:codesystem:test-catalog|HIVVL', { system: 'http://loinc.org', code: '25836-8' }]]);
      },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: catalogOrderSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [
          { system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL', display: 'Viral load' },
          { system: 'urn:openldr:codesystem:test-catalog', code: 'CD4', display: 'CD4 count' },
        ],
      } },
    });

    expect(res.statusCode).toBe(201);
    expect(asked).toEqual([[
      { system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' },
      { system: 'urn:openldr:codesystem:test-catalog', code: 'CD4' },
    ]]);
    const serviceRequest = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'ServiceRequest');
    expect(serviceRequest.code.coding).toEqual([
      { system: 'http://loinc.org', code: '25836-8' },
      { system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL', display: 'Viral load' },
      { system: 'urn:openldr:codesystem:test-catalog', code: 'CD4', display: 'CD4 count' },
    ]);
    // The warehouse keeps the first coding, the nameless LOINC link, so the order's name rides on
    // code.text (lab_requests.panel_desc).
    expect(serviceRequest.code.text).toBe('Viral load');
  });

  it('a Lab order keeps its referring facility and clinician all the way to lab_requests', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const labOrder = sampleForms.find((f) => f.name === 'Lab order')!;
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Lab order', schema: labOrder, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
        'fld-ord-priority': 'routine',
        'fld-ord-clinician': 'Dr. Banda',
        'fld-ord-ref-facility': { system: 'urn:openldr:cs:facility-registry', code: 'FAC-001', display: 'Hill Clinic' },
      } },
    });

    expect(res.statusCode).toBe(201);
    const serviceRequest = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'ServiceRequest');
    // The same projection the warehouse writer runs on this resource.
    expect(projectServiceRequest(serviceRequest, {})).toMatchObject({
      requester_code: 'FAC-001',
      requester_system: 'urn:openldr:cs:facility-registry',
      requester_display: 'Hill Clinic',
      requester_practitioner: 'Dr. Banda',
    });
  });

  it('does not ask the catalog when no answer is a catalog test', async () => {
    const ctx = fakeCtx();
    (ctx as any).testCatalog = { loincCodingsFor: async () => { throw new Error('the catalog was asked'); } };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: referenceSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('hands the extractor the band each result was measured against', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    // The order carries catalog tests, so S4's LOINC lookup runs too, and the submit checks the band.
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [],
          bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] }],
      }],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
            band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(201);
    const observation = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'Observation');
    expect(observation.valueQuantity).toEqual({ value: 11.2, unit: 'g/dL' });
    expect(observation.referenceRange).toEqual([{ low: { value: 12, unit: 'g/dL' }, high: { value: 15, unit: 'g/dL' } }]);
  });

  it('points every Observation at the order it was submitted with', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [],
          bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] }],
      }],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
            band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
        ] } },
      } },
    });
    expect(res.statusCode).toBe(201);
    const resources = runs[0].body.entry.map((e: any) => e.resource);
    const request = resources.find((r: any) => r.resourceType === 'ServiceRequest');
    expect(typeof request.id).toBe('string');
    const observations = resources.filter((r: any) => r.resourceType === 'Observation');
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.basedOn).toEqual([{ reference: `ServiceRequest/${request.id}` }]);
    }
  });

  it('a rejected order is revoked with the reason, carries a Specimen, and writes no Observation', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: rejectableOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        rej: { system: 'urn:openldr:cs:reject-order', code: 'WRONGPT', display: 'Wrong patient' },
      } },
    });
    expect(res.statusCode).toBe(201);
    const resources = runs[0].body.entry.map((e: any) => e.resource);
    const request = resources.find((r: any) => r.resourceType === 'ServiceRequest');
    const specimen = resources.find((r: any) => r.resourceType === 'Specimen');
    expect(request.status).toBe('revoked');
    expect(request.extension).toEqual([{ url: 'urn:openldr:ext:rejection', extension: [
      { url: 'code', valueCode: 'WRONGPT' }, { url: 'reason', valueString: 'Wrong patient' },
    ] }]);
    expect(specimen.status).toBe('unsatisfactory');
    expect(request.specimen).toEqual([{ reference: `Specimen/${specimen.id}` }]);
    expect(resources.filter((r: any) => r.resourceType === 'Observation')).toEqual([]);
  });

  it('refuses a result whose range the catalog does not hold, and stores nothing', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [],
          bands: [{ name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }] }],
      }],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
            band: { name: 'Highland women', low: 5, high: 30, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null } },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'invalid answers',
      errors: [{ fieldId: 'details', label: 'Results', reason: 'The reference ranges for HGB on FBC changed. Reopen the test and pick a range again.' }],
    });
    expect(runs).toEqual([]);
  });

  it('accepts a named range the catalog holds, and writes its name', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    const named = { name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [], bands: [named] }],
      }],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL', band: named },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(201);
    const observation = runs[0].body.entry.map((e: any) => e.resource).find((r: any) => r.resourceType === 'Observation');
    expect(observation.referenceRange[0].text).toBe('Highland women');
  });

  // Fix 1 of the named-reference-ranges review: `low` in the catalog band is null, so a coerce-first
  // check (turning the submitted string "5" into null) would wrongly match it. The route must refuse
  // instead, and it must not hand the extractor a value it never checked.
  it('refuses a band whose field has the wrong type rather than treating it as the catalog null', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => [{
        test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' },
        params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, unit: 'g/dL', display: 'HGB', band: null, fits: [],
          bands: [{ name: null, low: null, high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null }] }],
      }],
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
            band: { name: null, low: '5', high: 15, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null } },
        ] } },
      } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'invalid answers',
      errors: [{ fieldId: 'details', label: 'Results', reason: 'The reference ranges for HGB on FBC changed. Reopen the test and pick a range again.' }],
    });
    expect(runs).toEqual([]);
  });

  // Fix 6 of the review: a rejected test's results are never extracted (the Observation carries the
  // rejection reason instead), so a stale band left on one of its results must not block the submit.
  it('submits a rejected test carrying a band the catalog does not hold', async () => {
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).workflows = {
      runner: { runAndRecord: async (_w: string, _s: string, input: any) => { runs.push(input); return { runId: 'r', correlationId: null, status: 'completed', error: null }; } },
    };
    (ctx as any).testCatalog = {
      loincCodingsFor: async () => new Map(),
      resultParamsFor: async () => { throw new Error('the catalog should not be asked: the only band belongs to a rejected test'); },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: resultOrderSchema, targetPages: ['forms'] } });
    const res = await app.inject({
      method: 'POST', url: `/api/forms/${created.json().id as string}/responses`,
      payload: { answers: {
        patient: { reference: 'Patient/p1', display: 'Doe Jane' },
        tests: [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }],
        details: { 'urn:openldr:codesystem:test-catalog|FBC': {
          specimen: null,
          rejection: { system: 'urn:openldr:codesystem:rejection-reason', code: 'haemolysed', display: 'Haemolysed' },
          results: [
            { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
              band: { name: 'Stale range', low: 5, high: 30, unit: 'g/dL', sex: null, ageLow: null, ageHigh: null } },
          ],
        } },
      } },
    });

    expect(res.statusCode).toBe(201);
    expect(runs.length).toBe(1);
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

  // The default Ingest sends held rows to a Log (2026-11-20), so a run can complete with the
  // submission held back. The clerk must not be told it was submitted.
  it('reports a held submission as not stored, even when the run completed', async () => {
    const ctx = fakeCtx();
    (ctx as any).workflows = {
      runner: { runAndRecord: async () => ({ runId: 'run-h', correlationId: null, status: 'completed', error: null, nodeMeta: {}, held: { count: 1, reasons: ['failed the business-rule check'] } }) },
    };
    const app = authedApp(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/forms', payload: { name: 'O', schema: referenceSchema, targetPages: ['forms'] } });
    const formId = created.json().id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/forms/${formId}/responses`,
      payload: { answers: { patient: { reference: 'Patient/p1', display: 'Doe Jane' } } },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-h', held: 1 });
    expect(res.json().error).toMatch(/held back and not stored/);
    expect(res.json().error).toContain('failed the business-rule check');
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

  // Zero persisted is absence of evidence, not evidence of absence: the message must NOT assert
  // the retry is safe, only that nothing was reported and the run should be checked first.
  it('gives absence-of-evidence guidance, not a safety claim, when the failed run reports no persisted records', async () => {
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
    expect(res.json()).toMatchObject({ ok: false, persisted: 0, runId: 'run-none' });
    expect(res.json().message).toBe('No stored records were reported for this run. Check run run-none before resubmitting.');
    expect(res.json().message).not.toMatch(/safely be retried|safe to retry/i);
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
  // Design 2026-11-22-form-entries 5.6: a form that drives an app page (Users, Facility) is left
  // out of the Forms list for a caller without forms.edit. Its page still loads it.
  it('leaves page forms out of the forms list for a caller without forms.edit', async () => {
    const ctx = fakeCtx();
    const editor = authedApp(ctx);
    const clerk = authedApp(ctx, ['forms.view', 'forms.submit']);
    const ids: Record<string, string> = {};
    for (const [name, targetPages] of [['Users', ['users']], ['Facility', ['facilities']], ['Lab order', ['forms']], ['Plain', []]] as const) {
      const res = await editor.inject({ method: 'POST', url: '/api/forms', payload: { name, schema: sampleSchema, targetPages } });
      ids[name] = res.json().id as string;
      await editor.inject({ method: 'POST', url: `/api/forms/${ids[name]}/status`, payload: { status: 'published' } });
    }
    const names = async (app: ReturnType<typeof authedApp>, url: string) =>
      ((await app.inject({ method: 'GET', url })).json() as Array<{ name: string }>).map((f) => f.name).sort();
    expect(await names(clerk, '/api/forms')).toEqual(['Lab order', 'Plain']);
    expect(await names(editor, '/api/forms')).toEqual(['Facility', 'Lab order', 'Plain', 'Users']);
    // The Users and Facilities pages load their form by target page, unchanged.
    expect(await names(clerk, '/api/forms/published?targetPage=users')).toEqual(['Users']);
    expect(await names(clerk, '/api/forms/published?targetPage=facilities')).toEqual(['Facility']);
  });

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

describe('starter pack routes', () => {
  const PACK = { id: 'pack-location', resourceType: 'Location', name: 'Facility', version: '1', seeded: true, createdAt: NOW, updatedAt: NOW };
  const ENTRY = {
    ord: 0, fhirPath: 'Location.name', label: 'Name', apiProperty: 'name', fieldType: 'text', fhirValueField: null,
    required: true, locked: true, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
    rationale: 'The Facilities page cannot save a row without it.',
  };
  const ctx = {
    starterPacks: {
      listForResource: async (resourceType: string) => (resourceType === 'Location' ? [PACK] : []),
      get: async (id: string) => (id === PACK.id ? { ...PACK, entries: [ENTRY] } : null),
    },
    forms: { get: async (id: string) => (id === 'form-1' ? { id: 'form-1' } : null) },
  };

  it('lists the packs for a resource type', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs?resourceType=Location' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([PACK]);
  });

  it('answers an empty list for a type with no pack', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs?resourceType=Specimen' });
    expect(res.json()).toEqual([]);
  });

  it('refuses a list with no resource type', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs' });
    expect(res.statusCode).toBe(400);
  });

  it('returns one pack with its entries', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs/pack-location' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...PACK, entries: [ENTRY] });
  });

  it('404s an unknown pack', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('needs forms.view', async () => {
    const res = await appWithForms(ctx, ['guest'], []).inject({ method: 'GET', url: '/api/forms/starter-packs?resourceType=Location' });
    expect(res.statusCode).toBe(403);
  });

  it('leaves GET /api/forms/:id working', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/form-1' });
    expect(res.json()).toEqual({ id: 'form-1' });
  });
});

// Design 2026-11-22-form-entries: the submit route records an entry before the save, refuses a
// repeated requisition number and a facility outside the user's limit, and settles the row after.
describe('form entries on submit', () => {
  const REGISTRY = 'urn:openldr:cs:facility-registry';
  const field = (over: Record<string, unknown>) => ({
    fhirPath: null, description: null, fieldType: 'text', required: false, enabled: true,
    cardinality: { min: 0, max: '1' }, section: 'main', ...over,
  });
  /** A requisition form: a number and a facility, from the register or typed. */
  const entrySchema = (facility: 'register' | 'free-text') => ({
    ...sampleSchema,
    id: 'entry-order',
    fields: [
      field({ id: 'num', displayLabel: 'Requisition', order: 0, fhirPath: 'ServiceRequest.identifier.value' }),
      field({
        id: 'fac', displayLabel: 'Facility', fieldType: 'facility', order: 1,
        fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Organization' },
        ...(facility === 'register' ? { referenceTarget: REGISTRY } : {}),
      }),
    ],
  });
  const siteA = { system: REGISTRY, code: 'A1', display: 'Site A' };
  const siteB = { system: REGISTRY, code: 'B1', display: 'Site B' };
  type Scope = { limited: false } | { limited: true; facilities: string[]; districts: never[]; regions: string[] };
  const onlySiteA: Scope = { limited: true, facilities: ['reg-a'], districts: [], regions: [] };

  async function world(opts: { run?: (input: any) => unknown; exists?: (type: string, id: string) => boolean } = {}) {
    const { makeMigratedDb } = await import('@openldr/db/testing');
    const { createFormEntryStore } = await import('@openldr/db');
    const { createFormEntriesService, readScopeRegistryRows } = await import('@openldr/bootstrap');
    const db = await makeMigratedDb();
    for (const [id, code, name] of [['reg-a', 'A1', 'Site A'], ['reg-b', 'B1', 'Site B']]) {
      await db.insertInto('facility_registry').values({
        id, facility_system: 'urn:test:mfl', facility_code: code, name, region: 'Coast', district: name,
        extras: '{}', source: 'test', created_at: NOW, updated_at: NOW,
      } as never).execute();
    }
    const store = createFormEntryStore(db as never);
    const ctx = fakeCtx();
    const runs: any[] = [];
    (ctx as any).formEntries = createFormEntriesService({
      store, registryRows: () => readScopeRegistryRows(db as never),
      // Every saved record reads back as stored; the void re-save goes through the same fake runner.
      fhir: { get: async (type: string, id: string) => ({ resourceType: type, id, status: 'active' }) },
      runner: { runAndRecord: (...args: [any, any, any]) => (ctx as any).workflows.runner.runAndRecord(...args) },
      audit: async () => {},
      logger: { warn: () => {}, error: () => {} } as never,
    });
    (ctx as any).labIdentity = { tokens: async () => ({ 'lab.timezone': 'Africa/Dar_es_Salaam' }) };
    (ctx as any).workflows = {
      runner: {
        runAndRecord: async (_w: string, _s: string, input: any) => {
          runs.push(input);
          return opts.run ? opts.run(input) : { runId: 'run-ok', correlationId: 'corr-1', status: 'completed', error: null };
        },
      },
    };
    if (opts.exists) (ctx as any).fhirStore = { exists: async (type: string, id: string) => opts.exists!(type, id) };

    const appFor = (dataScope: Scope = { limited: false }, user = { id: 'u-aisha', username: 'aisha', displayName: 'Aisha M.' as string | null }) => {
      const app = Fastify();
      app.addHook('onRequest', async (req) => {
        req.user = { ...user, roles: ['clerk'], capabilities: ALL_FORMS_CAPS, roleIds: [], dataScope } as never;
      });
      registerFormsRoutes(app, withAccess(ctx) as never);
      return app;
    };
    const createForm = async (facility: 'register' | 'free-text' = 'register') =>
      (await appFor().inject({ method: 'POST', url: '/api/forms', payload: { name: 'Order', schema: entrySchema(facility), targetPages: ['forms'] } })).json().id as string;
    const submit = (app: ReturnType<typeof appFor>, formId: string, answers: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/forms/${formId}/responses`, payload: { answers } });
    const rows = async (formId: string) => (await store.list({ formId, limit: 50, offset: 0 })).entries;
    /** Marks an entry in error through the real void route. */
    const voidEntry = async (entryId: string) => {
      const app = Fastify();
      app.addHook('onRequest', async (req) => {
        req.user = { id: 'u-manager', username: 'manager', displayName: null, roles: [], roleIds: [], capabilities: ['forms.view', 'forms.void_entries'], dataScope: { limited: false } } as never;
      });
      registerFormEntryRoutes(app, withAccess(ctx) as never);
      return app.inject({ method: 'POST', url: `/api/forms/entries/${entryId}/void`, payload: { reason: 'typed the wrong patient' } });
    };
    return { db, store, ctx, runs, appFor, createForm, submit, rows, voidEntry };
  }

  it('answers the unchanged success body plus entryId, and the row names what the save stored', async () => {
    const w = await world();
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteA });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['correlationId', 'entryId', 'ok', 'resourceTypes', 'runId']);
    expect(body).toMatchObject({ ok: true, runId: 'run-ok', correlationId: 'corr-1', resourceTypes: ['ServiceRequest'] });

    const [row] = await w.rows(formId);
    expect(row).toMatchObject({
      id: body.entryId, status: 'active', facilityId: 'reg-a', facilityCode: 'A1', facilityName: 'Site A',
      entryKey: 'CS-0001', enteredBy: 'u-aisha', enteredByName: 'Aisha M.',
    });
    // The ids in `saved` are the ids the bundle carried into the pipeline.
    const entries = w.runs[0].body.entry as { resource: { resourceType: string; id: string } }[];
    expect(row!.saved).toEqual({
      responseId: entries[0]!.resource.id,
      resources: entries.slice(1).map((e) => ({ resourceType: e.resource.resourceType, id: e.resource.id })),
    });
    expect(typeof row!.saved!.responseId).toBe('string');
    await w.db.destroy();
  });

  it('uses the username when the user has no display name', async () => {
    const w = await world();
    const formId = await w.createForm();
    await w.submit(w.appFor({ limited: false }, { id: 'u-2', username: 'proofclerk', displayName: null }), formId, { num: 'CS-1', fac: siteA });
    expect((await w.rows(formId))[0]).toMatchObject({ enteredBy: 'u-2', enteredByName: 'proofclerk' });
    await w.db.destroy();
  });

  it('refuses a repeated requisition number at the same site with 409 entry-repeat, and saves nothing', async () => {
    const w = await world();
    const formId = await w.createForm();
    const first = await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteA });
    const [held] = await w.rows(formId);

    const res = await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteA });
    expect(res.statusCode).toBe(409);
    const at = new Date(held!.enteredAt);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Dar_es_Salaam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    expect(res.json()).toEqual({
      error: 'entry-repeat',
      message: expect.stringMatching(new RegExp(`^CS-0001 was already entered on \\d{1,2} [A-Z][a-z]{2} \\d{4} at ${local} by Aisha M\\.$`)),
      entry: { id: first.json().entryId, entryKey: 'CS-0001', enteredAt: held!.enteredAt, enteredByName: 'Aisha M.' },
    });
    expect(w.runs).toHaveLength(1);
    expect(await w.rows(formId)).toHaveLength(1);

    // Another site may use the same number.
    expect((await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteB })).statusCode).toBe(201);
    await w.db.destroy();
  });

  it('refuses a limited user naming a facility outside the limit with 403, and saves nothing', async () => {
    const w = await world();
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(onlySiteA), formId, { num: 'CS-1', fac: siteB });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'this entry names a facility outside your limit' });
    expect(w.runs).toHaveLength(0);
    expect(await w.rows(formId)).toHaveLength(0);

    // Inside the limit it saves.
    expect((await w.submit(w.appFor(onlySiteA), formId, { num: 'CS-1', fac: siteA })).statusCode).toBe(201);
    await w.db.destroy();
  });

  it('refuses a limited user on a form whose facility field is free text with 403, and saves nothing', async () => {
    const w = await world();
    const formId = await w.createForm('free-text');
    const res = await w.submit(w.appFor(onlySiteA), formId, { num: 'CS-1', fac: 'Site A' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "this form's facility field is free text, so it cannot be used by a user limited to a site" });
    expect(w.runs).toHaveLength(0);
    expect(await w.rows(formId)).toHaveLength(0);
    await w.db.destroy();
  });

  it('refuses a limited user whose limit names no facility with 403', async () => {
    const w = await world();
    const formId = await w.createForm();
    const res = await w.submit(w.appFor({ limited: true, facilities: [], districts: [], regions: [] }), formId, { num: 'CS-1', fac: siteA });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'your data limit names no facility, so you cannot enter this form' });
    expect(w.runs).toHaveLength(0);
    await w.db.destroy();
  });

  it('removes the row when the save failed and stored nothing, so the number is free again', async () => {
    let fail = true;
    const w = await world({
      run: () => (fail
        ? { runId: 'run-none', correlationId: null, status: 'failed', error: 'persist blew up', nodeMeta: {} }
        : { runId: 'run-ok', correlationId: null, status: 'completed', error: null }),
      exists: () => false,
    });
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-none', persisted: 0 });
    expect(await w.rows(formId)).toHaveLength(0);

    fail = false;
    expect((await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA })).statusCode).toBe(201);
    await w.db.destroy();
  });

  it('removes the row when the ingest workflow is off', async () => {
    const w = await world({ run: () => null, exists: () => false });
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('wf-ingest');
    expect(await w.rows(formId)).toHaveLength(0);
    await w.db.destroy();
  });

  it('keeps the row incomplete when the save failed after storing the order, and the number stays refused', async () => {
    const w = await world({
      run: () => ({
        runId: 'run-partial', correlationId: null, status: 'failed', error: 'log node blew up',
        nodeMeta: { 'persist-1': { persisted: 2 } },
      }),
      // The order was stored; nothing else.
      exists: (type) => type === 'ServiceRequest',
    });
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-partial', persisted: 2 });
    expect(Object.keys(res.json())).not.toContain('entryId');

    const [row] = await w.rows(formId);
    const order = (w.runs[0].body.entry as { resource: { resourceType: string; id: string } }[])
      .find((e) => e.resource.resourceType === 'ServiceRequest')!.resource;
    expect(row).toMatchObject({ status: 'incomplete', saved: { responseId: null, resources: [{ resourceType: 'ServiceRequest', id: order.id }] } });

    const again = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'entry-repeat', entry: { id: row!.id } });
    expect(w.runs).toHaveLength(1);
    await w.db.destroy();
  });

  it('keeps the row incomplete when the run says it stored records but none of the ids is found', async () => {
    const w = await world({
      run: () => ({ runId: 'run-p', correlationId: null, status: 'failed', error: 'boom', nodeMeta: { 'persist-1': { persisted: 1 } } }),
      exists: () => false,
    });
    const formId = await w.createForm();
    await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect((await w.rows(formId))[0]).toMatchObject({ status: 'incomplete', saved: { responseId: null, resources: [] } });
    await w.db.destroy();
  });

  it('keeps the row incomplete when the save failed and the store cannot say what landed', async () => {
    const w = await world({
      run: () => ({ runId: 'run-down', correlationId: null, status: 'failed', error: 'store down', nodeMeta: {} }),
      exists: () => { throw new Error('connection refused'); },
    });
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, runId: 'run-down', persisted: 0 });
    expect((await w.rows(formId))[0]).toMatchObject({ status: 'incomplete', saved: { responseId: null, resources: [] } });
    expect((await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA })).statusCode).toBe(409);
    await w.db.destroy();
  });

  it('removes the row when a held submission stored nothing, and keeps it incomplete when it stored some', async () => {
    let persisted = 0;
    const w = await world({
      run: () => ({
        runId: 'run-h', correlationId: null, status: 'completed', error: null,
        nodeMeta: { 'persist-1': { persisted } }, held: { count: 1, reasons: ['failed the business-rule check'] },
      }),
      exists: (type) => persisted > 0 && type === 'ServiceRequest',
    });
    const formId = await w.createForm();
    const none = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(none.statusCode).toBe(422);
    expect(await w.rows(formId)).toHaveLength(0);

    persisted = 1;
    const some = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(some.statusCode).toBe(422);
    const order = (w.runs[1].body.entry as { resource: { resourceType: string; id: string } }[])
      .find((e) => e.resource.resourceType === 'ServiceRequest')!.resource;
    expect((await w.rows(formId))[0]).toMatchObject({
      status: 'incomplete', saved: { responseId: null, resources: [{ resourceType: 'ServiceRequest', id: order.id }] },
    });
    await w.db.destroy();
  });

  it('settles the row and still fails the request when runAndRecord throws', async () => {
    let stored = false;
    const w = await world({
      run: () => { throw new Error('run store insert failed'); },
      exists: (type) => stored && type === 'ServiceRequest',
    });
    const formId = await w.createForm();
    const nothing = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(nothing.statusCode).toBe(500);
    expect(await w.rows(formId)).toHaveLength(0);

    stored = true;
    const some = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(some.statusCode).toBe(500);
    expect((await w.rows(formId))[0]).toMatchObject({ status: 'incomplete' });
    await w.db.destroy();
  });

  it('refuses a limited user when a second facility field names a site outside the limit', async () => {
    const w = await world();
    const schema = entrySchema('register');
    const two = { ...schema, fields: [...schema.fields, field({
      id: 'fac2', displayLabel: 'Second facility', fieldType: 'facility', order: 2,
      fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Organization' }, referenceTarget: REGISTRY,
    })] };
    const formId = (await w.appFor().inject({ method: 'POST', url: '/api/forms', payload: { name: 'Two', schema: two, targetPages: ['forms'] } })).json().id as string;
    const res = await w.submit(w.appFor(onlySiteA), formId, { num: 'CS-1', fac: siteA, fac2: siteB });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'this entry names a facility outside your limit' });
    expect(w.runs).toHaveLength(0);

    // An unlimited user saves, and the entry names the facility the order carries.
    expect((await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA, fac2: siteB })).statusCode).toBe(201);
    const order = (w.runs[0].body.entry as { resource: { resourceType: string; contained?: { organization?: { identifier?: { value?: string } } }[] } }[])
      .find((e) => e.resource.resourceType === 'ServiceRequest')!.resource;
    expect(order.contained?.[0]?.organization?.identifier?.value).toBe('B1');
    expect((await w.rows(formId))[0]).toMatchObject({ facilityId: 'reg-b', facilityCode: 'B1' });
    await w.db.destroy();
  });

  it('keys the entry on the number the order carries when two fields fill the identifier', async () => {
    const w = await world();
    const schema = entrySchema('register');
    const two = { ...schema, fields: [...schema.fields, field({ id: 'num2', displayLabel: 'Second number', order: 2, fhirPath: 'ServiceRequest.identifier' })] };
    const formId = (await w.appFor().inject({ method: 'POST', url: '/api/forms', payload: { name: 'Two', schema: two, targetPages: ['forms'] } })).json().id as string;

    expect((await w.submit(w.appFor(), formId, { num: 'CS-1', num2: 'CS-2', fac: siteA })).statusCode).toBe(201);
    const order = (w.runs[0].body.entry as { resource: { resourceType: string; identifier?: { value?: string }[] } }[])
      .find((e) => e.resource.resourceType === 'ServiceRequest')!.resource;
    const [row] = await w.rows(formId);
    expect(row!.entryKey).toBe(order.identifier?.[0]?.value);
    expect(row!.entryKey).toBe('CS-2');

    const again = await w.submit(w.appFor(), formId, { num: 'CS-9', num2: 'CS-2', fac: siteA });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'entry-repeat', entry: { id: row!.id, entryKey: 'CS-2' } });
    expect(w.runs).toHaveLength(1);
    await w.db.destroy();
  });

  it('takes the same requisition number at the same site again once the entry is marked in error', async () => {
    const w = await world();
    const formId = await w.createForm();
    const first = await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteA });
    expect(first.statusCode).toBe(201);
    expect((await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteA })).statusCode).toBe(409);

    const voided = await w.voidEntry(first.json().entryId);
    expect(voided.statusCode).toBe(200);
    expect(voided.json()).toMatchObject({ entry: { status: 'entered-in-error' }, skipped: 0 });
    // The re-save went through the same ingest workflow as the submit, every record marked in error.
    const resave = w.runs[w.runs.length - 1];
    expect(resave.__provenance).toEqual({ sourceSystem: 'form-capture' });
    expect(resave.body.entry.length).toBe(voided.json().resaved);
    expect(resave.body.entry.every((x: any) => x.resource.status === 'entered-in-error')).toBe(true);

    const again = await w.submit(w.appFor(), formId, { num: 'CS-0001', fac: siteA });
    expect(again.statusCode).toBe(201);
    expect(again.json().entryId).not.toBe(first.json().entryId);
    await w.db.destroy();
  });

  it('voiding an entry whose settle failed marks it and warns that its records are not known', async () => {
    const w = await world();
    const real = (w.ctx as any).formEntries;
    (w.ctx as any).formEntries = { ...real, finish: async () => { throw new Error('db gone'); } };
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    (w.ctx as any).formEntries = real;
    const runsBefore = w.runs.length;
    const voided = await w.voidEntry(res.json().entryId);
    expect(voided.statusCode).toBe(200);
    expect(voided.json()).toMatchObject({
      entry: { status: 'entered-in-error', saved: null }, resaved: 0, skipped: 0,
      warning: expect.stringMatching(/records this entry made are not known/),
    });
    expect(w.runs).toHaveLength(runsBefore);
    await w.db.destroy();
  });

  it('still answers success when settling the row fails after a completed save', async () => {
    const w = await world();
    const real = (w.ctx as any).formEntries;
    (w.ctx as any).formEntries = { ...real, finish: async () => { throw new Error('db gone'); } };
    const formId = await w.createForm();
    const res = await w.submit(w.appFor(), formId, { num: 'CS-1', fac: siteA });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, runId: 'run-ok' });
    expect((await w.rows(formId))[0]).toMatchObject({ id: res.json().entryId, status: 'active', saved: null });
    await w.db.destroy();
  });
});
