import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, cancelReceptionOrder: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { CancelOrderSheet } from './CancelOrderSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1', facility: { code: 'F1', display: 'Facility one' }, origin: 'lab-desk',
  patient: null, priority: null, clinician: null, note: null,
  tests: [{ serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active', rejection: null }],
  specimens: [],
  returned: null,
  redraws: [],
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('CancelOrderSheet', () => {
  it('cancels the order with the reason', async () => {
    const after = { ...ORDER, tests: [{ ...ORDER.tests[0]!, status: 'entered-in-error' }] };
    vi.mocked(api.cancelReceptionOrder).mockResolvedValue(after);
    const onCancelled = vi.fn();
    render(<CancelOrderSheet order={ORDER} onClose={() => {}} onCancelled={onCancelled} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' Wrong test list ' } });
    openMenu('cancel-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cancel registration' }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(after));
    expect(api.cancelReceptionOrder).toHaveBeenCalledWith({ requisition: 'REQ-1', facilityCode: 'F1', reason: 'Wrong test list' });
  });

  it('refuses a cancellation with no reason', async () => {
    render(<CancelOrderSheet order={ORDER} onClose={() => {}} onCancelled={() => {}} />);
    openMenu('cancel-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cancel registration' }));
    expect(toast.error).toHaveBeenCalled();
    expect(api.cancelReceptionOrder).not.toHaveBeenCalled();
  });
});
