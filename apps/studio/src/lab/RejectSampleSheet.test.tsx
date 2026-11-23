import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    rejectReceptionSample: vi.fn(),
    receptionSampleChoices: vi.fn(async () => [
      { system: 'urn:test:specimen', code: 'S1', display: 'Sample one' },
      { system: 'urn:test:specimen', code: 'S2', display: 'Sample two' },
    ]),
    expandValueSetByUrl: vi.fn(async (url: string) => {
      if (url === 'urn:openldr:valueset:sample-condition') return [{ system: 'urn:test:condition', code: 'C1', display: 'Condition one' }];
      if (url === 'urn:openldr:valueset:order-reject-reason') return [{ system: 'urn:test:reject', code: 'X1', display: 'Reject one' }];
      return [];
    }),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { RejectSampleSheet } from './RejectSampleSheet';

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

describe('RejectSampleSheet', () => {
  it('rejects the chosen sample type with a condition and a reason, asking a redraw by default', async () => {
    vi.mocked(api.rejectReceptionSample).mockResolvedValue(ORDER);
    const onRejected = vi.fn();
    render(<RejectSampleSheet order={ORDER} onClose={() => {}} onRejected={onRejected} />);
    expect(api.receptionSampleChoices).toHaveBeenCalledWith('REQ-1', 'F1');
    await pick('Sample type', 'Sample two');
    await pick('Condition', 'Condition one');
    await pick('Reason', 'Reject one');
    expect(screen.getByRole('switch', { name: 'Ask for a redraw' })).toHaveAttribute('aria-checked', 'true');
    openMenu('reject-sample-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject sample' }));
    await waitFor(() => expect(onRejected).toHaveBeenCalledWith(ORDER));
    expect(api.rejectReceptionSample).toHaveBeenCalledWith({
      requisition: 'REQ-1', facilityCode: 'F1', specimenTypeCode: 'S2', conditionCode: 'C1', reasonCode: 'X1', redraw: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Sample rejected for order REQ-1.');
  });

  it('sends redraw false when the switch is turned off, and starts on a received sample\'s type', async () => {
    vi.mocked(api.rejectReceptionSample).mockResolvedValue(ORDER);
    const received = { ...ORDER, specimens: [{ id: 'sp1', type: { system: 'urn:test:specimen', code: 'S2', display: 'Sample two' }, condition: null, receivedTime: '2026-11-23T09:00:00Z', status: 'available' }] };
    render(<RejectSampleSheet order={received} onClose={() => {}} onRejected={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sample type' })).toHaveTextContent('Sample two'));
    await pick('Condition', 'Condition one');
    await pick('Reason', 'Reject one');
    fireEvent.click(screen.getByRole('switch', { name: 'Ask for a redraw' }));
    openMenu('reject-sample-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject sample' }));
    await waitFor(() => expect(api.rejectReceptionSample).toHaveBeenCalledWith(expect.objectContaining({ specimenTypeCode: 'S2', redraw: false })));
  });

  it('shows a failed read of the sample types as an error, not as no sample type', async () => {
    vi.mocked(api.receptionSampleChoices).mockRejectedValueOnce(new Error('read sample types failed: 500'));
    render(<RejectSampleSheet order={ORDER} onClose={() => {}} onRejected={() => {}} />);
    expect(await screen.findByTestId('reject-sample-types-failed')).toHaveTextContent('read sample types failed: 500');
    expect(toast.error).toHaveBeenCalledWith('read sample types failed: 500');
    expect(screen.queryByText(/name no sample type/)).toBeNull();
  });

  it('refuses with no reason or no condition', async () => {
    render(<RejectSampleSheet order={ORDER} onClose={() => {}} onRejected={() => {}} />);
    await pick('Sample type', 'Sample one');
    openMenu('reject-sample-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject sample' }));
    expect(toast.error).toHaveBeenCalledWith('Choose a condition.');
    await pick('Condition', 'Condition one');
    openMenu('reject-sample-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject sample' }));
    expect(toast.error).toHaveBeenCalledWith('Choose a reason.');
    expect(api.rejectReceptionSample).not.toHaveBeenCalled();
  });
});
