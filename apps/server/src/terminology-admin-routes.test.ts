import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { makeMigratedDb } from '@openldr/db/testing';
import { createTerminologyAdminStore, createFacilityJobStore, DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { registerTerminologyAdminRoutes } from './terminology-admin-routes';
import { registerErrorHandler } from './error-handler';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null; before?: unknown; after?: unknown; metadata?: unknown }> = [];
  const ctxState = { active: false, enqueued: [] as any[], latest: null as any, put: [] as string[], deleted: [] as string[], codingSystem: null as any, upserts: [] as any[], jobsForSystem: [] as any[], deleteThrows: null as any, unlinked: [] as string[] };
  const admin = {
    publishers: {
      create: async (d: any) => ({ id: 'pub1', ...d }),
      update: async (id: string, d: any) => ({ id, ...d }),
      delete: async () => {},
    },
    codingSystems: {
      list: async () => [],
      create: async (d: any) => ({ id: 'sys1', ...d }),
      update: async (id: string, d: any) => ({ id, ...d }),
      delete: async (_id: string, _opts?: any) => { if (ctxState.deleteThrows) throw ctxState.deleteThrows; },
      getByUrl: async (_url: string) => ctxState.codingSystem,
      upsertByUrl: async (input: any) => { ctxState.codingSystem = { id: 'cs-url-LOINC', url: input.url, systemCode: input.systemCode, systemName: input.systemName, publisherId: input.publisherId, systemVersion: input.systemVersion ?? null, active: true, seeded: true, description: null }; ctxState.upserts.push(input); },
    },
    valueSets: {
      get: async (id: string) => ({ id, url: 'u' }),
      save: async (d: any) => ({ id: 'vs1', ...d }),
      delete: async () => {},
      duplicate: async (id: string) => ({ id: 'vs2', sourceId: id }),
      importFhir: async (r: any) => ({ id: 'vs9', url: 'http://imported' }),
    },
  };
  const ctx = {
    terminology: { admin, ontology: { unlink: async (id: string) => { ctxState.unlinked.push(id); } } },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    terminologyJobs: {
      hasActive: async () => ctxState.active,
      enqueue: async (input: any) => { ctxState.enqueued.push(input); return { id: 'tij_1', status: 'queued', ...input }; },
      latestForSystem: async () => ctxState.latest,
      listForCodingSystem: async (_id: string) => ctxState.jobsForSystem,
      get: async () => ctxState.latest,
    },
    blob: {
      putStream: async (key: string) => { ctxState.put.push(key); },
      delete: async (key: string) => { ctxState.deleted.push(key); },
    },
  } as unknown as AppContext;
  return { ctx, auditEvents, ctxState };
}

function appWith(ctx: AppContext, roles: string[] = ['lab_admin'], capabilities: string[] = ['terminology.manage']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles, capabilities }; });
  registerTerminologyAdminRoutes(app, ctx);
  return app;
}

describe('terminology admin RBAC', () => {
  it('a lab_technician cannot mutate terminology (create/import) — 403', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['lab_technician'], []);
    expect((await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/terminology/systems/sys9' })).statusCode).toBe(403);
  });

  it('read-only terminology GETs are NOT role-gated (a lab_technician is not rejected)', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, ['lab_technician'], []);
    // The handler runs (no 401/403 from the guard); the fake ctx's list is not fully stubbed, so the
    // status itself is not asserted — only that RBAC did not block the read.
    const res = await app.inject({ method: 'GET', url: '/api/terminology/publishers' });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe('terminology admin audit', () => {
  it('audits publisher create with the request actor', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
    expect(auditEvents[0]).toMatchObject({ action: 'publisher.create', entityType: 'publisher', entityId: 'pub1', actorId: 'admin1' });
  });

  it('audits coding system delete', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/sys9' });
    expect(res.statusCode).toBe(204);
    expect(auditEvents[0]).toMatchObject({ action: 'coding_system.delete', entityType: 'coding_system', entityId: 'sys9' });
  });

  it('audits value set update with a before snapshot', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'PUT', url: '/api/terminology/valuesets/vs1', payload: { url: 'u', status: 'active', compose: {} } });
    expect(res.statusCode).toBe(200);
    expect(auditEvents[0]).toMatchObject({ action: 'value_set.update', entityType: 'value_set', entityId: 'vs1' });
    expect(auditEvents[0].before).toEqual({ id: 'vs1', url: 'u' });
  });

  it('audits a value-set import with counts, not the full entity', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/valuesets/import', headers: { 'content-type': 'application/fhir+json' }, payload: JSON.stringify({ resourceType: 'ValueSet', url: 'http://imported', status: 'active' }) });
    expect(res.statusCode).toBe(201);
    const ev = auditEvents.find((e) => e.action === 'value_set.import');
    expect(ev).toBeTruthy();
    expect((ev as any).after).toBeNull();
    expect((ev as any).metadata).toMatchObject({ id: 'vs9' });
  });

  it('best-effort: a failing audit recorder does not break the route', async () => {
    const { ctx } = fakeCtx();
    (ctx as any).audit.record = async () => { throw new Error('db down'); };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'P', role: 'local' } });
    expect(res.statusCode).toBe(201);
  });
});

describe('terminology admin: coding system cascade delete', () => {
  it('deletes an upload-created system (has an ingest job): 204, unlinks ontology, deletes its blob', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.jobsForSystem = [{ id: 'tij_1', blobKey: 'terminology-dist/loinc/tij_1.zip' }];
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/cs-url-LOINC' });
    expect(res.statusCode).toBe(204);
    expect(ctxState.deleted).toEqual(['terminology-dist/loinc/tij_1.zip']);
    expect(ctxState.unlinked).toEqual(['cs-url-LOINC']);
  });

  it('a protected (system-managed) coding system returns 409 with the guard message', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.deleteThrows = Object.assign(new Error('This is a system-managed coding system and cannot be deleted.'), { name: 'TerminologyAdminError', kind: 'conflict' });
    const app = appWith(ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/systems/cs-fhir' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/system-managed coding system/i);
    expect(ctxState.deleted).toEqual([]);
  });
});

describe('terminology distribution upload/status/purge (publisher-scoped)', () => {
  it('resolve-or-CREATES the coding system then enqueues (201) when none exists', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = null;
    const app = appWith(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true&version=2.82',
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('PK-fake-zip'),
    });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts[0]).toMatchObject({ url: 'http://loinc.org', systemCode: 'LOINC', publisherId: 'pub-loinc' });
    expect(ctxState.enqueued[0]).toMatchObject({ systemType: 'loinc', codingSystemId: 'cs-url-LOINC', version: '2.82' });
    expect(res.json().jobId).toBe('tij_1');
  });

  it('REUSES an existing coding system (no upsert) and enqueues', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = { id: 'cs-existing', url: 'http://loinc.org', systemCode: 'LOINC' };
    const app = appWith(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts.length).toBe(0);
    expect(ctxState.enqueued[0].codingSystemId).toBe('cs-existing');
  });

  it('rejects a missing license (400) and never stores', async () => {
    const { ctx, ctxState } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=false', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
    expect(ctxState.put.length).toBe(0);
  });

  it('accepts a snomed upload (resolve-or-create + enqueue)', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.codingSystem = null;
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-snomed-ct/distribution?systemType=snomed&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(201);
    expect(ctxState.upserts[0]).toMatchObject({ url: 'http://snomed.info/sct' });
    expect(ctxState.enqueued[0].systemType).toBe('snomed');
  });

  it('reingest re-enqueues from the retained blob (202) for an upload-managed system', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.jobsForSystem = [{ id: 'tij_old', systemType: 'loinc', codingSystemId: 'cs-url-LOINC', blobKey: 'terminology-dist/loinc/cs-url-LOINC-1.zip', version: '2.82' }];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/systems/cs-url-LOINC/distribution/reingest' });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toBe('tij_1');
    expect(ctxState.enqueued[0]).toMatchObject({ systemType: 'loinc', codingSystemId: 'cs-url-LOINC', blobKey: 'terminology-dist/loinc/cs-url-LOINC-1.zip', version: '2.82' });
  });

  it('reingest returns 409 when there is no retained distribution', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.jobsForSystem = [];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/systems/cs-url-LOINC/distribution/reingest' });
    expect(res.statusCode).toBe(409);
    expect(ctxState.enqueued.length).toBe(0);
  });

  it('still rejects a genuinely unknown systemType (400)', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-x/distribution?systemType=nope&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when a job is already active (409)', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.active = true;
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(409);
  });

  it('GET job returns the latest job', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', phase: null, processed: 5, total: 5, error: null, version: '2.82', finishedAt: 'now' };
    const res = await appWith(ctx).inject({ method: 'GET', url: '/api/terminology/publishers/pub-loinc/distribution/job?systemType=loinc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', processed: 5 });
  });

  it('DELETE purges the retained blob', async () => {
    const { ctx, ctxState } = fakeCtx();
    ctxState.latest = { id: 'tij_1', status: 'ready', blobKey: 'terminology-dist/loinc/tij_1.zip', codingSystemId: 'cs-existing' };
    const res = await appWith(ctx).inject({ method: 'DELETE', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc' });
    expect(res.statusCode).toBe(204);
    expect(ctxState.deleted).toEqual(['terminology-dist/loinc/tij_1.zip']);
  });

  it('a lab_technician is rejected (403) on upload', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['lab_technician'], []).inject({ method: 'POST', url: '/api/terminology/publishers/pub-loinc/distribution?systemType=loinc&acceptLicense=true', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
    expect(res.statusCode).toBe(403);
  });
});

// ── the terms search `status` filter on the wire ────────────────────────────────────────────────
//
// The store has always taken `statuses: string[]`; the ROUTE was what narrowed it to one
// (`statuses: status ? [status] : undefined`), so `TermPicker` could only ever ask for a single
// status and sent none at all when the caller wanted two. `typecheck` cannot pin a query string —
// only a request through the real route can — so these go through a real migrated db and the real
// store rather than a hand-written double that would just report its own argument back.
describe('terms search: the status filter on the wire', () => {
  async function realApp() {
    const internalDb = await makeMigratedDb();
    const ctx = {
      terminology: { admin: createTerminologyAdminStore(internalDb) },
      audit: { record: async () => {} },
      logger: { error() {}, warn() {}, info() {} },
      internalDb,
    } as unknown as AppContext;
    const app = Fastify();
    registerErrorHandler(app);
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities: ['terminology.manage'] };
    });
    registerTerminologyAdminRoutes(app, ctx);
    return { app };
  }

  /** A system with one term per status, so any filter's effect is visible in the returned codes. */
  async function seeded(app: any): Promise<string> {
    const sys = await app.inject({
      method: 'POST', url: '/api/terminology/systems',
      payload: { systemCode: 'STATUSES', systemName: 'Status fixture', url: 'http://example.org/statuses', active: true },
    });
    expect(sys.statusCode).toBe(201);
    const id = sys.json().id as string;
    for (const [code, status] of [['L-1', 'ACTIVE'], ['L-2', 'DRAFT'], ['L-8', 'DISABLED'], ['L-9', 'DEPRECATED']]) {
      const res = await app.inject({ method: 'POST', url: `/api/terminology/systems/${id}/terms`, payload: { code, display: `Lab ${code}`, status } });
      expect(res.statusCode).toBe(201);
    }
    return id;
  }

  const codes = (res: any) => (res.json().rows as { code: string }[]).map((r) => r.code);

  it('a repeated status param filters on BOTH statuses', async () => {
    const { app } = await realApp();
    const id = await seeded(app);

    const res = await app.inject({ method: 'GET', url: `/api/terminology/systems/${id}/terms?status=ACTIVE&status=DRAFT` });
    expect(res.statusCode).toBe(200);
    expect(codes(res)).toEqual(['L-1', 'L-2']);
    // `total` drives pagination, so it has to be filtered too — an unfiltered count would page the
    // picker past the end of its own result set.
    expect(res.json().total).toBe(2);
  });

  it('one status still filters on that one', async () => {
    const { app } = await realApp();
    const id = await seeded(app);

    const res = await app.inject({ method: 'GET', url: `/api/terminology/systems/${id}/terms?status=ACTIVE` });
    expect(res.statusCode).toBe(200);
    expect(codes(res)).toEqual(['L-1']);
  });

  it('no status param still returns every status', async () => {
    const { app } = await realApp();
    const id = await seeded(app);

    const res = await app.inject({ method: 'GET', url: `/api/terminology/systems/${id}/terms` });
    expect(res.statusCode).toBe(200);
    expect(codes(res)).toEqual(['L-1', 'L-2', 'L-8', 'L-9']);
  });

  // ⛔ An empty `status=` must keep meaning "no filter", not "status equal to the empty string" —
  // the latter matches nothing and would empty the picker for a caller that built the query from a
  // cleared dropdown.
  it('an empty status param means no filter, not a filter on the empty string', async () => {
    const { app } = await realApp();
    const id = await seeded(app);

    const res = await app.inject({ method: 'GET', url: `/api/terminology/systems/${id}/terms?status=` });
    expect(res.statusCode).toBe(200);
    expect(codes(res)).toEqual(['L-1', 'L-2', 'L-8', 'L-9']);
  });
});

// ── facilities-phase-0 Task 11: facility mapping semantics at the API boundary ──────────────────
//
// The facilities Observed tab maps an observed string onto a registry facility by opening the
// SHIPPED `TermMappingDialog` (apps/studio/src/facilities/ObservedTab.tsx), which writes through
// THESE routes — there is no separate facility-mapping endpoint. So these routes are the domain
// boundary for the two rules the resolver already depends on, and the dialog defaulting `mapType`
// to `SAME-AS` / listing one mapping per row cannot be the only place either is enforced.
//
// A REAL migrated db + a REAL `createTerminologyAdminStore` is used here rather than `fakeCtx`
// above: both rules are about what ends up in `term_mappings`, which a hand-written store double
// would simply report back to itself.
describe('facility mapping semantics (terminology mapping routes)', () => {
  const OBSERVED = DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const mappingBody = (over: Record<string, unknown> = {}) => ({
    toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1', toDisplay: null,
    mapType: 'SAME-AS', relationship: null, owner: null, isActive: true, ...over,
  });

  async function realApp() {
    const internalDb = await makeMigratedDb();
    const auditEvents: any[] = [];
    const facilityJobs = createFacilityJobStore(internalDb);
    const ctx = {
      terminology: { admin: createTerminologyAdminStore(internalDb) },
      audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
      logger: { error() {}, warn() {}, info() {} },
      facilityJobs,
      // ⛔ REQUIRED, and the same real db the admin store is built on. Both the PUT and the DELETE
      // handlers read `term_mappings.to_system` straight off `ctx.internalDb` to decide whether the
      // mutation is a facility-dimension event (a retarget AWAY from a facility is invisible in the
      // request body). Omitting it does not fail loudly — the read throws inside the route's own
      // try/catch and comes back as a bare 500 on an otherwise valid request.
      internalDb,
    } as unknown as AppContext;
    const app = Fastify();
    // The coded 400 below is an AppError raised out of the handler, so the CENTRAL error handler
    // is what turns it into `{ error, code, correlationId }` — without it Fastify's default
    // 500 would swallow the code and this suite would be asserting on the wrong thing.
    registerErrorHandler(app);
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities: ['terminology.manage'] };
    });
    registerTerminologyAdminRoutes(app, ctx);
    return { app, internalDb, auditEvents, facilityJobs };
  }

  const saveMapping = (app: any, body: Record<string, unknown>) => app.inject({
    method: 'POST',
    url: `/api/terminology/terms/${encodeURIComponent(OBSERVED)}/${encodeURIComponent('BALAB')}/mappings`,
    payload: body,
  });

  const activeTargets = (db: any) => db.selectFrom('term_mappings').select(['to_code'])
    .where('from_code', '=', 'BALAB').where('is_active', '=', true).orderBy('to_code').execute();

  it('rejects a non-SAME-AS facility mapping at the API boundary, not just in the UI', async () => {
    const { app, internalDb } = await realApp();
    const res = await saveMapping(app, mappingBody({ mapType: 'RELATED-TO' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FAC0010');
    // …and nothing was written: the refusal is BEFORE the write, not a rollback after it.
    expect(await internalDb.selectFrom('term_mappings').selectAll().execute()).toEqual([]);
  });

  it('rejects a non-SAME-AS facility mapping on the update route too', async () => {
    const { app, internalDb } = await realApp();
    const id = (await saveMapping(app, mappingBody())).json().mapping.id;
    const res = await app.inject({
      method: 'PUT', url: `/api/terminology/mappings/${id}`,
      payload: { ...mappingBody({ mapType: 'BROADER-THAN' }), fromSystem: OBSERVED, fromCode: 'BALAB' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FAC0010');
    expect((await internalDb.selectFrom('term_mappings').select(['map_type']).execute())).toEqual([{ map_type: 'SAME-AS' }]);
  });

  // ⛔ Scoped to the facility registry. Every OTHER coding system keeps the full five-value
  // `MapType` vocabulary — a NARROWER-THAN onto LOINC is ordinary curation, and this guard must
  // not have quietly become a global one.
  it('leaves a non-SAME-AS mapping onto a NON-facility system alone', async () => {
    const { app } = await realApp();
    const res = await saveMapping(app, mappingBody({ toSystem: 'http://loinc.org', toCode: '101477-8', mapType: 'NARROWER-THAN' }));
    expect(res.statusCode).toBe(201);
  });

  it('supersedes the previous active mapping when a second facility is chosen', async () => {
    const { app, internalDb } = await realApp();
    expect((await saveMapping(app, mappingBody({ toCode: 'L-1' }))).statusCode).toBe(201);
    expect((await saveMapping(app, mappingBody({ toCode: 'L-2' }))).statusCode).toBe(201);

    expect(await activeTargets(internalDb)).toEqual([{ to_code: 'L-2' }]);
    // The superseded row is retained (deactivated), not deleted — the audit trail of what an
    // observed string used to resolve through has to survive the re-map.
    expect(await internalDb.selectFrom('term_mappings').select(['to_code', 'is_active']).orderBy('to_code').execute())
      .toEqual([{ to_code: 'L-1', is_active: false }, { to_code: 'L-2', is_active: true }]);
  });

  // ⛔ Re-saving the SAME facility is not a conflict (two rows naming one facility resolve
  // identically) — but it must not leave a duplicate behind either, because the uniqueness this
  // route now upholds is keyed on `(from_system, from_code)` alone.
  it('re-saving the SAME facility leaves exactly one row, still active', async () => {
    const { app, internalDb } = await realApp();
    const first = (await saveMapping(app, mappingBody({ toCode: 'L-1' }))).json().mapping.id;
    expect((await saveMapping(app, mappingBody({ toCode: 'L-1', toDisplay: 'Lab One' }))).statusCode).toBe(201);

    expect(await internalDb.selectFrom('term_mappings').select(['id', 'to_code', 'is_active']).execute())
      .toEqual([{ id: first, to_code: 'L-1', is_active: true }]);
  });

  // ⛔ The PUT hole. A PUT retargets one row, so it cannot ADD a competing mapping — but it CAN
  // re-activate a row an earlier save superseded, while another is still active, which is the same
  // violation reached a different way. Not reachable from the shipped dialog (it only ever edits
  // the mapping it listed) — which is precisely why the route, not the dialog, has to close it.
  it('re-activating a superseded mapping via PUT supersedes the current one instead of competing', async () => {
    const { app, internalDb } = await realApp();
    const first = (await saveMapping(app, mappingBody({ toCode: 'L-1' }))).json().mapping.id;
    await saveMapping(app, mappingBody({ toCode: 'L-2' }));

    const res = await app.inject({
      method: 'PUT', url: `/api/terminology/mappings/${first}`,
      payload: { ...mappingBody({ toCode: 'L-1' }), fromSystem: OBSERVED, fromCode: 'BALAB' },
    });

    expect(res.statusCode).toBe(200);
    expect(await activeTargets(internalDb)).toEqual([{ to_code: 'L-1' }]);
  });

  it('records the superseded mapping ids on the audit entry', async () => {
    const { app, auditEvents } = await realApp();
    const first = (await saveMapping(app, mappingBody({ toCode: 'L-1' }))).json().mapping.id;
    await saveMapping(app, mappingBody({ toCode: 'L-2' }));

    expect(auditEvents.at(-1)).toMatchObject({ action: 'term_mapping.create', metadata: { superseded: [first] } });
  });

  // The PUT path supersedes too (see the re-activation test above), so it owes the operator the
  // same accountability record. Without it a deactivation reached through PUT is invisible in the
  // audit log while the identical one reached through POST is not.
  it('records the superseded mapping ids on the audit entry for a PUT as well', async () => {
    const { app, auditEvents } = await realApp();
    const first = (await saveMapping(app, mappingBody({ toCode: 'L-1' }))).json().mapping.id;
    const second = (await saveMapping(app, mappingBody({ toCode: 'L-2' }))).json().mapping.id;

    await app.inject({
      method: 'PUT', url: `/api/terminology/mappings/${first}`,
      payload: { ...mappingBody({ toCode: 'L-1' }), fromSystem: OBSERVED, fromCode: 'BALAB' },
    });

    expect(auditEvents.at(-1)).toMatchObject({ action: 'term_mapping.update', metadata: { superseded: [second] } });
  });
});

// ── Task 6: enqueue a facility-map-rebuild after a MAPPING mutation ──────────────────────────────
//
// The Observed tab's "mapped" state is only true for report-facing purposes once the warehouse
// dimension is rebuilt from `term_mappings`, and these routes are the ONLY UI-reachable write path
// for that table (see the describe block above). Scoped with `isFacilityTarget` because this file
// is shared with generic terminology curation — a LOINC or ICD-10 mapping has no bearing on the
// facility dimension.
describe('facility mapping mutations enqueue a facility-map-rebuild (Task 6)', () => {
  const OBSERVED = DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const mappingBody = (over: Record<string, unknown> = {}) => ({
    toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1', toDisplay: null,
    mapType: 'SAME-AS', relationship: null, owner: null, isActive: true, ...over,
  });

  async function realApp() {
    const internalDb = await makeMigratedDb();
    const facilityJobs = createFacilityJobStore(internalDb);
    const ctx = {
      terminology: { admin: createTerminologyAdminStore(internalDb) },
      audit: { record: async () => {} },
      logger: { error() {}, warn() {}, info() {} },
      internalDb,
      facilityJobs,
    } as unknown as AppContext;
    const app = Fastify();
    registerErrorHandler(app);
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'], capabilities: ['terminology.manage'] };
    });
    registerTerminologyAdminRoutes(app, ctx);
    return { app, internalDb, facilityJobs };
  }

  async function drainFacilityJobs(store: ReturnType<typeof createFacilityJobStore>): Promise<void> {
    for (;;) {
      const job = await store.claimNext();
      if (!job) return;
      await store.finish(job.id, 'done', {});
    }
  }

  const saveMapping = (app: any, body: Record<string, unknown>) => app.inject({
    method: 'POST',
    url: `/api/terminology/terms/${encodeURIComponent(OBSERVED)}/${encodeURIComponent('BALAB')}/mappings`,
    payload: body,
  });

  const rebuildKinds = async (store: ReturnType<typeof createFacilityJobStore>) =>
    (await store.listUnresolved()).map((j) => j.kind);

  it('enqueues a rebuild when a FACILITY mapping is saved (POST)', async () => {
    const { app, facilityJobs } = await realApp();
    const res = await saveMapping(app, mappingBody());
    expect(res.statusCode).toBe(201);
    expect(await rebuildKinds(facilityJobs)).toContain('facility-map-rebuild');
  });

  it('⛔ does NOT enqueue for a non-facility terminology mapping (POST)', async () => {
    // This route is shared with generic terminology curation; a LOINC mapping has no bearing on
    // the facility dimension and must not trigger a warehouse rebuild.
    const { app, facilityJobs } = await realApp();
    const res = await saveMapping(app, mappingBody({ toSystem: 'http://loinc.org', toCode: '1234-5', mapType: 'NARROWER-THAN' }));
    expect(res.statusCode).toBe(201);
    expect(await facilityJobs.listUnresolved()).toEqual([]);
  });

  it('enqueues a rebuild when a facility mapping is updated (PUT)', async () => {
    const { app, facilityJobs } = await realApp();
    const id = (await saveMapping(app, mappingBody({ toCode: 'L-1' }))).json().mapping.id;
    await drainFacilityJobs(facilityJobs); // clear the POST's own enqueue so the PUT's is isolated

    const res = await app.inject({
      method: 'PUT', url: `/api/terminology/mappings/${id}`,
      payload: { ...mappingBody({ toCode: 'L-2' }), fromSystem: OBSERVED, fromCode: 'BALAB' },
    });
    expect(res.statusCode).toBe(200);
    expect(await rebuildKinds(facilityJobs)).toContain('facility-map-rebuild');
  });

  // ⛔ The retarget-AWAY case, which scoping the enqueue on the request BODY alone gets exactly
  // backwards. Pointing a facility mapping at a LOINC code REMOVES a facility resolution, so the
  // dimension is every bit as stale as when one is added — but the new body is not a facility
  // target, so a body-only check queues nothing. The UI then reports the row is no longer a facility
  // mapping while every report keeps resolving that observed string to the old facility, forever.
  // DELETE below already reads the row's own `to_system` first for precisely this reason; PUT did
  // not. The non-facility POST test above is what keeps this from being "just enqueue always".
  it('⛔ enqueues a rebuild when a facility mapping is retargeted AWAY from a facility (PUT)', async () => {
    const { app, facilityJobs } = await realApp();
    const id = (await saveMapping(app, mappingBody({ toCode: 'L-1' }))).json().mapping.id;
    await drainFacilityJobs(facilityJobs); // clear the POST's own enqueue so the PUT's is isolated

    const res = await app.inject({
      method: 'PUT', url: `/api/terminology/mappings/${id}`,
      payload: {
        ...mappingBody({ toSystem: 'http://loinc.org', toCode: '1234-5', mapType: 'NARROWER-THAN' }),
        fromSystem: OBSERVED, fromCode: 'BALAB',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(await rebuildKinds(facilityJobs)).toContain('facility-map-rebuild');
  });

  it('⛔ still does NOT enqueue when a non-facility mapping is retargeted to another non-facility system (PUT)', async () => {
    // The other side of the rule above: "either end is a facility target" must not decay into
    // "enqueue on every PUT". A LOINC mapping moved to another LOINC code touches nothing facility.
    const { app, facilityJobs } = await realApp();
    const id = (await saveMapping(app, mappingBody({ toSystem: 'http://loinc.org', toCode: '1234-5', mapType: 'NARROWER-THAN' }))).json().mapping.id;
    await drainFacilityJobs(facilityJobs);

    const res = await app.inject({
      method: 'PUT', url: `/api/terminology/mappings/${id}`,
      payload: {
        ...mappingBody({ toSystem: 'http://loinc.org', toCode: '9999-9', mapType: 'NARROWER-THAN' }),
        fromSystem: OBSERVED, fromCode: 'BALAB',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(await facilityJobs.listUnresolved()).toEqual([]);
  });

  it('enqueues a rebuild when a facility mapping is removed (DELETE)', async () => {
    const { app, facilityJobs } = await realApp();
    const id = (await saveMapping(app, mappingBody())).json().mapping.id;
    await drainFacilityJobs(facilityJobs); // clear the POST's own enqueue so the DELETE's is isolated

    const res = await app.inject({ method: 'DELETE', url: `/api/terminology/mappings/${id}` });
    expect(res.statusCode).toBe(204);
    expect(await rebuildKinds(facilityJobs)).toContain('facility-map-rebuild');
  });
});
