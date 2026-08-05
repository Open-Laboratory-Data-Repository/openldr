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
  it('fetches a level scoped only by the levels ABOVE it in the fixed hierarchy zone < region < district < council', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => {
      result.current.reportAnswers({ 'f-region': 'Dodoma' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // District and Council sit BELOW Region, so Region being the only value set scopes them both.
    expect(mockList).toHaveBeenCalledWith('district', { region: 'Dodoma' });
    expect(mockList).toHaveBeenCalledWith('council', { region: 'Dodoma' });
    // Zone sits ABOVE Region — a child (Region) must never scope its own parent (Zone), so Zone's
    // request carries an EMPTY scope here even though Region has a value. (An earlier, symmetric
    // "every OTHER level" version of this hook scoped Zone by { region: 'Dodoma' } instead — see
    // Important-1 in the Task 5 code review — which is exactly the defect this assertion pins.)
    expect(mockList).toHaveBeenCalledWith('zone', {});
  });

  it("Region's request carries only Zone in its scope — District/Council never constrain their own parent", async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => {
      // Zone, District AND Council all have values; Region does not. Under the old symmetric
      // scoping, District+Council being populated would have narrowed Region's own listbox to
      // essentially nothing new — the exact "edit a fully-populated facility" failure mode.
      result.current.reportAnswers({ 'f-zone': 'North', 'f-district': 'Ilala', 'f-council': 'Ilala Council' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(mockList).toHaveBeenCalledWith('region', { zone: 'North' });
  });

  it('changing Region refetches District and Council but NOT Zone', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-zone': 'North', 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    mockList.mockClear();

    act(() => { result.current.reportAnswers({ 'f-zone': 'North', 'f-region': 'Mwanza' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(mockList).toHaveBeenCalledWith('district', { zone: 'North', region: 'Mwanza' });
    expect(mockList).toHaveBeenCalledWith('council', { zone: 'North', region: 'Mwanza' });
    // Zone's own scope (nothing above it) is unaffected by Region changing, so it must not refetch.
    expect(mockList).not.toHaveBeenCalledWith('zone', expect.anything());
  });

  it('an edit-mode dialog with all four admin levels populated still offers alternatives for Region', async () => {
    mockList.mockImplementation((level: FacilityAdminLevel) =>
      Promise.resolve(level === 'region' ? counted(['Dodoma', 'Mwanza', 'Arusha']) : []),
    );
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    // Mirrors FacilityDialog's seedAnswers() on mount for a fully-populated facility — the shipped
    // form marks Zone/Region/District required, so this (all four already filled in) is the common
    // edit case, not an edge case.
    act(() => {
      result.current.reportAnswers({
        'f-zone': 'North', 'f-region': 'Dodoma', 'f-district': 'Dodoma Urban', 'f-council': 'Dodoma City',
      });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(mockList).toHaveBeenCalledWith('region', { zone: 'North' });
    // The server returned siblings, not just the one value already sitting in the field — proving
    // the fetch was scoped loosely enough (Zone only) for them to come back at all.
    expect(result.current.suggestions['f-region']?.options).toEqual(['Dodoma', 'Mwanza', 'Arusha']);
  });

  it('typing in an unrelated field mid-debounce does not reschedule (or starve) a pending admin-level fetch', async () => {
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(mockList).not.toHaveBeenCalledWith('district', expect.anything());

    // 'f-name' is not one of the four admin levels — FormRuntime's onAnswersChange has no finer
    // granularity than "some answer changed", so this fires reportAnswers just like a real
    // keystroke in the facility Name field would, with Region's value carried through unchanged.
    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma', 'f-name': 'Dodoma RRH' }); });
    // 100ms more (250ms total since the Region change) — enough for the ORIGINAL 200ms debounce to
    // have fired already. A buggy version that reschedules on every call would still be waiting
    // (its window would not close until 350ms).
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(mockList).toHaveBeenCalledWith('district', { region: 'Dodoma' });
  });

  it('a level that failed retries once its bookkeeping is cleared, even when its own scope is unchanged', async () => {
    let districtCalls = 0;
    mockList.mockImplementation((level: FacilityAdminLevel) => {
      if (level !== 'district') return Promise.resolve([]);
      districtCalls += 1;
      return districtCalls === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(counted(['Kinondoni']));
    });
    const schema = schemaWith(ADMIN_FIELDS);
    const { result } = renderHook(() => useFacilityAdminSuggestions(schema, 'key-1'));

    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current.suggestions['f-district']?.status).toBe('error');

    // Trigger a fresh debounce cycle via Council — a level BELOW District, so District's own scope
    // (Zone+Region) stays byte-for-byte the same as the failed attempt. This isolates the retry
    // from the "scope literally changed" path (already covered above): the only reason District
    // retries here is that its failed bookkeeping was rolled back on error.
    act(() => { result.current.reportAnswers({ 'f-region': 'Dodoma', 'f-council': 'Dodoma City' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(districtCalls).toBe(2);
    expect(result.current.suggestions['f-district']?.status).toBe('ready');
    expect(result.current.suggestions['f-district']?.options).toEqual(['Kinondoni']);
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
