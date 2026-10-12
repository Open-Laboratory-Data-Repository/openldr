import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { PatientIndexError, type AppContext } from '@openldr/bootstrap';
import { registerPatientRoutes } from './patient-routes';
import './auth-plugin';

type Impl = (...args: any[]) => Promise<unknown> | unknown;
const LIST = { rows: [{ ref: 'r1' }], total: 1, masked: false };
const DETAIL = { ref: 'r1', id: 'hl7-1', masked: false };
const SYSTEM = { system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 1, listColumn: true, searchable: true };

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => (...args) => { calls.push({ method, args }); return impl(...args); };
  const ctx = {
    patientIndex: {
      list: spy('list', over.list ?? (async () => LIST)),
      get: spy('get', over.get ?? (async () => DETAIL)),
      requests: spy('requests', over.requests ?? (async () => ({ rows: [], total: 0 }))),
      idForRef: spy('idForRef', over.idForRef ?? (() => 'hl7-1')),
    },
    patientIdentifierSystems: {
      list: spy('systems.list', over['systems.list'] ?? (async () => ({ rows: [SYSTEM], total: 1, ownedHere: true }))),
      get: spy('systems.get', over['systems.get'] ?? (async () => null)),
      set: spy('systems.set', over['systems.set'] ?? (async () => SYSTEM)),
    },
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, calls, audit };
}

function appWith(ctx: AppContext, capabilities: string[]) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'u1', username: 'user', displayName: null, roles: [], capabilities };
  });
  registerPatientRoutes(app, ctx);
  return app;
}

const ALL = ['patients.view', 'patients.view_identifiers', 'patients.manage'];

describe('patient routes', () => {
  it('lists unmasked for view_identifiers and audits the count, never the search text', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const res = await appWith(ctx, ALL).inject({ method: 'GET', url: '/api/patients?search=123456%2F10%2F1&status=all&limit=10' });
    expect([res.statusCode, res.json()]).toEqual([200, LIST]);
    expect(calls[0]).toEqual({ method: 'list', args: [{ q: '123456/10/1', status: 'all', limit: 10, offset: 0 }, { unmask: true }] });
    expect(audit.map((a) => [a.action, a.entityType, a.entityId, a.metadata])).toEqual([['patients.list', 'patient', 'list', { count: 1 }]]);
    expect(JSON.stringify(audit)).not.toContain('123456');
  });

  it('lists masked for view only and writes no audit', async () => {
    const { ctx, calls, audit } = fakeCtx({ list: async () => ({ rows: [], total: 0, masked: true }) });
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients?search=Mwan' });
    expect(res.statusCode).toBe(200);
    expect(calls[0].args[1]).toEqual({ unmask: false });
    expect(audit).toEqual([]);
  });

  it('refuses a bad list query with 400 before the service', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ALL).inject({ method: 'GET', url: '/api/patients?status=gone' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'status must be active, merged or all' }]);
    expect(calls).toEqual([]);
  });

  it('refuses every route without patients.view', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, []);
    for (const url of ['/api/patients', '/api/patients/r1', '/api/patients/r1/requests', '/api/patients/identifier-systems']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
    }
  });

  it('shows a detail unmasked and audits the patient id; masked writes no audit', async () => {
    const a = fakeCtx();
    const res = await appWith(a.ctx, ALL).inject({ method: 'GET', url: '/api/patients/r1' });
    expect([res.statusCode, res.json()]).toEqual([200, DETAIL]);
    expect(a.calls[0]).toEqual({ method: 'get', args: ['r1', { unmask: true }] });
    expect(a.audit.map((e) => [e.action, e.entityId])).toEqual([['patients.view', 'hl7-1']]);
    const b = fakeCtx();
    await appWith(b.ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/r1' });
    expect(b.calls[0].args[1]).toEqual({ unmask: false });
    expect(b.audit).toEqual([]);
  });

  it('answers a bad ref with 404, on the detail and on requests', async () => {
    const notFound = async () => { throw new PatientIndexError('patient not found', 'not-found'); };
    const { ctx } = fakeCtx({ get: notFound, requests: notFound });
    const app = appWith(ctx, ALL);
    for (const url of ['/api/patients/zzz', '/api/patients/zzz/requests']) {
      const res = await app.inject({ method: 'GET', url });
      expect([res.statusCode, res.json()]).toEqual([404, { error: 'patient not found', kind: 'not-found' }]);
    }
  });

  it('pages requests', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/r1/requests?limit=5&offset=10' });
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toEqual({ method: 'requests', args: ['r1', { limit: 5, offset: 10 }] });
  });

  it('routes /identifier-systems to the systems list, not to a patient ref', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/identifier-systems' });
    expect(res.statusCode).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(['systems.list']);
  });

  it('saves a system label with patients.manage and audits before and after', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: true };
    const res = await appWith(ctx, ALL).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: body });
    expect([res.statusCode, res.json()]).toEqual([200, SYSTEM]);
    expect(calls.map((c) => c.method)).toEqual(['systems.get', 'systems.set']);
    expect(audit.map((a) => [a.action, a.entityId, a.before, a.after])).toEqual([['patients.identifier_system.update', 'urn:zm:mpi', null, SYSTEM]]);
  });

  it('refuses the label edit without patients.manage, on bad input, and when central owns it', async () => {
    const body = { system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: true };
    expect((await appWith(fakeCtx().ctx, ['patients.view']).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: body })).statusCode).toBe(403);
    const bad = await appWith(fakeCtx().ctx, ALL).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: { ...body, system: '' } });
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'system is required' }]);
    const central = fakeCtx({ 'systems.set': async () => { throw new PatientIndexError('central owns it', 'central-managed'); } });
    const res = await appWith(central.ctx, ALL).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: body });
    expect([res.statusCode, res.json().kind]).toEqual([409, 'central-managed']);
  });
});
