import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getObservedSystems: vi.fn(), previewMatchCodes: vi.fn(), applyMatchCodes: vi.fn() };
});

// jsdom cannot open a Radix Select, so this stand-in keeps the disabled flag and the pick handler.
vi.mock('@/components/ui/select', () => {
  const Ctx = React.createContext<{ onValueChange: (v: string) => void; disabled: boolean }>({ onValueChange: () => {}, disabled: false });
  return {
    Select: ({ onValueChange, disabled, children }: { onValueChange: (v: string) => void; disabled?: boolean; children: React.ReactNode }) => (
      <Ctx.Provider value={{ onValueChange, disabled: !!disabled }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: { children: React.ReactNode; 'data-testid'?: string }) => {
      const { disabled } = React.useContext(Ctx);
      return <button type="button" disabled={disabled} {...rest}>{children}</button>;
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const { onValueChange } = React.useContext(Ctx);
      return <button type="button" data-testid={`pick-${value}`} onClick={() => onValueChange(value)}>{children}</button>;
    },
  };
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

  it('lets the system be picked again after the sheet closes mid-preview and reopens', async () => {
    const OTHER = 'urn:openldr:other';
    vi.mocked(api.getObservedSystems).mockClear();
    vi.mocked(api.getObservedSystems).mockResolvedValue([DISA, OTHER]);
    // The first preview never returns, as when the sheet is closed before the server answers.
    vi.mocked(api.previewMatchCodes).mockReturnValue(new Promise(() => {}));
    const { rerender } = render(<MatchCodesSheet open onClose={vi.fn()} onApplied={vi.fn()} />);
    fireEvent.click(await screen.findByTestId(`pick-${DISA}`));
    await waitFor(() => expect(api.previewMatchCodes).toHaveBeenCalledWith(DISA));
    expect(screen.getByTestId('match-sheet-system').hasAttribute('disabled')).toBe(true);

    rerender(<MatchCodesSheet open={false} onClose={vi.fn()} onApplied={vi.fn()} />);
    rerender(<MatchCodesSheet open onClose={vi.fn()} onApplied={vi.fn()} />);

    await waitFor(() => expect(api.getObservedSystems).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('match-sheet-system').hasAttribute('disabled')).toBe(false));
  });
});
