import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    receiveReceptionSample: vi.fn(),
    receptionSampleChoices: vi.fn(async () => [
      { system: 'urn:test:specimen', code: 'S1', display: 'Sample one' },
      { system: 'urn:test:specimen', code: 'S2', display: 'Sample two' },
    ]),
    expandValueSetByUrl: vi.fn(async (url: string) => (url === 'urn:openldr:valueset:sample-condition'
      ? [{ system: 'urn:test:condition', code: 'C1', display: 'Condition one' }]
      : [])),
  };
});

import * as api from '@/api';
import { ReceiveSampleSheet } from './ReceiveSampleSheet';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1', facility: { code: 'F1', display: 'Facility one' }, origin: 'form',
  patient: { id: 'p1', display: 'Ann Banda' }, priority: null, clinician: null, note: null,
  tests: [
    { serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active', rejection: null },
    { serviceRequestId: 'sr2', system: 'urn:test:catalog', code: 'T2', display: 'Test two', status: 'active', rejection: null },
  ],
  specimens: [],
  returned: null,
  redraws: [],
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

describe('ReceiveSampleSheet', () => {
  it('sends the chosen type and condition, for every test by default', async () => {
    vi.mocked(api.receiveReceptionSample).mockResolvedValue(ORDER);
    const onReceived = vi.fn();
    render(<ReceiveSampleSheet order={ORDER} onClose={() => {}} onReceived={onReceived} />);
    expect(api.receptionSampleChoices).toHaveBeenCalledWith('REQ-1', 'F1');
    await pick('Sample type', 'Sample two');
    await pick('Condition', 'Condition one');
    expect(screen.getByRole('checkbox', { name: 'Test one' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Test two' })).toBeChecked();
    openMenu('receive-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Receive sample' }));
    await waitFor(() => expect(onReceived).toHaveBeenCalledWith(ORDER));
    expect(api.receiveReceptionSample).toHaveBeenCalledWith({
      requisition: 'REQ-1', facilityCode: 'F1',
      type: { system: 'urn:test:specimen', code: 'S2', display: 'Sample two' },
      condition: { system: 'urn:test:condition', code: 'C1', display: 'Condition one' },
    });
  });

  it('offers only the live tests of an order, not a cancelled one', async () => {
    const mixed = { ...ORDER, tests: [ORDER.tests[0]!, { ...ORDER.tests[1]!, status: 'entered-in-error' }] };
    render(<ReceiveSampleSheet order={mixed} onClose={() => {}} onReceived={() => {}} />);
    await pick('Sample type', 'Sample one');
    expect(screen.getByRole('checkbox', { name: 'Test one' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Test two' })).toBeNull();
  });

  it('says to map the tests to the test catalog when they name no sample type', async () => {
    vi.mocked(api.receptionSampleChoices).mockResolvedValueOnce([]);
    render(<ReceiveSampleSheet order={ORDER} onClose={() => {}} onReceived={() => {}} />);
    expect(await screen.findByText(/Map these tests to a sample type in the test catalog/)).toBeInTheDocument();
  });

  it('names the tests the sample serves when the desk leaves one out', async () => {
    vi.mocked(api.receiveReceptionSample).mockResolvedValue(ORDER);
    render(<ReceiveSampleSheet order={ORDER} onClose={() => {}} onReceived={() => {}} />);
    await pick('Sample type', 'Sample one');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Test two' }));
    openMenu('receive-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Receive sample' }));
    await waitFor(() => expect(api.receiveReceptionSample).toHaveBeenCalled());
    expect(vi.mocked(api.receiveReceptionSample).mock.calls[0]![0]).toEqual({
      requisition: 'REQ-1', facilityCode: 'F1',
      type: { system: 'urn:test:specimen', code: 'S1', display: 'Sample one' },
      serviceRequestIds: ['sr1'],
    });
  });
});
