import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getObservedSystems: vi.fn(), previewMatchCodes: vi.fn(), applyMatchCodes: vi.fn() };
});

import * as api from '@/api';
import { MatchCodesSheet } from './MatchCodesSheet';

const DISA = 'urn:openldr:disa';

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  vi.mocked(api.getObservedSystems).mockResolvedValue([DISA]);
  vi.mocked(api.previewMatchCodes).mockReset();
  vi.mocked(api.applyMatchCodes).mockReset();
});

describe('MatchCodesSheet', () => {
  it('picks the only system, lists its matches, and applies them', async () => {
    vi.mocked(api.previewMatchCodes).mockResolvedValue({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }] });
    vi.mocked(api.applyMatchCodes).mockResolvedValue({ system: DISA, matches: [{ code: 'HIVVL', display: 'HIV VL', results: 2 }], rebuild: { ok: false, error: 'boom' } });
    const onApplied = vi.fn();
    render(<MatchCodesSheet open onClose={vi.fn()} onApplied={onApplied} />);
    expect(await screen.findByText('HIVVL · HIV VL · 2 result(s)')).toBeTruthy();
    expect(api.previewMatchCodes).toHaveBeenCalledWith(DISA);
    openMenu('match-sheet-menu');
    const apply = await screen.findByTestId('match-sheet-apply');
    await act(async () => { fireEvent.click(apply); });
    await waitFor(() => expect(api.applyMatchCodes).toHaveBeenCalledWith(DISA));
    expect(onApplied).toHaveBeenCalled();
  });

  it('says so when nothing matches, and keeps apply disabled', async () => {
    vi.mocked(api.previewMatchCodes).mockResolvedValue({ system: DISA, matches: [] });
    render(<MatchCodesSheet open onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(await screen.findByText('No unmapped code in this system matches a result field.')).toBeTruthy();
    openMenu('match-sheet-menu');
    expect((await screen.findByTestId('match-sheet-apply')).getAttribute('aria-disabled')).toBe('true');
  });
});
