import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { ShareSheet } from './ShareSheet';
import * as api from '../api';

// Who a dashboard is shared with (design 2026-11-18-roles-scope, part 2).
const CHOICES = [{ id: 'r-district', slug: 'district', name: 'District' }, { id: 'r-region', slug: 'region', name: 'Region' }];

async function openSheet(roles: string[], mayShare = true) {
  vi.spyOn(api, 'getDashboardShare').mockResolvedValue({ roles, choices: CHOICES, mayShare });
  render(<ShareSheet dashboardId="d1" open onOpenChange={() => {}} />);
  await screen.findByTestId('dashboard-share-roles');
}

function pressSave() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Share actions' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
}

describe('ShareSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('shows the roles by name, label on the left', async () => {
    await openSheet(['r-district']);
    expect(within(screen.getByTestId('dashboard-share-roles')).getByText('District')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-share-grid').className).toContain('grid-cols-[auto_minmax(0,1fr)]');
  });

  it('says everyone with the permission sees an unshared dashboard', async () => {
    await openSheet([]);
    expect(within(screen.getByTestId('dashboard-share-roles')).getByText('Everyone with the permission')).toBeInTheDocument();
  });

  it('saves the list from the sheet menu', async () => {
    const save = vi.spyOn(api, 'setDashboardShare').mockResolvedValue({ roles: [] });
    await openSheet(['r-district']);
    fireEvent.click(within(screen.getByTestId('dashboard-share-roles')).getByRole('button', { name: 'Remove District' }));
    pressSave();
    await waitFor(() => expect(save).toHaveBeenCalledWith('d1', []));
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows the list without a way to change it to someone who may not share', async () => {
    await openSheet(['r-district'], false);
    expect(screen.queryByRole('button', { name: 'Share actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove District' })).toBeNull();
  });
});
