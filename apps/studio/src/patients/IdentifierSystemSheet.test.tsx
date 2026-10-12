import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, saveIdentifierSystem: vi.fn() };
});

import * as api from '@/api';
import { IdentifierSystemSheet } from './IdentifierSystemSheet';

const SRC: api.IdentifierSystemRow = { system: 'urn:zm:mpi', label: 'MPI number', labelSource: 'source', patientCount: 3, listColumn: false, searchable: true };

beforeEach(() => { vi.mocked(api.saveIdentifierSystem).mockReset(); });

describe('IdentifierSystemSheet', () => {
  it('starts with an empty label when the label came from the source, and saves from the ⋯ menu', async () => {
    vi.mocked(api.saveIdentifierSystem).mockResolvedValue({ ...SRC, label: 'MPI', labelSource: 'operator', listColumn: true });
    const onSaved = vi.fn();
    render(<IdentifierSystemSheet system={SRC} onClose={() => {}} onSaved={onSaved} />);
    const input = screen.getByTestId('identifier-system-label') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('MPI number');
    fireEvent.change(input, { target: { value: 'MPI' } });
    fireEvent.click(screen.getByTestId('identifier-system-list-column'));
    const trigger = screen.getByTestId('identifier-system-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('identifier-system-save'));
    await waitFor(() => expect(vi.mocked(api.saveIdentifierSystem)).toHaveBeenCalledWith({ system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: true }));
    expect(onSaved).toHaveBeenCalled();
  });
});
