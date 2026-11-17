import { describe, it, expect, vi } from 'vitest';

// A stub node type `ported` sets ctx.portItems from its own config. Every other
// node type keeps its real handler.
vi.mock('./node-handlers', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./node-handlers')>();
  return {
    ...orig,
    pickHandler: (node: { type: string; data: Record<string, unknown> }) => {
      if (node.type !== 'ported') return orig.pickHandler(node as never);
      return async (n: { id: string; data: Record<string, unknown> }, ctx: { portItems: Record<string, unknown> }) => {
        const ports = n.data.ports as Record<string, Array<Record<string, unknown>>>;
        const wrap = (rows: Array<Record<string, unknown>> = []) => rows.map((json) => ({ json }));
        ctx.portItems[n.id] = { out: wrap(ports.out), held: wrap(ports.held) };
        return wrap(ports.out);
      };
    },
  };
});

import { runWorkflow } from './run-workflow';
import type { RunEvent } from '../types';

const trigger = { id: 't', type: 'trigger', data: {} };
const ported = (ports: Record<string, Array<Record<string, unknown>>>) => ({ id: 'p', type: 'ported', data: { ports } });
const sink = (id: string) => ({ id, type: 'action', data: { action: 'no-op' } });

async function run(nodes: unknown[], edges: unknown[]) {
  const events: RunEvent[] = [];
  const res = await runWorkflow(nodes as never, edges as never, { onEvent: (e) => events.push(e) });
  const inputOf = (id: string) => {
    const evt = events.find((e) => e.type === 'node:success' && e.nodeId === id);
    return evt && evt.type === 'node:success' ? (evt.input as unknown[]) : undefined;
  };
  return { res, inputOf };
}

describe('per-port items', () => {
  it('feeds each edge the items of its own port', async () => {
    const nodes = [trigger, ported({ out: [{ n: 1 }, { n: 2 }], held: [{ n: 3 }] }), sink('a'), sink('b')];
    const edges = [
      { id: 'e0', source: 't', target: 'p' },
      { id: 'e1', source: 'p', target: 'a', sourceHandle: 'out' },
      { id: 'e2', source: 'p', target: 'b', sourceHandle: 'held' },
    ];
    const { res, inputOf } = await run(nodes, edges);
    expect(res.status).toBe('completed');
    expect(inputOf('a')).toHaveLength(2);
    expect(inputOf('b')).toHaveLength(1);
    expect((inputOf('b') as Array<{ json: { n: number } }>)[0].json.n).toBe(3);
  });

  it('skips an edge whose port has no items, as a pruned branch does', async () => {
    const nodes = [trigger, ported({ out: [{ n: 1 }], held: [] }), sink('a'), sink('b'), sink('c')];
    const edges = [
      { id: 'e0', source: 't', target: 'p' },
      { id: 'e1', source: 'p', target: 'a', sourceHandle: 'out' },
      { id: 'e2', source: 'p', target: 'b', sourceHandle: 'held' },
      { id: 'e3', source: 'b', target: 'c' },
    ];
    const { res } = await run(nodes, edges);
    expect(res.results.find((r) => r.nodeId === 'a')?.status).toBe('success');
    expect(res.results.find((r) => r.nodeId === 'b')?.status).toBe('skipped');
    expect(res.results.find((r) => r.nodeId === 'c')?.status).toBe('skipped');
  });

  it('skips an edge whose port name is not in portItems', async () => {
    const nodes = [trigger, ported({ out: [{ n: 1 }] }), sink('a')];
    const edges = [
      { id: 'e0', source: 't', target: 'p' },
      { id: 'e1', source: 'p', target: 'a', sourceHandle: 'other' },
    ];
    const { res } = await run(nodes, edges);
    expect(res.results.find((r) => r.nodeId === 'a')?.status).toBe('skipped');
  });

  it('reads the out port for an edge with no sourceHandle', async () => {
    const nodes = [trigger, ported({ out: [{ n: 1 }, { n: 2 }], held: [{ n: 3 }] }), sink('a')];
    const edges = [
      { id: 'e0', source: 't', target: 'p' },
      { id: 'e1', source: 'p', target: 'a' },
    ];
    const { inputOf } = await run(nodes, edges);
    expect(inputOf('a')).toHaveLength(2);
  });

  it('records the out items as the node output', async () => {
    const nodes = [trigger, ported({ out: [{ n: 1 }, { n: 2 }], held: [{ n: 3 }] })];
    const { res } = await run(nodes, [{ id: 'e0', source: 't', target: 'p' }]);
    expect(res.results.find((r) => r.nodeId === 'p')?.output).toHaveLength(2);
  });

  it('merges a port edge with an ordinary edge into one target', async () => {
    const nodes = [trigger, ported({ out: [{ n: 1 }], held: [{ n: 2 }, { n: 3 }] }), sink('m')];
    const edges = [
      { id: 'e0', source: 't', target: 'p' },
      { id: 'e1', source: 'p', target: 'm', sourceHandle: 'held' },
      { id: 'e2', source: 't', target: 'm' },
    ];
    const { inputOf } = await run(nodes, edges);
    expect(inputOf('m')).toHaveLength(3); // 2 held + 1 trigger item
  });
});
