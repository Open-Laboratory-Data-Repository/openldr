import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    markReceptionOrderCorrected: vi.fn(),
    expandValueSetByUrl: vi.fn(async () => [{ system: 'urn:test:priority', code: 'P1', display: 'Priority one' }]),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { MarkCorrectedSheet } from './MarkCorrectedSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1', facility: { code: 'F1', display: 'Facility one' }, origin: 'form',
  patient: null, priority: null, clinician: 'Dr Old', note: null,
  tests: [{ serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'on-hold', rejection: null }],
  specimens: [],
  returned: { reason: { code: 'R1', display: 'Reason one' }, by: 'desk', at: '2026-11-23T10:00:00Z' },
  redraws: [],
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('MarkCorrectedSheet', () => {
  it('sends the changed fields and the reason, and toasts', async () => {
    const after = { ...ORDER, returned: null, clinician: 'Dr New', tests: [{ ...ORDER.tests[0]!, status: 'active' }] };
    vi.mocked(api.markReceptionOrderCorrected).mockResolvedValue(after);
    const onCorrected = vi.fn();
    render(<MarkCorrectedSheet order={ORDER} onClose={() => {}} onCorrected={onCorrected} />);
    fireEvent.change(screen.getByLabelText('Clinician'), { target: { value: 'Dr New' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' Site fixed the clinician ' } });
    openMenu('corrected-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark corrected' }));
    await waitFor(() => expect(onCorrected).toHaveBeenCalledWith(after));
    expect(api.markReceptionOrderCorrected).toHaveBeenCalledWith({
      requisition: 'REQ-1', facilityCode: 'F1', changes: { clinician: 'Dr New' }, reason: 'Site fixed the clinician',
    });
    expect(toast.success).toHaveBeenCalledWith('Order REQ-1 marked corrected.');
  });

  it('takes the order back with no field changed, since the site may have fixed something else', async () => {
    vi.mocked(api.markReceptionOrderCorrected).mockResolvedValue(ORDER);
    render(<MarkCorrectedSheet order={ORDER} onClose={() => {}} onCorrected={() => {}} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Birth date added on the form' } });
    openMenu('corrected-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark corrected' }));
    await waitFor(() => expect(api.markReceptionOrderCorrected).toHaveBeenCalledWith({
      requisition: 'REQ-1', facilityCode: 'F1', changes: {}, reason: 'Birth date added on the form',
    }));
  });

  it('refuses with no reason', async () => {
    render(<MarkCorrectedSheet order={ORDER} onClose={() => {}} onCorrected={() => {}} />);
    openMenu('corrected-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark corrected' }));
    expect(toast.error).toHaveBeenCalledWith('Marking an order corrected needs a reason.');
    expect(api.markReceptionOrderCorrected).not.toHaveBeenCalled();
  });
});
