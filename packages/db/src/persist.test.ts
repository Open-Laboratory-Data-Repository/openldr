import { describe, it, expect, vi } from 'vitest';
import { persistRequests, persistResource, persistResources } from './persist';
import type { FhirStore } from './fhir-store';
import { AppError, type Logger } from '@openldr/core';

const logger = { error: vi.fn(), info: vi.fn() } as unknown as Logger;

function fakeStore(): FhirStore {
  return {
    save: vi.fn(),
    saveMany: vi.fn(async (rs: unknown[]) => rs.map((r) => ({ resourceType: (r as { resourceType: string }).resourceType, id: (r as { id?: string }).id ?? 'gen-id', version: 1 }))),
    get: vi.fn(),
  } as unknown as FhirStore;
}

const validPatient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

describe('persistResource', () => {
  it('saves internally → projection deferred to the async worker', async () => {
    const fhirStore = fakeStore();
    const out = await persistResource({ fhirStore, logger }, validPatient);
    expect(out).toEqual({ saved: true, flattened: 'deferred' });
    expect(fhirStore.saveMany).toHaveBeenCalledOnce();
  });

  it('defers projection for a non-domain resource too', async () => {
    const fhirStore = fakeStore();
    const out = await persistResource({ fhirStore, logger }, { resourceType: 'Bundle', type: 'collection' });
    expect(out.flattened).toBe('deferred');
  });

  it('throws on invalid FHIR before saving', async () => {
    const fhirStore = fakeStore();
    await expect(persistResource({ fhirStore, logger }, { resourceType: 'Observation', code: { text: 'x' } })).rejects.toThrow();
    expect(fhirStore.saveMany).not.toHaveBeenCalled();
  });
});

describe('persistResources (batched)', () => {
  it('hands_skipUnchanged_to_saveMany_only_when_asked (item 16)', async () => {
    const saveMany = vi.fn(async (rs: any[], _prov?: unknown, _opts?: unknown) => rs.map((r) => ({ resourceType: r.resourceType, id: r.id, version: 1 })));
    const deps = { fhirStore: { saveMany } as never, logger: { error: vi.fn(), info: vi.fn() } as never };
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const resolveServiceRequest = async () => true;
    await persistResources(deps, [a], {}, { level: 'low', resolveServiceRequest, skipUnchanged: true });
    await persistResources(deps, [a], {}, { level: 'low', resolveServiceRequest });
    await persistResources(deps, [a], {});
    expect(saveMany.mock.calls[0][2]).toEqual({ skipUnchanged: true });
    expect(saveMany.mock.calls[1]).toHaveLength(2);
    expect(saveMany.mock.calls[2]).toHaveLength(2);
  });

  it('saves the whole list in one saveMany call → projection deferred to the async worker', async () => {
    const saveMany = vi.fn(async (rs: any[], _prov?: unknown) => rs.map((r) => ({ resourceType: r.resourceType, id: r.id, version: 1 })));
    const fhirStore = { saveMany } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const b = { resourceType: 'Patient', id: 'p2', gender: 'female' };
    const prov = { batchId: 'b1' };
    const res = await persistResources({ fhirStore, logger }, [a, b], prov);
    expect(saveMany).toHaveBeenCalledOnce();
    expect(saveMany.mock.calls[0][0].map((r: any) => r.id)).toEqual(['p1', 'p2']);
    expect(saveMany.mock.calls[0][1]).toBe(prov);
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.saved && r.flattened === 'deferred')).toBe(true);
  });

  it('with opts: validates first, then saves the whole list in one saveMany call', async () => {
    const saveMany = vi.fn(async (rs: any[]) => rs.map((r) => ({ resourceType: r.resourceType, id: r.id, version: 1 })));
    const fhirStore = { saveMany, exists: vi.fn(async () => false) } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const res = await persistResources({ fhirStore, logger }, [{ resourceType: 'Patient', id: 'p1' }, { resourceType: 'Patient', id: 'p2' }], {}, { level: 'low', resolveServiceRequest: async () => false });
    expect(saveMany).toHaveBeenCalledOnce();
    expect(res).toHaveLength(2);
  });

  it('throws on the first invalid resource (must-succeed validation)', async () => {
    const fhirStore = { saveMany: vi.fn(async (rs: any[]) => rs.map((r) => ({ id: r.id }))) } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    await expect(persistResources({ fhirStore, logger }, [{ nonsense: true }], {})).rejects.toBeTruthy();
  });
});

function stubStore() {
  const saved: unknown[] = [];
  return {
    saved,
    store: {
      save: vi.fn(),
      saveMany: vi.fn(async (rs: unknown[]) => { saved.push(...rs); return rs.map((r) => ({ resourceType: (r as any).resourceType, id: (r as any).id, version: 1 })); }),
      exists: vi.fn(async () => false),
      get: vi.fn(), getWithProvenance: vi.fn(), applyRemote: vi.fn(),
    } as any,
  };
}
const gateLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;
const labObs = { resourceType: 'Observation', id: 'o1', status: 'final',
  category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Hb' }, subject: { reference: 'Patient/p1' } };
const opts = (level: any) => ({ level, resolveServiceRequest: async () => false });

describe('persistResources strictness gate', () => {
  it('high: rejects a lab result with no order and saves NOTHING', async () => {
    const { store, saved } = stubStore();
    await expect(persistResources({ fhirStore: store, logger: gateLogger }, [labObs], {}, opts('high')))
      .rejects.toBeInstanceOf(AppError);
    expect(saved).toHaveLength(0);
  });
  it('low: persists it', async () => {
    const { store, saved } = stubStore();
    await persistResources({ fhirStore: store, logger: gateLogger }, [labObs], {}, opts('low'));
    expect(saved).toHaveLength(1);
  });
});

// Item 16: the import check saves the passing requests of a page with one call.
describe('persistRequests', () => {
  const sr = (id: string) => ({ resourceType: 'ServiceRequest', id, status: 'active', intent: 'order', subject: { reference: 'Patient/p1' } });
  const result = (id: string, order: string) => ({ ...labObs, id, basedOn: [{ reference: `ServiceRequest/${order}` }] });
  function pageStore(over: { failWhole?: boolean; failId?: string } = {}) {
    const calls: Array<{ ids: string[]; opts: unknown }> = [];
    const stored = new Set<string>();
    const store = {
      saveMany: vi.fn(async (rs: any[], _prov?: unknown, o?: unknown) => {
        calls.push({ ids: rs.map((r) => r.id), opts: o });
        if (over.failWhole && rs.length > 2) throw Object.assign(new Error('page refused'), { code: '53100' });
        if (over.failId && rs.some((r) => r.id === over.failId)) throw Object.assign(new Error('row refused'), { code: '23514' });
        for (const r of rs) if (r.resourceType === 'ServiceRequest') stored.add(r.id);
        return rs.map((r) => ({ resourceType: r.resourceType, id: r.id, version: 1 }));
      }),
      exists: vi.fn(async (_t: string, id: string) => stored.has(id)),
    } as any;
    return { store, calls };
  }
  const high = (store: any) => ({ level: 'high' as const, resolveServiceRequest: (id: string) => store.exists('ServiceRequest', id) });

  it('saves_every_passing_request_of_the_page_with_one_call_in_order', async () => {
    const { store, calls } = pageStore();
    const out = await persistRequests({ fhirStore: store, logger: gateLogger }, [
      { key: 'A', resources: [sr('sr-a'), result('o-a', 'sr-a')] },
      { key: 'B', resources: [sr('sr-b'), result('o-b', 'sr-b')] },
    ], { batchId: 'run' }, { ...high(store), skipUnchanged: true });
    expect(out).toEqual([{ key: 'A' }, { key: 'B' }]);
    expect(calls).toEqual([{ ids: ['sr-a', 'o-a', 'sr-b', 'o-b'], opts: { skipUnchanged: true } }]);
  });

  it('a_result_passes_when_its_order_came_with_an_earlier_request_of_the_page', async () => {
    const { store, calls } = pageStore();
    const out = await persistRequests({ fhirStore: store, logger: gateLogger }, [
      { key: 'A', resources: [sr('sr-a')] },
      { key: 'B', resources: [result('o-b', 'sr-a')] },
    ], {}, high(store));
    expect(out).toEqual([{ key: 'A' }, { key: 'B' }]);
    expect(calls[0].ids).toEqual(['sr-a', 'o-b']);
  });

  it('a_result_is_refused_when_its_order_only_comes_with_a_later_request', async () => {
    const { store, calls } = pageStore();
    const out = await persistRequests({ fhirStore: store, logger: gateLogger }, [
      { key: 'A', resources: [result('o-a', 'sr-b')] },
      { key: 'B', resources: [sr('sr-b')] },
    ], {}, high(store));
    expect(out[0].key).toBe('A');
    expect((out[0].error as { code?: string }).code).toBe('VA0002');
    expect(out[1]).toEqual({ key: 'B' });
    expect(calls[0].ids).toEqual(['sr-b']);
  });

  it('when_the_page_save_fails_each_request_is_saved_alone_and_only_the_bad_one_fails', async () => {
    const { store, calls } = pageStore({ failWhole: true, failId: 'o-b' });
    const out = await persistRequests({ fhirStore: store, logger: gateLogger }, [
      { key: 'A', resources: [sr('sr-a'), result('o-a', 'sr-a')] },
      { key: 'B', resources: [sr('sr-b'), result('o-b', 'sr-b')] },
      { key: 'C', resources: [sr('sr-c')] },
    ], {}, high(store));
    expect(out.map((o) => [o.key, (o.error as { code?: string } | undefined)?.code ?? null])).toEqual([['A', null], ['B', '23514'], ['C', null]]);
    // The page, then each request alone.
    expect(calls.map((c) => c.ids)).toEqual([['sr-a', 'o-a', 'sr-b', 'o-b', 'sr-c'], ['sr-a', 'o-a'], ['sr-b', 'o-b'], ['sr-c']]);
  });

  it('saved_alone_a_request_no_longer_sees_the_order_of_a_request_that_failed', async () => {
    const { store } = pageStore({ failWhole: true, failId: 'sr-a' });
    const out = await persistRequests({ fhirStore: store, logger: gateLogger }, [
      { key: 'A', resources: [sr('sr-a')] },
      { key: 'B', resources: [result('o-b', 'sr-a')] },
      { key: 'C', resources: [sr('sr-c')] },
    ], {}, high(store));
    expect(out.map((o) => [o.key, (o.error as { code?: string } | undefined)?.code ?? null])).toEqual([['A', '23514'], ['B', 'VA0002'], ['C', null]]);
  });

  it('a_page_with_no_passing_request_saves_nothing', async () => {
    const { store, calls } = pageStore();
    const out = await persistRequests({ fhirStore: store, logger: gateLogger }, [{ key: 'A', resources: [result('o-a', 'missing')] }], {}, high(store));
    expect((out[0].error as { code?: string }).code).toBe('VA0002');
    expect(calls).toEqual([]);
    expect(await persistRequests({ fhirStore: store, logger: gateLogger }, [], {}, high(store))).toEqual([]);
  });
});
