import type { FastifyInstance, FastifyReply } from 'fastify';
import { gunzipSync } from 'node:zlib';
import { resolveCodingSystemId, type AppContext } from '@openldr/bootstrap';
import { appError, redact } from '@openldr/core';
import { FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { z } from 'zod';
import { actorFromRequest, recordAudit } from './audit-helper';
import { requireCapability } from './rbac';
import { canonicalSystemUrl, isFhirValueSetCatalog, parseTerminologyTerms, parseTerminologyTermsStream, terminologyImportTemplate } from '@openldr/terminology';

// Mutations, imports, and server-side loader paths (e.g. LOINC import) alter shared terminology
// configuration for the whole install, so they are gated to admin/manager roles. Read-only GETs stay
// available to any authenticated user because terminology lookups are used broadly across the app.
const MANAGE = { preHandler: requireCapability('terminology.manage') };

const publisherInput = z.object({
  name: z.string().min(1),
  role: z.enum(['local', 'standard', 'external']),
  icon: z.string().nullish(),
});
const systemInput = z.object({
  systemCode: z.string().min(1),
  systemName: z.string().min(1),
  url: z.string().nullish(),
  systemVersion: z.string().nullish(),
  description: z.string().nullish(),
  active: z.boolean(),
  publisherId: z.string().nullish(),
});
export function registerTerminologyAdminRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const admin = ctx.terminology.admin;
  type IdParam = { id: string };

  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('application/fhir+json', (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('application/gzip', (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('application/x-gzip', (_req, payload, done) => {
    done(null, payload);
  });

  app.get('/api/terminology/publishers', async () => admin.publishers.list());
  app.post('/api/terminology/publishers', MANAGE, async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const created = await admin.publishers.create(parsed.data);
      await recordAudit(ctx, req, { action: 'publisher.create', entityType: 'publisher', entityId: created.id, before: null, after: created });
      reply.code(201);
      return created;
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/publishers/:id', MANAGE, async (req, reply) => {
    const parsed = publisherInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const updated = await admin.publishers.update((req.params as IdParam).id, parsed.data);
      await recordAudit(ctx, req, { action: 'publisher.update', entityType: 'publisher', entityId: (req.params as IdParam).id, before: null, after: updated });
      return updated;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/publishers/:id', MANAGE, async (req, reply) => {
    try {
      await admin.publishers.delete((req.params as IdParam).id);
      await recordAudit(ctx, req, { action: 'publisher.delete', entityType: 'publisher', entityId: (req.params as IdParam).id, before: null, after: null });
      reply.code(204); return null;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/publishers/:id/deletion-impact', async (req, reply) => {
    try { return await admin.publishers.deletionImpact((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });

  app.get('/api/terminology/systems', async (req) => {
    const { publisher } = req.query as { publisher?: string };
    return admin.codingSystems.list(publisher);
  });
  app.post('/api/terminology/systems', MANAGE, async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const created = await admin.codingSystems.create(parsed.data);
      await recordAudit(ctx, req, { action: 'coding_system.create', entityType: 'coding_system', entityId: created.id, before: null, after: created });
      reply.code(201); return created;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id', MANAGE, async (req, reply) => {
    const parsed = systemInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const updated = await admin.codingSystems.update((req.params as IdParam).id, parsed.data);
      await recordAudit(ctx, req, { action: 'coding_system.update', entityType: 'coding_system', entityId: (req.params as IdParam).id, before: null, after: updated });
      return updated;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id', MANAGE, async (req, reply) => {
    const id = (req.params as IdParam).id;
    try {
      const jobs = await ctx.terminologyJobs.listForCodingSystem(id);   // capture blob keys before deleting rows
      await admin.codingSystems.delete(id, { cascade: true });          // policy + cascade (concepts + job rows + system row); throws 'conflict' if protected
      await ctx.terminology.ontology.unlink(id).catch(() => {});        // ontology teardown (no-op if none)
      for (const j of jobs) { try { await ctx.blob.delete(j.blobKey); } catch { /* best-effort blob cleanup */ } }
      await recordAudit(ctx, req, { action: 'coding_system.delete', entityType: 'coding_system', entityId: id, before: null, after: null });
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/deletion-impact', async (req, reply) => {
    try { return await admin.codingSystems.deletionImpact((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });

  // ── Terms ────────────────────────────────────────────────────────────────
  const termInput = z.object({
    code: z.string().min(1), display: z.string().min(1),
    status: z.enum(['ACTIVE', 'DRAFT', 'DEPRECATED', 'DISABLED']),
    shortName: z.string().nullish(), class: z.string().nullish(), unit: z.string().nullish(),
    replacedBy: z.string().nullish(), metadata: z.record(z.unknown()).nullish(),
  });

  // Accept EITHER the coding-system id (`cs-url-LOINC`) or its canonical url (`http://loinc.org`).
  // Callers legitimately hold one or the other: the Terminology page lists systems by id, while a
  // form field's Codes binding is authored as the canonical FHIR system URL. Matching only on `id`
  // meant the form-field term picker always 404'd, so a coded field could never be bound to an
  // imported code system — the one place terminology and forms are supposed to meet.
  async function systemInfo(id: string): Promise<{ url: string; systemCode: string }> {
    const sys = (await admin.codingSystems.list()).find((s) => s.id === id || s.url === id);
    if (!sys || !sys.url) {
      throw Object.assign(new Error(`coding system has no url: ${id}`), { name: 'TerminologyAdminError', kind: 'not-found' as const });
    }
    return { url: sys.url, systemCode: sys.systemCode };
  }

  async function systemUrl(id: string): Promise<string> {
    return (await systemInfo(id)).url;
  }

  async function importTermRowsInBatches(rows: ReturnType<typeof parseTerminologyTerms>): Promise<{ imported: number }> {
    // Pass the whole import to importRows in ONE call: the store batches the insert internally and
    // emits exactly one terminology_system sync signal per distinct system (Sync S3). Splitting the
    // import into multiple importRows calls here would emit one signal per chunk — the per-batch spam
    // we must avoid.
    const shaped = rows.map((r) => ({ ...r, status: r.status ?? 'ACTIVE' }));
    return admin.terms.importRows(shaped);
  }

  app.get('/api/terminology/systems/:id/terms', async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const { q, status, limit, offset } = req.query as { q?: string; status?: string | string[]; limit?: string; offset?: string };
      return await admin.terms.search(url, { query: q, statuses: statusFilter(status), limit: Number(limit ?? 50), offset: Number(offset ?? 0) });
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms', MANAGE, async (req, reply) => {
    const parsed = termInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const created = await admin.terms.create({ system: url, ...parsed.data });
      await recordAudit(ctx, req, { action: 'term.create', entityType: 'term', entityId: created.code, before: null, after: created, metadata: { system: url } });
      reply.code(201);
      return created;
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/systems/:id/terms/:code', MANAGE, async (req, reply) => {
    const parsed = termInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const code = decodeURIComponent((req.params as { id: string; code: string }).code);
      const updated = await admin.terms.update(url, code, { system: url, ...parsed.data });
      await recordAudit(ctx, req, { action: 'term.update', entityType: 'term', entityId: code, before: null, after: updated, metadata: { system: url } });
      return updated;
    } catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/systems/:id/terms/:code', MANAGE, async (req, reply) => {
    try {
      const url = await systemUrl((req.params as IdParam).id);
      const code = decodeURIComponent((req.params as { id: string; code: string }).code);
      await admin.terms.delete(url, code);
      await recordAudit(ctx, req, { action: 'term.delete', entityType: 'term', entityId: code, before: null, after: null, metadata: { system: url } });
      reply.code(204); return null;
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/systems/:id/terms/import', MANAGE, async (req, reply) => {
    try {
      const system = await systemInfo((req.params as IdParam).id);
      let result: { imported: number };
      if (isReadableBody(req.body)) {
        const rows = await parseTerminologyTermsStream(req.body, system.url, system.systemCode);
        result = await importTermRowsInBatches(rows);
      } else {
        const rawBody = req.body;
        const raw = rawBody && typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)
          ? rawBody as { csv?: string; text?: string }
          : { text: await bodyToText(rawBody) };
        const rawRows = parseTerminologyTerms(String(raw.text ?? raw.csv ?? ''), system.url, system.systemCode);
        result = await importTermRowsInBatches(rawRows);
      }
      await recordAudit(ctx, req, { action: 'term.import', entityType: 'term', entityId: system.url, before: null, after: null, metadata: { systemId: (req.params as IdParam).id, result } });
      return result;
    } catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/systems/:id/terms/template.csv', async (req, reply) => {
    try {
      const system = await systemInfo((req.params as IdParam).id);
      const template = terminologyImportTemplate(system.systemCode);
      reply.header('content-type', template.contentType);
      reply.header('content-disposition', `attachment; filename="${template.filename}"`);
      return template.body;
    } catch (e) { return mapErr(e, reply); }
  });

  // ── Term Mappings ─────────────────────────────────────────────────────────
  const mappingInput = z.object({
    toSystem: z.string().min(1), toCode: z.string().min(1), toDisplay: z.string().nullish(),
    mapType: z.enum(['SAME-AS', 'NARROWER-THAN', 'BROADER-THAN', 'RELATED-TO', 'UNMAPPED-FROM']),
    relationship: z.string().nullish(), owner: z.string().nullish(), isActive: z.boolean(),
  });
  const mappingUpdateInput = mappingInput.extend({ fromSystem: z.string().min(1), fromCode: z.string().min(1) });

  app.get('/api/terminology/terms/:system/:code/mappings', async (req, reply) => {
    try {
      const system = decodeURIComponent((req.params as { system: string; code: string }).system);
      const code = decodeURIComponent((req.params as { system: string; code: string }).code);
      const [outgoing, reverse] = await Promise.all([admin.termMappings.listOutgoing(system, code), admin.termMappings.listReverse(system, code)]);
      return { outgoing, reverse };
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/terms/:system/:code/mappings', MANAGE, async (req, reply) => {
    const parsed = mappingInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    // ⛔ OUTSIDE the try below on purpose — `mapErr` classifies everything it catches as
    // 404/409/500/503, which would bury this coded 400. Letting the AppError propagate reaches the
    // central error handler, which is what puts `code: 'FAC0010'` on the wire.
    assertFacilityMappingSemantic(parsed.data);
    try {
      const system = decodeURIComponent((req.params as { system: string; code: string }).system);
      const code = decodeURIComponent((req.params as { system: string; code: string }).code);
      const input = { fromSystem: system, fromCode: code, ...parsed.data, toDisplay: parsed.data.toDisplay ?? null };
      const created = isFacilityTarget(parsed.data)
        ? await admin.termMappings.saveExclusive(input)
        : { ...await admin.termMappings.create(input), superseded: [] as string[] };
      // Task 6: a facility mapping just changed what an observed string resolves to, so the
      // report-facing dimension is now stale. Enqueue rather than rebuild inline — same reasoning
      // as facilities-routes.ts's Task 5 calls: a rebuild talks to the EXTERNAL warehouse, and this
      // mutation must not fail because that warehouse hiccuped. Scoped with `isFacilityTarget`: this
      // route is shared with generic terminology curation, and a LOINC/ICD-10 mapping has no bearing
      // on the facility dimension. Wrapped and placed before `recordAudit` for the same reason as
      // facilities-routes.ts — `recordAudit` is itself deliberately contained, so an unwrapped throw
      // here would both 500 an already-committed create and skip the audit write below it. Logged
      // rather than swallowed silently: a lost enqueue means a permanently stale dimension.
      if (isFacilityTarget(parsed.data)) {
        try {
          await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
        } catch (err) {
          ctx.logger.error({ err, mappingId: created.mapping.id }, 'failed to enqueue a facility-map-rebuild job after saving a facility mapping');
        }
      }
      await recordAudit(ctx, req, { action: 'term_mapping.create', entityType: 'term_mapping', entityId: created.mapping.id, before: null, after: created.mapping, metadata: { draftCreated: created.draftCreated, superseded: created.superseded } });
      reply.code(201);
      // The response shape is unchanged (`{ mapping, draftCreated }`, what studio's
      // `createTermMapping` reads) — `superseded` is an operator-accountability fact and belongs on
      // the audit entry above, not in a client payload nothing consumes.
      return { mapping: created.mapping, draftCreated: created.draftCreated };
    } catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/mappings/:id', MANAGE, async (req, reply) => {
    const parsed = mappingUpdateInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    assertFacilityMappingSemantic(parsed.data); // outside the try — see the POST above
    try {
      const id = (req.params as IdParam).id;
      const input = { ...parsed.data, toDisplay: parsed.data.toDisplay ?? null };
      // ⛔ Read the row's CURRENT target BEFORE the write, the same way DELETE below does and for the
      // same reason: after the update it is gone. Scoping the enqueue on the NEW body alone gets the
      // retarget-AWAY case exactly backwards — pointing a facility mapping at a LOINC code REMOVES a
      // facility resolution, so the dimension is stale, yet `isFacilityTarget(parsed.data)` is false
      // and nothing would be queued. The UI would say the row is no longer a facility mapping while
      // reports kept resolving that observed string to the old facility, indefinitely.
      const previous = await ctx.internalDb.selectFrom('term_mappings').select(['to_system']).where('id', '=', id).executeTakeFirst();
      // A PUT retargets one existing row, so it cannot ADD a competing active mapping — but it can
      // re-activate a superseded one while another is active, which is the same violation by a
      // different route. `saveExclusive` with this row's id covers both.
      const saved = isFacilityTarget(parsed.data)
        ? await admin.termMappings.saveExclusive(input, { id })
        : { mapping: await admin.termMappings.update(id, input), superseded: [] as string[] };
      // Task 6: same reasoning as the POST above — a facility mapping retarget makes the
      // report-facing dimension stale, so enqueue a rebuild, scoped and contained the same way.
      // EITHER end being a facility target is enough: retargeting one AWAY changes resolution just
      // as much as retargeting one TOWARDS.
      if (isFacilityTarget(parsed.data) || (previous && isFacilityTarget({ toSystem: previous.to_system }))) {
        try {
          await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
        } catch (err) {
          ctx.logger.error({ err, mappingId: id }, 'failed to enqueue a facility-map-rebuild job after updating a facility mapping');
        }
      }
      // A PUT supersedes too, so it owes the same accountability record the POST above writes —
      // otherwise a deactivation reached through PUT is invisible in the audit log while the
      // identical one reached through POST is not. The response shape is unchanged.
      await recordAudit(ctx, req, { action: 'term_mapping.update', entityType: 'term_mapping', entityId: id, before: null, after: saved.mapping, metadata: { superseded: saved.superseded } });
      return saved.mapping;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/mappings/:id', MANAGE, async (req, reply) => {
    const id = (req.params as IdParam).id;
    try {
      // Task 6: the target system decides whether this delete is a facility-dimension event, and it
      // only lives on the row being removed — read it BEFORE the delete, since it is gone after.
      const row = await ctx.internalDb.selectFrom('term_mappings').select(['to_system']).where('id', '=', id).executeTakeFirst();
      await admin.termMappings.delete(id);
      // Same reasoning as POST/PUT above: removing a facility mapping makes the report-facing
      // dimension stale too, so it gets the same scoped, contained enqueue.
      if (row && isFacilityTarget({ toSystem: row.to_system })) {
        try {
          await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
        } catch (err) {
          ctx.logger.error({ err, mappingId: id }, 'failed to enqueue a facility-map-rebuild job after deleting a facility mapping');
        }
      }
      await recordAudit(ctx, req, { action: 'term_mapping.delete', entityType: 'term_mapping', entityId: id, before: null, after: null });
      reply.code(204); return null;
    }
    catch (e) { return mapErr(e, reply); }
  });

  // Value Sets
  const composeClause = z.object({
    system: z.string().optional(),
    version: z.string().optional(),
    concept: z.array(z.object({ code: z.string(), display: z.string().optional() })).optional(),
    filter: z.array(z.object({ property: z.string(), op: z.string(), value: z.string() })).optional(),
    valueSet: z.array(z.string()).optional(),
  });
  const valueSetInput = z.object({
    url: z.string().min(1),
    version: z.string().nullish(),
    name: z.string().nullish(),
    title: z.string().nullish(),
    status: z.enum(['draft', 'active', 'retired']),
    experimental: z.boolean().optional(),
    description: z.string().nullish(),
    compose: z.object({ include: z.array(composeClause).optional(), exclude: z.array(composeClause).optional() }),
    publisherId: z.string().nullish(),
    category: z.string().nullish(),
  });

  app.get('/api/terminology/valuesets', async (req) => {
    const { publisherId } = req.query as { publisherId?: string };
    return admin.valueSets.list(publisherId);
  });
  app.post('/api/terminology/valuesets', MANAGE, async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const saved = await admin.valueSets.save(parsed.data);
      await recordAudit(ctx, req, { action: 'value_set.create', entityType: 'value_set', entityId: saved.id, before: null, after: saved });
      reply.code(201); return saved;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id', async (req, reply) => {
    try { return await admin.valueSets.get((req.params as IdParam).id); }
    catch (e) { return mapErr(e, reply); }
  });
  app.put('/api/terminology/valuesets/:id', MANAGE, async (req, reply) => {
    const parsed = valueSetInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.message }; }
    try {
      const id = (req.params as IdParam).id;
      const before = await admin.valueSets.get(id).catch(() => null);
      const saved = await admin.valueSets.save(parsed.data);
      await recordAudit(ctx, req, { action: 'value_set.update', entityType: 'value_set', entityId: id, before, after: saved });
      return saved;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.delete('/api/terminology/valuesets/:id', MANAGE, async (req, reply) => {
    try {
      const id = (req.params as IdParam).id;
      const before = await admin.valueSets.get(id).catch(() => null);
      await admin.valueSets.delete(id);
      await recordAudit(ctx, req, { action: 'value_set.delete', entityType: 'value_set', entityId: id, before, after: null });
      reply.code(204); return null;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/:id/duplicate', MANAGE, async (req, reply) => {
    try {
      const id = (req.params as IdParam).id;
      const dup = await admin.valueSets.duplicate(id);
      await recordAudit(ctx, req, { action: 'value_set.duplicate', entityType: 'value_set', entityId: dup.id, before: null, after: dup, metadata: { sourceId: id } });
      reply.code(201); return dup;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/expand', async (req, reply) => {
    try {
      const { activeOnly } = req.query as { activeOnly?: string };
      return await admin.valueSets.expand((req.params as IdParam).id, activeOnly !== 'false');
    } catch (e) { return mapErr(e, reply); }
  });
  app.post('/api/terminology/valuesets/import', MANAGE, async (req, reply) => {
    try {
      const resource = await parseJsonUpload(req.body);
      if (isFhirValueSetCatalog(resource)) {
        const result = await admin.valueSets.importFhirCatalog(resource);
        await recordAudit(ctx, req, { action: 'value_set.import', entityType: 'value_set', entityId: 'catalog', before: null, after: null, metadata: { imported: result.imported, skipped: result.skipped } });
        reply.code(201);
        return result;
      }
      const saved = await admin.valueSets.importFhir(resource);
      await recordAudit(ctx, req, { action: 'value_set.import', entityType: 'value_set', entityId: saved.id, before: null, after: null, metadata: { id: saved.id, url: saved.url } });
      reply.code(201);
      return saved;
    }
    catch (e) { return mapErr(e, reply); }
  });
  app.get('/api/terminology/valuesets/:id/export', async (req, reply) => {
    try {
      const resource = await admin.valueSets.exportFhir((req.params as IdParam).id);
      reply.header('content-type', 'application/fhir+json');
      reply.header('content-disposition', `attachment; filename="${(req.params as IdParam).id}.json"`);
      return resource;
    } catch (e) { return mapErr(e, reply); }
  });

  // ── Distribution upload / status / purge ────────────────────────────────
  const UPLOAD = { preHandler: requireCapability('terminology.manage'), bodyLimit: 1_073_741_824 };
  const SUPPORTED_SYSTEMS = new Set(['loinc', 'snomed', 'rxnorm']);

  app.post('/api/terminology/publishers/:publisherId/distribution', UPLOAD, async (req, reply) => {
    const publisherId = (req.params as { publisherId: string }).publisherId;
    const q = req.query as { systemType?: string; acceptLicense?: string; version?: string };
    const systemType = String(q.systemType ?? '');
    if (!SUPPORTED_SYSTEMS.has(systemType) || !canonicalSystemUrl(systemType)) { reply.code(400); return { error: `unsupported systemType: ${systemType || '(missing)'}` }; }
    if (q.acceptLicense !== 'true') { reply.code(400); return { error: 'the distribution license must be accepted' }; }
    if (await ctx.terminologyJobs.hasActive(systemType)) { reply.code(409); return { error: `an import for ${systemType} is already in progress` }; }
    if (!isReadableBody(req.body)) { reply.code(400); return { error: 'expected a zip stream (application/octet-stream)' }; }

    let codingSystemId: string;
    try { codingSystemId = await resolveCodingSystemId(admin, systemType, q.version ?? null); }
    catch (e) { return mapErr(e, reply); }

    const key = `terminology-dist/${systemType}/${codingSystemId}-${Date.now()}.zip`;
    try { await ctx.blob.putStream(key, req.body as NodeJS.ReadableStream as never, 'application/zip'); }
    catch (e) { return mapErr(e, reply); }

    const job = await ctx.terminologyJobs.enqueue({ systemType, codingSystemId, blobKey: key, version: q.version ?? null, createdBy: req.user?.id ?? null });
    await recordAudit(ctx, req, { action: 'terminology.distribution.uploaded', entityType: 'coding_system', entityId: codingSystemId, before: null, after: null, metadata: { publisherId, systemType, version: q.version ?? null, jobId: job.id } });
    reply.code(201);
    return { jobId: job.id };
  });

  // Publisher-scoped path; the job itself is systemType-scoped (one active/latest per system), so
  // `latestForSystem` resolves the job regardless of the :publisherId (which is the UI's navigational
  // context + audit subject).
  app.get('/api/terminology/publishers/:publisherId/distribution/job', MANAGE, async (req, reply) => {
    const q = req.query as { systemType?: string };
    const systemType = String(q.systemType ?? 'loinc');
    const job = await ctx.terminologyJobs.latestForSystem(systemType);
    if (!job) { reply.code(404); return { error: 'no import job for this system' }; }
    return { id: job.id, status: job.status, phase: job.phase, processed: job.processed, total: job.total, error: job.error, version: job.version, finishedAt: job.finishedAt };
  });

  app.delete('/api/terminology/publishers/:publisherId/distribution', MANAGE, async (req, reply) => {
    const publisherId = (req.params as { publisherId: string }).publisherId;
    const q = req.query as { systemType?: string };
    const systemType = String(q.systemType ?? 'loinc');
    const job = await ctx.terminologyJobs.latestForSystem(systemType);
    if (job?.blobKey) {
      try { await ctx.blob.delete(job.blobKey); } catch (e) { return mapErr(e, reply); }
    }
    await recordAudit(ctx, req, { action: 'terminology.distribution.purged', entityType: 'coding_system', entityId: job?.codingSystemId ?? publisherId, before: null, after: null, metadata: { systemType, jobId: job?.id ?? null } });
    reply.code(204);
    return null;
  });

  // Rebuild an upload-managed coding system's concepts + ontology by RE-INGESTING its retained
  // distribution zip from the blob store — the correct "rebuild" for uploads (the recorded ontology
  // sourcePath is an ephemeral extraction dir that no longer exists). Re-enqueues onto the same
  // ingest worker the upload uses, so progress flows through the job-status poll + bell.
  app.post('/api/terminology/systems/:id/distribution/reingest', MANAGE, async (req, reply) => {
    const id = (req.params as IdParam).id;
    const jobs = await ctx.terminologyJobs.listForCodingSystem(id);
    const latest = jobs.find((j) => j.blobKey);
    if (!latest) { reply.code(409); return { error: 'no stored distribution to rebuild from — upload one first' }; }
    try {
      const job = await ctx.terminologyJobs.enqueue({
        systemType: latest.systemType, codingSystemId: id, blobKey: latest.blobKey, version: latest.version, createdBy: req.user?.id ?? null,
      });
      await recordAudit(ctx, req, { action: 'terminology.distribution.reingested', entityType: 'coding_system', entityId: id, before: null, after: null, metadata: { systemType: latest.systemType, jobId: job.id, blobKey: latest.blobKey } });
      reply.code(202);
      return { jobId: job.id };
    } catch (e) { return mapErr(e, reply); }
  });
}

function isReadableBody(body: unknown): body is NodeJS.ReadableStream {
  return !!body && typeof body === 'object' && typeof (body as { pipe?: unknown }).pipe === 'function';
}

async function bodyToText(body: unknown): Promise<string> {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (isReadableBody(body)) {
    let text = '';
    for await (const chunk of body as AsyncIterable<Buffer | string>) text += chunk.toString();
    return text;
  }
  return '';
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (isReadableBody(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
}

async function parseJsonUpload(body: unknown): Promise<unknown> {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !isReadableBody(body)) return body;
  let bytes = await bodyToBuffer(body);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString('utf8'));
}

// Duck-type guard rather than `instanceof TerminologyAdminError`: that class lives in
// @openldr/db, which apps/server intentionally does NOT depend on (it would couple the
// server build to the full Kysely/migrations DB layer). The real class sets
// name='TerminologyAdminError', so checking name + kind is reliable. (Follow-up: move
// TerminologyAdminError into @openldr/terminology, alongside TerminologyError.)
function isAdminError(err: unknown): err is { message: string; kind: 'not-found' | 'conflict' } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'TerminologyAdminError' &&
    typeof (err as { kind?: unknown }).kind === 'string'
  );
}

/**
 * The terms search `status` query param, normalised for the store's `statuses: string[]`.
 *
 * `status` may repeat — `?status=ACTIVE&status=DRAFT`. Fastify 5's default query parser
 * (`fast-querystring`, not Node's `querystring`) hands back a bare string for one occurrence and
 * an array for several, so both shapes arrive here and only one may reach the store.
 *
 * Empty values are dropped and an empty result becomes `undefined`, so `?status=` keeps meaning
 * "no filter" rather than "status equal to the empty string", which matches nothing.
 */
function statusFilter(status: string | string[] | undefined): string[] | undefined {
  const list = (Array.isArray(status) ? status : status === undefined ? [] : [status]).filter((s) => s !== '');
  return list.length ? list : undefined;
}

/** Whether this mapping write TARGETS the facility registry — the only coding system the two rules
 *  below apply to. Every other system keeps the full five-value `MapType` vocabulary and may hold
 *  as many active mappings per source term as an operator curates. */
function isFacilityTarget(input: { toSystem: string }): boolean {
  return input.toSystem === FACILITY_REGISTRY_SYSTEM;
}

/**
 * facilities-phase-0 Task 11 — domain-layer enforcement of the mapping semantic the facility
 * resolver actually honours.
 *
 * `resolveObservedFacilities` (packages/bootstrap/src/facility-reconcile.ts) resolves ONLY through
 * `map_type = 'SAME-AS'`; a NARROWER-THAN/RELATED-TO/etc mapping onto a registry facility is
 * accepted, stored, shown in the mapping list, and then silently resolves to nothing. The
 * Facilities Observed tab's dialog already defaults to SAME-AS — but a default in a dialog is not
 * enforcement, and this route is reachable without it.
 *
 * ⚠ Written as "anything that is not exactly SAME-AS", NOT as an enumeration of the four other
 * `MapType` values. `term_mappings.map_type` has no CHECK constraint and `reference-apply.ts`
 * round-trips arbitrary values in from central sync (`'equivalent'`, a FHIR equivalence code and
 * not a `MapType` at all, appears in existing tests) — an enumeration would let every value nobody
 * thought of through. The zod schema on these two routes happens to narrow `mapType` to the five
 * known values before this runs, so today the check only ever sees those; the inequality is how it
 * stays correct if that schema is ever widened, not a claim that it currently sees more.
 *
 * ⛔ Existing non-SAME-AS rows are NOT touched by this — nothing here deactivates one. They stay
 * active and simply do not resolve.
 */
function assertFacilityMappingSemantic(input: { toSystem: string; mapType: string }): void {
  if (!isFacilityTarget(input)) return;
  if (input.mapType !== 'SAME-AS') {
    throw appError('FAC0010', {
      message: `facility resolution requires map_type SAME-AS, got ${input.mapType}`,
      details: { toSystem: input.toSystem, mapType: input.mapType },
    });
  }
}

function mapErr(err: unknown, reply: FastifyReply) {
  if (isAdminError(err)) {
    reply.code(err.kind === 'not-found' ? 404 : 409);
    return { error: redact(err.message) };
  }
  const msg = err instanceof Error ? err.message : String(err);
  reply.code(/ECONNREFUSED|connect/i.test(msg) ? 503 : 500);
  return { error: redact(msg) };
}
