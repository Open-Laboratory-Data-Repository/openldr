import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    searchReceptionPatients: vi.fn(),
    registerReceptionPatient: vi.fn(),
    expandValueSetByUrl: vi.fn(async () => [{ system: 'urn:test:gender', code: 'g1', display: 'Gender one' }]),
  };
});

import * as api from '@/api';
import { toast } from 'sonner';
import { PatientSheet } from './PatientSheet';

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PatientSheet', () => {
  it('finds a patient by identifier and hands back the one chosen', async () => {
    vi.mocked(api.searchReceptionPatients).mockResolvedValue([
      { id: 'p1', name: 'Ann Banda', birthDate: '1990-05-01', gender: 'g1', identifiers: [{ system: 'urn:test:id', value: 'N-1' }] },
    ]);
    const onPicked = vi.fn();
    render(<PatientSheet open onClose={() => {}} onPicked={onPicked} />);
    await waitFor(() => expect(api.expandValueSetByUrl).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: ' N-1 ' } });
    openMenu('patient-sheet-menu');
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Search' })); });
    expect(api.searchReceptionPatients).toHaveBeenCalledWith({ identifier: 'N-1' });
    expect(await screen.findByRole('radio', { name: /Ann Banda/ })).toBeChecked();
    openMenu('patient-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Use this patient' }));
    expect(onPicked).toHaveBeenCalledWith({ id: 'p1', display: 'Ann Banda' });
  });

  it('asks for a birth date with a name before searching', async () => {
    render(<PatientSheet open onClose={() => {}} onPicked={() => {}} />);
    await waitFor(() => expect(api.expandValueSetByUrl).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ann Banda' } });
    openMenu('patient-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Search' }));
    expect(toast.error).toHaveBeenCalled();
    expect(api.searchReceptionPatients).not.toHaveBeenCalled();
  });

  it('refuses an identifier with a system and no value', async () => {
    render(<PatientSheet open onClose={() => {}} onPicked={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sex' })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Banda' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sex' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Gender one' }));
    fireEvent.change(screen.getByLabelText('Age in years'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Identifier system'), { target: { value: 'urn:test:id' } });
    openMenu('patient-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register patient' }));
    expect(toast.error).toHaveBeenCalled();
    expect(api.registerReceptionPatient).not.toHaveBeenCalled();
  });
});
