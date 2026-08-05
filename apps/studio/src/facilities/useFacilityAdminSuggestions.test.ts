import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FormSchema } from '@/forms-runtime/types';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listFacilityAdminValues: vi.fn() };
});

import * as api from '@/api';
import type { FacilityAdminLevel } from '@/api';
import { useFacilityAdminSuggestions } from './useFacilityAdminSuggestions';

function schemaWith(fields: FormSchema['fields']): FormSchema {
  return {
    id: 'facility-schema',
    name: 'Facility',
    versionLabel: null,
    fhirVersion: null,
    fhirResourceType: null,
    fhirProfileUrl: null,
    facilityId: null,
    fields,
    sections: [],
    targetPages: ['facilities'],
    version: 1,
    active: true,
    status: 'published',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as FormSchema;
}

const ADMIN_FIELDS: FormSchema['fields'] = [
  { id: 'f-zone', displayLabel: 'Zone', description: null, fieldType: 'suggest', apiProperty: 'zone', fhirPath: null, required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' } },
  { id: 'f-region', displayLabel: 'Region', description: null, fieldType: 'suggest', apiProperty: 'region', fhirPath: null, required: true, enabled: true, order: 1, cardinality: { min: 1, max: '1' } },
  { id: 'f-district', displayLabel: 'District', description: null, fieldType: 'suggest', apiProperty: 'district', fhirPath: null, required: true, enabled: true, order: 2, cardinality: { min: 1, max: '1' } },
  { id: 'f-council', displayLabel: 'Council', description: null, fieldType: 'suggest', apiProperty: 'council', fhirPath: null, required: false, enabled: true, order: 3, cardinality: { min: 0, max: '1' } },
] as unknown as FormSchema['fields'];

const mockList = api.listFacilityAdminValues as unknown as ReturnType<typeof vi.fn>;

function counted(values: string[]): Array<{ value: string; count: number }> {
  return values.map((value, i) => ({ value, count: values.length - i }));
}

beforeEach(() => {
  vi.useFakeTimers();
  mockList.mockReset();
  mockList.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFacilityAdminSuggestions', () => {
  it('fetches a level scoped by the OTHER admin levels currently chosen', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => {
      result.current.reportAnswers({ 'f-region': 'Dodoma' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mockList).toHaveBeenCalledWith('district', { region: 'Dodoma' });
    expect(mockList).toHaveBeenCalledWith('council', { region: 'Dodoma' });
    // zone has no OTHER level scoping it here since region is the only value set and zone !== region
    expect(mockList).toHaveBeenCalledWith('zone', { region: 'Dodoma' });
  });

  it('changing Region refetches District with the new scope', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    mockList.mockClear();

    act(() => { result.current.reportAnswers({ 'f-region': 'Mwanza' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(mockList).toHaveBeenCalledWith('district', { region: 'Mwanza' });
  });

  it('does not fetch on every keystroke — rapid reportAnswers calls collapse into a single fetch per level', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => {
      result.current.reportAnswers({ 'f-region': 'D' });
      result.current.reportAnswers({ 'f-region': 'Do' });
      result.current.reportAnswers({ 'f-region': 'Dod' });
      result.current.reportAnswers({ 'f-region': 'Dodoma' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    const districtCalls = mockList.mock.calls.filter((c) => c[0] === 'district');
    expect(districtCalls).toHaveLength(1);
    expect(districtCalls[0]?.[1]).toEqual({ region: 'Dodoma' });
  });

  it('a fetch failure degrades that field to status "error" without throwing', async () => {
    mockList.mockImplementation((level: string) =>
      level === 'district' ? Promise.reject(new Error('network down')) : Promise.resolve([]),
    );
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(result.current.suggestions['f-district']?.status).toBe('error');
    expect(result.current.suggestions['f-district']?.error).toBe('network down');
    // Sibling levels are unaffected — one failing fetch doesn't block the others.
    expect(result.current.suggestions['f-zone']?.status).toBe('ready');
  });

  it('ignores a stale response that resolves after a newer one for the same level', async () => {
    // Every reportAnswers cycle fetches ALL admin levels concurrently (zone/region/district/
    // council), not just the one the operator is editing — so the mock must key its controlled
    // promises off the `level` argument itself (district only), not off call order, or a sibling
    // level's fetch would silently consume the wrong promise.
    let resolveFirst!: (v: Array<{ value: string; count: number }>) => void;
    let resolveSecond!: (v: Array<{ value: string; count: number }>) => void;
    let districtCallCount = 0;
    mockList.mockImplementation((level: FacilityAdminLevel) => {
      if (level !== 'district') return Promise.resolve([]);
      districtCallCount += 1;
      if (districtCallCount === 1) return new Promise((res) => { resolveFirst = res; });
      return new Promise((res) => { resolveSecond = res; });
    });

    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    act(() => { result.current.reportAnswers({ 'f-region': 'Mwanza' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // Resolve OUT OF ORDER: the newer (second) request settles first, then the stale first one.
    await act(async () => { resolveSecond(counted(['Newer'])); });
    await act(async () => { resolveFirst(counted(['Stale'])); });

    expect(result.current.suggestions['f-district']?.options).toEqual(['Newer']);
  });

  it('unmounting mid-fetch causes no post-unmount state update', async () => {
    let resolve!: (v: Array<{ value: string; count: number }>) => void;
    const pending = new Promise<Array<{ value: string; count: number }>>((res) => { resolve = res; });
    mockList.mockReturnValue(pending);

    const schema = schemaWith(ADMIN_FIELDS);
    const { result, unmount } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    unmount();
    // Resolving after unmount must not throw or emit an act() warning.
    await act(async () => { resolve(counted(['Too late'])); });
  });

  it('a schema with no admin suggest fields never calls the endpoint', async () => {
    const schema = schemaWith([
      { id: 'f-name', displayLabel: 'Name', description: null, fieldType: 'text', apiProperty: 'name', fhirPath: null, required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' } },
    ] as unknown as FormSchema['fields']);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-name': 'Dodoma RRH' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(mockList).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual({});
  });

  it('a null schema (still loading) never calls the endpoint', async () => {
    const { result } = renderHook(() => useFacilityAdminSuggestions(null, 'key-1'));
    act(() => { result.current.reportAnswers({}); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('changing resetKey clears prior suggestion state', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    mockList.mockResolvedValue(counted(['Dodoma']));
    const { result, rerender } = renderHook(
      ({ key }) => useFacilityAdminSuggestions(schema, key),
      { initialProps: { key: 'facility-a' } },
    );

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current.suggestions['f-district']?.options).toEqual(['Dodoma']);

    rerender({ key: 'facility-b' });
    expect(result.current.suggestions).toEqual({});
  });

  it('options end up populated from the resolved rows, in the order the server returned them', async () => {
    mockList.mockResolvedValue(counted(['Dodoma', 'Mwanza']));
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({}); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(result.current.suggestions['f-zone']?.options).toEqual(['Dodoma', 'Mwanza']);
    expect(result.current.suggestions['f-zone']?.status).toBe('ready');
  });
});
