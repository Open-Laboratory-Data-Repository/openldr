import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';

const params = z.object({
  plugin: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  edition: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/),
});
const caps = ['reports.view', 'reports.view_issued', 'patients.view', 'patients.view_identifiers'];
const coding = z.object({
  text: z.string().optional(),
  coding: z.array(z.object({ display: z.string().optional(), code: z.string().optional() })).optional(),
});
const ref = z.object({ reference: z.string() });
const quantity = z.object({ value: z.number(), unit: z.string().optional() });
const obs = z.object({
  status: z.string(),
  subject: ref,
  code: coding,
  valueQuantity: quantity.optional(),
  valueString: z.string().optional(),
  valueDateTime: z.string().optional(),
  valueBoolean: z.boolean().optional(),
  valueCodeableConcept: coding.optional(),
  interpretation: z.array(coding).optional(),
  referenceRange: z
    .array(z.object({ text: z.string().optional(), low: quantity.optional(), high: quantity.optional() }))
    .optional(),
});
const report = z.object({
  status: z.enum(['final', 'amended', 'corrected', 'appended']),
  code: coding,
  issued: z.string(),
  subject: ref,
  result: z.array(ref).default([]),
  basedOn: z.array(ref).default([]),
  conclusion: z.string().optional(),
  resultsInterpreter: z.array(z.object({ display: z.string().optional() })).optional(),
  extension: z
    .array(z.object({ url: z.string(), valuePositiveInt: z.number().int().positive().optional() }))
    .optional(),
});
const label = (v: z.infer<typeof coding>) =>
  v.text ||
  v.coding
    ?.map((c) => c.display || c.code)
    .filter(Boolean)
    .join(', ') ||
  '';
const qty = (q: z.infer<typeof quantity>) => [q.value, q.unit].filter((v) => v !== undefined).join(' ');

export function registerIssuedReportRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext) {
  app.get('/api/reports/issued/:plugin/:edition', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!req.user) return reply.code(401).send();
    const unavailable = () => reply.code(404).send({ error: 'Edition unavailable' });
    // CE withholds individual reports and patient identifiers under a data limit.
    if (req.user.dataScope?.limited !== false || !caps.every((cap) => req.user!.capabilities?.includes(cap)))
      return unavailable();
    const key = params.safeParse(req.params);
    if (!key.success) return unavailable();
    const { plugin, edition } = key.data;
    const saved = await ctx.internalDb
      .selectFrom('issued_report_editions')
      .selectAll()
      .where('plugin_id', '=', plugin)
      .where('edition_id', '=', edition)
      .executeTakeFirst();
    if (!saved || !saved.versions.length) return unavailable();
    const versions = saved.versions.filter((v) =>
      ['DiagnosticReport', 'Observation', 'ServiceRequest'].includes(v.resourceType),
    );
    if (!versions.length) return unavailable();
    const rows = await ctx.internalDb
      .selectFrom('fhir.resource_history')
      .select(['resource_type', 'id', 'resource'])
      .where('op', '=', 'upsert')
      .where((eb) =>
        eb.or(
          versions.map((v) =>
            eb.and({
              resource_type: v.resourceType,
              id: v.id,
              version: v.version,
            }),
          ),
        ),
      )
      .execute();
    if (rows.length !== versions.length) return unavailable();
    const bodies = new Map(rows.map((row) => [row.resource_type + '/' + row.id, row.resource]));
    const parsed = report.safeParse(bodies.get('DiagnosticReport/' + saved.report_id));
    if (!parsed.success) return unavailable();
    const r = parsed.data;
    const readings = [];
    for (const link of r.result) {
      if (!link.reference.startsWith('Observation/')) return unavailable();
      const o = obs.safeParse(bodies.get(link.reference));
      if (
        !o.success ||
        o.data.subject.reference !== r.subject.reference ||
        o.data.status === 'entered-in-error'
      )
        return unavailable();
      const v = o.data;
      const value = v.valueQuantity
        ? qty(v.valueQuantity)
        : v.valueCodeableConcept
          ? label(v.valueCodeableConcept)
          : (v.valueString ?? v.valueDateTime ?? v.valueBoolean?.toString());
      if (value === undefined) return unavailable();
      readings.push({
        name: label(v.code),
        value,
        interpretation: v.interpretation?.map(label).join(', '),
        range: v.referenceRange
          ?.map((b) =>
            [
              b.text,
              (b.low || b.high) &&
                [b.low && qty(b.low), b.high && qty(b.high)].map((x) => x ?? '…').join(' – '),
            ]
              .filter(Boolean)
              .join(' · '),
          )
          .join(', '),
      });
    }
    const request = r.basedOn.length ? bodies.get(r.basedOn[0].reference) : null;
    if (r.basedOn.some((link) => !bodies.has(link.reference))) return unavailable();
    const accession = z
      .object({ subject: ref, requisition: z.object({ value: z.string() }) })
      .safeParse(request);
    if (request && (!accession.success || accession.data.subject.reference !== r.subject.reference))
      return unavailable();
    await recordAudit(ctx, req, {
      action: 'reports.issued.read',
      entityType: 'DiagnosticReport',
      entityId: saved.report_id,
      metadata: { edition, plugin },
    });
    const version = versions.find(
      (v) => v.resourceType === 'DiagnosticReport' && v.id === saved.report_id,
    )!.version;
    const current = await ctx.internalDb
      .selectFrom('fhir.fhir_current')
      .select('version')
      .where('resource_type', '=', 'DiagnosticReport')
      .where('id', '=', saved.report_id)
      .executeTakeFirst();
    return {
      id: saved.report_id,
      version,
      earlierVersion: Boolean(current && current.version > version),
      edition: r.extension?.find((x) => x.url === 'urn:openldr:edition-number')?.valuePositiveInt,
      title: label(r.code),
      status: r.status,
      issued: r.issued,
      accession: accession.success ? accession.data.requisition.value : null,
      reviewer: r.resultsInterpreter
        ?.map((i) => i.display)
        .filter(Boolean)
        .join(', '),
      narrative: r.conclusion,
      readings,
    };
  });
}
