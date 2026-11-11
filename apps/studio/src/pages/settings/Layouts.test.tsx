import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1', roles: [] }, hasCapability: () => true }) }));
vi.mock('@/api', async (orig) => ({
  ...(await orig<typeof import('@/api')>()),
  listLayouts: vi.fn(), saveLayout: vi.fn(), deleteLayout: vi.fn(), listRoles: vi.fn(),
}));
import * as api from '@/api';
import { Layouts } from './Layouts';

const bench = { id: 'l1', name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['tech'] };
const roles = [
  { id: 'r1', slug: 'tech', name: 'Lab technician', description: null, isSystem: true, locked: false },
  { id: 'r2', slug: 'analyst', name: 'Analyst', description: null, isSystem: false, locked: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listRoles).mockResolvedValue(roles as never);
});

const page = () => render(<MemoryRouter><Layouts /></MemoryRouter>);
async function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

describe('Settings, Layouts', () => {
  it('lists layouts with their pages, start page and roles, with pagination', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [bench], roleOrder: ['tech'] });
    page();
    const row = (await screen.findByText('Bench')).closest('tr')!;
    expect(within(row).getByText('2')).toBeTruthy();
    expect(within(row).getByText('Forms')).toBeTruthy();
    expect(within(row).getByText('Lab technician')).toBeTruthy();
    expect(screen.getByLabelText('Next page')).toBeTruthy();
  });

  it('shows the striped empty state when there are no layouts', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [], roleOrder: [] });
    page();
    expect(await screen.findByTestId('layouts-empty')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('creates a layout from the header menu, through the sheet', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [], roleOrder: [] });
    vi.mocked(api.saveLayout).mockResolvedValue({ ...bench, id: 'new' });
    page();
    await openMenu(await screen.findByTestId('layouts-menu'));
    fireEvent.click(await screen.findByTestId('layouts-new'));
    fireEvent.change(await screen.findByTestId('layout-name'), { target: { value: 'Bench' } });
    fireEvent.click(screen.getByTestId('layout-page-/forms'));
    fireEvent.click(screen.getByTestId('layout-page-/patients'));
    fireEvent.click(await screen.findByTestId('layout-role-tech'));
    await openMenu(screen.getByTestId('layout-sheet-menu'));
    fireEvent.click(await screen.findByTestId('layout-save'));
    await waitFor(() => expect(api.saveLayout).toHaveBeenCalledWith(null, { name: 'Bench', startPage: null, pages: ['/patients', '/forms'], roles: ['tech'] }));
    expect(api.listLayouts).toHaveBeenCalledTimes(3); // page load, store refresh, page reload
  });

  it('edits a layout from its row menu, starting from what is saved', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [bench], roleOrder: ['tech'] });
    vi.mocked(api.saveLayout).mockResolvedValue(bench);
    page();
    await openMenu(await screen.findByLabelText('Actions for Bench'));
    fireEvent.click(await screen.findByTestId('layout-edit'));
    expect((await screen.findByTestId('layout-name') as HTMLInputElement).value).toBe('Bench');
    expect(screen.getByTestId('layout-page-/forms').getAttribute('data-state')).toBe('checked');
    await openMenu(screen.getByTestId('layout-sheet-menu'));
    fireEvent.click(await screen.findByTestId('layout-save'));
    await waitFor(() => expect(api.saveLayout).toHaveBeenCalledWith('l1', { name: 'Bench', startPage: '/forms', pages: ['/patients', '/forms'], roles: ['tech'] }));
  });

  it('does not save a layout with no name or no pages', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [], roleOrder: [] });
    page();
    await openMenu(await screen.findByTestId('layouts-menu'));
    fireEvent.click(await screen.findByTestId('layouts-new'));
    await openMenu(await screen.findByTestId('layout-sheet-menu'));
    fireEvent.click(await screen.findByTestId('layout-save'));
    expect(await screen.findByTestId('layout-error')).toBeTruthy();
    expect(api.saveLayout).not.toHaveBeenCalled();
  });

  it('asks before deleting, then deletes', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue({ layouts: [bench], roleOrder: ['tech'] });
    vi.mocked(api.deleteLayout).mockResolvedValue(undefined);
    page();
    await openMenu(await screen.findByLabelText('Actions for Bench'));
    fireEvent.click(await screen.findByTestId('layout-delete'));
    expect(api.deleteLayout).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete layout' }));
    await waitFor(() => expect(api.deleteLayout).toHaveBeenCalledWith('l1'));
  });
});
