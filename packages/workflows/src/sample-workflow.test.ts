import { describe, it, expect } from 'vitest';
import { buildDefaultWorkflows } from './sample-workflow';

describe('buildDefaultWorkflows', () => {
  const [ingest, reactive] = buildDefaultWorkflows({
    orderFormId: 'form-xyz',
    webhookSecret: 'ingest-secret',
  });

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
    expect(hook?.data).toMatchObject({ secret: 'ingest-secret', path: 'ingest', method: 'POST' });
  });

  it('routes with a Switch: fhir rule + form fallback', () => {
    const route = ingest.definition.nodes.find((n) => n.type === 'condition');
    expect(route?.id).toBe('route-1');
    expect(route?.data.templateId).toBe('switch');
    expect(route?.data.fallbackOutput).toBe('form');
    const rules = route?.data.rules as Array<{ name: string; condition: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('fhir');
    expect(rules[0].condition).toBe(
      "Array.isArray($json.body) || (!!$json.body && $json.body.resourceType === 'Bundle')",
    );
  });

  it('has both branch nodes reading body, bound to the form id', () => {
    const unwrap = ingest.definition.nodes.find((n) => n.data.action === 'unwrap-bundle');
    expect(unwrap?.data.config).toMatchObject({ sourcePath: 'body' });
    const fv = ingest.definition.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config).toMatchObject({ formId: 'form-xyz', sourcePath: 'body' });
  });

  it('wires one persist source; the reactive listens to it', () => {
    const persist = ingest.definition.nodes.find((n) => n.data.action === 'persist-store');
    expect(persist?.data.config).toMatchObject({ source: 'webhook-ingest' });
    const evt = reactive.definition.nodes.find((n) => n.data.triggerType === 'event');
    expect(evt?.data.config).toMatchObject({ source: 'webhook-ingest' });
  });

  it('branch edges carry sourceHandle and both converge on persist', () => {
    const edges = ingest.definition.edges;
    const toUnwrap = edges.find((e) => e.target === 'unwrap-1');
    const toForm = edges.find((e) => e.target === 'form-validate-1');
    expect(toUnwrap).toMatchObject({ source: 'route-1', sourceHandle: 'fhir' });
    expect(toForm).toMatchObject({ source: 'route-1', sourceHandle: 'form' });
    const intoPersist = edges.filter((e) => e.target === 'persist-1').map((e) => e.source).sort();
    expect(intoPersist).toEqual(['form-validate-1', 'unwrap-1']);
    expect(edges.some((e) => e.source === 'persist-1' && e.target === 'log-1')).toBe(true);
  });
});
