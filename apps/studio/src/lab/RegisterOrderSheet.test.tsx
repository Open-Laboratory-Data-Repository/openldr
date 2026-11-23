import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    registerReceptionOrder: vi.fn(),
    registerReceptionPatient: vi.fn(),
    searchReceptionPatients: vi.fn(async () => []),
    searchReceptionFacilities: vi.fn(async () => [{ code: 'F1', display: 'Facility one' }]),
    searchReceptionTests: vi.fn(async () => [{ system: 'urn:test:catalog', code: 'T1', display: 'Test one' }]),
    expandValueSetByUrl: vi.fn(async (url: string) => (url.endsWith('administrative-gender')
      ? [{ system: 'urn:test:gender', code: 'g1', display: 'Gender one' }]
      : url.endsWith('request-priority') ? [{ system: 'urn:test:priority', code: 'p9', display: 'Priority nine' }] : [])),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { RegisterOrderSheet } from './RegisterOrderSheet';

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

describe('RegisterOrderSheet', () => {
  it('registers the order with the values filled in, and the patient made in the patient sheet', async () => {
    const onRegistered = vi.fn();
    const made = { requisition: 'REQ-9', facility: { code: 'F1', display: 'Facility one' }, origin: 'lab-desk' as const,
      patient: { id: 'p1', display: 'Ann Banda' }, priority: 'p9', clinician: 'Dr Phiri', note: null, tests: [], specimens: [], returned: null, redraws: [] };
    vi.mocked(api.registerReceptionOrder).mockResolvedValue(made);
    vi.mocked(api.registerReceptionPatient).mockResolvedValue({ id: 'p1', display: 'Ann Banda' });
    render(<RegisterOrderSheet open requisition="REQ-9" onClose={() => {}} onRegistered={onRegistered} />);

    expect(screen.getByLabelText('Requisition number')).toHaveValue('REQ-9');
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'Fa' } });
    fireEvent.click(await screen.findByRole('radio', { name: 'Facility one' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Test one' }));
    await pick('Priority', 'Priority nine');
    fireEvent.change(screen.getByLabelText('Clinician'), { target: { value: ' Dr Phiri ' } });

    openMenu('register-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Find or register patient' }));
    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Banda' } });
    await pick('Sex', 'Gender one');
    fireEvent.change(screen.getAllByLabelText('Birth date')[1]!, { target: { value: '1990-05-01' } });
    openMenu('patient-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register patient' }));
    expect(await screen.findByTestId('register-patient-value')).toHaveTextContent('Ann Banda');
    expect(api.registerReceptionPatient).toHaveBeenCalledWith({ given: 'Ann', family: 'Banda', gender: 'g1', birthDate: '1990-05-01' });
    expect(api.searchReceptionPatients).not.toHaveBeenCalled();

    openMenu('register-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register order' }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(made));
    expect(api.registerReceptionOrder).toHaveBeenCalledWith({
      requisition: 'REQ-9', facilityCode: 'F1', patientId: 'p1',
      tests: [{ system: 'urn:test:catalog', code: 'T1' }], priority: 'p9', clinician: 'Dr Phiri',
    });
  });

  it('refuses to register without a facility, a test and a patient', async () => {
    render(<RegisterOrderSheet open requisition="REQ-9" onClose={() => {}} onRegistered={() => {}} />);
    openMenu('register-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register order' }));
    expect(toast.error).toHaveBeenCalled();
    expect(api.registerReceptionOrder).not.toHaveBeenCalled();
  });

  it('shows the server refusal in a toast', async () => {
    vi.mocked(api.registerReceptionOrder).mockRejectedValue(new Error('register order failed: already registered'));
    vi.mocked(api.registerReceptionPatient).mockResolvedValue({ id: 'p1', display: 'Ann Banda' });
    render(<RegisterOrderSheet open requisition="REQ-9" onClose={() => {}} onRegistered={() => {}} />);
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'Fa' } });
    fireEvent.click(await screen.findByRole('radio', { name: 'Facility one' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Test one' }));
    openMenu('register-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Find or register patient' }));
    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Banda' } });
    await pick('Sex', 'Gender one');
    fireEvent.change(screen.getByLabelText('Age in years'), { target: { value: '4' } });
    openMenu('patient-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register patient' }));
    await screen.findByText('Ann Banda');
    openMenu('register-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register order' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('register order failed: already registered'));
  });
});
