import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VersionsDrawer } from './VersionsDrawer';
import { listReportDesignVersions, getReportDesignVersion } from '../api';

vi.mock('../api', () => ({
  listReportDesignVersions: vi.fn(),
  getReportDesignVersion: vi.fn(),
}));

const versions = [
  { version: 2, name: 'Second', publishedAt: '2026-08-20T10:00:00Z', publishedBy: 'ana' },
  { version: 1, name: 'First', publishedAt: '2026-08-01T10:00:00Z', publishedBy: null },
];

describe('VersionsDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists published versions newest first, with an em dash for an unknown publisher', async () => {
    vi.mocked(listReportDesignVersions).mockResolvedValue(versions);
    render(<VersionsDrawer open designId="d1" onClose={vi.fn()} onRestore={vi.fn()} />);
    await screen.findByText('ana');
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('—');
  });

  it('restore fetches the snapshot and hands it up rather than writing to the server', async () => {
    const snapshot = { id: 'd1', name: 'First', paper: 'A4', orientation: 'portrait', status: 'published', parameters: [], pages: [] };
    vi.mocked(listReportDesignVersions).mockResolvedValue(versions);
    vi.mocked(getReportDesignVersion).mockResolvedValue(snapshot as never);
    const onRestore = vi.fn();
    const onClose = vi.fn();
    render(<VersionsDrawer open designId="d1" onClose={onClose} onRestore={onRestore} />);
    fireEvent.click(await screen.findByLabelText('Restore version 1'));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(snapshot, 1));
    expect(getReportDesignVersion).toHaveBeenCalledWith('d1', 1);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the empty state when nothing has been published', async () => {
    vi.mocked(listReportDesignVersions).mockResolvedValue([]);
    render(<VersionsDrawer open designId="d1" onClose={vi.fn()} onRestore={vi.fn()} />);
    expect(await screen.findByText(/No versions yet/i)).toBeInTheDocument();
  });
});
