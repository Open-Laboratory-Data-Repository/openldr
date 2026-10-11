import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listResultFields: vi.fn(), downloadResultFieldsCsv: vi.fn() };
});

import * as api from '@/api';
import { ResultFieldsTab } from './ResultFieldsTab';

const FIELD: api.ResultField = { code: 'VLC', display: 'HIV VL copies', role: 'result', units: 'copies/mL', loinc: '20447-9' };
const list = (over: Partial<api.ResultFieldList> = {}): api.ResultFieldList => ({ rows: [FIELD], total: 1, ownedHere: true, loaded: true, ...over });

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.mocked(api.listResultFields).mockReset(); });

describe('ResultFieldsTab', () => {
  it('shows the spinner, then a field with its role, units and LOINC', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list());
    render(<ResultFieldsTab canManage loinc={null} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const row = await screen.findByTestId('result-field-row-VLC');
    expect(row.textContent).toContain('HIV VL copies');
    expect(row.textContent).toContain('20447-9');
    expect(vi.mocked(api.listResultFields)).toHaveBeenCalledWith({ q: undefined, loinc: 'all', role: undefined, limit: 25, offset: 0 });
  });

  it('says no dictionary is loaded, with stripes and no table', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list({ rows: [], total: 0, loaded: false }));
    render(<ResultFieldsTab canManage loinc={null} />);
    expect(await screen.findByText('No result dictionary is loaded. Import one with openldr terminology import parameters <file>.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('asks again with the LOINC filter', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list());
    render(<ResultFieldsTab canManage loinc={null} />);
    await screen.findByTestId('result-field-row-VLC');
    fireEvent.click(screen.getByTestId('result-fields-loinc-none'));
    await waitFor(() => expect(vi.mocked(api.listResultFields)).toHaveBeenLastCalledWith({ q: undefined, loinc: 'none', role: undefined, limit: 25, offset: 0 }));
  });

  it('is read-only when the dictionary came from central', async () => {
    vi.mocked(api.listResultFields).mockResolvedValue(list({ ownedHere: false }));
    render(<ResultFieldsTab canManage loinc={null} />);
    await screen.findByTestId('result-field-row-VLC');
    expect(screen.getByText('This result dictionary comes from central. Only central can change its LOINC links.')).toBeTruthy();
    expect(screen.queryByTestId('result-field-actions-VLC')).toBeNull();
    openMenu('result-fields-menu-trigger');
    await screen.findByTestId('result-fields-export');
    expect(screen.queryByTestId('result-fields-import')).toBeNull();
  });
});
