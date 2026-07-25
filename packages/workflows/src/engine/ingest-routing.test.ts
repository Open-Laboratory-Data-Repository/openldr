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
