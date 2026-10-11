import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    linkResultField: vi.fn(async () => ({ code: 'VLC', before: null, after: '20447-9' })),
    unlinkResultField: vi.fn(async () => ({ code: 'VLC', before: '20447-9', after: null })),
  };
});

import * as api from '@/api';
import { ResultFieldSheet } from './ResultFieldSheet';

const FIELD: api.ResultField = { code: 'VLC', display: 'HIV VL copies', role: 'result', units: null, loinc: null };

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ResultFieldSheet', () => {
  it('saves a typed LOINC code when LOINC is not loaded', async () => {
    const onSaved = vi.fn();
    render(<ResultFieldSheet field={FIELD} ownedHere loinc={null} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId('result-field-loinc'), { target: { value: '20447-9' } });
    openMenu('result-field-sheet-menu');
    const save = await screen.findByTestId('result-field-save');
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(api.linkResultField).toHaveBeenCalledWith('VLC', '20447-9'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('clears an existing link', async () => {
    render(<ResultFieldSheet field={{ ...FIELD, loinc: '20447-9' }} ownedHere loinc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    openMenu('result-field-sheet-menu');
    const clear = await screen.findByTestId('result-field-clear');
    await act(async () => { fireEvent.click(clear); });
    await waitFor(() => expect(api.unlinkResultField).toHaveBeenCalledWith('VLC'));
  });

  it('shows no actions when the dictionary came from central', () => {
    render(<ResultFieldSheet field={FIELD} ownedHere={false} loinc={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByTestId('result-field-sheet-menu')).toBeNull();
  });
});
