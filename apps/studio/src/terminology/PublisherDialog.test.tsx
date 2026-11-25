import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { PublisherDialog } from './PublisherDialog';
import * as api from '../api';

/** Opens the sheet's ⋯ menu and picks one action. */
async function pick(label: RegExp | string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Publisher actions' }));
  await user.click(await screen.findByRole('menuitem', { name: label }));
}

describe('PublisherDialog', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('creates a publisher', async () => {
    const created = { id: 'p9', name: 'My Lab', role: 'local', icon: null, seeded: false, sortOrder: 100 };
    vi.spyOn(api, 'createPublisher').mockResolvedValue(created as never);
    const onSaved = vi.fn();
    render(<PublisherDialog open publisher={null} onOpenChange={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Lab' } });
    await pick(/create/i);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });

  it('a failed save shows a toast and keeps the sheet open with the input', async () => {
    vi.spyOn(api, 'createPublisher').mockRejectedValue(new Error('create publisher failed: name taken'));
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<PublisherDialog open publisher={null} onOpenChange={onOpenChange} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Lab' } });
    await pick(/create/i);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('create publisher failed: name taken'));
    expect(screen.queryByText('create publisher failed: name taken')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('My Lab');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('edits an existing publisher (Save label, updatePublisher called)', async () => {
    const existing = { id: 'p1', name: 'Lab', role: 'local', icon: null, seeded: false, sortOrder: 5 };
    const updated = { ...existing, name: 'Lab 2' };
    vi.spyOn(api, 'updatePublisher').mockResolvedValue(updated as never);
    const onSaved = vi.fn();
    render(<PublisherDialog open publisher={existing as never} onOpenChange={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab 2' } });
    await pick('Save');
    await waitFor(() => expect(api.updatePublisher).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Lab 2' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
  });

  it('has no footer buttons: Cancel in the ⋯ menu closes the sheet', async () => {
    const onOpenChange = vi.fn();
    render(<PublisherDialog open publisher={null} onOpenChange={onOpenChange} onSaved={() => {}} />);
    expect(screen.queryByRole('button', { name: /^(create|save|cancel)$/i })).not.toBeInTheDocument();
    await pick('Cancel');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables the Role control for a seeded publisher', () => {
    const seeded = { id: 'pub-loinc', name: 'LOINC', role: 'external', icon: null, seeded: true, sortOrder: 2 };
    render(<PublisherDialog open publisher={seeded as never} onOpenChange={() => {}} onSaved={() => {}} />);
    // The Role select trigger is a combobox; when disabled Radix sets data-disabled / disabled.
    const role = screen.getByLabelText('Role');
    expect(role).toBeDisabled();
  });
});
