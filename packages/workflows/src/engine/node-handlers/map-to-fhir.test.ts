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
    const held = items.filter((i) => !i.json.ok).map((i) => ({ json: { item: i.json, reason: 'no mapping for this shape' } }));
    return { out, held, meta: { fhir: 0, form: 0, mapped: out.length, held: held.length } };
  });
}

function ctxWith(mapToFhir: unknown) {
  return createContext(undefined, () => {}, [], undefined, { mapToFhir } as unknown as WorkflowServices);
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
    expect(ctx.portItems['m']).toEqual({ out, held: [{ json: { item: { other: 1 }, reason: 'no mapping for this shape' } }] });
    expect(ctx.nodeMeta['m']).toEqual({ fhir: 0, form: 0, mapped: 1, held: 1 });
  });

  it('splits a list of rows at sourcePath into one item each, and holds an element that is not a row', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    await mapToFhirHandler(node({ sourcePath: 'body.rows' }), ctx, [{ json: { body: { rows: [{ ok: 'a' }, { ok: 'b' }, 'QZX'] } } }]);
    expect(svc.mock.calls[0][0].items).toEqual([{ json: { ok: 'a' } }, { json: { ok: 'b' } }]);
    const held = ctx.portItems['m'].held;
    expect(held).toEqual([{ json: { item: 'QZX', reason: 'not a row' } }]);
    expect(String(held[0].json.reason)).not.toContain('QZX');
    expect(ctx.nodeMeta['m']).toMatchObject({ mapped: 2, held: 1 });
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

  it('holds an item with nothing, or a scalar, at sourcePath', async () => {
    const svc = fakeService();
    const ctx = ctxWith(svc);
    await mapToFhirHandler(node({ sourcePath: 'body' }), ctx, [{ json: { other: 1 } }, { json: { body: 'QZX' } }]);
    expect(svc.mock.calls[0][0].items).toEqual([]);
    expect(ctx.portItems['m'].held).toEqual([
      { json: { item: { other: 1 }, reason: 'nothing at body' } },
      { json: { item: { body: 'QZX' }, reason: 'nothing at body' } },
    ]);
    expect(ctx.nodeMeta['m']).toMatchObject({ held: 2 });
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
  it('sends records down the out edge and held items down the held edge', async () => {
    const events: RunEvent[] = [];
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'm', type: 'action', data: { action: 'map-to-fhir', config: {} } },
      { id: 'a', type: 'action', data: { action: 'no-op' } },
      { id: 'b', type: 'action', data: { action: 'no-op' } },
    ];
    const edges = [
      { id: 'e0', source: 't', target: 'm' },
      { id: 'e1', source: 'm', target: 'a', sourceHandle: 'out' },
      { id: 'e2', source: 'm', target: 'b', sourceHandle: 'held' },
    ];
    const res = await runWorkflow(nodes as never, edges as never, {
      input: [{ ok: 'a' }, { ok: 'b' }, { other: 1 }],
      onEvent: (e) => events.push(e),
      services: { mapToFhir: fakeService() } as unknown as WorkflowServices,
    });
    expect(res.status).toBe('completed');
    const inputOf = (id: string) => {
      const evt = events.find((e) => e.type === 'node:success' && e.nodeId === id);
      return evt && evt.type === 'node:success' ? (evt.input as Array<{ json: Record<string, unknown> }>) : undefined;
    };
    expect(inputOf('a')?.map((i) => i.json.id)).toEqual(['r-a', 'r-b']);
    expect(inputOf('b')).toEqual([{ json: { item: { other: 1 }, reason: 'no mapping for this shape' } }]);
  });
});
