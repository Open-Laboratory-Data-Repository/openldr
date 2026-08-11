import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, expandValueSet: vi.fn() };
});

import { expandValueSet } from '@/api';
import { useCodeDisplayMap, displayFor, FACILITY_STATUS_VALUESET_ID, FACILITY_LEVEL_VALUESET_ID } from './facility-code-labels';

describe('displayFor', () => {
  it('resolves a code to its display via the map', () => {
    const map = new Map([['active', 'Active']]);
    expect(displayFor(map, 'active')).toBe('Active');
  });

  it('falls back to the raw code when the map has no entry for it', () => {
    const map = new Map([['active', 'Active']]);
    expect(displayFor(map, 'some-legacy-code')).toBe('some-legacy-code');
  });

  it('renders an em dash for null/undefined/empty, never "null"', () => {
    const map = new Map<string, string>();
    expect(displayFor(map, null)).toBe('—');
    expect(displayFor(map, undefined)).toBe('—');
    expect(displayFor(map, '')).toBe('—');
  });
});

describe('useCodeDisplayMap', () => {
  it('fetches the value set by id and exposes it as a code -> display map', async () => {
    (expandValueSet as ReturnType<typeof vi.fn>).mockResolvedValue({
      codes: [
        { system: 'http://hl7.org/fhir/location-status', code: 'active', display: 'Active' },
        { system: 'http://hl7.org/fhir/location-status', code: 'suspended', display: 'Suspended' },
      ],
      total: 2,
    });
    const { result } = renderHook(() => useCodeDisplayMap(FACILITY_STATUS_VALUESET_ID));
    await waitFor(() => expect(result.current.get('active')).toBe('Active'));
    expect(result.current.get('suspended')).toBe('Suspended');
    expect(expandValueSet).toHaveBeenCalledWith(FACILITY_STATUS_VALUESET_ID);
  });

  it('degrades to an empty map on a failed fetch, rather than throwing', async () => {
    (expandValueSet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCodeDisplayMap(FACILITY_LEVEL_VALUESET_ID));
    await waitFor(() => expect(expandValueSet).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
