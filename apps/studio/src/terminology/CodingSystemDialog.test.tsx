import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { CodingSystemDialog } from './CodingSystemDialog';
import * as api from '../api';

/** Opens the sheet's ⋯ menu and picks one action. */
async function pick(label: RegExp | string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Coding system actions' }));
  await user.click(await screen.findByRole('menuitem', { name: label }));
}

describe('CodingSystemDialog', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('creates a code system (upper-cases the code)', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([]);
    const created = {
      id: 'c9',
      systemCode: 'X',
      systemName: 'X sys',
      url: null,
      systemVersion: null,
      description: null,
      active: true,
      publisherId: null,
      seeded: false,
    };
    vi.spyOn(api, 'createCodingSystem').mockResolvedValue(created as never);
    const onSaved = vi.fn();
    render(
      <CodingSystemDialog
        open
        system={null}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText('System code'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('System name'), { target: { value: 'X sys' } });
    await pick(/create/i);
    await waitFor(() =>
      expect(api.createCodingSystem).toHaveBeenCalledWith(
        expect.objectContaining({ systemCode: 'X', systemName: 'X sys' }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });

  it('a failed save shows a toast and keeps the sheet open with the input', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([]);
    vi.spyOn(api, 'createCodingSystem').mockRejectedValue(new Error('create coding system failed: code taken'));
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<CodingSystemDialog open system={null} onOpenChange={onOpenChange} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('System code'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('System name'), { target: { value: 'X sys' } });
    await pick(/create/i);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('create coding system failed: code taken'));
    expect(screen.queryByText('create coding system failed: code taken')).not.toBeInTheDocument();
    expect(screen.getByLabelText('System name')).toHaveValue('X sys');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a failed publisher load shows a toast', async () => {
    vi.spyOn(api, 'listPublishers').mockRejectedValue(new Error('list publishers failed'));
    render(<CodingSystemDialog open system={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('list publishers failed'));
  });

  it('disables the System code field when editing', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([]);
    const sys = {
      id: 'c1',
      systemCode: 'LOINC',
      systemName: 'L',
      url: null,
      systemVersion: null,
      description: null,
      active: true,
      publisherId: null,
      seeded: true,
    };
    render(
      <CodingSystemDialog
        open
        system={sys as never}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await act(async () => {});
    expect(screen.getByLabelText('System code')).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Coding system actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(create|save)$/i })).not.toBeInTheDocument();
  });

  it('populates the publisher select from listPublishers', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([
      { id: 'p1', name: 'WHO', role: 'external', icon: null, seeded: true, sortOrder: 0 },
    ] as never);
    render(<CodingSystemDialog open system={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(api.listPublishers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'WHO' })).toBeInTheDocument();
  });
});
