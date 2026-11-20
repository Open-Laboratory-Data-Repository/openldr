import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getRemovalPlan: vi.fn(), removePlugin: vi.fn() };
});
import * as api from '@/api';
import { RemovePluginSheet } from './RemovePluginSheet';

// Layer: what the Remove sheet shows and sends, in jsdom, over a mocked API. The server's stop and
// delete are proven in plugin-removal.test.ts and marketplace-routes.test.ts.

const plan = { running: [{ kind: 'copy' as const, id: 'cp1', label: 'c1', status: 'running' }, { kind: 'import' as const, id: 'im1', label: 'c2', status: 'running' }], copies: 2, copiedBytes: 21 * 1024 ** 3 };

beforeEach(() => {
  vi.clearAllMocks();
  (api.getRemovalPlan as ReturnType<typeof vi.fn>).mockResolvedValue(plan);
  (api.removePlugin as ReturnType<typeof vi.fn>).mockResolvedValue({ stopped: ['cp1'], deletedCopies: 0 });
});

async function openMenuAndRemove(): Promise<void> {
  const trigger = await screen.findByTestId('remove-plugin-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (screen.queryAllByRole('menuitem').length === 0) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByTestId('remove-plugin-confirm'));
}

describe('RemovePluginSheet', () => {
  it('lists what is running and says removing stops it', async () => {
    render(<RemovePluginSheet pluginId="cdr-source" open onOpenChange={() => {}} onRemoved={() => {}} />);
    const running = await screen.findByTestId('remove-running');
    expect(running.textContent).toContain('cp1');
    expect(running.textContent).toContain('Import im1 (running)');
    expect(running.textContent).toMatch(/Removing stops/);
  });

  it('offers three choices, keep everything first and chosen, with the copied size', async () => {
    render(<RemovePluginSheet pluginId="cdr-source" open onOpenChange={() => {}} onRemoved={() => {}} />);
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['all', 'settings', 'nothing']);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('remove-choice-all').textContent).toContain('21 GB');
    expect(screen.getByTestId('remove-saved-kept').textContent).toMatch(/never deleted/);
  });

  it('Remove sends the chosen keep and reports back', async () => {
    const onRemoved = vi.fn();
    render(<RemovePluginSheet pluginId="cdr-source" open onOpenChange={() => {}} onRemoved={onRemoved} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Keep settings/ }));
    await openMenuAndRemove();
    await waitFor(() => expect(api.removePlugin).toHaveBeenCalledWith('cdr-source', 'settings'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it('a read that will not stop: says which, removes nothing, and stays open', async () => {
    (api.removePlugin as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('still stopping'), { stillStopping: ['cp1'] }));
    const onRemoved = vi.fn();
    render(<RemovePluginSheet pluginId="cdr-source" open onOpenChange={() => {}} onRemoved={onRemoved} />);
    await screen.findAllByRole('radio');
    await openMenuAndRemove();
    expect((await screen.findByTestId('remove-still-stopping')).textContent).toContain('cp1');
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
