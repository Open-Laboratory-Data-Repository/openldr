import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parsePageQuery, parsePatientListQuery, parseSystemInput, parseSystemListQuery, PatientIndexError, type AppContext,
} from '@openldr/bootstrap';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Patient index (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 4). patients.view
// reads; patients.view_identifiers unmasks; patients.manage edits identifier system labels. Masking
// happens in bootstrap's patient-index.ts, so these routes only pass the caller's right along.
const VIEW = { preHandler: requireCapability('patients.view') };
const MANAGE = { preHandler: requireCapability('patients.manage') };

function canUnmask(req: FastifyRequest): boolean {
  return (req.user?.capabilities ?? []).includes('patients.view_identifiers');
}

function replyPatientError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof PatientIndexError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

export function registerPatientRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/patients', VIEW, async (req, reply) => {
    const parsed = parsePatientListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const unmask = canUnmask(req);
    const out = await ctx.patientIndex.list(parsed.query, { unmask });
    // The search text is often an identifier, so only the count is recorded.
    if (unmask) await recordAudit(ctx, req, { action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { count: out.total } });
    return reply.send(out);
  });

  // Registered before /:ref so this literal path is never read as a patient ref.
  app.get('/api/patients/identifier-systems', VIEW, async (req, reply) => {
    const parsed = parseSystemListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.patientIdentifierSystems.list(parsed.query));
  });

  // The system URI goes in the body: URIs carry slashes and colons.
  app.put('/api/patients/identifier-systems', MANAGE, async (req, reply) => {
    const parsed = parseSystemInput(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    try {
      const before = await ctx.patientIdentifierSystems.get(parsed.input.system);
      const after = await ctx.patientIdentifierSystems.set(parsed.input);
      await recordAudit(ctx, req, { action: 'patients.identifier_system.update', entityType: 'patient_identifier_system', entityId: parsed.input.system, before, after });
      return reply.send(after);
    } catch (err) {
      return replyPatientError(err, reply);
    }
  });

  app.get('/api/patients/:ref', VIEW, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    const unmask = canUnmask(req);
    try {
      const detail = await ctx.patientIndex.get(ref, { unmask });
      if (unmask) await recordAudit(ctx, req, { action: 'patients.view', entityType: 'patient', entityId: ctx.patientIndex.idForRef(ref) ?? 'unknown' });
      return reply.send(detail);
    } catch (err) {
      return replyPatientError(err, reply);
    }
  });

  app.get('/api/patients/:ref/requests', VIEW, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    const parsed = parsePageQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    try {
      return reply.send(await ctx.patientIndex.requests(ref, parsed.query));
    } catch (err) {
      return replyPatientError(err, reply);
    }
  });
}
