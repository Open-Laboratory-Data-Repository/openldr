import { describe, it, expect } from 'vitest';
import { buildBody, needsPickedFile } from './use-workflow-api';
import type { WorkflowNode, WorkflowEdge } from '../lib/types';

describe('buildBody: Save sends the graph and name only (review C7-1)', () => {
  it('leaves out enabled and description, so the server keeps the stored ones', () => {
    const body = buildBody({ id: 'wf_1', name: 'Copy', nodes: [], edges: [] });
    expect(body).toMatchObject({ id: 'wf_1', name: 'Copy' });
    expect(Object.keys(body)).not.toContain('enabled');
    expect(Object.keys(body)).not.toContain('description');
  });
});

describe('needsPickedFile: Run asks for a file only when no node supplies it (real test F13)', () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode;
  const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target }) as WorkflowEdge;
  const bytes = new Set(['whonet-sqlite:convert']);
  const whonet = node('w', 'plugin-node', { pluginId: 'whonet-sqlite', nodeId: 'convert' });

  it('asks when the bytes node has only a trigger upstream, or nothing', () => {
    expect(needsPickedFile([node('t', 'trigger'), whonet], [edge('t', 'w')], bytes)).toBe(true);
    expect(needsPickedFile([whonet], [], bytes)).toBe(true);
  });

  it('does not ask when another node feeds the bytes node, directly or further up', () => {
    expect(needsPickedFile([node('f', 'file'), whonet], [edge('f', 'w')], bytes)).toBe(false);
    expect(needsPickedFile([node('t', 'trigger'), node('f', 'file'), node('c', 'code'), whonet], [edge('t', 'f'), edge('f', 'c'), edge('c', 'w')], bytes)).toBe(false);
  });

  it('does not ask for a plugin node that does not read bytes', () => {
    expect(needsPickedFile([node('p', 'plugin-node', { pluginId: 'other', nodeId: 'x' })], [], bytes)).toBe(false);
  });
});
