import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ValueSetBuilder } from './ValueSetBuilder';
import * as api from '../api';
import type { ValueSet } from '../api';

const saved: ValueSet = {
  id: 'vs-custom',
  url: 'urn:openldr:vs:custom',
  version: null,
  name: null,
  title: 'Custom Set',
  status: 'draft',
  experimental: false,
  description: null,
  compose: { include: [{ concept: [] }] },
  immutable: false,
  category: null,
  publisherId: 'pub-local',
};

describe('ValueSetBuilder', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('saves a new value set and refreshes the expansion preview', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([{ id: 'pub-local', name: 'Local', role: 'local', icon: null, seeded: true, sortOrder: 0 }] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([]);
    vi.spyOn(api, 'saveValueSet').mockResolvedValue(saved);
    vi.spyOn(api, 'expandValueSet').mockResolvedValue({ codes: [{ system: 'urn:system', code: 'Y', display: 'Yes' }], total: 1 });
    const onSaved = vi.fn();

    render(<ValueSetBuilder valueSet={null} systems={[]} defaultPublisherId="pub-local" onSaved={onSaved} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('urn:openldr:valueset:my-set'), { target: { value: 'urn:openldr:vs:custom' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Custom Set' } });
    const actionsButton = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Save')) {
      fireEvent.keyDown(actionsButton, { key: 'Enter' });
    }
    const saveItem = await screen.findByText('Save');
    fireEvent.pointerMove(saveItem);
    fireEvent.click(saveItem);

    await waitFor(() => expect(api.saveValueSet).toHaveBeenCalledWith(expect.objectContaining({
      url: 'urn:openldr:vs:custom',
      title: 'Custom Set',
      publisherId: 'pub-local',
    })));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(api.expandValueSet).toHaveBeenCalledWith('vs-custom', true);
    expect(await screen.findByText('Yes')).toBeInTheDocument();
  });
});

describe('ValueSetBuilder live expansion', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('shows the live codes when the stored expansion is empty', async () => {
    // "This lab's tests" is worked out when read, so its stored expansion is empty, and the sheet
    // said "Expansion is empty" while forms offered 5 tests.
    vi.spyOn(api, 'listPublishers').mockResolvedValue([] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([]);
    vi.spyOn(api, 'expandValueSet').mockResolvedValue({ codes: [], total: 0 });
    const live = vi.spyOn(api, 'expandValueSetByUrl').mockResolvedValue([
      { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC', display: 'Full blood count' },
    ]);
    render(<ValueSetBuilder valueSet={{ ...saved, compose: { include: [] } }} systems={[]} defaultPublisherId="pub-local" onSaved={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText('Full blood count')).toBeInTheDocument();
    expect(live).toHaveBeenCalledWith('urn:openldr:vs:custom');
    expect(screen.queryByText('Expansion is empty.')).toBeNull();
  });
});

describe('ValueSetBuilder errors', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('a failed expansion shows one toast and the could-not-load text, not "Expansion is empty."', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([]);
    vi.spyOn(api, 'expandValueSet').mockRejectedValue(new Error('expand failed: 503'));
    render(<ValueSetBuilder valueSet={saved} systems={[]} defaultPublisherId="pub-local" onSaved={() => {}} onCancel={() => {}} />);

    expect(await screen.findByText('Could not load this list. Reload the page to try again.')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('expand failed: 503');
    expect(screen.queryByText('expand failed: 503')).not.toBeInTheDocument();
    expect(screen.queryByText('Expansion is empty.')).toBeNull();
  });

  it('a failed save shows a toast, not a box in the editor', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([]);
    vi.spyOn(api, 'saveValueSet').mockRejectedValue(new Error('save value set failed: url taken'));
    const onSaved = vi.fn();
    render(<ValueSetBuilder valueSet={null} systems={[]} defaultPublisherId="pub-local" onSaved={onSaved} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('urn:openldr:valueset:my-set'), { target: { value: 'urn:openldr:vs:custom' } });
    const actionsButton = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Save')) fireEvent.keyDown(actionsButton, { key: 'Enter' });
    const saveItem = await screen.findByText('Save');
    fireEvent.pointerMove(saveItem);
    fireEvent.click(saveItem);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('save value set failed: url taken'));
    expect(screen.queryByText('save value set failed: url taken')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('urn:openldr:valueset:my-set')).toHaveValue('urn:openldr:vs:custom');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('one outage gives one toast, when the publisher list and the expansion both fail', async () => {
    vi.spyOn(api, 'listValueSets').mockResolvedValue([]);
    vi.spyOn(api, 'listPublishers').mockRejectedValue(new Error('Failed to fetch'));
    vi.spyOn(api, 'expandValueSet').mockRejectedValue(new Error('Failed to fetch'));
    render(<ValueSetBuilder valueSet={saved} systems={[]} defaultPublisherId="pub-local" onSaved={() => {}} onCancel={() => {}} />);

    expect(await screen.findByText('Could not load this list. Reload the page to try again.')).toBeInTheDocument();
    await waitFor(() => expect(api.listPublishers).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
