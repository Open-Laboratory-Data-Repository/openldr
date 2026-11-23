import { z } from 'zod';
import type { Logger } from '@openldr/core';
import { AppError } from '@openldr/core';
import { allowedResourceTypes } from '@openldr/marketplace';
import { PluginRequestError, type PluginCaller, type PluginRequests, type Provenance } from '@openldr/db';
import type { FacilityRegistryStore } from '@openldr/db';
import { TerminologyError, type Operations } from '@openldr/terminology';
import type { HostFn, HostPlugin, PluginHost } from '@openldr/plugins';
import { checkResources } from './import-run';
import { parsePatientFindQuery, parsePatientListQuery, type PatientDetail, type PatientIndex } from './patient-index';
import { PatientIndexError } from './patient-identifier-systems';
import { parseCatalogListQuery, type TestCatalog } from './test-catalog';
import type { AuditActor, AuditDetails } from './record-audit';
import { pluginPatientRefs } from './plugin-patient-ref';

// The CE host functions a plugin's server code calls (design 2026-11-23-lab-plugin, 5.2; plan
// 2026-11-23-plugin-host-2a-data, task 5). One set is built per call, for one plugin and one caller.
//
// What the plugin cannot change: the plugin id, version, grant and tables come from the stored,
// signed manifest row (HostPlugin), and the caller from CE's session (Task 6). A host function's
// input is only the request. Every input schema is strict, so a field such as `pluginId`, `caller`
// or `facilities` in the input is refused, never read.
//
// Every function answers `{ ok: true, result }` or `{ ok: false, error: { code, message } }`. None
// throws on purpose: the runner turns an unexpected throw into a HOST_ERROR result, and its text is
// logged here, never given to the plugin.

export type HostResult = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; issues?: unknown[] } };

const ok = (result: unknown): HostResult => ({ ok: true, result });
const fail = (code: string, message: string, issues?: unknown[]): HostResult =>
  ({ ok: false, error: issues ? { code, message, issues } : { code, message } });

/** The most facilities a limited caller's patient search binds. MSSQL takes about 2,100 bound
 *  values in one statement. */
export const MAX_PATIENT_SCOPE_FACILITIES = 2000;

export interface PluginHostDeps {
  /** Structured requests on a plugin's own tables (Task 3), on the internal database. */
  requests: Pick<PluginRequests, 'select' | 'write'>;
  patients: Pick<PatientIndex, 'list' | 'find' | 'get' | 'getById' | 'idForRef' | 'rowsByIds'>;
  /** The lasting key behind `pluginRef` (plugin-patient-ref.ts), read once and kept. */
  pluginRefKey(): Promise<Buffer>;
  testCatalog: Pick<TestCatalog, 'list' | 'get'>;
  terminology: Pick<Operations, 'expand' | 'lookup'>;
  facilityRegistry: Pick<FacilityRegistryStore, 'list' | 'get' | 'idsMatching'>;
  /** The latest stored FHIR resource with its stored provenance, or null. */
  fhirGetWithProvenance(resourceType: string, id: string): Promise<{ resource: unknown; provenance: Provenance } | null>;
  /** CE's FHIR save path with validation (bootstrap index.ts `workflowPersist`). */
  persist(resources: unknown[], provenance: Provenance): Promise<unknown>;
  audit(actor: AuditActor, details: AuditDetails): Promise<void>;
  logger: Logger;
}

const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

const patientSearchInput = z.object({
  search: z.string().max(200).optional(),
  // A strong-match lookup (ruling 5): one exact identifier, or given and family with a full birth
  // date. A caller with patients.find and not patients.view may search only this way.
  identifier: z.object({ system: z.string().max(2000).optional(), value: z.string().max(500) }).strict().optional(),
  given: z.string().max(200).optional(),
  family: z.string().max(200).optional(),
  birthDate: z.string().max(40).optional(),
  status: z.enum(['active', 'merged', 'all']).optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
}).strict();
const patientGetInput = z.object({ ref: z.string().min(1).max(500).optional(), pluginRef: z.string().min(1).max(500).optional() })
  .strict().refine((i) => (i.ref === undefined) !== (i.pluginRef === undefined), 'give ref or pluginRef, one of them');
/** The most patients one patients.getMany reads. */
export const MAX_GET_MANY = 100;
const patientGetManyInput = z.object({ pluginRefs: z.array(z.string().min(1).max(500)).min(1).max(MAX_GET_MANY) }).strict();
const patientRegisterInput = z.object({ patient: z.record(z.unknown()) }).strict();
const expandInput = z.object({
  url: z.string().min(1).max(2000),
  count: z.number().int().min(0).max(10_000).optional(),
  offset: z.number().int().min(0).optional(),
  filter: z.string().max(200).optional(),
}).strict();
const lookupInput = z.object({ system: z.string().min(1).max(2000), code: z.string().min(1).max(500) }).strict();
const catalogListInput = z.record(z.string().max(500)).refine((r) => Object.keys(r).length <= 20, 'too many fields');
const catalogGetInput = z.object({ code: z.string().min(1).max(500) }).strict();
const facilitySearchInput = z.object({
  q: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();
const facilityGetInput = z.object({ id: z.string().min(1).max(200) }).strict();
const ceReadInput = z.object({ op: z.string().min(1).max(100), input: z.unknown().optional() }).strict();
const fhirEmitInput = z.object({ resources: z.array(z.unknown()) }).strict();
const callerGetInput = z.object({}).strict();

/** The most record ids one fhir_emit audit row lists. The count and types are always complete. */
export const MAX_AUDITED_IDS = 200;

/** The ops `ce_read` answers (ruling 6). */
export const CE_READ_OPS = [
  'patients.search', 'patients.get', 'patients.getMany', 'patients.register', 'valueset.expand', 'valueset.lookup',
  'testCatalog.list', 'testCatalog.get', 'facilities.search', 'facilities.get', 'caller.get',
] as const;
type CeReadOp = typeof CE_READ_OPS[number];

class HostInputError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function parse<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
    throw new HostInputError('INVALID_REQUEST', `${what}: ${first?.message ?? 'not valid'}${where}`);
  }
  return r.data;
}

/** The caller's facilities, lowercased, or '*' for no limit. */
function scopeOf(caller: PluginCaller): Set<string> | '*' {
  if (caller.facilities === '*') return '*';
  return new Set(caller.facilities.map((f) => f.toLowerCase()));
}

/** The facility id an `Organization/<id>` reference names, lowercased, or null. */
function orgId(reference: unknown): string | null {
  if (typeof reference !== 'string') return null;
  const m = /^Organization\/(.+)$/i.exec(reference);
  return m ? m[1].toLowerCase() : null;
}

type FacilityRow = { id: string; name: string; facilityCode?: string | null; level?: string | null; status?: string | null; region?: string | null; district?: string | null };
/** One facility as facilities.search and facilities.get answer it. */
const facilityView = (r: FacilityRow) => ({
  id: r.id, name: r.name, facilityCode: r.facilityCode ?? null, level: r.level ?? null,
  status: r.status ?? null, region: r.region ?? null, district: r.district ?? null,
});

function inScope(scope: Set<string> | '*', reference: unknown): boolean {
  if (scope === '*') return true;
  const id = orgId(reference);
  return id !== null && scope.has(id);
}

export function createPluginHost(deps: PluginHostDeps): PluginHost {
  /** Turns a thrown error into a result. Known errors keep their plain message; anything else is
   *  logged and answered with a fixed message, so no internals reach the plugin. */
  function failure(fn: string, plugin: HostPlugin, err: unknown): HostResult {
    if (err instanceof HostInputError) return fail(err.code, err.message);
    if (err instanceof PluginRequestError) return fail(`REQUEST_${err.reason.toUpperCase()}`, err.message);
    if (err instanceof PatientIndexError) return fail(err.kind === 'not-found' ? 'NOT_FOUND' : 'INVALID_REQUEST', err.message);
    if (err instanceof TerminologyError) return fail(err.kind === 'not-found' ? 'NOT_FOUND' : 'INVALID_REQUEST', err.message);
    if (err instanceof AppError && err.code === 'VA0002') {
      const outcome = (err.details as { outcome?: { issue?: unknown[] } } | undefined)?.outcome;
      return fail('VALIDATION_FAILED', 'the records did not pass CE validation; nothing was saved', outcome?.issue ?? []);
    }
    deps.logger.error({ err, plugin: plugin.id, fn }, 'plugin host function failed');
    return fail('HOST_ERROR', `${fn} failed inside CE`);
  }

  // Read once, on the first patient answer, then kept. A failed read is tried again next call.
  let refKey: Promise<Buffer> | null = null;
  const loadRefKey = () => {
    refKey ??= deps.pluginRefKey().catch((err) => { refKey = null; throw err; });
    return refKey;
  };

  return {
    forCall(plugin, caller) {
      const kinds = new Set(plugin.capabilities.map((c) => c.kind));
      const scope = scopeOf(caller);
      const actor: AuditActor = { actorType: 'user', actorId: caller.userId, actorName: caller.displayName ?? caller.userId };
      const auditMeta = { pluginId: plugin.id, pluginVersion: plugin.version };
      // The studio's own rule: identifiers show only to a person who holds patients.view_identifiers.
      const unmask = caller.capabilities.includes('patients.view_identifiers');
      const provenance: Provenance = { pluginId: plugin.id, pluginVersion: plugin.version, sourceSystem: `plugin:${plugin.id}` };

      const guard = (fn: string, body: (input: unknown) => Promise<unknown>): HostFn =>
        async (input) => {
          try {
            return ok(await body(input));
          } catch (err) {
            return failure(fn, plugin, err);
          }
        };

      const allowedTypes = new Set(allowedResourceTypes(plugin.capabilities));

      /** A stored record with this id, if this plugin wrote it; null when there is none. A record
       *  another plugin or an ingest wrote is refused, so a plugin cannot rewrite it. */
      const ownedOrNew = async (fn: string, resourceType: string, id: string): Promise<unknown | null> => {
        const stored = await deps.fhirGetWithProvenance(resourceType, id);
        if (!stored) return null;
        if (stored.provenance.pluginId !== plugin.id) {
          throw new HostInputError('FORBIDDEN', `${fn}: ${resourceType}/${id} was not written by this plugin, so it cannot change it; nothing was saved`);
        }
        return stored.resource;
      };

      // As the studio's patient routes: the patient ops need patients.view. patients.find (ruling 5)
      // also opens them, for a strong-match search only, and a limited user keeps it.
      const canView = caller.capabilities.includes('patients.view');
      const canFind = caller.capabilities.includes('patients.find');
      const needPatientsAccess = (op: string) => {
        if (!canView && !canFind) {
          throw new HostInputError('FORBIDDEN', `${op}: the caller holds neither patients.view nor patients.find`);
        }
      };
      /** The caller's facilities for a patient search, or undefined for no limit. */
      const searchFacilities = (): string[] | undefined => {
        if (scope === '*') return undefined;
        if (scope.size > MAX_PATIENT_SCOPE_FACILITIES) {
          throw new HostInputError('TOO_MANY_FACILITIES', `patients.search: the caller's data limit covers over ${MAX_PATIENT_SCOPE_FACILITIES} facilities`);
        }
        return [...scope];
      };

      const refsFor = async () => pluginPatientRefs(await loadRefKey(), plugin.id);
      /** A boot-time ref as this plugin's lasting ref, or null. */
      const lasting = (refs: { encode(id: string): string }, ref: string | null): string | null => {
        const id = ref === null ? null : deps.patients.idForRef(ref);
        return id === null ? null : refs.encode(id);
      };
      /** The survivor ids, of those given, whose managing facility is inside the caller's limit. A
       *  survivor outside it is not named, so the answer says nothing about whether it exists. */
      const survivorsInScope = async (ids: string[]): Promise<Set<string>> => {
        if (scope === '*' || ids.length === 0) return new Set(ids);
        const rows = await deps.patients.rowsByIds([...new Set(ids)], { unmask: false });
        const seen = new Set<string>();
        for (const row of rows) {
          const id = deps.patients.idForRef(row.ref);
          if (id !== null && inScope(scope, row.managingFacility?.reference)) seen.add(id);
        }
        return seen;
      };
      /** Each row with its pluginRef, and for a merged patient replacedByRef and replacedByPluginRef,
       *  both null when the survivor is outside the caller's limit. The row's id is hidden when
       *  masked, so it comes from its ref. */
      const withPluginRefs = async <R extends { ref: string; replacedByRef: string | null }>(rows: R[]) => {
        const refs = await refsFor();
        const survivorIds = new Map(rows.map((r) => [r, r.replacedByRef === null ? null : deps.patients.idForRef(r.replacedByRef)]));
        const shown = await survivorsInScope([...survivorIds.values()].filter((id): id is string => id !== null));
        return rows.map((r) => {
          const survivor = survivorIds.get(r) ?? null;
          const named = survivor !== null && shown.has(survivor);
          return {
            ...r, pluginRef: lasting(refs, r.ref),
            replacedByRef: named ? r.replacedByRef : null,
            replacedByPluginRef: named ? refs.encode(survivor) : null,
          };
        });
      };

      const readOps: Record<CeReadOp, (input: unknown) => Promise<unknown>> = {
        async 'patients.search'(raw) {
          needPatientsAccess('patients.search');
          const i = parse(patientSearchInput, raw, 'patients.search');
          const strong = i.identifier !== undefined || i.given !== undefined || i.family !== undefined || i.birthDate !== undefined;
          if (strong || !canView) {
            // A caller with patients.find alone cannot browse: no free-text search, no empty search.
            if (i.search !== undefined) {
              throw new HostInputError(canView ? 'INVALID_REQUEST' : 'FORBIDDEN', canView
                ? 'patients.search: give search, or an identifier or name with birth date, not both'
                : 'patients.search: with patients.find, search needs an exact identifier, or given, family and birthDate');
            }
            const fq = parsePatientFindQuery({
              identifier: i.identifier, given: i.given, family: i.family, birthDate: i.birthDate,
              status: i.status, limit: i.limit, offset: i.offset,
            });
            if (!fq.ok) throw new HostInputError('INVALID_REQUEST', `patients.search: ${fq.error}`);
            const out = await deps.patients.find(fq.query, { unmask, facilities: searchFacilities() });
            if (unmask) await deps.audit(actor, { action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { ...auditMeta, count: out.total } });
            return { ...out, rows: await withPluginRefs(out.rows) };
          }
          const q = parsePatientListQuery({
            search: i.search, status: i.status,
            limit: i.limit === undefined ? undefined : String(i.limit),
            offset: i.offset === undefined ? undefined : String(i.offset),
          });
          if (!q.ok) throw new HostInputError('INVALID_REQUEST', `patients.search: ${q.error}`);
          const out = await deps.patients.list(q.query, { unmask, facilities: searchFacilities() });
          // As the studio route: an unmasked list is audited, with the count only.
          if (unmask) await deps.audit(actor, { action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { ...auditMeta, count: out.total } });
          return { ...out, rows: await withPluginRefs(out.rows) };
        },

        async 'patients.get'(raw) {
          needPatientsAccess('patients.get');
          const i = parse(patientGetInput, raw, 'patients.get');
          const refs = await refsFor();
          let id: string | null;
          if (i.pluginRef !== undefined) {
            // A pluginRef opens only for the plugin it was made for: another plugin's fails here.
            id = refs.decode(i.pluginRef);
          } else {
            id = deps.patients.idForRef(i.ref as string);
          }
          if (id === null) throw new PatientIndexError('patient not found', 'not-found');
          const detail = await deps.patients.getById(id, { unmask });
          // A patient outside the caller's data limit is answered as not found, so the answer says
          // nothing about whether it exists.
          if (!inScope(scope, detail.managingFacility?.reference)) throw new PatientIndexError('patient not found', 'not-found');
          if (unmask) await deps.audit(actor, { action: 'patients.view', entityType: 'patient', entityId: detail.id ?? 'unknown', metadata: auditMeta });
          const [withRefs] = await withPluginRefs([detail]);
          return { ...withRefs, pluginRef: refs.encode(id) };
        },

        // Several patients by pluginRef in one call, as an order list needs them. Each answer is
        // what patients.get gives, or null where patients.get would answer not found: a ref that
        // is not valid or not this plugin's, no such patient, or one outside the caller's limit.
        async 'patients.getMany'(raw) {
          needPatientsAccess('patients.getMany');
          const { pluginRefs } = parse(patientGetManyInput, raw, 'patients.getMany');
          const refs = await refsFor();
          const byId = new Map<string, PatientDetail | null>();
          const ids = pluginRefs.map((r) => refs.decode(r));
          for (const id of ids) {
            if (id === null || byId.has(id)) continue;
            let detail: PatientDetail | null = null;
            try {
              detail = await deps.patients.getById(id, { unmask });
            } catch (err) {
              if (!(err instanceof PatientIndexError && err.kind === 'not-found')) throw err;
            }
            byId.set(id, detail && inScope(scope, detail.managingFacility?.reference) ? detail : null);
          }
          const foundIds = [...byId].filter(([, d]) => d !== null).map(([id]) => id);
          // As patients.get, but one row for the call, with the count and the ids read.
          if (unmask && foundIds.length > 0) {
            await deps.audit(actor, { action: 'patients.view', entityType: 'patient', entityId: 'many', metadata: { ...auditMeta, count: foundIds.length, ids: foundIds } });
          }
          const shown = await withPluginRefs(foundIds.map((id) => byId.get(id) as PatientDetail));
          const answer = new Map(foundIds.map((id, n) => [id, { ...shown[n], pluginRef: refs.encode(id) }]));
          return { rows: ids.map((id) => (id === null ? null : answer.get(id) ?? null)) };
        },

        async 'patients.register'(raw) {
          needPatientsAccess('patients.register');
          // Writing a Patient is consent given at install: the plugin's emit-fhir list must name it.
          if (!allowedTypes.has('Patient')) {
            throw new HostInputError('FORBIDDEN', 'patients.register: this plugin was not granted emit-fhir for Patient at install');
          }
          const { patient } = parse(patientRegisterInput, raw, 'patients.register');
          if (patient.resourceType !== 'Patient') throw new HostInputError('INVALID_REQUEST', 'patients.register: the record must be a Patient');
          if (typeof patient.id !== 'string' || !FHIR_ID.test(patient.id)) {
            throw new HostInputError('INVALID_REQUEST', 'patients.register: the Patient needs an id of up to 64 letters, digits, dashes and dots');
          }
          const id = patient.id;
          const managing = (patient.managingOrganization as { reference?: unknown } | undefined)?.reference;
          if (scope !== '*' && !inScope(scope, managing)) {
            throw new HostInputError('OUTSIDE_DATA_LIMIT', "patients.register: the Patient's managingOrganization must be one of the caller's facilities");
          }
          // For every caller: it may create a patient, and update only one this plugin wrote.
          const existing = await ownedOrNew('patients.register', 'Patient', id);
          if (existing && scope !== '*' && !inScope(scope, (existing as { managingOrganization?: { reference?: unknown } }).managingOrganization?.reference)) {
            throw new HostInputError('OUTSIDE_DATA_LIMIT', 'patients.register: a patient with this id is held by a facility outside the caller\'s data limit');
          }
          await deps.persist([patient], provenance);
          await deps.audit(actor, { action: 'patients.register', entityType: 'patient', entityId: id, metadata: auditMeta });
          return { id, pluginRef: (await refsFor()).encode(id) };
        },

        async 'valueset.expand'(raw) {
          const i = parse(expandInput, raw, 'valueset.expand');
          return deps.terminology.expand(i.url, { count: i.count, offset: i.offset, filter: i.filter });
        },

        async 'valueset.lookup'(raw) {
          const i = parse(lookupInput, raw, 'valueset.lookup');
          return deps.terminology.lookup(i.system, i.code);
        },

        async 'testCatalog.list'(raw) {
          const i = parse(catalogListInput, raw, 'testCatalog.list');
          const q = parseCatalogListQuery(i);
          if (!q.ok) throw new HostInputError('INVALID_REQUEST', `testCatalog.list: ${q.error}`);
          return deps.testCatalog.list(q.query);
        },

        async 'testCatalog.get'(raw) {
          const { code } = parse(catalogGetInput, raw, 'testCatalog.get');
          const test = await deps.testCatalog.get(code);
          if (!test) throw new HostInputError('NOT_FOUND', `testCatalog.get: no test ${code}`);
          return test;
        },

        // Who is calling, from CE's session. The capabilities stay out: the plugin gets only what
        // the caller could see of itself.
        async 'caller.get'(raw) {
          parse(callerGetInput, raw, 'caller.get');
          return {
            userId: caller.userId,
            displayName: caller.displayName,
            facilities: caller.facilities === '*' ? '*' : [...caller.facilities],
          };
        },

        async 'facilities.search'(raw) {
          const i = parse(facilitySearchInput, raw, 'facilities.search');
          const limit = i.limit ?? 50;
          const offset = i.offset ?? 0;
          const view = facilityView;
          if (scope === '*') {
            const { rows, total } = await deps.facilityRegistry.list({ q: i.q, limit, offset });
            return { rows: rows.map(view), total };
          }
          // A limited caller sees only its own facilities: the matching ids, cut to its list.
          const matching = (await deps.facilityRegistry.idsMatching(i.q ? { q: i.q } : {}))
            .map((m) => m.id).filter((id) => scope.has(id.toLowerCase())).sort();
          const page = matching.slice(offset, offset + limit);
          const rows = [];
          for (const id of page) {
            const r = await deps.facilityRegistry.get(id);
            if (r) rows.push(view(r));
          }
          return { rows, total: matching.length };
        },

        // One facility by its register id. Outside the caller's data limit it is answered as not
        // found, as a missing one is, so the answer says nothing about whether it exists.
        async 'facilities.get'(raw) {
          // Ids are compared without case, as facilities.search and the data limit compare them.
          const id = parse(facilityGetInput, raw, 'facilities.get').id.toLowerCase();
          if (scope !== '*' && !scope.has(id)) throw new HostInputError('NOT_FOUND', 'facilities.get: facility not found');
          const r = await deps.facilityRegistry.get(id);
          if (!r) throw new HostInputError('NOT_FOUND', 'facilities.get: facility not found');
          return facilityView(r);
        },
      };

      const fns: Record<string, HostFn> = {};

      if (kinds.has('host:db')) {
        fns.db_select = guard('db_select', (input) => deps.requests.select(plugin.id, plugin.tables, caller, input as never));
        fns.db_write = guard('db_write', (input) => deps.requests.write(plugin.id, plugin.tables, caller, input as never));
      }

      if (kinds.has('host:ce-read')) {
        fns.ce_read = guard('ce_read', async (raw) => {
          const { op, input } = parse(ceReadInput, raw, 'ce_read');
          if (!(CE_READ_OPS as readonly string[]).includes(op)) {
            throw new HostInputError('UNKNOWN_OP', `ce_read: unknown op '${op}' (known: ${CE_READ_OPS.join(', ')})`);
          }
          return readOps[op as CeReadOp](input);
        });
      }

      // fhir_emit needs host:db as well as emit-fhir. A plugin with emit-fhir alone (cdr-source)
      // returns its records as output and gets no host functions.
      if (kinds.has('emit-fhir') && kinds.has('host:db')) {
        const allowed = allowedTypes;
        fns.fhir_emit = guard('fhir_emit', async (raw) => {
          // A limited caller may not send records into CE: nothing checks a record's facility here.
          if (scope !== '*') {
            throw new HostInputError('OUTSIDE_DATA_LIMIT', 'fhir_emit: a caller with a data limit cannot send records to CE; nothing was saved');
          }
          const { resources } = parse(fhirEmitInput, raw, 'fhir_emit');
          // Every record is checked before any is saved, so a refused type saves nothing.
          const refused = checkResources(resources, allowed);
          if (refused) {
            const message = refused === 'RESOURCE_TYPE_NOT_ALLOWED'
              ? `fhir_emit: this plugin may send only ${[...allowed].join(', ')}; nothing was saved`
              : refused === 'NO_RESOURCES' ? 'fhir_emit: no records were sent' : 'fhir_emit: every record needs a resourceType; nothing was saved';
            throw new HostInputError(refused, message);
          }
          for (const r of resources as Array<{ resourceType: string; contained?: unknown }>) {
            if (r.resourceType === 'Bundle') throw new HostInputError('RESOURCE_TYPE_NOT_ALLOWED', 'fhir_emit: a Bundle cannot be sent; send its records one by one. Nothing was saved');
            if (Array.isArray(r.contained) ? r.contained.length > 0 : r.contained !== undefined) {
              throw new HostInputError('INVALID_RESOURCE', `fhir_emit: a ${r.resourceType} with contained records cannot be sent; nothing was saved`);
            }
          }
          // Each record is new or one this plugin wrote, checked before any is saved.
          const ids: string[] = [];
          for (const r of resources as Array<{ resourceType: string; id?: unknown }>) {
            if (typeof r.id === 'string' && r.id.length > 0) {
              await ownedOrNew('fhir_emit', r.resourceType, r.id);
              ids.push(`${r.resourceType}/${r.id}`);
            }
          }
          await deps.persist(resources, provenance);
          const types = [...new Set((resources as Array<{ resourceType: string }>).map((r) => r.resourceType))].sort();
          await deps.audit(actor, {
            action: 'fhir.emit', entityType: 'fhir', entityId: ids[0] ?? 'batch',
            metadata: { ...auditMeta, count: resources.length, types, ids: ids.slice(0, MAX_AUDITED_IDS), idsTruncated: ids.length > MAX_AUDITED_IDS },
          });
          return { saved: resources.length };
        });
      }

      return fns;
    },
  };
}
