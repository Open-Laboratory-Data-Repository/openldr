import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createFormEntriesService, formAccess, readScopeRegistryRows } from '@openldr/bootstrap';
import { createFormEntryStore, type FormAccess, type FormAccessStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { toQuestionnaireResponse, type FormSchema } from '@openldr/forms';
import { registerFormEntryRoutes } from './form-entry-routes';
import './auth-plugin';

// Design 2026-11-22-form-entries, 5.2 and 5.3: who sees which site's entries.

const NOW = '2026-01-01T00:00:00.000Z';
const REGISTRY = 'urn:openldr:cs:facility-registry';

function field(over: Record<string, unknown>) {
  return {
    fhirPath: null, description: null, fieldType: 'text', required: false, enabled: true,
    cardinality: { min: 0, max: '1' }, section: 'main', ...over,
  };
}

const schema = {
  id: 'order', name: 'Order', versionLabel: null, fhirVersion: null, fhirResourceType: 'ServiceRequest',
  fhirProfileUrl: null, facilityId: null, targetPages: [], languages: ['en'], version: 1, active: true,
  status: 'draft', createdAt: NOW, updatedAt: NOW, sections: [{ id: 'main', label: 'Main', order: 0 }],
  fields: [
    field({ id: 'num', displayLabel: 'Requisition', order: 0, fhirPath: 'ServiceRequest.identifier.value' }),
    field({
      id: 'fac', displayLabel: 'Facility', fieldType: 'facility', order: 1, fhirPath: 'ServiceRequest.requester',
      fhirDiscriminator: { type: 'Organization' }, referenceTarget: REGISTRY,
    }),
    field({ id: 'name', displayLabel: 'Patient', order: 2 }),
  ],
} as unknown as FormSchema;

type Scope = { limited: false } | { limited: true; facilities: string[]; districts: never[]; regions: string[] };
const all: Scope = { limited: false };
const siteA: Scope = { limited: true, facilities: ['reg-a'], districts: [], regions: [] };
const siteB: Scope = { limited: true, facilities: ['reg-b'], districts: [], regions: [] };
const coast: Scope = { limited: true, facilities: [], districts: [], regions: ['Coast'] };

/** `secret` is open only to role r-other, so a clerk with no roles may not open it. */
function accessStore(): FormAccessStore {
  const lists: Record<string, FormAccess> = { secret: { open: ['r-other'], submit: [] } };
  return {
    async get(id) { return lists[id] ?? { open: [], submit: [] }; },
    async set() { throw new Error('not used'); },
    async forForms(ids) { return new Map(ids.filter((id) => lists[id]).map((id) => [id, lists[id]!])); },
    async removeRole() {},
  };
}

async function world() {
  const db = await makeMigratedDb();
  for (const [id, code, name] of [['reg-a', 'A1', 'Site A'], ['reg-b', 'B1', 'Site B']]) {
    await db.insertInto('facility_registry').values({
      id, facility_system: 'urn:test:mfl', facility_code: code, name, region: 'Coast', district: name,
      extras: '{}', source: 'test', created_at: NOW, updated_at: NOW,
    } as never).execute();
  }
  const store = createFormEntryStore(db as never);
  const access = accessStore();
  // The saved form copies, keyed by id, as the FHIR store would hold them.
  const saved = new Map<string, Record<string, unknown>>();
  // Other saved records, keyed `Type/id`, and what the void route sends and audits.
  const records = new Map<string, Record<string, unknown>>();
  const runs: any[] = [];
  const audits: any[] = [];
  const fhirGet = async (type: string, id: string) => {
    if (id === 'qr-broken') throw new Error('db gone');
    return type === 'QuestionnaireResponse' ? (saved.get(id) ?? null) : (records.get(`${type}/${id}`) ?? null);
  };
  const ctx = {
    forms: { get: async (id: string) => (id === 'form-1' || id === 'secret' ? { id, name: id, schema } : null) },
    formAccessStore: access,
    formAccess: formAccess({ access }),
    formEntries: createFormEntriesService({
      store, registryRows: () => readScopeRegistryRows(db as never),
      fhir: { get: fhirGet as never },
      runner: {
        runAndRecord: async (_w: string, _s: string, input: unknown) => {
          runs.push(input);
          return { runId: 'run-v', correlationId: null, status: 'completed', error: null, nodeMeta: {} };
        },
      },
      audit: async (actor, details) => { audits.push({ actor, details }); },
      logger: { warn: () => {}, error: () => {} } as never,
      // u-manager is a known user; any other id names no user any more.
      users: {
        getMany: async (ids: string[]) => ids.includes('u-manager')
          ? [{ id: 'u-manager', username: 'manager', displayName: 'Mary Manager' }] as never
          : [],
      },
    }),
    fhirStore: { get: fhirGet },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  };

  const appFor = (dataScope: Scope | undefined, opts: { id?: string; capabilities?: string[] } = {}) => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = {
        id: opts.id ?? 'u-clerk', username: 'clerk', displayName: null, roles: [], roleIds: [],
        capabilities: opts.capabilities ?? ['forms.view'], ...(dataScope ? { dataScope } : {}),
      } as never;
    });
    registerFormEntryRoutes(app, ctx as never);
    return app;
  };

  /** One entry, settled active, with a saved form copy holding these answers. */
  const add = async (formId: string, facilityId: string | null, entryKey: string, enteredBy: string, answers?: Record<string, unknown>) => {
    const e = await store.create({
      formId, facilityId, facilityCode: null, facilityName: null, entryKey, summary: [], enteredBy, enteredByName: enteredBy,
    });
    if (!answers) return e;
    const responseId = `qr-${entryKey}`;
    saved.set(responseId, { ...toQuestionnaireResponse(schema, answers as never), id: responseId } as never);
    return store.setSaved(e.id, { responseId, resources: [] }, 'active');
  };
  return { db, store, saved, records, runs, audits, appFor, add };
}

const keys = (body: { entries: { entryKey: string }[] }) => body.entries.map((e) => e.entryKey).sort();

describe('GET /api/forms/:id/entries', () => {
  it('shows an unlimited user every entry, and a user with no limit set the same', async () => {
    const w = await world();
    await w.add('form-1', 'reg-a', 'CS-A', 'u-x');
    await w.add('form-1', 'reg-b', 'CS-B', 'u-y');
    for (const scope of [all, undefined]) {
      const res = await w.appFor(scope).inject({ url: '/api/forms/form-1/entries' });
      expect(res.statusCode).toBe(200);
      expect(keys(res.json())).toEqual(['CS-A', 'CS-B']);
      expect(res.json().total).toBe(2);
    }
    await w.db.destroy();
  });

  it('never shows a user limited to site A the entries of site B, whatever the filter asks', async () => {
    const w = await world();
    await w.add('form-1', 'reg-a', 'CS-A', 'u-x');
    await w.add('form-1', 'reg-b', 'CS-B', 'u-y');
    const app = w.appFor(siteA);
    expect(keys((await app.inject({ url: '/api/forms/form-1/entries' })).json())).toEqual(['CS-A']);
    for (const q of ['search=CS-B', 'enteredBy=u-y', 'status=active&enteredBy=u-y&search=cs']) {
      const res = await app.inject({ url: `/api/forms/form-1/entries?${q}` });
      expect(res.statusCode, q).toBe(200);
      expect(res.json(), q).toEqual({ entries: [], total: 0 });
    }
    await w.db.destroy();
  });

  it("shows a limited user their own entry at another site, and an entry with no facility only to its maker", async () => {
    const w = await world();
    await w.add('form-1', 'reg-b', 'CS-MINE', 'u-clerk');
    await w.add('form-1', null, 'CS-NONE', 'u-y');
    expect(keys((await w.appFor(siteA).inject({ url: '/api/forms/form-1/entries' })).json())).toEqual(['CS-MINE']);
    expect(keys((await w.appFor(siteA, { id: 'u-y' }).inject({ url: '/api/forms/form-1/entries' })).json())).toEqual(['CS-NONE']);
    await w.db.destroy();
  });

  it('passes status, search and paging through', async () => {
    const w = await world();
    for (const k of ['CS-1', 'CS-2', 'CS-3']) await w.add('form-1', 'reg-a', k, 'u-x');
    const app = w.appFor(all);
    const page = (await app.inject({ url: '/api/forms/form-1/entries?limit=2&offset=1' })).json();
    expect(page.entries).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(keys((await app.inject({ url: '/api/forms/form-1/entries?search=cs-2' })).json())).toEqual(['CS-2']);
    expect((await app.inject({ url: '/api/forms/form-1/entries?status=entered-in-error' })).json().total).toBe(0);
    // Empty values, as a form sends them, count as left out.
    expect((await app.inject({ url: '/api/forms/form-1/entries?status=&enteredBy=&search=&limit=&offset=' })).json().total).toBe(3);
    await w.db.destroy();
  });

  it('answers 400 for a bad query value', async () => {
    const w = await world();
    const app = w.appFor(all);
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'limit=2.5', 'offset=-1', 'status=done', 'search=' + 'x'.repeat(201)]) {
      expect((await app.inject({ url: `/api/forms/form-1/entries?${q}` })).statusCode, q).toBe(400);
    }
    await w.db.destroy();
  });

  it('answers 404 for a form that does not exist or that the caller may not open', async () => {
    const w = await world();
    await w.add('secret', 'reg-a', 'CS-S', 'u-x');
    expect((await w.appFor(all).inject({ url: '/api/forms/nope/entries' })).statusCode).toBe(404);
    expect((await w.appFor(all).inject({ url: '/api/forms/secret/entries' })).statusCode).toBe(404);
    // An editor manages every form.
    const editor = w.appFor(all, { capabilities: ['forms.view', 'forms.edit'] });
    expect(keys((await editor.inject({ url: '/api/forms/secret/entries' })).json())).toEqual(['CS-S']);
    await w.db.destroy();
  });

  it('needs forms.view', async () => {
    const w = await world();
    for (const url of ['/api/forms/form-1/entries', '/api/forms/entries/x', '/api/forms/form-1/entry-context']) {
      expect((await w.appFor(all, { capabilities: ['forms.submit'] }).inject({ url })).statusCode, url).toBe(403);
    }
    await w.db.destroy();
  });
});

describe('GET /api/forms/entries/:entryId', () => {
  it('returns the entry with every answer from the saved copy, in form order', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x', {
      num: 'CS-1', fac: { system: REGISTRY, code: 'A1', display: 'Site A' }, name: 'y'.repeat(120),
    });
    const res = await w.appFor(siteA).inject({ url: `/api/forms/entries/${e.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: e.id, entryKey: 'CS-1', status: 'active' });
    expect(res.json().answers).toEqual([
      { fieldId: 'num', label: 'Requisition', value: 'CS-1' },
      { fieldId: 'fac', label: 'Facility', value: 'Site A' },
      { fieldId: 'name', label: 'Patient', value: 'y'.repeat(120) },
    ]);
    await w.db.destroy();
  });

  it('keeps the label the saved copy carries after the form is edited', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x', { num: 'CS-1', name: 'Amina' });
    // The copy as saved, carrying its own wording for the patient field.
    const qr = w.saved.get(e.saved!.responseId!)! as { item: { linkId: string; item?: { linkId: string; text?: string }[] }[] };
    qr.item[0]!.item!.find((i) => i.linkId === 'name')!.text = 'Patient name';
    const res = await w.appFor(all).inject({ url: `/api/forms/entries/${e.id}` });
    expect(res.json().answers).toEqual([
      { fieldId: 'num', label: 'Requisition', value: 'CS-1' },
      { fieldId: 'name', label: 'Patient name', value: 'Amina' },
    ]);
    await w.db.destroy();
  });

  it('answers null answers when there is no saved copy or it cannot be read', async () => {
    const w = await world();
    const bare = await w.add('form-1', 'reg-a', 'CS-1', 'u-x');
    const gone = await w.store.setSaved((await w.add('form-1', 'reg-a', 'CS-2', 'u-x')).id, { responseId: 'qr-missing', resources: [] }, 'incomplete');
    const broken = await w.store.setSaved((await w.add('form-1', 'reg-a', 'CS-3', 'u-x')).id, { responseId: 'qr-broken', resources: [] }, 'incomplete');
    for (const e of [bare, gone, broken]) {
      const res = await w.appFor(all).inject({ url: `/api/forms/entries/${e.id}` });
      expect(res.statusCode, e.entryKey!).toBe(200);
      expect(res.json().answers, e.entryKey!).toBeNull();
    }
    await w.db.destroy();
  });

  it('answers 404 to a user limited to site A for an entry of site B, as for one that does not exist', async () => {
    const w = await world();
    const b = await w.add('form-1', 'reg-b', 'CS-B', 'u-y', { num: 'CS-B' });
    const refused = await w.appFor(siteA).inject({ url: `/api/forms/entries/${b.id}` });
    const missing = await w.appFor(siteA).inject({ url: '/api/forms/entries/no-such-entry' });
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toEqual(missing.json());
    expect(missing.statusCode).toBe(404);
    // The same entry is open to site B's user, to its maker, and to an unlimited user.
    expect((await w.appFor(siteB).inject({ url: `/api/forms/entries/${b.id}` })).statusCode).toBe(200);
    expect((await w.appFor(siteA, { id: 'u-y' }).inject({ url: `/api/forms/entries/${b.id}` })).statusCode).toBe(200);
    expect((await w.appFor(all).inject({ url: `/api/forms/entries/${b.id}` })).statusCode).toBe(200);
    await w.db.destroy();
  });

  it('answers 404 for an entry of a form the caller may not open', async () => {
    const w = await world();
    const s = await w.add('secret', 'reg-a', 'CS-S', 'u-clerk');
    expect((await w.appFor(all).inject({ url: `/api/forms/entries/${s.id}` })).statusCode).toBe(404);
    expect((await w.appFor(all, { capabilities: ['forms.view', 'forms.edit'] }).inject({ url: `/api/forms/entries/${s.id}` })).statusCode).toBe(200);
    await w.db.destroy();
  });
});

describe('who marked an entry in error, by name', () => {
  it('names a known user on the list and on the read', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x');
    await w.store.void(e.id, { id: 'u-manager', reason: 'typo' });
    const app = w.appFor(all);
    const list = await app.inject({ url: '/api/forms/form-1/entries' });
    expect(list.json().entries[0]).toMatchObject({ statusBy: 'u-manager', statusByName: 'Mary Manager' });
    const one = await app.inject({ url: `/api/forms/entries/${e.id}` });
    expect(one.json()).toMatchObject({ statusBy: 'u-manager', statusByName: 'Mary Manager' });
    await w.db.destroy();
  });

  it('gives null for a user that no longer exists, and for an entry nobody marked', async () => {
    const w = await world();
    const gone = await w.add('form-1', 'reg-a', 'CS-1', 'u-x');
    const kept = await w.add('form-1', 'reg-a', 'CS-2', 'u-x');
    await w.store.void(gone.id, { id: 'u-removed', reason: 'typo' });
    const app = w.appFor(all);
    const list = await app.inject({ url: '/api/forms/form-1/entries' });
    const byKey = new Map(list.json().entries.map((e: { entryKey: string; statusByName: unknown }) => [e.entryKey, e.statusByName]));
    expect(byKey).toEqual(new Map([['CS-1', null], ['CS-2', null]]));
    const one = await app.inject({ url: `/api/forms/entries/${gone.id}` });
    expect(one.json()).toMatchObject({ statusBy: 'u-removed', statusByName: null });
    expect((await app.inject({ url: `/api/forms/entries/${kept.id}` })).json().statusByName).toBeNull();
    await w.db.destroy();
  });
});

describe('GET /api/forms/:id/entry-context', () => {
  it('locks a one-facility limit, offers a several-facility limit, and leaves no limit alone', async () => {
    const w = await world();
    const ctxOf = async (scope: Scope | undefined) => (await w.appFor(scope).inject({ url: '/api/forms/form-1/entry-context' })).json();
    expect(await ctxOf(siteA)).toEqual({
      facility: { id: 'reg-a', code: 'A1', name: 'Site A' }, locked: true, choices: [{ id: 'reg-a', code: 'A1', name: 'Site A' }],
    });
    expect(await ctxOf(coast)).toEqual({
      facility: null, locked: false, choices: [{ id: 'reg-a', code: 'A1', name: 'Site A' }, { id: 'reg-b', code: 'B1', name: 'Site B' }],
    });
    expect(await ctxOf(all)).toEqual({ facility: null, locked: false, choices: null });
    expect(await ctxOf(undefined)).toEqual({ facility: null, locked: false, choices: null });
    await w.db.destroy();
  });

  it('answers 404 for a form that does not exist or that the caller may not open', async () => {
    const w = await world();
    expect((await w.appFor(siteA).inject({ url: '/api/forms/nope/entry-context' })).statusCode).toBe(404);
    expect((await w.appFor(siteA).inject({ url: '/api/forms/secret/entry-context' })).statusCode).toBe(404);
    await w.db.destroy();
  });
});

describe('POST /api/forms/entries/:entryId/void', () => {
  const VOID = ['forms.view', 'forms.void_entries'];
  const voidIt = (app: ReturnType<Awaited<ReturnType<typeof world>>['appFor']>, id: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/forms/entries/${id}/void`, payload: payload as never });

  it('marks the entry, re-saves its records, and audits with the caller as actor', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x', { num: 'CS-1' });
    w.records.set('ServiceRequest/sr-1', { resourceType: 'ServiceRequest', id: 'sr-1', status: 'active' });
    await w.store.setSaved(e.id, { responseId: e.saved!.responseId, resources: [{ resourceType: 'ServiceRequest', id: 'sr-1' }] }, 'active');

    const res = await voidIt(w.appFor(all, { capabilities: VOID }), e.id, { reason: ' wrong patient ' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ entry: { id: e.id, status: 'entered-in-error', statusBy: 'u-clerk', statusReason: 'wrong patient' }, resaved: 2, skipped: 0 });
    expect(body).not.toHaveProperty('warning');
    expect(w.runs).toHaveLength(1);
    expect(w.runs[0].body.entry.map((x: any) => [x.request.url, x.resource.status])).toEqual([
      [`QuestionnaireResponse/${e.saved!.responseId}`, 'entered-in-error'], ['ServiceRequest/sr-1', 'entered-in-error'],
    ]);
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0].actor).toEqual({ actorType: 'user', actorId: 'u-clerk', actorName: 'clerk' });
    expect(w.audits[0].details).toMatchObject({ action: 'form.entry.void', entityId: e.id, metadata: { reason: 'wrong patient', resaved: 2, skipped: 0 } });
    await w.db.destroy();
  });

  it('answers 409 already-void for an entry already marked', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x');
    const app = w.appFor(all, { capabilities: VOID });
    expect((await voidIt(app, e.id, { reason: 'typo' })).statusCode).toBe(200);
    const again = await voidIt(app, e.id, { reason: 'typo' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already-void' });
    await w.db.destroy();
  });

  it('voids an incomplete entry with no saved records, with nothing re-saved and no warning', async () => {
    const w = await world();
    const e = await w.store.setSaved((await w.add('form-1', 'reg-a', 'CS-1', 'u-x')).id, { responseId: null, resources: [] }, 'incomplete');
    const res = await voidIt(w.appFor(all, { capabilities: VOID }), e.id, { reason: 'never finished' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entry: expect.objectContaining({ status: 'entered-in-error' }), resaved: 0, skipped: 0 });
    expect(w.runs).toHaveLength(0);
    await w.db.destroy();
  });

  it('answers 400 for a missing, empty or too long reason', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x');
    const app = w.appFor(all, { capabilities: VOID });
    for (const payload of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) }, { reason: 5 }]) {
      expect((await voidIt(app, e.id, payload)).statusCode, JSON.stringify(payload).slice(0, 40)).toBe(400);
    }
    expect((await w.store.get(e.id))!.status).toBe('active');
    await w.db.destroy();
  });

  it('answers 404 for an entry the caller may not see, of a form they may not open, or that does not exist', async () => {
    const w = await world();
    const b = await w.add('form-1', 'reg-b', 'CS-B', 'u-y');
    const s = await w.add('secret', 'reg-a', 'CS-S', 'u-x');
    expect((await voidIt(w.appFor(siteA, { capabilities: VOID }), b.id, { reason: 'typo' })).statusCode).toBe(404);
    expect((await voidIt(w.appFor(all, { capabilities: VOID }), s.id, { reason: 'typo' })).statusCode).toBe(404);
    expect((await voidIt(w.appFor(all, { capabilities: VOID }), 'no-such', { reason: 'typo' })).statusCode).toBe(404);
    expect((await w.store.get(b.id))!.status).toBe('active');
    expect((await w.store.get(s.id))!.status).toBe('active');
    await w.db.destroy();
  });

  it('needs forms.void_entries', async () => {
    const w = await world();
    const e = await w.add('form-1', 'reg-a', 'CS-1', 'u-x');
    expect((await voidIt(w.appFor(all, { capabilities: ['forms.view', 'forms.submit', 'forms.edit'] }), e.id, { reason: 'typo' })).statusCode).toBe(403);
    expect((await w.store.get(e.id))!.status).toBe('active');
    await w.db.destroy();
  });
});
