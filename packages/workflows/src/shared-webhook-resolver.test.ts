import { describe, it, expect } from 'vitest';
import * as shared from './shared-webhook-resolver';
import type { Workflow } from './types';
const workflow = (id = 'w1', secret: unknown = { secretRef: 'ref' }): Workflow => ({ id, name: id, description: null, enabled: true, createdBy: null, definition: { nodes: [{ id: 'n', type: 'trigger', data: { triggerType: 'webhook', path: '/hello/', secret } }], edges: [] } });
describe('shared webhook resolver', () => {
  it('reads current definitions and secret values on every request', async () => {
    let rows = [workflow()]; let secret = 'old';
    const resolver = shared.createSharedWebhookResolver({ findByPath: async path => path === 'hello' ? rows : [], resolveRef: async () => secret });
    expect(await resolver.resolve('/hello/')).toEqual({ workflowId: 'w1', secret: 'old' });
    secret = 'new';
    expect(await resolver.resolve('hello')).toEqual({ workflowId: 'w1', secret: 'new' });
    rows = [];
    expect(await resolver.resolve('hello')).toBeUndefined();
  });
  it('rejects ambiguous workflows and nodes', async () => {
    const w = workflow(); let rows = [w, workflow('w2')];
    const resolver = shared.createSharedWebhookResolver({ findByPath: async () => rows, resolveRef: async () => 'secret' });
    await expect(resolver.resolve('hello')).rejects.toBeInstanceOf(shared.WebhookPathConflictError);
    rows = [{ ...w, definition: { ...w.definition, nodes: [...w.definition.nodes, { ...w.definition.nodes[0], id: 'n2' }] } }];
    await expect(resolver.resolve('hello')).rejects.toBeInstanceOf(shared.WebhookPathConflictError);
  });
  it('denies unavailable credentials and propagates database lookup failures', async () => {
    const resolver = shared.createSharedWebhookResolver({ findByPath: async () => [workflow()], resolveRef: async () => { throw new Error('secret database'); } });
    await expect(resolver.resolve('hello')).rejects.toThrow('secret database');
    const missing = shared.createSharedWebhookResolver({ findByPath: async () => [workflow('w1', null)], resolveRef: async () => null });
    expect(await missing.resolve('hello')).toEqual({ workflowId: 'w1', secret: null });
    const missingRef = shared.createSharedWebhookResolver({ findByPath: async () => [workflow()], resolveRef: async () => null });
    expect(await missingRef.resolve('hello')).toEqual({ workflowId: 'w1', secret: null });
    const unavailable = shared.createSharedWebhookResolver({ findByPath: async () => { throw new Error('database'); }, resolveRef: async () => null });
    await expect(unavailable.resolve('hello')).rejects.toThrow('database');
  });
  it('supports legacy nodes and ignores disabled, empty and unrelated paths', async () => {
    const w = workflow('legacy', 'plain'); w.definition.nodes[0].type = 'webhook';
    const resolver = shared.createSharedWebhookResolver({ findByPath: async () => [w], resolveRef: async () => null });
    expect(await resolver.resolve('hello')).toEqual({ workflowId: 'legacy', secret: 'plain' });
    expect(await resolver.resolve('other')).toBeUndefined();
    expect(await resolver.resolve('///')).toBeUndefined();
    w.enabled = false;
    expect(await resolver.resolve('hello')).toBeUndefined();
  });
});
