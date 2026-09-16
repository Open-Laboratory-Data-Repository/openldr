import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  catalogChangeAction, catalogImportAudit, catalogImportInputSchema, parseCatalogListQuery, readCatalogImportFile,
  CATALOG_IMPORT_MAX_BYTES, TEST_CATALOG_SYSTEM, TestCatalogError, type AppContext,
} from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Test catalog S1 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.6): terminology.view
// to read, terminology.manage to change anything, central edits and lab settings alike.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };
// An import step sends the whole table back, up to 5,000 rows, which passes Fastify's 1 MiB default.
const IMPORT_STEP = { ...MANAGE, bodyLimit: 16 * 1024 * 1024 };
// Data entry narrows the Lab order's specimen picker through the specimens route, and a Lab Technician
// holds forms.view and forms.submit only (packages/rbac/src/presets.ts:52). So that route takes the gate
// reference search takes (reference-search-routes.ts:9), not terminology.view.
const FORMS_VIEW = { preHandler: requireCapability('forms.view') };
// Must equal the urls migration 106 seeds.
const ORDER_REJECT_VALUE_SET = 'urn:openldr:valueset:order-reject-reason';
const TEST_REJECT_VALUE_SET = 'urn:openldr:valueset:test-reject-reason';
const importFormat = z.enum(['csv', 'xlsx']);

const coding = z.object({ system: z.string().min(1), code: z.string().min(1) });
// A reference band. Every edge is optional: a band naming neither sex nor age is the catch-all.
const band = z.object({
  low: z.number().nullish(), high: z.number().nullish(), unit: z.string().nullish(),
  sex: z.string().nullish(), ageLow: z.number().nullish(), ageHigh: z.number().nullish(),
});
// zod strips what it does not declare, so a parameter list left out of this schema would vanish
// between the sheet and the service without a word. Found live 2026-09-16.
const resultParam = z.object({
  system: z.string().min(1),
  code: z.string().min(1),
  resultType: z.enum(['numeric', 'coded', 'text']),
  valueSetUrl: z.string().nullish(),
  bands: z.array(band).optional(),
}).transform((p) => ({
  system: p.system,
  code: p.code,
  resultType: p.resultType,
  valueSetUrl: p.valueSetUrl ?? null,
  bands: (p.bands ?? []).map((b) => ({
    low: b.low ?? null, high: b.high ?? null, unit: b.unit ?? null,
    sex: b.sex ?? null, ageLow: b.ageLow ?? null, ageHigh: b.ageHigh ?? null,
  })),
}));
const testInput = z.object({
  code: z.string().nullish(),
  display: z.string(),
  shortName: z.string().nullish(),
  category: z.string().nullish(),
  specimenTypes: z.array(coding).optional(),
  resultParams: z.array(resultParam).optional(),
  loinc: z.string().nullish(),
  active: z.boolean().optional(),
});
const labInput = z.object({
  enabled: z.boolean(),
  specimenTypes: z.array(coding).nullable(),
  localDisplay: z.string().nullable(),
});
const enabledInput = z.object({ enabled: z.boolean() });
const activeInput = z.object({ active: z.boolean() });
const specimensInput = z.object({ tests: z.array(coding) });
const resultParamsInput = z.object({
  tests: z.array(coding),
  patient: z.object({ reference: z.string().min(1) }).optional(),
});

/**
 * The patient's sex and whole years of age, read from the stored Patient. The studio sends a
 * reference only, so no date arithmetic happens in the browser and no birth date travels with a
 * picker answer. A patient that cannot be read gives nulls, and the catalog then answers the
 * catch-all band (bench result entry, spec 7).
 */
async function patientBandKey(ctx: AppContext, reference: string | undefined): Promise<{ sex: string | null; ageYears: number | null }> {
  const id = reference?.split('/')[1];
  if (!id) return { sex: null, ageYears: null };
  const patient = (await ctx.fhirStore.get('Patient', id).catch(() => null)) as { gender?: string; birthDate?: string } | null;
  if (!patient) return { sex: null, ageYears: null };
  const born = patient.birthDate ? new Date(patient.birthDate) : null;
  const ageYears = born && !Number.isNaN(born.getTime())
    ? Math.floor((Date.now() - born.getTime()) / (365.2425 * 24 * 60 * 60 * 1000))
    : null;
  return { sex: patient.gender ?? null, ageYears };
}

/** The reasons one value set offers, as plain codings. An unreadable set answers none, so a reject
 *  sheet opens empty rather than the page failing. */
async function expandReasons(ctx: AppContext, url: string): Promise<Array<{ system: string; code: string; display: string | null }>> {
  const vs = await ctx.terminology.ops.expand(url, { count: 500 }).catch(() => null);
  return (vs?.expansion?.contains ?? []).map((c) => ({ system: c.system ?? '', code: c.code ?? '', display: c.display ?? null }));
}

// A catalog refusal keeps its words and says which kind it is. Anything else goes to the shared
// error handler.
function replyCatalogError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof TestCatalogError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

/**
 * The uploaded file's bytes, or null when the body is not a file. `bodyLimit` does not bound a
 * passthrough parser (facilities-routes.ts, MAX_UPLOAD_BYTES), so the count happens here. Reading stops
 * one chunk past the limit, and readCatalogImportFile refuses that size in its own words.
 */
async function readUpload(body: unknown): Promise<Buffer | null> {
  if (!body || typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] !== 'function') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > CATALOG_IMPORT_MAX_BYTES) break;
  }
  return Buffer.concat(chunks);
}

export function registerTestCatalogRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // The upload arrives as raw bytes. terminology-admin-routes.ts registers this parser first on the same
  // app, and a second registration throws, so it is guarded as in facilities-routes.ts.
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }

  app.get('/api/test-catalog', VIEW, async (req, reply) => {
    const parsed = parseCatalogListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.testCatalog.list(parsed.query));
  });

  // The page's pickers read this, not a ValueSet expansion, so they offer exactly what a save accepts.
  app.get('/api/test-catalog/options', VIEW, async (_req, reply) => {
    return reply.send(await ctx.testCatalog.options());
  });

  app.post('/api/test-catalog', MANAGE, async (req, reply) => {
    const parsed = testInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const created = await ctx.testCatalog.create(parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.create', entityType: 'test_catalog', entityId: created.code, before: null, after: created });
      return reply.code(201).send(created);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = testInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const updated = await ctx.testCatalog.update(code, parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.update', entityType: 'test_catalog', entityId: code, before, after: updated });
      return reply.send(updated);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code/lab', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = labInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = (await ctx.testCatalog.get(code))?.lab ?? null;
      const saved = await ctx.testCatalog.setLabSettings(code, parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: code, before, after: saved.lab });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  // The page's row actions. Each changes one field; `openldr test-catalog enable | disable | retire |
  // restore` calls the same service methods and records the same audit action.
  app.put('/api/test-catalog/:code/enabled', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = enabledInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const saved = await ctx.testCatalog.setEnabled(code, parsed.data.enabled);
      await recordAudit(ctx, req, {
        action: catalogChangeAction('enabled', parsed.data.enabled), entityType: 'test_catalog', entityId: code,
        before: { enabled: before?.lab.enabled ?? null }, after: { enabled: saved.lab.enabled },
      });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code/active', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = activeInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const saved = await ctx.testCatalog.setActive(code, parsed.data.active);
      await recordAudit(ctx, req, {
        action: catalogChangeAction('active', parsed.data.active), entityType: 'test_catalog', entityId: code,
        before: { active: before?.active ?? null }, after: { active: saved.active },
      });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  // Import step 1: read the file. Nothing is stored. The table goes back to the studio, which sends it
  // with each later step, so the server keeps no state between steps.
  app.post('/api/test-catalog/import/read', MANAGE, async (req, reply) => {
    const format = importFormat.safeParse((req.query as Record<string, unknown>).format);
    if (!format.success) return reply.code(400).send({ error: 'format must be "csv" or "xlsx"' });
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'Send the file itself as the request body, as application/octet-stream.' });
    try {
      return reply.send(readCatalogImportFile(bytes, format.data));
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.post('/api/test-catalog/import/preview', IMPORT_STEP, async (req, reply) => {
    const parsed = catalogImportInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.send(await ctx.testCatalog.importPreview(parsed.data));
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  // `openldr test-catalog import --apply` calls the same service method and records the same entry.
  app.post('/api/test-catalog/import/apply', IMPORT_STEP, async (req, reply) => {
    const parsed = catalogImportInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const report = await ctx.testCatalog.importApply(parsed.data);
      await recordAudit(ctx, req, catalogImportAudit(report));
      return reply.send(report);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.get('/api/test-catalog/export', VIEW, async (_req, reply) => {
    const csv = await ctx.testCatalog.exportCsv();
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="test-catalog.csv"')
      .send(csv);
  });

  // Test catalog S4: the specimens the chosen tests accept, for the Lab order's specimen picker (spec 4.5).
  app.post('/api/test-catalog/specimens', FORMS_VIEW, async (req, reply) => {
    const parsed = specimensInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.send({ specimens: await ctx.testCatalog.specimensFor(parsed.data.tests) });
  });

  // Browsing the catalog from a Lab order (docs/superpowers/specs/2026-09-16-browse-tests-design.md).
  // Gated on forms.view, and narrowed: a data-entry surface sees what a test is and whether this lab
  // runs it, never the management data GET /api/test-catalog answers. The coding system travels with
  // the answer, so a pick into an empty Tests answer has one and the studio names none.
  app.get('/api/test-catalog/browse', FORMS_VIEW, async (req, reply) => {
    const parsed = parseCatalogListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = await ctx.testCatalog.list(parsed.query);
    return reply.send({
      rows: result.rows.map((t) => ({ code: t.code, display: t.display, category: t.category, enabled: t.lab.enabled })),
      total: result.total,
      system: TEST_CATALOG_SYSTEM,
    });
  });

  // The browse sheet's category filter: every category in the catalog, not only those on the page it
  // has loaded. Read once when the sheet opens, and narrowed to the categories, because options() also
  // answers the management page's other pickers.
  app.get('/api/test-catalog/browse/categories', FORMS_VIEW, async (_req, reply) => {
    const { categories } = await ctx.testCatalog.options();
    return reply.send({ categories: categories.map(({ code, display }) => ({ code, display })) });
  });

  // Bench result entry: the parameters each chosen test yields, with the band that fits the patient,
  // and the rejection reasons for both levels. The reasons are expanded here because the studio must
  // never name a clinical value set (AGENTS.md section 8).
  app.post('/api/test-catalog/result-params', FORMS_VIEW, async (req, reply) => {
    const parsed = resultParamsInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const patient = await patientBandKey(ctx, parsed.data.patient?.reference);
    const [tests, order, test] = await Promise.all([
      ctx.testCatalog.resultParamsFor(parsed.data.tests, patient),
      expandReasons(ctx, ORDER_REJECT_VALUE_SET),
      expandReasons(ctx, TEST_REJECT_VALUE_SET),
    ]);
    return reply.send({ tests, rejectReasons: { order, test } });
  });
}
