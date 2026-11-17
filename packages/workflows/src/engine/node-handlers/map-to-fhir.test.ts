import { describe, it, expect, vi } from 'vitest';
import { mapToFhirHandler } from './map-to-fhir';
import { createContext } from '../execution-context';
import { runWorkflow } from '../run-workflow';
import type { RunMapToFhirInput, RunMapToFhirOutput, WorkflowServices } from '../services';
import type { RunEvent } from '../../types';

// A fake service: an item with `ok` becomes one record, anything else is held.
function fakeService() {
  return vi.fn(async ({ items }: RunMapToFhirInput): Promise<RunMapToFhirOutput> => {
    const out = items.filter((i) => i.json.ok).map((i) => ({ json: { resourceType: 'Basic', id: `r-${String(i.json.ok)}` } }));
    const heldIndexes = items.flatMap((i, index) => (i.json.ok ? [] : [index]));
    const held = heldIndexes.map((index) => ({ json: { item: items[index].json, reason: `no mapping for this shape ${index}` } }));
    return { out, held, heldIndexes, meta: { fhir: 0, form: 0, mapped: out.length, held: held.length, heldReasons: held.map((h) => h.json.reason) } };
  });
}

// The node with both ports wired, unless told otherwise.
const WIRED = [
  { id: 'e1', source: 'm', target: 'a', sourceHandle: 'out' },
  { id: 'e2', source: 'm', target: 'b', sourceHandle: 'held' },
];

function ctxWith(mapToFhir: unknown, edges = WIRED) {
  return createContext(undefined, () => {}, edges, undefined, { mapToFhir } as unknown as WorkflowServices);
}

const node = (config: Record<string, unknown>) => ({ id: 'm', type: 'action', data: { action: 'map-to-fhir', config } });

describe('mapToFhirHandler', () => {
  it('sets both ports, records meta and returns the out items', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    const out = await mapToFhirHandler(node({ targetId: 't1', formIds: ['f1'], mappings: [{ any: 1 }] }), ctx, [
      { json: { ok: 'a' } },
      { json: { other: 1 } },
    ]);
    expect(svc).toHaveBeenCalledWith({
      items: [{ json: { ok: 'a' } }, { json: { other: 1 } }],
      config: { targetId: 't1', formIds: ['f1'], mappings: [{ any: 1 }] },
    });
    expect(out).toEqual([{ json: { resourceType: 'Basic', id: 'r-a' } }]);
    expect(ctx.portItems['m']).toEqual({ out, held: [{ json: { item: { other: 1 }, reason: 'no mapping for this shape 1' } }] });
    expect(ctx.nodeMeta['m']).toEqual({ fhir: 0, form: 0, mapped: 1, held: 1, heldReasons: ['no mapping for this shape 1'] });
  });

  it('splits a list of rows at sourcePath, holds an element that is not a row, and keeps input order', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    await mapToFhirHandler(node({ sourcePath: 'body.rows' }), ctx, [{ json: { body: { rows: [{ ok: 'a' }, 'QZX', { other: 1 }, { ok: 'b' }] } } }]);
    expect(svc.mock.calls[0][0].items).toEqual([{ json: { ok: 'a' } }, { json: { other: 1 } }, { json: { ok: 'b' } }]);
    const held = ctx.portItems['m'].held;
    expect(held.map((h) => h.json.reason)).toEqual(['not a row', 'no mapping for this shape 1']);
    expect(held[0].json.item).toBe('QZX');
    expect(String(held[0].json.reason)).not.toContain('QZX');
    expect(ctx.nodeMeta['m']).toMatchObject({ mapped: 2, held: 2, heldReasons: ['not a row', 'no mapping for this shape 1'] });
  });

  it('keeps a FHIR list at sourcePath as one item, wrapped as a collection Bundle', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    const list = [{ resourceType: 'Patient', id: 'p1' }, { resourceType: 'Specimen', id: 's1' }];
    await mapToFhirHandler(node({ sourcePath: 'body' }), ctx, [{ json: { body: list } }]);
    expect(svc.mock.calls[0][0].items).toEqual([
      { json: { resourceType: 'Bundle', type: 'collection', entry: [{ resource: list[0] }, { resource: list[1] }] } },
    ]);
  });

  it('reads an object at sourcePath as one item', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    await mapToFhirHandler(node({ sourcePath: 'body' }), ctx, [{ json: { body: { ok: 'a' } } }]);
    expect(svc.mock.calls[0][0].items).toEqual([{ json: { ok: 'a' } }]);
  });

  it('holds an item with nothing, a scalar or an empty list at sourcePath, as a copy', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    const first = { other: 1 };
    await mapToFhirHandler(node({ sourcePath: 'body' }), ctx, [{ json: first }, { json: { body: 'QZX' } }, { json: { body: [] } }]);
    expect(svc.mock.calls[0][0].items).toEqual([]);
    const held = ctx.portItems['m'].held;
    expect(held).toEqual([
      { json: { item: { other: 1 }, reason: 'nothing at body' } },
      { json: { item: { body: 'QZX' }, reason: 'nothing at body' } },
      { json: { item: { body: [] }, reason: 'nothing at body' } },
    ]);
    expect(held[0].json.item).not.toBe(first);
    expect(ctx.nodeMeta['m']).toMatchObject({ held: 3 });
  });

  it('throws when items are held and the held port is not connected, naming the count and reasons', async () => {
    const ctx = ctxWith(fakeService(), [WIRED[0]]);
    const items = Array.from({ length: 7 }, (_, i) => ({ json: { [`c${i}`]: 'QZX' } }));
    await expect(mapToFhirHandler(node({}), ctx, items)).rejects.toThrow(
      'Map to FHIR node: 7 item(s) held and the held port is not connected. First reasons: no mapping for this shape 0; no mapping for this shape 1; no mapping for this shape 2; no mapping for this shape 3; no mapping for this shape 4',
    );
  });

  it('does not throw for an unconnected held port when nothing is held', async () => {
    const ctx = ctxWith(fakeService(), []);
    await expect(mapToFhirHandler(node({}), ctx, [{ json: { ok: 'a' } }])).resolves.toHaveLength(1);
  });

  it('throws when there are mappings and no target', async () => {
    const ctx = ctxWith(fakeService());
    await expect(mapToFhirHandler(node({ mappings: [{ any: 1 }] }), ctx, [])).rejects.toThrow(/targetId is required/);
  });

  it('works with no mappings and no target', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    await mapToFhirHandler(node({}), ctx, [{ json: { ok: 'a' } }]);
    expect(svc.mock.calls[0][0].config).toEqual({ targetId: '', formIds: [], mappings: [] });
  });

  it('throws when the service is not injected', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, {} as unknown as WorkflowServices);
    await expect(mapToFhirHandler(node({}), ctx, [])).rejects.toThrow(/mapToFhir service not injected/);
  });
});

describe('map-to-fhir in a run', () => {
  const nodes = [
    { id: 't', type: 'trigger', data: {} },
    { id: 'm', type: 'action', data: { action: 'map-to-fhir', config: {} } },
    { id: 'a', type: 'action', data: { action: 'no-op' } },
    { id: 'b', type: 'action', data: { action: 'no-op' } },
  ];
  const edges = [{ id: 'e0', source: 't', target: 'm' }, ...WIRED];

  async function run(input: unknown[], runEdges = edges) {
    const events: RunEvent[] = [];
    const res = await runWorkflow(nodes as never, runEdges as never, {
      input,
      onEvent: (e) => events.push(e),
      services: { mapToFhir: fakeService() } as unknown as WorkflowServices,
    });
    const inputOf = (id: string) => {
      const evt = events.find((e) => e.type === 'node:success' && e.nodeId === id);
      return evt && evt.type === 'node:success' ? (evt.input as Array<{ json: Record<string, unknown> }>) : undefined;
    };
    const statusOf = (id: string) => res.results.find((r) => r.nodeId === id)?.status;
    return { res, inputOf, statusOf };
  }

  it('sends records down the out edge and held items down the held edge, with the reasons in meta', async () => {
    const { res, inputOf } = await run([{ ok: 'a' }, { ok: 'b' }, { other: 1 }]);
    expect(res.status).toBe('completed');
    expect(inputOf('a')?.map((i) => i.json.id)).toEqual(['r-a', 'r-b']);
    expect(inputOf('b')).toEqual([{ json: { item: { other: 1 }, reason: 'no mapping for this shape 2' } }]);
    expect(res.results.find((r) => r.nodeId === 'm')?.meta).toMatchObject({ held: 1, heldReasons: ['no mapping for this shape 2'] });
  });

  it('skips the out edge when nothing maps', async () => {
    const { statusOf } = await run([{ other: 1 }]);
    expect(statusOf('a')).toBe('skipped');
    expect(statusOf('b')).toBe('success');
  });

  it('skips the held edge when nothing is held', async () => {
    const { statusOf } = await run([{ ok: 'a' }]);
    expect(statusOf('a')).toBe('success');
    expect(statusOf('b')).toBe('skipped');
  });

  it('fails the run when items are held and no held edge exists', async () => {
    const { res, statusOf } = await run([{ ok: 'a' }, { other: 1 }], [edges[0], WIRED[0]]);
    expect(res.status).not.toBe('completed');
    expect(statusOf('m')).toBe('error');
    expect(res.results.find((r) => r.nodeId === 'm')?.error).toContain('1 item(s) held and the held port is not connected');
  });
});
