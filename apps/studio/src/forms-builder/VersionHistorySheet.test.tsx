import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { VersionHistorySheet } from './VersionHistorySheet';
import * as api from '../api';

const NOW = '2026-01-01T00:00:00.000Z';

function version(v: number, label: string | null) {
  return {
    id: `fv-${v}`, formId: 'form-1', version: v, versionLabel: label,
    name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'],
    publishedAt: NOW, publishedBy: 'u1',
  };
}

describe('VersionHistorySheet', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('lists versions newest first', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([version(2, 'v2'), version(1, 'v1')]);

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);

    expect(await screen.findByText('v2')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('v2');
    expect(rows[1]).toHaveTextContent('v1');
  });

  it('confirms before restoring, then reports it', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([version(1, 'v1')]);
    const restore = vi.spyOn(api, 'restoreFormVersion').mockResolvedValue({
      id: 'form-1', name: 'Specimen intake', versionLabel: 'v1', fhirResourceType: null,
      status: 'draft', active: true, schema: { fields: [] }, targetPages: ['forms'],
      createdAt: NOW, updatedAt: NOW,
    });

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);
    expect(await screen.findByText('v1')).toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: /actions for version 1/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Restore')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Restore'));

    // Nothing is written until the confirm is answered.
    expect(restore).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith('form-1', 1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored version 1'));
  });

  it('a rejected restore surfaces the server message', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([version(1, 'v1')]);
    vi.spyOn(api, 'restoreFormVersion').mockRejectedValue(new Error('restore form version: forms.edit required'));

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);
    expect(await screen.findByText('v1')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /actions for version 1/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Restore')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Restore'));
    fireEvent.click(await screen.findByRole('button', { name: /^restore$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('restore form version: forms.edit required'),
    );
  });

  it('shows an empty state and no table header when the form has never been published', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);

    expect(await screen.findByText(/never been published/i)).toBeInTheDocument();
    // StripedEmpty renders its children, so assert on the copy, not on a title prop.
    // An empty table's header forces intrinsic width and scrolls sideways on a phone.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a failed fetch shows an error, not the never-published empty state', async () => {
    vi.spyOn(api, 'listFormVersions').mockRejectedValue(new Error('list form versions: network error'));

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);

    expect(await screen.findByText('list form versions: network error')).toBeInTheDocument();
    expect(screen.queryByText(/never been published/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('list form versions: network error'),
    );
  });

  it('changing the page size returns to the first page', async () => {
    const many = Array.from({ length: 15 }, (_, i) => version(15 - i, `v${15 - i}`));
    vi.spyOn(api, 'listFormVersions').mockResolvedValue(many);

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);
    expect(await screen.findByText('v15')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(await screen.findByText('v5')).toBeInTheDocument();
    expect(screen.queryByText('v15')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Rows per page'));
    fireEvent.click(await screen.findByText('25'));

    expect(await screen.findByText('v15')).toBeInTheDocument();
  });
});
