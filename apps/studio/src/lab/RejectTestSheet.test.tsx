import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    rejectReceptionTest: vi.fn(),
    expandValueSetByUrl: vi.fn(async (url: string) => (url === 'urn:openldr:valueset:test-reject-reason'
      ? [{ system: 'urn:test:test-reject', code: 'Y1', display: 'Test reason one' }]
      : [])),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { RejectTestSheet } from './RejectTestSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1', facility: { code: 'F1', display: 'Facility one' }, origin: 'form',
  patient: null, priority: null, clinician: null, note: null,
  tests: [{ serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active', rejection: null }],
  specimens: [], returned: null, redraws: [],
};
const TARGET = { order: ORDER, test: ORDER.tests[0]! };

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

describe('RejectTestSheet', () => {
  it('rejects the one test with a reason, asking a redraw by default', async () => {
    vi.mocked(api.rejectReceptionTest).mockResolvedValue(ORDER);
    const onRejected = vi.fn();
    render(<RejectTestSheet target={TARGET} onClose={() => {}} onRejected={onRejected} />);
    expect(screen.getByText('Test one')).toBeInTheDocument();
    await pick('Reason', 'Test reason one');
    openMenu('reject-test-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject test' }));
    await waitFor(() => expect(onRejected).toHaveBeenCalledWith(ORDER));
    expect(api.rejectReceptionTest).toHaveBeenCalledWith({ serviceRequestId: 'sr1', reasonCode: 'Y1', redraw: true });
    expect(toast.success).toHaveBeenCalledWith('Test one rejected.');
  });

  it('sends redraw false when the switch is off', async () => {
    vi.mocked(api.rejectReceptionTest).mockResolvedValue(ORDER);
    render(<RejectTestSheet target={TARGET} onClose={() => {}} onRejected={() => {}} />);
    await pick('Reason', 'Test reason one');
    fireEvent.click(screen.getByRole('switch', { name: 'Ask for a redraw' }));
    openMenu('reject-test-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject test' }));
    await waitFor(() => expect(api.rejectReceptionTest).toHaveBeenCalledWith({ serviceRequestId: 'sr1', reasonCode: 'Y1', redraw: false }));
  });

  it('refuses with no reason', async () => {
    render(<RejectTestSheet target={TARGET} onClose={() => {}} onRejected={() => {}} />);
    openMenu('reject-test-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject test' }));
    expect(toast.error).toHaveBeenCalledWith('Choose a reason.');
    expect(api.rejectReceptionTest).not.toHaveBeenCalled();
  });
});
