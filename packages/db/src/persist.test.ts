import { describe, it, expect, vi } from 'vitest';
import { persistResource, persistResources } from './persist';
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
