import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { ReceptionError, TEST_CATALOG_SYSTEM, type AppContext, type ReceptionOrder } from '@openldr/bootstrap';
import { FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { registerLabRoutes } from './lab-routes';
import './auth-plugin';

type Impl = (...args: any[]) => Promise<unknown> | unknown;

const ORDER: ReceptionOrder = {
  requisition: 'REQ-1',
  facility: { code: 'F1', display: 'Clinic One' },
  origin: 'lab-desk',
  patient: { id: 'p1', display: 'Ana Banda' },
  priority: 'routine',
  clinician: 'Dr K',
  note: null,
  tests: [{ serviceRequestId: 'sr1', system: TEST_CATALOG_SYSTEM, code: 'HB', display: 'Haemoglobin', status: 'active' }],
  specimens: [{ id: 'sp1', type: { system: 'urn:t', code: 'BLD', display: 'Blood' }, condition: 'Good', receivedTime: '2026-11-23T08:00:00Z' }],
};
const PATIENT = { id: 'p1', name: 'Ana Banda', birthDate: '1990-01-02', gender: 'female', identifiers: [{ system: 'urn:mpi', value: 'M1' }] };

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => (...args) => { calls.push({ method, args }); return impl(...args); };
  const ctx = {
    labReception: {
      findOrders: spy('findOrders', over.findOrders ?? (async () => [ORDER])),
      registerOrder: spy('registerOrder', over.registerOrder ?? (async () => ORDER)),
      correctOrder: spy('correctOrder', over.correctOrder ?? (async () => ORDER)),
      searchPatients: spy('searchPatients', over.searchPatients ?? (async () => [PATIENT])),
      registerPatient: spy('registerPatient', over.registerPatient ?? (async () => ({ id: 'p9', display: 'Ana Banda' }))),
      receiveSample: spy('receiveSample', over.receiveSample ?? (async () => ORDER)),
      sampleChoices: spy('sampleChoices', over.sampleChoices ?? (async () => ({ types: [{ system: 'urn:t', code: 'BLD', display: 'Blood' }] }))),
    },
    testCatalog: {
      list: spy('catalog.list', over['catalog.list'] ?? (async () => ({
        rows: [
          { code: 'HB', display: 'Haemoglobin', lab: { enabled: true, localDisplay: null } },
          { code: 'GLU', display: 'Glucose', lab: { enabled: true, localDisplay: 'Blood sugar' } },
        ],
        total: 2,
        ownedHere: true,
      }))),
    },
    terminology: {
      admin: {
        terms: {
          search: spy('terms.search', over['terms.search'] ?? (async () => ({
            rows: [{ system: FACILITY_REGISTRY_SYSTEM, code: 'F1', display: 'Clinic One', status: 'ACTIVE' }],
            total: 1,
          }))),
        },
      },
    },
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, calls, audit };
}

function appWith(ctx: AppContext, capabilities: string[], user: Record<string, unknown> | null = {}) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user === null) return;
    req.user = { id: 'u1', username: 'desk1', displayName: 'Desk One', roles: [], capabilities, ...user } as never;
  });
  registerLabRoutes(app, ctx);
  return app;
}

const CAP = ['lab.receive'];
const ORDER_BODY = { requisition: 'REQ-1', facilityCode: 'F1', patientId: 'p1', tests: [{ system: TEST_CATALOG_SYSTEM, code: 'HB' }] };

const ROUTES: Array<{ method: 'GET' | 'POST'; url: string; payload?: unknown }> = [
  { method: 'GET', url: '/api/lab/orders?requisition=REQ-1' },
  { method: 'POST', url: '/api/lab/orders', payload: ORDER_BODY },
  { method: 'POST', url: '/api/lab/orders/correct', payload: { requisition: 'REQ-1', facilityCode: 'F1', changes: { priority: 'stat' }, reason: 'typo' } },
  { method: 'GET', url: '/api/lab/patients?identifier=M1' },
  { method: 'POST', url: '/api/lab/patients', payload: { given: 'Ana', family: 'Banda', gender: 'female', birthDate: '1990-01-02' } },
  { method: 'POST', url: '/api/lab/samples', payload: { requisition: 'REQ-1', facilityCode: 'F1', type: { system: 'urn:t', code: 'BLD' } } },
  { method: 'GET', url: '/api/lab/samples/choices?requisition=REQ-1&facility=F1' },
  { method: 'GET', url: '/api/lab/facilities?q=cl' },
  { method: 'GET', url: '/api/lab/tests?q=h' },
];

describe('lab reception routes', () => {
  it.each(ROUTES)('$method $url refuses without lab.receive and calls nothing', async (r) => {
    const { ctx, calls, audit } = fakeCtx();
    // forms.view, facilities.view and terminology.view do not open these routes (ruling 8).
    const res = await appWith(ctx, ['forms.view', 'facilities.view', 'terminology.view', 'patients.view']).inject(r as never);
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
    expect(audit).toEqual([]);
  });

  it.each(ROUTES)('$method $url refuses a request with no user', async (r) => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, CAP, null).inject(r as never);
    expect(res.statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  describe('GET /api/lab/orders', () => {
    it('finds the orders by requisition and pins the ReceptionOrder wire shape', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/orders?requisition=REQ-1' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        rows: [{
          requisition: 'REQ-1',
          facility: { code: 'F1', display: 'Clinic One' },
          origin: 'lab-desk',
          patient: { id: 'p1', display: 'Ana Banda' },
          priority: 'routine',
          clinician: 'Dr K',
          note: null,
          tests: [{ serviceRequestId: 'sr1', system: TEST_CATALOG_SYSTEM, code: 'HB', display: 'Haemoglobin', status: 'active' }],
          specimens: [{ id: 'sp1', type: { system: 'urn:t', code: 'BLD', display: 'Blood' }, condition: 'Good', receivedTime: '2026-11-23T08:00:00Z' }],
        }],
      });
      expect(calls).toEqual([{ method: 'findOrders', args: ['REQ-1'] }]);
    });

    it('refuses a missing requisition with 400 and a plain error', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/orders' });
      expect(res.statusCode).toBe(400);
      expect(typeof res.json().error).toBe('string');
      expect(res.json().error).toContain('requisition');
      expect(calls).toEqual([]);
    });
  });

  describe('POST /api/lab/orders', () => {
    it('registers with the display name as actor, answers 201 and audits without the patient name', async () => {
      const { ctx, calls, audit } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders', payload: { ...ORDER_BODY, priority: 'stat' } });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(ORDER);
      expect(calls).toEqual([{ method: 'registerOrder', args: [{ ...ORDER_BODY, priority: 'stat' }, 'Desk One'] }]);
      expect(audit.map((a) => [a.action, a.entityType, a.entityId, a.metadata])).toEqual([
        ['lab.order.register', 'lab_order', 'REQ-1', { facility: 'F1', tests: ['HB'] }],
      ]);
      expect(JSON.stringify(audit)).not.toContain('Ana');
    });

    it('uses the username when there is no display name', async () => {
      const { ctx, calls } = fakeCtx();
      await appWith(ctx, CAP, { displayName: null }).inject({ method: 'POST', url: '/api/lab/orders', payload: ORDER_BODY });
      expect(calls[0]!.args[1]).toBe('desk1');
    });

    it('refuses a body with no tests with 400 before calling the service', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders', payload: { ...ORDER_BODY, tests: [] } });
      expect(res.statusCode).toBe(400);
      expect(typeof res.json().error).toBe('string');
      expect(calls).toEqual([]);
    });

    it.each([
      ['invalid', 400],
      ['not-found', 404],
      ['conflict', 409],
    ] as const)('maps ReceptionError %s to %i and audits nothing', async (reason, status) => {
      const { ctx, audit } = fakeCtx({ registerOrder: async () => { throw new ReceptionError(reason, `refused: ${reason}`); } });
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders', payload: ORDER_BODY });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: `refused: ${reason}`, reason });
      expect(audit).toEqual([]);
    });

    it('answers 409 when two desks register the same order at once and the store refuses the second', async () => {
      const unique = Object.assign(new Error('duplicate key value violates unique constraint "resource_history_pkey"'), { code: '23505' });
      const { ctx, audit } = fakeCtx({ registerOrder: async () => { throw unique; } });
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders', payload: ORDER_BODY });
      expect(res.statusCode).toBe(409);
      expect(res.json().reason).toBe('conflict');
      expect(res.json().error).not.toContain('resource_history');
      expect(audit).toEqual([]);
    });
  });

  describe('POST /api/lab/orders/correct', () => {
    const body = { requisition: 'REQ-1', facilityCode: 'F1', changes: { priority: 'stat', note: null }, reason: 'typo' };

    it('corrects, and audits the fields changed but not the values', async () => {
      const { ctx, calls, audit } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders/correct', payload: body });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(ORDER);
      expect(calls).toEqual([{ method: 'correctOrder', args: [body, 'Desk One'] }]);
      expect(audit.map((a) => [a.action, a.entityType, a.entityId, a.metadata])).toEqual([
        ['lab.order.correct', 'lab_order', 'REQ-1', { facility: 'F1', fields: ['priority', 'note'] }],
      ]);
    });

    it('passes a change the desk may not make through to the service, which refuses it', async () => {
      const { ctx, calls } = fakeCtx({ correctOrder: async () => { throw new ReceptionError('invalid', 'not the tests'); } });
      const res = await appWith(ctx, CAP).inject({
        method: 'POST', url: '/api/lab/orders/correct', payload: { ...body, changes: { tests: [] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'not the tests', reason: 'invalid' });
      expect((calls[0]!.args[0] as { changes: unknown }).changes).toEqual({ tests: [] });
    });

    it('takes a null facility for an order that names none', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders/correct', payload: { ...body, facilityCode: null } });
      expect(res.statusCode).toBe(200);
      expect((calls[0]!.args[0] as { facilityCode: unknown }).facilityCode).toBeNull();
    });

    it('maps not-found to 404', async () => {
      const { ctx } = fakeCtx({ correctOrder: async () => { throw new ReceptionError('not-found', 'no order'); } });
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders/correct', payload: body });
      expect([res.statusCode, res.json()]).toEqual([404, { error: 'no order', reason: 'not-found' }]);
    });

    it('refuses a body with no reason field with 400', async () => {
      const { ctx, calls } = fakeCtx();
      const { reason: _r, ...rest } = body;
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/orders/correct', payload: rest });
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    });
  });

  describe('GET /api/lab/patients', () => {
    it('searches and pins the patient search wire shape', async () => {
      const { ctx, calls, audit } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/patients?name=Ana%20Banda&birthDate=1990-01-02' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        rows: [{ id: 'p1', name: 'Ana Banda', birthDate: '1990-01-02', gender: 'female', identifiers: [{ system: 'urn:mpi', value: 'M1' }] }],
      });
      expect(calls).toEqual([{ method: 'searchPatients', args: [{ name: 'Ana Banda', birthDate: '1990-01-02' }] }]);
      expect(audit).toEqual([]);
    });

    it('passes an identifier search through', async () => {
      const { ctx, calls } = fakeCtx();
      await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/patients?identifier=M1' });
      expect(calls).toEqual([{ method: 'searchPatients', args: [{ identifier: 'M1' }] }]);
    });
  });

  describe('POST /api/lab/patients', () => {
    const body = { given: 'Ana', family: 'Banda', gender: 'female', ageYears: 30, identifier: { system: 'urn:mpi', value: 'M1' } };

    it('registers, answers 201 and audits the id with no name or identifier', async () => {
      const { ctx, calls, audit } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/patients', payload: body });
      expect([res.statusCode, res.json()]).toEqual([201, { id: 'p9', display: 'Ana Banda' }]);
      expect(calls).toEqual([{ method: 'registerPatient', args: [body, 'Desk One'] }]);
      expect(audit.map((a) => [a.action, a.entityType, a.entityId, a.metadata])).toEqual([['lab.patient.register', 'patient', 'p9', undefined]]);
      const text = JSON.stringify(audit);
      expect(text).not.toContain('Ana');
      expect(text).not.toContain('M1');
    });

    it('refuses an age that is not a number with 400', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/patients', payload: { ...body, ageYears: 'thirty' } });
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    });

    it('maps the service refusal to 400', async () => {
      const { ctx } = fakeCtx({ registerPatient: async () => { throw new ReceptionError('invalid', 'Sex must be one of male, female, other, unknown.'); } });
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/patients', payload: { ...body, gender: 'x' } });
      expect([res.statusCode, res.json().reason]).toEqual([400, 'invalid']);
    });
  });

  describe('POST /api/lab/samples', () => {
    const body = {
      requisition: 'REQ-1', facilityCode: 'F1',
      type: { system: 'urn:t', code: 'BLD' }, condition: { system: 'urn:c', code: 'OK' },
      serviceRequestIds: ['sr1'], receivedTime: '2026-11-23T08:00:00Z',
    };

    it('receives and audits the specimen with its type and condition codes', async () => {
      const { ctx, calls, audit } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/samples', payload: body });
      expect([res.statusCode, res.json()]).toEqual([200, ORDER]);
      expect(calls).toEqual([{ method: 'receiveSample', args: [body, 'Desk One'] }]);
      expect(audit.map((a) => [a.action, a.entityType, a.entityId, a.metadata])).toEqual([
        ['lab.sample.receive', 'specimen', 'sp1', { requisition: 'REQ-1', facility: 'F1', type: 'BLD', condition: 'OK' }],
      ]);
    });

    it.each([['not-found', 404], ['invalid', 400]] as const)('maps %s to %i', async (reason, status) => {
      const { ctx, audit } = fakeCtx({ receiveSample: async () => { throw new ReceptionError(reason, 'no'); } });
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/samples', payload: body });
      expect(res.statusCode).toBe(status);
      expect(audit).toEqual([]);
    });

    it('refuses a sample with no type with 400', async () => {
      const { ctx, calls } = fakeCtx();
      const { type: _t, ...rest } = body;
      const res = await appWith(ctx, CAP).inject({ method: 'POST', url: '/api/lab/samples', payload: rest });
      expect(res.statusCode).toBe(400);
      expect(calls).toEqual([]);
    });
  });

  describe('GET /api/lab/samples/choices', () => {
    it('answers the sample types for the order', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/samples/choices?requisition=REQ-1&facility=F1' });
      expect([res.statusCode, res.json()]).toEqual([200, { types: [{ system: 'urn:t', code: 'BLD', display: 'Blood' }] }]);
      expect(calls).toEqual([{ method: 'sampleChoices', args: ['REQ-1', 'F1'] }]);
    });

    it('passes a blank facility as null', async () => {
      const { ctx, calls } = fakeCtx();
      await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/samples/choices?requisition=REQ-1' });
      expect(calls).toEqual([{ method: 'sampleChoices', args: ['REQ-1', null] }]);
    });

    it('maps not-found to 404', async () => {
      const { ctx } = fakeCtx({ sampleChoices: async () => { throw new ReceptionError('not-found', 'No order REQ-1 was found.'); } });
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/samples/choices?requisition=REQ-1' });
      expect([res.statusCode, res.json()]).toEqual([404, { error: 'No order REQ-1 was found.', reason: 'not-found' }]);
    });
  });

  describe('GET /api/lab/facilities', () => {
    it('searches the facility register, top 20', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/facilities?q=%20cl%20' });
      expect([res.statusCode, res.json()]).toEqual([200, { rows: [{ code: 'F1', display: 'Clinic One' }] }]);
      expect(calls).toEqual([{ method: 'terms.search', args: [FACILITY_REGISTRY_SYSTEM, { query: 'cl', limit: 20, offset: 0 }] }]);
    });

    it.each(['', 'c', '%20c%20'])('answers no rows for q=%j without searching', async (q) => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: `/api/lab/facilities?q=${q}` });
      expect([res.statusCode, res.json()]).toEqual([200, { rows: [] }]);
      expect(calls).toEqual([]);
    });
  });

  describe('GET /api/lab/tests', () => {
    it('lists the active tests enabled at this lab, top 50, named by the lab', async () => {
      const { ctx, calls } = fakeCtx();
      const res = await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/tests?q=gl' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        rows: [
          { system: TEST_CATALOG_SYSTEM, code: 'HB', display: 'Haemoglobin' },
          { system: TEST_CATALOG_SYSTEM, code: 'GLU', display: 'Blood sugar' },
        ],
      });
      expect(calls).toEqual([{ method: 'catalog.list', args: [{ q: 'gl', enabled: true, status: 'active', limit: 50, offset: 0 }] }]);
    });

    it('lists without a search term', async () => {
      const { ctx, calls } = fakeCtx();
      await appWith(ctx, CAP).inject({ method: 'GET', url: '/api/lab/tests' });
      expect(calls).toEqual([{ method: 'catalog.list', args: [{ enabled: true, status: 'active', limit: 50, offset: 0 }] }]);
    });
  });
});
