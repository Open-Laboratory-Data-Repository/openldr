import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    returnReceptionOrder: vi.fn(),
    expandValueSetByUrl: vi.fn(async (url: string) => (url === 'urn:openldr:valueset:order-return-reason'
      ? [{ system: 'urn:test:return', code: 'R1', display: 'Reason one' }]
      : [])),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { ReturnOrderSheet } from './ReturnOrderSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1', facility: { code: 'F1', display: 'Facility one' }, origin: 'form',
  patient: null, priority: null, clinician: null, note: null,
  tests: [{ serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active', rejection: null }],
  specimens: [], returned: null, redraws: [],
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

async function pick(name: string, option: string) {
  await waitFor(() => expect(screen.getByRole('combobox', { name })).not.toBeDisabled());
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

beforeEach(() => { vi.clearAllMocks(); });

describe('ReturnOrderSheet', () => {
  it('returns the order with the chosen reason and the note, and toasts', async () => {
    const after = { ...ORDER, returned: { reason: { code: 'R1', display: 'Reason one' }, by: 'desk', at: '2026-11-23T10:00:00Z' } };
    vi.mocked(api.returnReceptionOrder).mockResolvedValue(after);
    const onReturned = vi.fn();
    render(<ReturnOrderSheet order={ORDER} onClose={() => {}} onReturned={onReturned} />);
    expect(api.expandValueSetByUrl).toHaveBeenCalledWith('urn:openldr:valueset:order-return-reason');
    await pick('Reason', 'Reason one');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' Birth date missing ' } });
    openMenu('return-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Return to site' }));
    await waitFor(() => expect(onReturned).toHaveBeenCalledWith(after));
    expect(api.returnReceptionOrder).toHaveBeenCalledWith({ requisition: 'REQ-1', facilityCode: 'F1', reasonCode: 'R1', note: 'Birth date missing' });
    expect(toast.success).toHaveBeenCalledWith('Order REQ-1 returned to its site.');
  });

  it('sends no note when none is typed', async () => {
    vi.mocked(api.returnReceptionOrder).mockResolvedValue(ORDER);
    render(<ReturnOrderSheet order={ORDER} onClose={() => {}} onReturned={() => {}} />);
    await pick('Reason', 'Reason one');
    openMenu('return-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Return to site' }));
    await waitFor(() => expect(api.returnReceptionOrder).toHaveBeenCalledWith({ requisition: 'REQ-1', facilityCode: 'F1', reasonCode: 'R1' }));
  });

  it('refuses a return with no reason', async () => {
    render(<ReturnOrderSheet order={ORDER} onClose={() => {}} onReturned={() => {}} />);
    openMenu('return-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Return to site' }));
    expect(toast.error).toHaveBeenCalledWith('Choose a reason.');
    expect(api.returnReceptionOrder).not.toHaveBeenCalled();
  });

  it('shows the server error in a toast', async () => {
    vi.mocked(api.returnReceptionOrder).mockRejectedValue(new Error('return order failed: Order REQ-1 is already on hold.'));
    render(<ReturnOrderSheet order={ORDER} onClose={() => {}} onReturned={() => {}} />);
    await pick('Reason', 'Reason one');
    openMenu('return-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Return to site' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('return order failed: Order REQ-1 is already on hold.'));
  });
});
