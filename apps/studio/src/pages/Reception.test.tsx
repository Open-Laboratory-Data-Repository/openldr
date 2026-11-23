import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const caps = vi.hoisted(() => ({ set: new Set<string>(['lab.receive']) }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me', username: 'desk', displayName: null, roles: ['reception'] },
    loading: false,
    hasCapability: (c: string) => caps.set.has(c),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    findReceptionOrders: vi.fn(),
    correctReceptionOrder: vi.fn(),
    cancelReceptionOrder: vi.fn(),
    registerReceptionPatient: vi.fn(),
    searchReceptionPatients: vi.fn(async () => []),
    searchReceptionFacilities: vi.fn(async () => []),
    searchReceptionTests: vi.fn(async () => []),
    receptionSampleChoices: vi.fn(async () => []),
    expandValueSetByUrl: vi.fn(async (url: string) => (url.endsWith('administrative-gender')
      ? [{ system: 'urn:test:gender', code: 'g1', display: 'Gender one' }]
      : [])),
    // AppShell's notification bell and plugin menu call these on mount (see Notifications.test.tsx).
    listNotifications: vi.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
    listPluginUis: vi.fn(async () => []),
  };
});

import userEvent from '@testing-library/user-event';
import * as api from '@/api';
import { toast } from 'sonner';
import { visibleNav } from '@/shell/AppShell';
import { Reception } from './Reception';

const ORDER: api.ReceptionOrder = {
  requisition: 'REQ-1',
  facility: { code: 'F1', display: 'Facility one' },
  origin: 'form',
  patient: null,
  priority: null,
  clinician: null,
  note: null,
  tests: [{ serviceRequestId: 'sr1', system: 'urn:test:catalog', code: 'T1', display: 'Test one', status: 'active' }],
  specimens: [],
};

function renderPage() {
  return render(<MemoryRouter><Reception /></MemoryRouter>);
}

// Radix menus open on pointerDown in jsdom, with Enter as the fallback (as in Connectors.test.tsx).
function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

// The search settles inside act, so its state updates land before the next step.
async function search(value: string) {
  const box = screen.getByTestId('reception-scan');
  fireEvent.change(box, { target: { value } });
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
}

beforeEach(() => {
  vi.clearAllMocks();
  caps.set = new Set(['lab.receive']);
});

describe('Reception', () => {
  it('focuses the scan box on load and shows the empty state before a search', async () => {
    renderPage();
    await waitFor(() => expect(api.listPluginUis).toHaveBeenCalled());
    expect(screen.getByTestId('reception-scan')).toHaveFocus();
    expect(screen.getByText(/scan or type a requisition number/i)).toBeInTheDocument();
  });

  it('searches when Enter is pressed and shows the found order', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([ORDER]);
    renderPage();
    await search(' REQ-1 ');
    expect(api.findReceptionOrders).toHaveBeenCalledWith('REQ-1');
    expect(await screen.findByTestId('order-panel-F1|REQ-1')).toBeInTheDocument();
    expect(screen.getByText('Facility one')).toBeInTheDocument();
    expect(screen.getByText('Test one')).toBeInTheDocument();
    // The request status shows by its name, not its code.
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('lets the next scan replace the number just searched', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([ORDER]);
    const user = userEvent.setup();
    renderPage();
    await search('REQ-1');
    await screen.findByTestId('order-panel-F1|REQ-1');
    const box = screen.getByTestId('reception-scan') as HTMLInputElement;
    expect(box).toHaveFocus();
    // A scanner types into the focused box and presses Enter, with no click first.
    await user.keyboard('REQ-2{Enter}');
    expect(box).toHaveValue('REQ-2');
    await waitFor(() => expect(api.findReceptionOrders).toHaveBeenLastCalledWith('REQ-2'));
  });

  it('puts focus back in the scan box when a sheet closes', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([ORDER]);
    renderPage();
    await search('REQ-1');
    await screen.findByTestId('order-panel-F1|REQ-1');
    openMenu('order-actions-F1|REQ-1');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Correct order' }));
    await screen.findByRole('dialog');
    openMenu('correct-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('reception-scan')).toHaveFocus());
  });

  it('keeps a failed search an error, with no not-found state and no Register', async () => {
    vi.mocked(api.findReceptionOrders).mockRejectedValue(new Error('find order failed: 500'));
    renderPage();
    await search('REQ-1');
    expect(toast.error).toHaveBeenCalledWith('find order failed: 500');
    expect(screen.queryByText(/no order REQ-1/i)).toBeNull();
    openMenu('reception-menu');
    await screen.findByRole('menuitem', { name: 'Search' });
    expect(screen.queryByRole('menuitem', { name: /register this order/i })).toBeNull();
  });

  it('offers Register this order in the page menu when nothing is found', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([]);
    renderPage();
    await search('REQ-404');
    expect(await screen.findByText(/no order REQ-404/i)).toBeInTheDocument();
    openMenu('reception-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: /register this order/i }));
    // The scan box carries the same label, so read the sheet's own field.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Requisition number')).toHaveValue('REQ-404');
  });

  it('keeps every action in a menu, with no standalone action button', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([ORDER]);
    renderPage();
    await search('REQ-1');
    await screen.findByTestId('order-panel-F1|REQ-1');
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.filter((n) => /register|receive|correct|link|search|save/i.test(n))).toEqual([]);
    openMenu('order-actions-F1|REQ-1');
    const items = (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
    expect(items).toEqual(['Receive sample', 'Link patient', 'Correct order']);
  });

  it('offers Cancel registration for a desk order only, and shows the cancelled tests after', async () => {
    const desk: api.ReceptionOrder = { ...ORDER, origin: 'lab-desk' };
    vi.mocked(api.findReceptionOrders).mockResolvedValue([desk]);
    vi.mocked(api.cancelReceptionOrder).mockResolvedValue({ ...desk, tests: [{ ...desk.tests[0]!, status: 'entered-in-error' }] });
    renderPage();
    await search('REQ-1');
    await screen.findByTestId('order-panel-F1|REQ-1');
    openMenu('order-actions-F1|REQ-1');
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent))
      .toEqual(['Receive sample', 'Link patient', 'Correct order', 'Cancel registration']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel registration' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Wrong test list' } });
    openMenu('cancel-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cancel registration' }));
    await waitFor(() => expect(api.cancelReceptionOrder).toHaveBeenCalledWith({ requisition: 'REQ-1', facilityCode: 'F1', reason: 'Wrong test list' }));
    expect(await screen.findByText('Entered in error')).toBeInTheDocument();
  });

  it('points a desk order\'s Correct order sheet to Cancel registration', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([{ ...ORDER, origin: 'lab-desk' }]);
    renderPage();
    await search('REQ-1');
    await screen.findByTestId('order-panel-F1|REQ-1');
    openMenu('order-actions-F1|REQ-1');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Correct order' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/use Cancel registration in the order menu/)).toBeInTheDocument();
  });

  it('links a patient registered in the patient sheet without a second search', async () => {
    vi.mocked(api.findReceptionOrders).mockResolvedValue([ORDER]);
    vi.mocked(api.registerReceptionPatient).mockResolvedValue({ id: 'p1', display: 'Ann Banda' });
    vi.mocked(api.correctReceptionOrder).mockResolvedValue({ ...ORDER, patient: { id: 'p1', display: 'Ann Banda' } });
    renderPage();
    await search('REQ-1');
    await screen.findByTestId('order-panel-F1|REQ-1');
    openMenu('order-actions-F1|REQ-1');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link patient' }));

    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Banda' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sex' })).not.toBeDisabled());
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sex' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Gender one' }));
    fireEvent.change(screen.getByLabelText('Age in years'), { target: { value: '30' } });
    openMenu('patient-sheet-menu');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Register patient' }));

    await waitFor(() => expect(api.correctReceptionOrder).toHaveBeenCalled());
    expect(api.registerReceptionPatient).toHaveBeenCalledWith({ given: 'Ann', family: 'Banda', gender: 'g1', ageYears: 30 });
    expect(vi.mocked(api.correctReceptionOrder).mock.calls[0]![0]).toMatchObject({
      requisition: 'REQ-1', facilityCode: 'F1', changes: { patientId: 'p1' },
    });
    expect(api.searchReceptionPatients).not.toHaveBeenCalled();
    expect(await screen.findByText('Ann Banda')).toBeInTheDocument();
  });
});

describe('Reception in the sidebar', () => {
  it('shows only to a user who holds lab.receive', () => {
    const pages = (held: string[]) => visibleNav((c) => held.includes(c), null).map((n) => n.to);
    expect(pages(['patients.view'])).not.toContain('/reception');
    expect(pages(['lab.receive'])).toContain('/reception');
  });
});
