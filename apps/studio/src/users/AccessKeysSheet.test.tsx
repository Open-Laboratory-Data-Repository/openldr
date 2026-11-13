import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@/i18n';

// Pin a zone west of UTC with no daylight saving, before any import reads a date. Node applies a
// change to process.env.TZ at once. Vitest's default pool is child processes, and afterAll puts
// the old zone back.
const zone = vi.hoisted(() => {
  const before = process.env.TZ;
  process.env.TZ = 'America/Bogota';
  return { before };
});
afterAll(() => {
  if (zone.before === undefined) delete process.env.TZ;
  else process.env.TZ = zone.before;
});

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listAccessKeys: vi.fn(), createAccessKey: vi.fn(), revokeAccessKey: vi.fn() };
});
import { listAccessKeys, createAccessKey, revokeAccessKey, type AccessKey } from '@/api';
import { AccessKeysSheet, endOfDayIso } from './AccessKeysSheet';

const bob = { id: 'u2', username: 'bob' };
// A made-up value in the key's shape. Not a real key.
const KEY = 'oldr_TESTVALUE-not-a-real-key-0123456789abcdef';

function key(over: Partial<AccessKey> & { id: string; name: string }): AccessKey {
  return {
    userId: 'u2', prefix: `oldr_${over.id.padEnd(7, 'x')}`, createdBy: 'me', createdAt: '2026-11-01T10:00:00.000Z',
    expiresAt: null, revokedAt: null, lastUsedAt: null, ...over,
  };
}
const active = key({ id: 'k1', name: 'ci-bot' });
const revoked = key({ id: 'k2', name: 'old-bot', revokedAt: '2026-11-02T10:00:00.000Z' });
const expired = key({ id: 'k3', name: 'temp-bot', expiresAt: '2020-01-01T00:00:00.000Z' });

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

// Mirrors how the Users page holds the sheet: a user while open, null once closed.
let reopen: () => void = () => {};
function Harness() {
  const [user, setUser] = useState<typeof bob | null>(bob);
  reopen = () => setUser(bob);
  return <AccessKeysSheet user={user} onClose={() => setUser(null)} />;
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}
// jsdom has no document.execCommand. Each test that needs it sets one.
function setExecCommand(value: unknown) {
  Object.defineProperty(document, 'execCommand', { value, configurable: true, writable: true });
}

async function createKey(name: string) {
  openDropdown(await screen.findByRole('button', { name: 'Access key actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New key' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  openDropdown(screen.getByRole('button', { name: 'New key actions' }));
  const create = await screen.findByRole('menuitem', { name: 'Create key' });
  // The create call settles after the click returns, so let it finish inside act.
  await act(async () => { fireEvent.click(create); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAccessKeys).mockResolvedValue([active]);
  vi.mocked(createAccessKey).mockResolvedValue({ key: KEY, record: key({ id: 'k9', name: 'new-bot' }) });
  vi.mocked(revokeAccessKey).mockResolvedValue(undefined);
  setClipboard(undefined);
  setExecCommand(undefined);
});
afterEach(() => { setClipboard(undefined); setExecCommand(undefined); });

describe('AccessKeysSheet', () => {
  it('names the user in the title', async () => {
    render(<Harness />);
    expect(await screen.findByText('Access keys for bob')).toBeTruthy();
    await waitFor(() => expect(listAccessKeys).toHaveBeenCalledWith('u2'));
  });

  it('lists a user\'s keys with pagination', async () => {
    const many = Array.from({ length: 30 }, (_, i) => key({ id: `k${i + 1}`, name: `key-${String(i + 1).padStart(2, '0')}` }));
    vi.mocked(listAccessKeys).mockResolvedValue(many);
    render(<Harness />);
    expect(await screen.findByText('key-01')).toBeTruthy();
    expect(screen.getByText('key-25')).toBeTruthy();
    expect(screen.queryByText('key-26')).toBeNull();
    expect(screen.getByText('1–25 of 30')).toBeTruthy();
    for (const name of ['Name', 'Prefix', 'Created', 'Expires', 'Last used', 'Status']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('key-26')).toBeTruthy();
    expect(screen.getByText('key-30')).toBeTruthy();
    expect(screen.queryByText('key-01')).toBeNull();
  });

  it('works out each status, and offers Revoke on every key that is not revoked', async () => {
    vi.mocked(listAccessKeys).mockResolvedValue([active, revoked, expired]);
    render(<Harness />);
    const activeRow = (await screen.findByText('ci-bot')).closest('tr')!;
    const revokedRow = screen.getByText('old-bot').closest('tr')!;
    const expiredRow = screen.getByText('temp-bot').closest('tr')!;
    expect(within(activeRow).getByText('Active')).toBeTruthy();
    expect(within(revokedRow).getByText('Revoked')).toBeTruthy();
    expect(within(expiredRow).getByText('Expired')).toBeTruthy();
    expect(within(activeRow).getByRole('button', { name: 'Actions for ci-bot' })).toBeTruthy();
    expect(within(revokedRow).queryByRole('button')).toBeNull();
    // "Expired" is this browser's clock. The server may still accept the key, so Revoke stays.
    openDropdown(within(expiredRow).getByRole('button', { name: 'Actions for temp-bot' }));
    expect(await screen.findByRole('menuitem', { name: 'Revoke' })).toBeTruthy();
  });

  it('lets a long unbroken name wrap anywhere, so it cannot widen the table', async () => {
    // jsdom does no layout, so this checks the class that does the work, nothing more.
    vi.mocked(listAccessKeys).mockResolvedValue([key({ id: 'k5', name: 'nightly_export_reporting_service_key' })]);
    render(<Harness />);
    const nameEl = await screen.findByText('nightly_export_reporting_service_key');
    expect(nameEl.className).toContain('[overflow-wrap:anywhere]');
    const stackedPrefix = within(nameEl.closest('td')!).getByText('oldr_k5xxxxx');
    expect(stackedPrefix.className).toContain('[overflow-wrap:anywhere]');
  });

  it('shows a failed load as an error, not as an empty list, and clears it once a load works', async () => {
    vi.mocked(listAccessKeys).mockRejectedValueOnce(new Error('list access keys failed: 500'));
    render(<Harness />);
    expect(await screen.findByText('Could not load the keys: list access keys failed: 500')).toBeTruthy();
    expect(screen.queryByText('No access keys yet.')).toBeNull();
    // A create reads the list again, and this time it works.
    await createKey('new-bot');
    expect(await screen.findByText('ci-bot')).toBeTruthy();
    expect(screen.queryByText(/Could not load the keys/)).toBeNull();
  });

  it('shows a dash for no expiry and for never used', async () => {
    render(<Harness />);
    const row = (await screen.findByText('ci-bot')).closest('tr')!;
    expect(within(row).getAllByText('-').length).toBe(2);
  });

  it('shows the striped empty state with no keys, and the spinner while loading', async () => {
    let resolve!: (rows: AccessKey[]) => void;
    vi.mocked(listAccessKeys).mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<Harness />);
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('No access keys yet.')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    await act(async () => { resolve([]); });
    expect(await screen.findByText('No access keys yet.')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('creates a key and shows it once with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<Harness />);
    await createKey('  new-bot  ');
    await waitFor(() => expect(createAccessKey).toHaveBeenCalledWith('u2', { name: 'new-bot', expiresAt: null }));
    const field = await screen.findByDisplayValue(KEY) as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    // A textarea wraps, so the whole key shows and can be selected by hand.
    expect(field.tagName).toBe('TEXTAREA');
    expect(screen.getByText('This key cannot be shown again. Copy it now.')).toBeTruthy();
    // The list is read again, so the new key's row appears.
    await waitFor(() => expect(listAccessKeys).toHaveBeenCalledTimes(2));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy key' })); });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY));
    expect(await screen.findByText('Copied.')).toBeTruthy();
  });

  it('copies with the older command when the page has no clipboard', async () => {
    // A plain HTTP page that is not localhost, as over Tailscale, has no navigator.clipboard.
    setClipboard(undefined);
    let selectedWhenCopied = '';
    const execCommand = vi.fn(() => {
      const el = document.activeElement as HTMLTextAreaElement;
      selectedWhenCopied = el.value.slice(el.selectionStart, el.selectionEnd);
      return true;
    });
    setExecCommand(execCommand);
    render(<Harness />);
    await createKey('new-bot');
    expect(await screen.findByDisplayValue(KEY)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy key' })); });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(selectedWhenCopied).toBe(KEY);
    expect(await screen.findByText('Copied.')).toBeTruthy();
    expect(screen.queryByText('Copy did not work here. Select the key and copy it by hand.')).toBeNull();
  });

  it('asks to copy by hand when the clipboard and the older command both fail', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const execCommand = vi.fn(() => false);
    setExecCommand(execCommand);
    render(<Harness />);
    await createKey('new-bot');
    const field = await screen.findByDisplayValue(KEY) as HTMLTextAreaElement;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy key' })); });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByText('Copy did not work here. Select the key and copy it by hand.')).toBeTruthy();
    expect(screen.queryByText('Copied.')).toBeNull();
    // The key is left selected.
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(KEY.length);
  });

  it('asks to copy by hand when the field ignores select(), though the older command answers true', async () => {
    // iOS Safari can ignore select() on a read-only field while execCommand('copy') returns true.
    setClipboard(undefined);
    const execCommand = vi.fn(() => true);
    setExecCommand(execCommand);
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {});
    try {
      render(<Harness />);
      await createKey('new-bot');
      const field = await screen.findByDisplayValue(KEY) as HTMLTextAreaElement;
      field.setSelectionRange(0, 0);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy key' })); });
      expect(await screen.findByText('Copy did not work here. Select the key and copy it by hand.')).toBeTruthy();
      expect(screen.queryByText('Copied.')).toBeNull();
    } finally {
      select.mockRestore();
    }
  });

  it('turns spell check off on the key field', async () => {
    render(<Harness />);
    await createKey('new-bot');
    const field = await screen.findByDisplayValue(KEY) as HTMLTextAreaElement;
    expect(field.getAttribute('spellcheck')).toBe('false');
  });

  it('does not show the key again after the sheet is closed and reopened', async () => {
    render(<Harness />);
    await createKey('new-bot');
    expect(await screen.findByDisplayValue(KEY)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Access keys for bob')).toBeNull());
    expect(screen.queryByDisplayValue(KEY)).toBeNull();
    act(() => reopen());
    expect(await screen.findByText('Access keys for bob')).toBeTruthy();
    await screen.findByText('ci-bot');
    expect(screen.queryByDisplayValue(KEY)).toBeNull();
    expect(screen.queryByText('This key cannot be shown again. Copy it now.')).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('revokes a key after confirmation', async () => {
    render(<Harness />);
    const row = (await screen.findByText('ci-bot')).closest('tr')!;
    openDropdown(within(row).getByRole('button', { name: 'Actions for ci-bot' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }));
    expect(await screen.findByText('Revoke ci-bot?')).toBeTruthy();
    expect(revokeAccessKey).not.toHaveBeenCalled();
    vi.mocked(listAccessKeys).mockResolvedValue([{ ...active, revokedAt: '2026-11-13T10:00:00.000Z' }]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revoke' })); });
    await waitFor(() => expect(revokeAccessKey).toHaveBeenCalledWith('u2', 'k1'));
    const after = (await screen.findByText('Revoked')).closest('tr')!;
    expect(within(after).queryByRole('button')).toBeNull();
  });

  it('does not revoke when the confirmation is cancelled', async () => {
    render(<Harness />);
    const row = (await screen.findByText('ci-bot')).closest('tr')!;
    openDropdown(within(row).getByRole('button', { name: 'Actions for ci-bot' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Revoke ci-bot?')).toBeNull());
    expect(revokeAccessKey).not.toHaveBeenCalled();
  });

  it('sends a picked expiry as the end of that day in the browser\'s time zone', async () => {
    render(<Harness />);
    openDropdown(await screen.findByRole('button', { name: 'Access key actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New key' }));
    expect(screen.getByText('The key works until the end of this day, in your time zone.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dated-bot' } });
    // The Expires label names the picker's trigger.
    fireEvent.click(screen.getByLabelText('Expires'));
    const days = [...document.querySelectorAll<HTMLElement>('[data-day]')].filter((d) => {
      const b = d.querySelector('button');
      return b && !b.disabled;
    });
    const picked = days[days.length - 1];
    fireEvent.click(picked.querySelector('button')!);
    // The trigger shows the day that was picked, not the day before.
    const [y, m, d] = picked.dataset.day!.split('-');
    expect(screen.getByLabelText('Expires').textContent).toContain(`${d}/${m}/${y}`);
    openDropdown(screen.getByRole('button', { name: 'New key actions' }));
    const create = await screen.findByRole('menuitem', { name: 'Create key' });
    await act(async () => { fireEvent.click(create); });
    await waitFor(() => expect(createAccessKey).toHaveBeenCalledWith('u2', { name: 'dated-bot', expiresAt: endOfDayIso(picked.dataset.day!) }));
  });

  it('makes one key when Enter and the menu item fire in the same render', async () => {
    render(<Harness />);
    openDropdown(await screen.findByRole('button', { name: 'Access key actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New key' }));
    const nameField = screen.getByLabelText('Name');
    fireEvent.change(nameField, { target: { value: 'once-bot' } });
    openDropdown(screen.getByRole('button', { name: 'New key actions' }));
    const create = await screen.findByRole('menuitem', { name: 'Create key' });
    await act(async () => {
      fireEvent.keyDown(nameField, { key: 'Enter' });
      fireEvent.click(create);
    });
    expect(createAccessKey).toHaveBeenCalledTimes(1);
  });

  it('shows the server\'s refusal and keeps the form', async () => {
    vi.mocked(createAccessKey).mockRejectedValue(new Error('create access key failed: name is over 80 characters'));
    render(<Harness />);
    await createKey('x');
    expect(await screen.findByText(/name is over 80 characters/)).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });
});

describe('endOfDayIso', () => {
  it('runs in the pinned zone, five hours behind UTC', () => {
    expect(new Date(Date.UTC(2026, 10, 20, 12)).getTimezoneOffset()).toBe(300);
  });

  it('is the last millisecond of that day in local time, as a full ISO date-time', () => {
    // 23:59:59.999 on the 20th in Bogota (UTC-5) is 04:59:59.999 on the 21st in UTC. A version
    // written with Date.UTC would give 2026-11-20T23:59:59.999Z and fail.
    expect(endOfDayIso('2026-11-20')).toBe('2026-11-21T04:59:59.999Z');
  });
});
