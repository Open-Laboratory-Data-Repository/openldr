import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    correctReceptionOrder: vi.fn(),
    expandValueSetByUrl: vi.fn(async () => [{ system: 'urn:test:priority', code: 'p9', display: 'Priority nine' }]),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { CorrectOrderSheet } from './CorrectOrderSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1', facility: { code: 'F1', display: 'Facility one' }, origin: 'form',
  patient: null, priority: null, clinician: 'Dr Phri', note: 'old note',
  tests: [{ serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active' }],
  specimens: [],
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('CorrectOrderSheet', () => {
  it('sends only the fields that changed, with the reason', async () => {
    vi.mocked(api.correctReceptionOrder).mockResolvedValue({ ...ORDER, clinician: 'Dr Phiri', note: null });
    const onCorrected = vi.fn();
    render(<CorrectOrderSheet order={ORDER} onClose={() => {}} onCorrected={onCorrected} />);
    fireEvent.change(screen.getByLabelText('Clinician'), { target: { value: 'Dr Phiri' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Typo in the name' } });
    openMenu('correct-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save correction' }));
    await waitFor(() => expect(onCorrected).toHaveBeenCalled());
    expect(api.correctReceptionOrder).toHaveBeenCalledWith({
      requisition: 'REQ-1', facilityCode: 'F1', changes: { clinician: 'Dr Phiri', note: null }, reason: 'Typo in the name',
    });
  });

  it('refuses a correction with no reason', async () => {
    render(<CorrectOrderSheet order={ORDER} onClose={() => {}} onCorrected={() => {}} />);
    fireEvent.change(screen.getByLabelText('Clinician'), { target: { value: 'Dr Phiri' } });
    openMenu('correct-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save correction' }));
    expect(toast.error).toHaveBeenCalled();
    expect(api.correctReceptionOrder).not.toHaveBeenCalled();
  });
});
