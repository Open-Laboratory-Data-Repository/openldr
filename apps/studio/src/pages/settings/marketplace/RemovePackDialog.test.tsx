import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getPackRemoval: vi.fn(), removePack: vi.fn() };
});
import * as api from '@/api';
import { RemovePackDialog } from './RemovePackDialog';

// Layer: what the Remove prompt shows and sends, in jsdom, over a mocked API. The server's refusal
// and delete are proven in content-pack-profile tests and marketplace-routes.test.ts.

const removal = { roles: ['Sample Clerk'], layouts: ['Collection site'], formsKept: ['Lab request', 'Sample dispatch'], holders: [] };

beforeEach(() => {
  vi.clearAllMocks();
  (api.getPackRemoval as ReturnType<typeof vi.fn>).mockResolvedValue(removal);
  (api.removePack as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
});

describe('RemovePackDialog', () => {
  it('lists the roles and layouts that go and the forms that stay', async () => {
    render(<RemovePackDialog packId="collection-site" open onOpenChange={() => {}} onRemoved={() => {}} />);
    expect((await screen.findByTestId('remove-pack-roles')).textContent).toContain('Sample Clerk');
    expect(screen.getByTestId('remove-pack-layouts').textContent).toContain('Collection site');
    const kept = screen.getByTestId('remove-pack-forms');
    expect(kept.textContent).toContain('Lab request');
    expect(kept.textContent).toContain('Sample dispatch');
    expect(screen.getByTestId('remove-pack-confirm')).not.toBeDisabled();
    expect(screen.queryByText(/removePack\./)).toBeNull();
  });

  it('says the kept forms open to anyone who may view forms when the pack removes a role', async () => {
    render(<RemovePackDialog packId="collection-site" open onOpenChange={() => {}} onRemoved={() => {}} />);
    const note = await screen.findByTestId('remove-pack-forms-open');
    expect(note.textContent).toBe("These forms were limited to the pack's roles. After removal, anyone who may view forms can open them.");
  });

  it('says nothing about form access when the pack removes no role or keeps no form', async () => {
    (api.getPackRemoval as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...removal, roles: [] });
    const { unmount } = render(<RemovePackDialog packId="collection-site" open onOpenChange={() => {}} onRemoved={() => {}} />);
    await screen.findByTestId('remove-pack-forms');
    expect(screen.queryByTestId('remove-pack-forms-open')).toBeNull();
    unmount();
    (api.getPackRemoval as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...removal, formsKept: [] });
    render(<RemovePackDialog packId="collection-site" open onOpenChange={() => {}} onRemoved={() => {}} />);
    await screen.findByTestId('remove-pack-forms');
    expect(screen.queryByTestId('remove-pack-forms-open')).toBeNull();
  });

  it('disables confirm and names the users when someone still holds a role', async () => {
    (api.getPackRemoval as ReturnType<typeof vi.fn>).mockResolvedValue({ ...removal, holders: [{ role: 'Sample Clerk', users: ['amina', 'joseph'] }] });
    render(<RemovePackDialog packId="collection-site" open onOpenChange={() => {}} onRemoved={() => {}} />);
    const holders = await screen.findByTestId('remove-pack-holders');
    expect(holders.textContent).toContain('Sample Clerk');
    expect(holders.textContent).toContain('amina, joseph');
    expect(screen.getByTestId('remove-pack-confirm')).toBeDisabled();
  });

  it('Remove sends the pack id and reports back', async () => {
    const onRemoved = vi.fn();
    render(<RemovePackDialog packId="collection-site" open onOpenChange={() => {}} onRemoved={onRemoved} />);
    await screen.findByTestId('remove-pack-roles');
    fireEvent.click(screen.getByTestId('remove-pack-confirm'));
    await waitFor(() => expect(api.removePack).toHaveBeenCalledWith('collection-site'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it('a refusal shows the holders the server names, keeps the prompt open, and removes nothing', async () => {
    (api.removePack as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'held', holders: [{ role: 'Sample Clerk', users: ['amina'] }] });
    const onRemoved = vi.fn();
    const onOpenChange = vi.fn();
    render(<RemovePackDialog packId="collection-site" open onOpenChange={onOpenChange} onRemoved={onRemoved} />);
    await screen.findByTestId('remove-pack-roles');
    fireEvent.click(screen.getByTestId('remove-pack-confirm'));
    expect((await screen.findByTestId('remove-pack-holders')).textContent).toContain('amina');
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId('remove-pack-confirm')).toBeDisabled();
  });
});
