import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    previewTestMappingImport: vi.fn(async () => ({ counts: { new: 1, changed: 0, unchanged: 2, refused: 1 }, refused: [{ line: 4, system: 's', code: 'BAD', reason: 'no catalog test has code NOPE' }], rebuild: null })),
    applyTestMappingImport: vi.fn(async () => ({ counts: { new: 1, changed: 0, unchanged: 2, refused: 1 }, refused: [], rebuild: { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } } })),
  };
});

import * as api from '@/api';
import { ImportMappingsSheet } from './ImportMappingsSheet';

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in TestSheet.test.tsx).
function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ImportMappingsSheet', () => {
  it('checks the file first and lists refused rows, then imports', async () => {
    const onImported = vi.fn();
    render(<ImportMappingsSheet open onClose={vi.fn()} onImported={onImported} />);
    const file = new File(['system,code,catalog_code\n'], 'm.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('import-mappings-file'), { target: { files: [file] } });
    expect(await screen.findByText('1 new, 0 changed, 2 unchanged, 1 refused')).toBeTruthy();
    expect(screen.getByText('Line 4, BAD: no catalog test has code NOPE')).toBeTruthy();
    openMenu('import-mappings-menu');
    const apply = await screen.findByTestId('import-mappings-apply');
    await act(async () => { fireEvent.click(apply); });
    await waitFor(() => expect(api.applyTestMappingImport).toHaveBeenCalledWith(file));
    expect(onImported).toHaveBeenCalled();
  });
});
