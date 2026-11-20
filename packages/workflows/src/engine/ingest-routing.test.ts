import { describe, it, expect, vi } from 'vitest';
import { buildDefaultWorkflows } from '../sample-workflow';
import { runWorkflow } from './run-workflow';
import type { RunMapToFhirInput, WorkflowServices } from './services';
import type { WorkflowItem } from './items';

/** The seeded ingest workflow's nodes/edges, form-bound to a fake id. */
function ingestGraph() {
  const [ingest] = buildDefaultWorkflows({ orderFormId: 'form-1', webhookSecret: 's' });
  return ingest.definition;
}

// Made-up field ids of the fake order form.
const FORM_FIELDS = new Set(['answer_a', 'answer_b']);

/**
 * A fake Map to FHIR service with the real service's three outcomes: FHIR goes out as its
 * resources, answers to the order form go out as one extracted record, and anything else is held.
 * It proves the graph's wiring, not the real classification.
 */
function fakeMapToFhir(input: RunMapToFhirInput) {
  const out: WorkflowItem[] = [];
  const held: WorkflowItem[] = [];
  const heldIndexes: number[] = [];
  const meta = { fhir: 0, form: 0, mapped: 0, held: 0, heldReasons: [] as string[], notes: [] as string[] };
  input.items.forEach((item, index) => {
    const json = item.json as Record<string, unknown>;
    const hold = (reason: string) => {
      held.push({ json: { item: json, reason } });
      heldIndexes.push(index);
      meta.held += 1;
      meta.heldReasons.push(reason);
    };
    if (json.resourceType === 'Bundle') {
      const resources = ((json.entry as Array<{ resource: Record<string, unknown> }>) ?? []).map((e) => e.resource);
      // A resource with id FAILS stands for one that fails CE's checks: the whole Bundle is held.
      if (resources.some((r) => r.id === 'FAILS')) return hold('record 1 (Observation): failed the business-rule check');
      for (const r of resources) out.push({ json: r });
      meta.fhir += 1;
    } else if (typeof json.resourceType === 'string') {
      out.push({ json });
      meta.fhir += 1;
    } else if (Object.keys(json).length > 0 && Object.keys(json).every((k) => FORM_FIELDS.has(k)) && input.config.formIds.includes('form-1')) {
      out.push({ json: { resourceType: 'ServiceRequest', id: `sr-${index}` } });
      meta.form += 1;
    } else {
      hold('no mapping for this shape');
    }
  });
  return { out, held, heldIndexes, meta };
}

/** Stub services: mapToFhir as above, persistStore echoes its items so we can assert calls. */
function stubServices() {
  const mapToFhir = vi.fn(async (input: RunMapToFhirInput) => fakeMapToFhir(input));
  const persistStore = vi.fn(async ({ items, source }: { items: WorkflowItem[]; source?: string }) => ({
    items,
    meta: { persisted: items.length, flattened: { written: items.length, skipped: 0, degraded: 0 }, resourceTypes: [], source },
  }));
  return { mapToFhir, persistStore } as unknown as WorkflowServices;
}

const statusOf = (results: { nodeId: string; status: string }[], id: string) =>
  results.find((r) => r.nodeId === id)?.status;

type PersistCall = { items: WorkflowItem[]; source?: string };
const persistMock = (s: WorkflowServices) => s.persistStore as unknown as ReturnType<typeof vi.fn>;
const persistedTypes = (s: WorkflowServices) =>
  (persistMock(s).mock.calls[0]![0] as PersistCall).items.map((i) => (i.json as { resourceType: string }).resourceType);

describe('wf-ingest routing', () => {
  it('passes the node config to the service: body rows, Lab result, the order form, no mappings', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: { answer_a: 'x' }, headers: {}, query: {} },
      services,
    });
    const call = (services.mapToFhir as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RunMapToFhirInput;
    expect(call.config).toEqual({ targetId: 'lab-result', formIds: ['form-1'], mappings: [] });
    // sourcePath 'body': the service sees the posted body, not the webhook envelope.
    expect(call.items).toEqual([{ json: { answer_a: 'x' } }]);
  });

  it('sends a FHIR transaction Bundle to Persist as its resources', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }, { resource: { resourceType: 'ServiceRequest', id: 'sr1' } }],
    };
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: bundle, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'map-1')).toBe('success');
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect(statusOf(results, 'log-1')).toBe('success');
    expect(persistMock(services)).toHaveBeenCalledTimes(1);
    expect(persistedTypes(services)).toEqual(['Observation', 'ServiceRequest']);
  });

  it('sends answers to the order form to Persist as the extracted records', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: { answer_a: 'x', answer_b: 'y' }, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect(persistedTypes(services)).toEqual(['ServiceRequest']);
  });

  const errorOf = (results: { nodeId: string; error?: string }[], id: string) => results.find((r) => r.nodeId === id)?.error;

  const heldLogOf = (results: unknown[]) =>
    (results as Array<{ nodeId: string; output?: WorkflowItem[]; logs?: Array<{ message: string }> }>).find((r) => r.nodeId === 'held-log-1');

  // Since 2026-11-20 the default graph sends held items to "Log held". The run completes; the
  // webhook and form answers report the held count (workflows-routes.ts, forms-routes.ts).
  it('logs an unknown row as held, with its reason and not its values, and stores nothing', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: { QZX_col: 'QZX-value' }, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'held-log-1')).toBe('success');
    expect(heldLogOf(results)?.logs?.map((l) => l.message)).toEqual(['Held, not stored: no mapping for this shape']);
    expect(JSON.stringify(heldLogOf(results)?.logs)).not.toContain('QZX');
    expect(persistMock(services)).not.toHaveBeenCalled();
  });

  it('logs a FHIR Bundle that fails the checks as held, and stores nothing from it', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ resource: { resourceType: 'Observation', id: 'FAILS' } }] };
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: bundle, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(heldLogOf(results)?.logs?.[0]?.message).toMatch(/failed the business-rule check$/);
    expect(persistMock(services)).not.toHaveBeenCalled();
  });

  it('stores the good items of a mixed list and logs the one that cannot be mapped', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const body = [{ resourceType: 'Observation', id: 'o1' }, { answer_a: 'x' }, { QZX_col: 'QZX-value' }];
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(persistedTypes(services)).toEqual(['Observation', 'ServiceRequest']);
    expect(heldLogOf(results)?.output?.map((i) => i.json.reason)).toEqual(['no mapping for this shape']);
  });

  // A person who wants a message refused whole unwires held again.
  it('with held unwired, fails the run for an unknown row, with the count and reason, and does not run Persist', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results, status } = await runWorkflow(
      nodes.filter((n) => n.id !== 'held-log-1'),
      edges.filter((e) => e.sourceHandle !== 'held'),
      { input: { method: 'POST', body: { QZX_col: 'QZX-value' }, headers: {}, query: {} }, services },
    );
    expect(status).toBe('failed');
    expect(errorOf(results, 'map-1')).toBe(
      'Map to FHIR node: 1 item(s) held and the held port is not connected. First reasons: no mapping for this shape',
    );
    expect(persistMock(services)).not.toHaveBeenCalled();
  });

  // The seam this branch exists to create, end to end through the REAL seeded graph: what
  // POST /api/forms/:id/responses hands the runner is a transaction Bundle whose entry[0] is the
  // QuestionnaireResponse, with the provenance override at the TOP LEVEL of the envelope.
  it('carries a form-capture submission through the graph with its provenance override', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        { resource: { resourceType: 'QuestionnaireResponse', id: 'qr1', author: { display: 'clerk' } } },
        { resource: { resourceType: 'ServiceRequest', id: 'sr1', subject: { reference: 'Patient/p1' } } },
      ],
    };

    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: bundle, headers: {}, query: {}, __provenance: { sourceSystem: 'form-capture' } },
      services,
    });

    expect(status).toBe('completed');
    expect(statusOf(results, 'map-1')).toBe('success');
    expect(statusOf(results, 'persist-1')).toBe('success');

    const persist = persistMock(services);
    expect(persist).toHaveBeenCalledTimes(1);
    const call = persist.mock.calls[0]![0] as PersistCall;
    // The override wins over the node's configured `webhook-ingest`, so hand-entered data is
    // distinguishable from LIMS/CDR data in the store.
    expect(call.source).toBe('form-capture');
    // BOTH items reach persistence: the verbatim record of what was typed AND what was derived.
    expect(persistedTypes(services)).toEqual(['QuestionnaireResponse', 'ServiceRequest']);
  });

  // The webhook path must be unaffected: an external sender cannot forge the override, because it
  // travels on the envelope the route builds, not inside the posted body.
  it('keeps the configured source for a webhook Bundle with no override', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    await runWorkflow(nodes, edges, {
      input: {
        method: 'POST', headers: {}, query: {},
        body: {
          resourceType: 'Bundle', type: 'transaction',
          // A forged override INSIDE the body must not be honoured.
          entry: [{ resource: { resourceType: 'Observation', id: 'o1', __provenance: { sourceSystem: 'form-capture' } } }],
        },
      },
      services,
    });

    expect((persistMock(services).mock.calls[0]![0] as PersistCall).source).toBe('webhook-ingest');
  });

  it('sends a bare resource array to Persist', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: [{ resourceType: 'Observation', id: 'o1' }], headers: {}, query: {} },
      services,
    });
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect(persistedTypes(services)).toEqual(['Observation']);
  });
});
