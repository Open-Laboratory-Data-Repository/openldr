import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listFacilityImportSources: vi.fn(), linkMatchingFacilityCodes: vi.fn() };
});

import { listFacilityImportSources, linkMatchingFacilityCodes, type LinkMatchingResult } from '@/api';
import { LinkMatchingSheet } from './LinkMatchingSheet';

const MZ = 'urn:openldr:register:mz-disa';
const preview: LinkMatchingResult = {
  registerUrl: MZ, applied: false,
  counts: { linked: 1, 'already-linked': 2, kept: 0, 'no-match': 5 },
  pairs: [
    { observedSystem: 'urn:openldr:default_fac', code: 'MICAN', sourceDisplay: 'CS Micane', reportCount: 9, registryId: 'fac-mican', name: 'CS Micane', outcome: 'linked' },
    { observedSystem: 'urn:openldr:default_fac', code: 'ZZZZZ', sourceDisplay: null, reportCount: 1, registryId: null, name: null, outcome: 'no-match' },
  ],
};

function openMenu(trigger: HTMLElement, itemName: RegExp) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: itemName })) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('LinkMatchingSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFacilityImportSources as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: MZ, name: 'Mozambique DISA facility codes' }]);
  });

  it('asks for a register before previewing', async () => {
    render(<LinkMatchingSheet open onOpenChange={() => {}} onLinked={() => {}} />);
    expect(await screen.findByText(/choose a register to see/i)).toBeInTheDocument();
    expect(linkMatchingFacilityCodes).not.toHaveBeenCalled();
  });

  it('dry-runs on register choice, lists only codes to link, and applies from the menu', async () => {
    (linkMatchingFacilityCodes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ ...preview, applied: true });
    const onLinked = vi.fn();
    render(<LinkMatchingSheet open onOpenChange={() => {}} onLinked={onLinked} initialRegisterUrl={MZ} />);

    await waitFor(() => expect(linkMatchingFacilityCodes).toHaveBeenCalledWith({ registerUrl: MZ }));
    expect(await screen.findByText(/1 to link, 2 already linked/i)).toBeInTheDocument();
    expect(screen.getByText('MICAN')).toBeInTheDocument();
    expect(screen.queryByText('ZZZZZ')).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Link actions' });
    openMenu(trigger, /link 1 code/i);
    fireEvent.click(screen.getByRole('menuitem', { name: /link 1 code/i }));

    await waitFor(() => expect(linkMatchingFacilityCodes).toHaveBeenLastCalledWith({ registerUrl: MZ, apply: true }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ applied: true })));
  });

  it('shows the empty state and disables apply when nothing would link', async () => {
    (linkMatchingFacilityCodes as ReturnType<typeof vi.fn>).mockResolvedValue({ ...preview, counts: { linked: 0, 'already-linked': 2, kept: 0, 'no-match': 5 }, pairs: [] });
    render(<LinkMatchingSheet open onOpenChange={() => {}} onLinked={() => {}} initialRegisterUrl={MZ} />);

    expect(await screen.findByText(/no codes would be linked/i)).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Link actions' });
    openMenu(trigger, /link 0 codes/i);
    expect(screen.getByRole('menuitem', { name: /link 0 codes/i })).toHaveAttribute('data-disabled');
  });
});
