import { describe, it, expect } from 'vitest';
import { buildDefaultWorkflows } from './sample-workflow';

describe('buildDefaultWorkflows', () => {
  const [ingest, reactive] = buildDefaultWorkflows({
    orderFormId: 'form-xyz',
    webhookSecret: 'ingest-secret',
  });
  const nodeIds = () => ingest.definition.nodes.map((n) => n.id).sort();

  it('returns exactly the Ingest + reactive workflows with stable ids', () => {
    expect(buildDefaultWorkflows({ orderFormId: 'form-xyz', webhookSecret: 's' })).toHaveLength(2);
    expect(ingest.id).toBe('wf-ingest');
    expect(ingest.name).toBe('Ingest');
    expect(reactive.id).toBe('wf-sample-reactive');
  });

  // wf-ingest used to ship disabled (operator opt-in for the live HTTP endpoint). Form capture
  // — POST /api/forms/:id/responses — now runs through this workflow, so shipping it disabled
  // would 409 every clinical submission on a fresh install. It is install-critical now.
  it('ships both the ingest and the reactive workflow enabled', () => {
    expect(ingest.enabled).toBe(true);
    expect(reactive.enabled).toBe(true);
  });

  it('injects the secret + path onto the single webhook node', () => {
    const hook = ingest.definition.nodes.find((n) => n.type === 'webhook');
    expect(hook?.id).toBe('trigger-1');
    expect(hook?.data).toMatchObject({ secret: 'ingest-secret', path: 'ingest', method: 'POST' });
  });

  it('is webhook, Map to FHIR, Persist store and Log, with no Switch, Unwrap or Form Validate', () => {
    expect(nodeIds()).toEqual(['log-1', 'map-1', 'persist-1', 'trigger-1']);
    const actions = ingest.definition.nodes.map((n) => n.data.action ?? n.data.templateId);
    expect(actions).not.toContain('unwrap-bundle');
    expect(actions).not.toContain('form-validate');
    expect(ingest.definition.nodes.some((n) => n.type === 'condition')).toBe(false);
  });

  it('configures Map to FHIR to read body, target Lab result and allow the order form, with no mapping', () => {
    const map = ingest.definition.nodes.find((n) => n.id === 'map-1');
    expect(map?.type).toBe('action');
    expect(map?.data).toMatchObject({ action: 'map-to-fhir', templateId: 'map-to-fhir', iconName: 'ArrowRightLeft' });
    expect(map?.data.config).toEqual({ sourcePath: 'body', targetId: 'lab-result', formIds: ['form-xyz'], mappings: [] });
  });

  it('wires one persist source; the reactive listens to it', () => {
    const persist = ingest.definition.nodes.find((n) => n.data.action === 'persist-store');
    expect(persist?.id).toBe('persist-1');
    expect(persist?.data.config).toMatchObject({ source: 'webhook-ingest' });
    const evt = reactive.definition.nodes.find((n) => n.data.triggerType === 'event');
    expect(evt?.data.config).toMatchObject({ source: 'webhook-ingest' });
  });

  it('sends out to Persist then Log, and leaves held unwired so a held item fails the run', () => {
    const edges = ingest.definition.edges.map((e) => [e.source, e.sourceHandle ?? null, e.target]);
    expect(edges).toEqual([
      ['trigger-1', null, 'map-1'],
      ['map-1', 'out', 'persist-1'],
      ['persist-1', null, 'log-1'],
    ]);
    expect(ingest.definition.edges.some((e) => e.sourceHandle === 'held')).toBe(false);
  });

  it('describes the new graph, not the old Switch', () => {
    expect(ingest.description).toMatch(/Map to FHIR/);
    expect(ingest.description).not.toMatch(/Switch/);
  });
});
