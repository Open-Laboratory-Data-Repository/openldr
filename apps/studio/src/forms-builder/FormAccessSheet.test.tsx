import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { FormAccessSheet } from './FormAccessSheet';
import * as api from '../api';

// Who may open and submit a form (design 2026-11-18-roles-scope, part 1).
function role(id: string, name: string) {
  return { id, slug: id, name, description: null, isSystem: false, locked: false, capabilities: [], memberCount: 0 };
}
const ROLES = [role('r-nurse', 'Nurse'), role('r-clerk', 'Clerk'), role('r-tech', 'Lab technician')];

async function openSheet(access: { open: string[]; submit: string[] }) {
  vi.spyOn(api, 'listRoles').mockResolvedValue(ROLES);
  vi.spyOn(api, 'getFormAccess').mockResolvedValue(access);
  render(<FormAccessSheet formId="form-1" open onOpenChange={() => {}} />);
  await screen.findByTestId('form-access-open');
}

function pressSave() {
  const trigger = screen.getByRole('button', { name: 'Access actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
}

describe('FormAccessSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('shows the two lists by role name, label on the left, and says when a list is empty', async () => {
    await openSheet({ open: ['r-nurse'], submit: [] });
    expect(screen.getByText('Who may open')).toBeInTheDocument();
    expect(screen.getByText('Who may submit')).toBeInTheDocument();
    expect(within(screen.getByTestId('form-access-open')).getByText('Nurse')).toBeInTheDocument();
    // An empty list is everyone with the permission, and the sheet says so.
    expect(within(screen.getByTestId('form-access-submit')).getByText('Everyone with the permission')).toBeInTheDocument();
    expect(within(screen.getByTestId('form-access-open')).queryByText('Everyone with the permission')).toBeNull();
    expect(screen.getByTestId('form-access-grid').className).toContain('grid-cols-[auto_minmax(0,1fr)]');
  });

  it('saves both lists from the sheet menu', async () => {
    const save = vi.spyOn(api, 'setFormAccess').mockResolvedValue({ open: [], submit: ['r-clerk'] });
    await openSheet({ open: ['r-nurse'], submit: ['r-clerk'] });
    fireEvent.click(within(screen.getByTestId('form-access-open')).getByRole('button', { name: 'Remove Nurse' }));
    pressSave();
    await waitFor(() => expect(save).toHaveBeenCalledWith('form-1', { open: [], submit: ['r-clerk'] }));
    expect(toast.success).toHaveBeenCalled();
  });

  it('keeps a role id it cannot name, so saving does not drop it', async () => {
    const save = vi.spyOn(api, 'setFormAccess').mockResolvedValue({ open: ['r-gone'], submit: [] });
    await openSheet({ open: ['r-gone'], submit: [] });
    pressSave();
    await waitFor(() => expect(save).toHaveBeenCalledWith('form-1', { open: ['r-gone'], submit: [] }));
  });

  it('reports a failed save and keeps the sheet open', async () => {
    vi.spyOn(api, 'setFormAccess').mockRejectedValue(new Error('no role r-x'));
    await openSheet({ open: [], submit: [] });
    pressSave();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId('form-access-open')).toBeInTheDocument();
  });
});
