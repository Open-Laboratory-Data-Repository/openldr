import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import '@/i18n';
import { ChangePasswordSheet } from './ChangePasswordSheet';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('./local', () => ({ localChangePassword: vi.fn() }));
const signOut = vi.hoisted(() => vi.fn());
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ signOut }) }));

import { toast } from 'sonner';
import { localChangePassword } from './local';

const change = vi.mocked(localChangePassword);

function Host({ onOpenChange }: { onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <ChangePasswordSheet open={open} onOpenChange={(o) => { setOpen(o); onOpenChange?.(o); }} />
    </>
  );
}

function fill(current: string, next: string, repeat: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: repeat } });
}

// Radix menus open on pointerDown in jsdom, with Enter as the fallback.
function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

function save() {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
}

describe('ChangePasswordSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves from the dots menu, confirms and closes', async () => {
    change.mockResolvedValue('ok');
    const onOpenChange = vi.fn();
    render(<Host onOpenChange={onOpenChange} />);
    expect(screen.getByRole('dialog', { name: 'Change password' })).toBeInTheDocument();
    fill('old password 1', 'a much better one', 'a much better one');
    save();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(change).toHaveBeenCalledWith('old password 1', 'a much better one');
    expect(toast.success).toHaveBeenCalledWith('Password changed.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no footer buttons: the only button besides the close control is the dots menu', () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    const names = Array.from(dialog.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(names.filter((n) => n !== 'Close')).toEqual(['Actions']);
  });

  it('sends nothing when the two new passwords differ', async () => {
    render(<Host />);
    fill('old password 1', 'a much better one', 'a much better two');
    save();
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows wrong_current, clears the fields and stays open', async () => {
    change.mockResolvedValue('wrong_current');
    render(<Host />);
    fill('not it', 'a much better one', 'a much better one');
    save();
    expect(await screen.findByText('The current password is wrong.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Repeat password')).toHaveValue('');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows same_as_current in words and stays open', async () => {
    change.mockResolvedValue('same_as_current');
    render(<Host />);
    fill('temporary pass', 'temporary pass', 'temporary pass');
    save();
    expect(await screen.findByText('Choose a password different from the temporary one.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows the sign-in page when the server says the session ended', async () => {
    change.mockResolvedValue('session_ended');
    render(<Host />);
    fill('old password 1', 'a much better one', 'a much better one');
    save();
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('asks the person to try again when the request throws', async () => {
    change.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Host />);
    fill('old password 1', 'a much better one', 'a much better one');
    save();
    expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('clears every field and message when the sheet closes', async () => {
    change.mockResolvedValue('wrong_current');
    render(<Host />);
    fill('not it', 'a much better one', 'a much better one');
    save();
    await screen.findByText('The current password is wrong.');
    fill('typed again', 'half typed', '');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(await screen.findByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.queryByText('The current password is wrong.')).toBeNull();
  });

  it('puts the label left of each input and marks the new passwords', () => {
    render(<Host />);
    const grid = screen.getByLabelText('Current password').parentElement as HTMLElement;
    expect(grid).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)]', 'items-center');
    expect(screen.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Repeat password')).toHaveAttribute('autocomplete', 'new-password');
  });
});
