import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    createFacilityImportSource: vi.fn(),
  };
});

import * as api from '@/api';
import type { FacilityRegisterSource } from '@/api';
import { RegisterSourceDialog } from './RegisterSourceDialog';

const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

const CREATED: FacilityRegisterSource = {
  id: 'cs-freg-new', url: 'urn:tz:hfr', name: 'Tanzania HFR', code: 'TZ_HFR',
  version: null, jurisdiction: null, contact: null, publisherId: null, active: true,
};

/** ⛔ Register/Cancel live in a ⋯ `DropdownMenu` (ui-actions-in-dots-menu), never as standalone
 *  footer buttons — same idiom `ImportFacilitiesSheet.test.tsx`'s own `openMenu`/`clickMenuItem`
 *  use for the sheet's own ⋯ menu. */
function openDialogMenu() {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'Register source actions' }),
    { button: 0, ctrlKey: false, pointerType: 'mouse' },
  );
  if (!screen.queryByRole('menu')) {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Register source actions' }), { key: 'Enter' });
  }
}

describe('RegisterSourceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is reached ONLY through the ⋯ menu — no standalone Register/Cancel buttons on the dialog', () => {
    render(<RegisterSourceDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    openDialogMenu();
    expect(screen.getByRole('menuitem', { name: /^register$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('keeps Register disabled until url/name/code are all filled, then sends them (trimmed) to createFacilityImportSource', async () => {
    mocked(api.createFacilityImportSource).mockResolvedValue(CREATED);
    const onCreated = vi.fn();
    render(<RegisterSourceDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);

    openDialogMenu();
    expect(screen.getByRole('menuitem', { name: /^register$/i })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByLabelText('Canonical URI'), { target: { value: '  urn:tz:hfr  ' } });
    openDialogMenu();
    expect(screen.getByRole('menuitem', { name: /^register$/i })).toHaveAttribute('aria-disabled', 'true'); // still missing name/code
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '  Tanzania HFR  ' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '  TZ_HFR  ' } });
    openDialogMenu();
    expect(screen.getByRole('menuitem', { name: /^register$/i })).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: /^register$/i }));

    await waitFor(() => expect(api.createFacilityImportSource).toHaveBeenCalledTimes(1));
    // ⛔ Whitespace is trimmed before the request — a pasted trailing space must not become part of
    // the register's permanent canonical identity.
    expect(api.createFacilityImportSource).toHaveBeenCalledWith({
      url: 'urn:tz:hfr', name: 'Tanzania HFR', code: 'TZ_HFR',
      version: undefined, jurisdiction: undefined, contact: undefined,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
  });

  it('sends the optional fields only when filled, and never sends publisherId (no FK-safe input for it in this dialog)', async () => {
    mocked(api.createFacilityImportSource).mockResolvedValue(CREATED);
    render(<RegisterSourceDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Canonical URI'), { target: { value: 'urn:tz:hfr' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Tanzania HFR' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'TZ_HFR' } });
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '2026-Q3' } });
    fireEvent.change(screen.getByLabelText('Jurisdiction'), { target: { value: 'TZ' } });

    openDialogMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^register$/i }));

    await waitFor(() => expect(api.createFacilityImportSource).toHaveBeenCalledTimes(1));
    const sent = mocked(api.createFacilityImportSource).mock.calls[0][0];
    expect(sent).toMatchObject({ version: '2026-Q3', jurisdiction: 'TZ', contact: undefined });
    expect(sent).not.toHaveProperty('publisherId');
  });

  it('shows the server error (e.g. a duplicate-url 409) and does not close or clear the form', async () => {
    mocked(api.createFacilityImportSource).mockRejectedValue(
      new Error('a facility register already exists for a url matching "urn:tz:hfr" (case-insensitive)'),
    );
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(<RegisterSourceDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Canonical URI'), { target: { value: 'urn:tz:hfr' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Tanzania HFR' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'TZ_HFR' } });
    openDialogMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^register$/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
    // The operator's typed values survive the failed attempt — worth keeping to retry with a fix.
    expect(screen.getByLabelText('Canonical URI')).toHaveValue('urn:tz:hfr');
  });

  it('resets to a blank form every time it is reopened', () => {
    const { rerender } = render(<RegisterSourceDialog open={false} onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    rerender(<RegisterSourceDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText('Canonical URI')).toHaveValue('');
    expect(screen.getByLabelText('Display name')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toHaveValue('');
  });
});
