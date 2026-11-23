import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, linkReceptionRedraw: vi.fn() };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { LinkRedrawSheet } from './LinkRedrawSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-2', facility: { code: 'F1', display: 'Facility one' }, origin: 'lab-desk',
  patient: null, priority: null, clinician: null, note: null,
  tests: [{ serviceRequestId: 'sr2', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active', rejection: null }],
  specimens: [], returned: null, redraws: [],
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('LinkRedrawSheet', () => {
  it('links the order to the rejected order it replaces, and toasts', async () => {
    vi.mocked(api.linkReceptionRedraw).mockResolvedValue(ORDER);
    const onLinked = vi.fn();
    render(<LinkRedrawSheet order={ORDER} onClose={() => {}} onLinked={onLinked} />);
    fireEvent.change(screen.getByLabelText('Rejected order number'), { target: { value: ' REQ-1 ' } });
    openMenu('redraw-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link redraw' }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(ORDER));
    expect(api.linkReceptionRedraw).toHaveBeenCalledWith({ requisition: 'REQ-2', facilityCode: 'F1', replacesRequisition: 'REQ-1' });
    expect(toast.success).toHaveBeenCalledWith('Order REQ-2 linked as the redraw of REQ-1.');
  });

  it('refuses with no number', async () => {
    render(<LinkRedrawSheet order={ORDER} onClose={() => {}} onLinked={() => {}} />);
    openMenu('redraw-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link redraw' }));
    expect(toast.error).toHaveBeenCalledWith('Type the number of the rejected order.');
    expect(api.linkReceptionRedraw).not.toHaveBeenCalled();
  });

  it('shows the server error in a toast', async () => {
    vi.mocked(api.linkReceptionRedraw).mockRejectedValue(new Error('link redraw failed: Order REQ-2 has no test that order REQ-1 rejected.'));
    render(<LinkRedrawSheet order={ORDER} onClose={() => {}} onLinked={() => {}} />);
    fireEvent.change(screen.getByLabelText('Rejected order number'), { target: { value: 'REQ-1' } });
    openMenu('redraw-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link redraw' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('link redraw failed: Order REQ-2 has no test that order REQ-1 rejected.'));
  });
});
