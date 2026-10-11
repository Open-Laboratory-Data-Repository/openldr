import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getMappingTargets: vi.fn(), setTestMapping: vi.fn(), clearTestMapping: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { MapCodeSheet } from './MapCodeSheet';

const DISA = 'urn:openldr:disa';
const ROW: api.ObservedTestCode = { system: DISA, code: 'HIVVL', description: null, requests: 2, lastSeen: null, status: 'unmapped', catalog: null, centralManaged: false };
const REBUILT: api.RebuildOutcome = { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1, results: { mapped: 0, ambiguous: [], targetMissing: [] }, selfRows: 0 } };

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in TestSheet.test.tsx).
function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMappingTargets).mockResolvedValue([{ code: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }]);
});

describe('MapCodeSheet', () => {
  it('shows the system and code labels left, and Save is in the sheet menu', async () => {
    render(<MapCodeSheet target={ROW} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText(DISA)).toBeTruthy();
    expect(screen.getByText('HIVVL')).toBeTruthy();
    expect(screen.getByTestId('map-sheet-menu')).toBeTruthy();
  });

  it('saves the chosen catalog test and tells the page', async () => {
    vi.mocked(api.setTestMapping).mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: REBUILT });
    const onSaved = vi.fn();
    render(<MapCodeSheet target={{ ...ROW, status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' } }} onClose={vi.fn()} onSaved={onSaved} />);
    await waitFor(() => expect(api.getMappingTargets).toHaveBeenCalled());
    openMenu('map-sheet-menu');
    const save = await screen.findByTestId('map-sheet-save');
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(api.setTestMapping).toHaveBeenCalledWith(DISA, 'HIVVL', 'VL', 'test'));
    expect(onSaved).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('a central mapping is read-only: no Save, a note instead', async () => {
    render(<MapCodeSheet target={{ ...ROW, centralManaged: true }} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText('Central maps this code. A lab cannot change it.')).toBeTruthy();
    expect(screen.queryByTestId('map-sheet-menu')).toBeNull();
  });
});
