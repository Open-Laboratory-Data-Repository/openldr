import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

let mockCanManage = true;
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: (cap: string) => (cap === 'roles.manage' ? mockCanManage : true) }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listRoles: vi.fn(), deleteRole: vi.fn(), getRoleCatalog: vi.fn(), createRole: vi.fn(), updateRole: vi.fn() };
});

import * as api from '@/api';
import type { RoleRecord } from '@/api';
import { toast } from 'sonner';
import { Roles } from './Roles';

const roles: RoleRecord[] = [
  { id: 'admin', slug: 'lab_admin', name: 'Administrator', description: 'Full access to every capability.', isSystem: true, locked: true, capabilities: ['users.manage'], memberCount: 1 },
  { id: 'r2', slug: 'lab_technician', name: 'Lab Technician', description: 'Day-to-day lab operations.', isSystem: true, locked: false, capabilities: ['users.view'], memberCount: 5 },
  { id: 'r3', slug: 'reviewer', name: 'Reviewer', description: 'Custom role for external reviewers.', isSystem: false, locked: false, capabilities: [], memberCount: 0 },
];

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

// "Create role" now lives behind the page header's ⋯ menu (consistency pass — mirrors
// Connectors' openAddConnector helper).
async function openCreateRole() {
  openDropdown(await screen.findByTestId('roles-menu-trigger'));
  fireEvent.click(await screen.findByTestId('create-role'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanManage = true;
  (api.listRoles as ReturnType<typeof vi.fn>).mockResolvedValue(roles);
  (api.getRoleCatalog as ReturnType<typeof vi.fn>).mockResolvedValue({ groups: [] });
});

describe('Roles page', () => {
  it('lists roles with name, description, member count, and a System badge', async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    expect(await screen.findByText('Administrator')).toBeTruthy();
    expect(screen.getByText('Full access to every capability.')).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText(/1 members/)).toBeTruthy();

    const adminRow = screen.getByText('Administrator').closest('tr')!;
    expect(within(adminRow).getByText('System')).toBeTruthy();
    expect(within(adminRow).getByText('Locked')).toBeTruthy();

    const reviewerRow = screen.getByText('Reviewer').closest('tr')!;
    expect(within(reviewerRow).queryByText('System')).toBeNull();
  });

  it("locked role's delete is disabled", async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');

    const trigger = screen.getByTestId('role-actions-admin');
    openDropdown(trigger);

    const deleteItem = await screen.findByTestId('role-delete-admin');
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
  });

  it("system (non-locked) role's delete is also disabled", async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Lab Technician');

    openDropdown(screen.getByTestId('role-actions-r2'));
    const deleteItem = await screen.findByTestId('role-delete-r2');
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
  });

  it('custom role can be deleted, after a confirm dialog', async () => {
    (api.deleteRole as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Reviewer');

    openDropdown(screen.getByTestId('role-actions-r3'));
    fireEvent.click(await screen.findByTestId('role-delete-r3'));

    const confirmBtn = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(api.deleteRole).toHaveBeenCalledWith('r3'));
    expect(screen.queryByText('Reviewer')).toBeNull();
  });

  it('"Create role" is shown (behind the header ⋯ menu) when the user has roles.manage', async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');
    openDropdown(await screen.findByTestId('roles-menu-trigger'));
    expect(await screen.findByTestId('create-role')).toBeTruthy();
  });

  it('the header ⋯ menu (and "Create role" within it) and the row actions kebab are hidden without roles.manage', async () => {
    mockCanManage = false;
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');
    expect(screen.queryByTestId('roles-menu-trigger')).toBeNull();
    expect(screen.queryByTestId('create-role')).toBeNull();
    expect(screen.queryByTestId('role-actions-admin')).toBeNull();
    expect(screen.queryByTestId('role-actions-r3')).toBeNull();
  });

  it('shows an empty state with no roles', async () => {
    (api.listRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<MemoryRouter><Roles /></MemoryRouter>);
    expect(await screen.findByText(/no roles yet/i)).toBeTruthy();
  });

  it('surfaces a load failure via toast', async () => {
    (api.listRoles as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('opening the create sheet and saving calls createRole with the entered name', async () => {
    (api.createRole as ReturnType<typeof vi.fn>).mockResolvedValue({ ...roles[2], id: 'r4', name: 'New Role' });
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');

    await openCreateRole();
    fireEvent.change(await screen.findByTestId('role-name'), { target: { value: 'New Role' } });

    // RoleSheet's Save lives in its own ⋯ (Actions) menu, not a footer button.
    openDropdown(screen.getByTestId('role-actions-trigger'));
    fireEvent.click(await screen.findByTestId('role-save'));

    await waitFor(() => expect(api.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Role' })));
    expect(await screen.findByText('New Role')).toBeTruthy();
  });

  it('renders the standard table toolbar and filters rows by name', async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');            // wait for rows

    const search = screen.getByPlaceholderText(/search roles/i);
    fireEvent.change(search, { target: { value: 'zzz-no-such-role' } });
    expect(screen.queryByText('Administrator')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(await screen.findByText('Administrator')).toBeInTheDocument();
  });

  // ⛔ REGRESSION, reported 2026-08-21 from a phone: the table's horizontal scrollbar sat directly
  // under the last row with a band of dead background between it and the pagination.
  //
  // The Table had no `wrapperClassName`, so its built-in scroll wrapper kept the default
  // `relative w-full overflow-auto` and hugged its content height. The fill has to be on THAT
  // wrapper — `flex-1` on an ancestor moves the ancestor, not the scroller, and the scrollbar
  // belongs to the scroller. Same trap as Terminology's tables in the 2026-07-31 mobile pass.
  //
  // ⚠ The Table must also render only when there are rows. `LoadingState` is a SIBLING here, so an
  // always-filling wrapper would split the pane 50/50 with the loader on every load, and an empty
  // table's header still forces its own intrinsic width and scrolls sideways on a phone.
  //
  // ⚠ HONEST NON-PROOF: jsdom computes no layout. This pins the classes, not the pixels.
  it('fills the pane with the table scroller, so its scrollbar sits above the pagination', async () => {
    const { container } = render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');
    const wrapper = container.querySelector('table')?.parentElement;
    expect(wrapper?.className, 'the SCROLLER is what must fill').toMatch(/min-h-0/);
    expect(wrapper?.className).toMatch(/flex-1/);
    expect(wrapper?.className, 'and it is the thing that scrolls').toMatch(/overflow-auto/);
  });

  it('renders no table at all while loading, so the loader does not share the pane', async () => {
    (api.listRoles as any).mockReturnValue(new Promise(() => {}));
    const { container } = render(<MemoryRouter><Roles /></MemoryRouter>);
    expect(container.querySelector('table'), 'an empty header still forces intrinsic width').toBeNull();
  });

  it('adopts the standard table toolbar (filter/sort/columns + chips)', async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');

    await addFilterViaPopover('Reviewer');

    // The applied filter's value also renders in the ActiveFilterChips row, so a bare
    // `findByText('Reviewer')` matches both the chip and the table cell. Scope to the row.
    expect(await screen.findByTestId('role-row-r3')).toBeInTheDocument();
    expect(screen.queryByText('Administrator')).not.toBeInTheDocument();
    expectStandardTableToolbar();
  });
});
