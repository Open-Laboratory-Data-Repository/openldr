import { describe, it, expect, vi } from 'vitest';
import { buildDefaultWorkflows } from '../sample-workflow';
import { runWorkflow } from './run-workflow';
import type { WorkflowServices } from './services';
import type { WorkflowItem } from './items';

/** The seeded ingest workflow's nodes/edges, form-bound to a fake id. */
function ingestGraph() {
  const [ingest] = buildDefaultWorkflows({ orderFormId: 'form-1', webhookSecret: 's' });
  return ingest.definition;
}

/** Stub services: validateForm and persistStore just echo their items so we can assert calls. */
function stubServices() {
  const validateForm = vi.fn(async ({ formId, items }: { formId: string; items: WorkflowItem[] }) => ({
    items: [{ json: { resourceType: 'ServiceRequest' } }],
    meta: { formId, validated: items.length, invalid: [] },
  }));
  const persistStore = vi.fn(async ({ items, source }: { items: WorkflowItem[]; source?: string }) => ({
    items,
    meta: { persisted: items.length, flattened: { written: items.length, skipped: 0, degraded: 0 }, resourceTypes: [], source },
  }));
  return { validateForm, persistStore } as unknown as WorkflowServices;
}

const statusOf = (results: { nodeId: string; status: string }[], id: string) =>
  results.find((r) => r.nodeId === id)?.status;

describe('wf-ingest routing', () => {
  it('routes a FHIR transaction Bundle to unwrap and skips form-validate', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }],
    };
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: bundle, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'unwrap-1')).toBe('success');
    expect(statusOf(results, 'form-validate-1')).toBe('skipped');
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect((services.validateForm as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((services.persistStore as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('routes form answers to form-validate and skips unwrap', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results, status } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: { patientName: 'Ada', testCode: 'CBC' }, headers: {}, query: {} },
      services,
    });
    expect(status).toBe('completed');
    expect(statusOf(results, 'form-validate-1')).toBe('success');
    expect(statusOf(results, 'unwrap-1')).toBe('skipped');
    expect(statusOf(results, 'persist-1')).toBe('success');
    expect((services.validateForm as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((services.persistStore as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  // The seam this branch exists to create, end to end through the REAL seeded graph: what
  // POST /api/forms/:id/responses hands the runner is a transaction Bundle whose entry[0] is the
  // QuestionnaireResponse, with the provenance override at the TOP LEVEL of the envelope.
  //
  // Every route test stubs runAndRecord, so they only assert the shape of an envelope handed to a
  // stub; the other cases here drive the real graph but with no `__provenance`. Neither would
  // catch a rename of the reserved key, a Switch condition that stopped matching the capture
  // payload, or a Persist Store node that stopped preferring the override. This one does.
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
    expect(statusOf(results, 'unwrap-1')).toBe('success');
    expect(statusOf(results, 'form-validate-1')).toBe('skipped');
    expect(statusOf(results, 'persist-1')).toBe('success');

    const persist = services.persistStore as unknown as ReturnType<typeof vi.fn>;
    expect(persist).toHaveBeenCalledTimes(1);
    const call = persist.mock.calls[0]![0] as { items: WorkflowItem[]; source?: string };
    // The override wins over the node's configured `webhook-ingest`, so hand-entered data is
    // distinguishable from LIMS/CDR data in the store.
    expect(call.source).toBe('form-capture');
    // BOTH items reach persistence: the verbatim record of what was typed AND what was derived.
    expect(call.items.map((i) => (i.json as { resourceType: string }).resourceType))
      .toEqual(['QuestionnaireResponse', 'ServiceRequest']);
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

    const persist = services.persistStore as unknown as ReturnType<typeof vi.fn>;
    expect((persist.mock.calls[0]![0] as { source?: string }).source).toBe('webhook-ingest');
  });

  it('routes a bare resource array to unwrap', async () => {
    const { nodes, edges } = ingestGraph();
    const services = stubServices();
    const { results } = await runWorkflow(nodes, edges, {
      input: { method: 'POST', body: [{ resourceType: 'Observation', id: 'o1' }], headers: {}, query: {} },
      services,
    });
    expect(statusOf(results, 'unwrap-1')).toBe('success');
    expect(statusOf(results, 'form-validate-1')).toBe('skipped');
  });
});
