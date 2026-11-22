import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ReceptionError, TEST_CATALOG_SYSTEM, type AppContext, type RegisterPatientInput,
} from '@openldr/bootstrap';
import { FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { z, type ZodError } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// The lab desk's routes (lab module slices 1b and 2, ruling 8). The Reception role holds lab.receive
// but not forms.view, facilities.view, terminology.view or patients.view_identifiers, so every
// existing lookup refuses it. These routes gate on lab.receive alone and call createLabReception.
const RECEIVE = { preHandler: requireCapability('lab.receive') };

/** The facility search's page and minimum, as the form picker's (reference-search-routes.ts). */
const FACILITY_LIMIT = 20;
const MIN_QUERY = 2;
const TEST_LIMIT = 50;

// String caps, after form-entry-routes.ts (search 100, reason 500).
const CODE_MAX = 100;
const NAME_MAX = 100;
const NUMBER_MAX = 100;
const TEXT_MAX = 500;
const URI_MAX = 500;
const code = z.string().min(1).max(CODE_MAX);
const system = z.string().min(1).max(URI_MAX);
const requisition = z.string().trim().min(1).max(NUMBER_MAX);
const name = z.string().max(NAME_MAX);
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A blank date is no date: the service reads '' as left out.
const isDate = (v: string): boolean => v === '' || (FULL_DATE.test(v) && !Number.isNaN(Date.parse(v)));
// A FHIR dateTime with a time: a date, a time and a zone, which Specimen.receivedTime needs.
const isDateTime = (v: string): boolean => v === '' ||
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

const coding = z.object({ system, code });
const codingWithDisplay = coding.extend({ display: z.string().max(TEXT_MAX).optional() });

const ordersQuery = z.object({ requisition });
const registerOrderBody = z.object({
  requisition,
  facilityCode: code,
  patientId: code,
  tests: z.array(coding).min(1).max(TEST_LIMIT),
  priority: code.optional(),
  clinician: name.optional(),
  note: z.string().max(TEXT_MAX).optional(),
});
// Extra keys pass through on purpose: the service refuses a change it may not make (the tests, the
// number, the facility) and says how to fix it instead. zod would drop them without a word.
const correctOrderBody = z.object({
  requisition,
  facilityCode: code.nullable(),
  changes: z.object({
    priority: z.string().max(CODE_MAX).nullable().optional(),
    clinician: name.nullable().optional(),
    note: z.string().max(TEXT_MAX).nullable().optional(),
    patientId: code.optional(),
  }).passthrough(),
  reason: z.string().max(TEXT_MAX),
});
const patientsQuery = z.object({
  identifier: z.string().max(CODE_MAX).optional(),
  name: name.optional(),
  birthDate: z.string().refine(isDate, 'must be a full date, YYYY-MM-DD').optional(),
});
// Sex is checked by the service against the Patient schema's own list (ruling 11).
const registerPatientBody = z.object({
  given: name,
  family: name,
  gender: z.string().max(CODE_MAX),
  birthDate: z.string().refine(isDate, 'must be a full date, YYYY-MM-DD').optional(),
  ageYears: z.number().optional(),
  identifier: z.object({ system: z.string().max(URI_MAX), value: z.string().max(CODE_MAX) }).optional(),
});
const receiveSampleBody = z.object({
  requisition,
  facilityCode: code.nullable().optional(),
  type: codingWithDisplay,
  condition: codingWithDisplay.optional(),
  serviceRequestIds: z.array(code).max(TEST_LIMIT).optional(),
  receivedTime: z.string().refine(isDateTime, 'must be a date and time with a zone, as 2026-11-23T08:00:00Z').optional(),
});
const choicesQuery = z.object({ requisition, facility: z.string().max(CODE_MAX).optional() });
const searchQuery = z.object({ q: z.string().max(NAME_MAX).optional() });

/** A zod refusal in plain words: each field and what is wrong with it. */
function plain(err: ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

/** A blank value as null. */
function orNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Two writes of the same fixed id at the same moment: the store's history key refuses the second
 *  (fhir-store.ts writeMany). It saved nothing, so it is the same refusal as an order already there. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '23505';
}

/** A reception refusal keeps its words and says which kind it is. Anything else goes to the shared
 *  error handler. */
function replyReceptionError(err: unknown, reply: FastifyReply) {
  if (isUniqueViolation(err)) {
    return reply.code(409).send({ error: 'Someone else saved this at the same moment. Search again to see it.', reason: 'conflict' });
  }
  if (!(err instanceof ReceptionError)) throw err;
  const status = err.reason === 'invalid' ? 400 : err.reason === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, reason: err.reason });
}

/** Who did a desk write, as the record names them (constraints: displayName, else username). */
function actorOf(req: FastifyRequest): string | null {
  return req.user ? (req.user.displayName || req.user.username) : null;
}

export function registerLabRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const desk = ctx.labReception;

  /** Parses a body or query, or answers 400 and returns null. */
  function parse<T>(schema: z.ZodType<T>, input: unknown, reply: FastifyReply): T | null {
    const parsed = schema.safeParse(input ?? {});
    if (parsed.success) return parsed.data;
    void reply.code(400).send({ error: plain(parsed.error) });
    return null;
  }

  /** The actor of a write, or a 401 when there is none. The capability gate normally refuses first. */
  function actor(req: FastifyRequest, reply: FastifyReply): string | null {
    const who = actorOf(req);
    if (!who) void reply.code(401).send({ error: 'authentication required' });
    return who;
  }

  app.get('/api/lab/orders', RECEIVE, async (req, reply) => {
    const q = parse(ordersQuery, req.query, reply);
    if (!q) return reply;
    return reply.send({ rows: await desk.findOrders(q.requisition) });
  });

  app.post('/api/lab/orders', RECEIVE, async (req, reply) => {
    const who = actor(req, reply);
    if (!who) return reply;
    const body = parse(registerOrderBody, req.body, reply);
    if (!body) return reply;
    try {
      const order = await desk.registerOrder(body, who);
      await recordAudit(ctx, req, {
        action: 'lab.order.register', entityType: 'lab_order', entityId: order.requisition,
        metadata: { facility: order.facility?.code ?? null, tests: order.tests.map((t) => t.code) },
      });
      return reply.code(201).send(order);
    } catch (err) {
      return replyReceptionError(err, reply);
    }
  });

  app.post('/api/lab/orders/correct', RECEIVE, async (req, reply) => {
    const who = actor(req, reply);
    if (!who) return reply;
    const body = parse(correctOrderBody, req.body, reply);
    if (!body) return reply;
    try {
      const order = await desk.correctOrder(body, who);
      // The fields changed, not their values: a note or clinician name stays out of the audit.
      await recordAudit(ctx, req, {
        action: 'lab.order.correct', entityType: 'lab_order', entityId: order.requisition,
        metadata: { facility: order.facility?.code ?? null, fields: Object.keys(body.changes) },
      });
      return reply.send(order);
    } catch (err) {
      return replyReceptionError(err, reply);
    }
  });

  app.get('/api/lab/patients', RECEIVE, async (req, reply) => {
    const q = parse(patientsQuery, req.query, reply);
    if (!q) return reply;
    return reply.send({ rows: await desk.searchPatients(q) });
  });

  app.post('/api/lab/patients', RECEIVE, async (req, reply) => {
    const who = actor(req, reply);
    if (!who) return reply;
    const body = parse(registerPatientBody, req.body, reply);
    if (!body) return reply;
    try {
      const made = await desk.registerPatient(body as RegisterPatientInput, who);
      // The id only, as the other patient audits record (patient-routes.ts): no name, no identifier.
      await recordAudit(ctx, req, { action: 'lab.patient.register', entityType: 'patient', entityId: made.id });
      return reply.code(201).send(made);
    } catch (err) {
      return replyReceptionError(err, reply);
    }
  });

  app.post('/api/lab/samples', RECEIVE, async (req, reply) => {
    const who = actor(req, reply);
    if (!who) return reply;
    const body = parse(receiveSampleBody, req.body, reply);
    if (!body) return reply;
    try {
      const order = await desk.receiveSample({ ...body, facilityCode: body.facilityCode ?? null }, who);
      const specimen = order.specimens.find((s) => s.type?.system === body.type.system && s.type.code === body.type.code);
      await recordAudit(ctx, req, {
        action: 'lab.sample.receive', entityType: 'specimen', entityId: specimen?.id ?? order.requisition,
        metadata: {
          requisition: order.requisition, facility: order.facility?.code ?? null,
          type: body.type.code, condition: body.condition?.code ?? null,
        },
      });
      return reply.send(order);
    } catch (err) {
      return replyReceptionError(err, reply);
    }
  });

  app.get('/api/lab/samples/choices', RECEIVE, async (req, reply) => {
    const q = parse(choicesQuery, req.query, reply);
    if (!q) return reply;
    try {
      return reply.send(await desk.sampleChoices(q.requisition, orNull(q.facility)));
    } catch (err) {
      return replyReceptionError(err, reply);
    }
  });

  // The facility register, searched as the form's facility picker searches it
  // (reference-search-routes.ts, code-system mode), without needing a form.
  app.get('/api/lab/facilities', RECEIVE, async (req, reply) => {
    const q = parse(searchQuery, req.query, reply);
    if (!q) return reply;
    const term = (q.q ?? '').trim();
    if (term.length < MIN_QUERY) return reply.send({ rows: [] });
    const found = await ctx.terminology.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { query: term, limit: FACILITY_LIMIT, offset: 0 });
    return reply.send({ rows: found.rows.map((r) => ({ code: r.code, display: r.display })) });
  });

  // The tests this lab offers: active catalog tests the lab has enabled, under the lab's own name.
  app.get('/api/lab/tests', RECEIVE, async (req, reply) => {
    const q = parse(searchQuery, req.query, reply);
    if (!q) return reply;
    const term = orNull(q.q);
    const found = await ctx.testCatalog.list({
      ...(term ? { q: term } : {}), enabled: true, status: 'active', limit: TEST_LIMIT, offset: 0,
    });
    return reply.send({
      rows: found.rows.map((t) => ({ system: TEST_CATALOG_SYSTEM, code: t.code, display: t.lab.localDisplay ?? t.display })),
    });
  });
}
