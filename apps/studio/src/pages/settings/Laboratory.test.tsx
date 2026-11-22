import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
import { toast } from 'sonner';
// The capabilities the signed-in account holds. Every test starts with all of them.
const auth = vi.hoisted(() => ({ lacking: new Set<string>() }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: (c: string) => !auth.lacking.has(c) }),
}));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchLabIdentity: vi.fn(),
    saveLabIdentity: vi.fn(),
    listFacilityImportSources: vi.fn(),
    setAllowSelfAuthorise: vi.fn(),
    fetchAllowSelfAuthorise: vi.fn(),
    listLabSections: vi.fn(),
    addLabSection: vi.fn(),
    removeLabSection: vi.fn(),
  };
});
import * as api from '@/api';
import { Laboratory } from './Laboratory';
import { SUB_NAV } from './settingsNav';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

/** What GET /api/settings/lab actually returns: the field list, the values, and the logo limits. */
const META = {
  fields: [
    { id: 'lab.name', labelKey: 'settings.laboratory.name', multiline: false },
    { id: 'lab.address', labelKey: 'settings.laboratory.address', multiline: true },
    { id: 'lab.contact', labelKey: 'settings.laboratory.contact', multiline: false },
    { id: 'lab.timezone', labelKey: 'settings.laboratory.timezone', multiline: false },
    { id: 'lab.logo', labelKey: 'settings.laboratory.logo', multiline: false },
  ],
  values: { 'lab.name': 'OpenLDR', 'lab.address': 'PO Box xxxx', 'lab.contact': 'support@example.org', 'lab.logo': LOGO },
  logo: { maxBytes: 512 * 1024, mimeTypes: ['image/png', 'image/jpeg'] },
  allowSelfAuthorise: false,
};

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(api.fetchLabIdentity).mockResolvedValue(META as never);
  vi.mocked(api.listFacilityImportSources).mockResolvedValue([] as never);
  vi.mocked(api.saveLabIdentity).mockClear();
  vi.mocked(api.listLabSections).mockReset().mockResolvedValue([]);
  vi.mocked(api.setAllowSelfAuthorise).mockReset();
  vi.mocked(api.fetchAllowSelfAuthorise).mockReset().mockResolvedValue({ value: false });
  vi.mocked(api.addLabSection).mockReset();
  vi.mocked(api.removeLabSection).mockReset();
  auth.lacking.clear();
});

/** AGENTS.md section 5: page actions live in a ⋯ dropdown, never a standalone button. Radix opens
 *  its menu on pointerdown, not click, so fireEvent.click alone never opens it. */
async function save(): Promise<void> {
  const trigger = screen.getByRole('button', { name: /^(actions|aktionen|ações)$/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByText(/^(save|enregistrer|salvar)$/i));
}

describe('Settings → Laboratory', () => {
  it('renders the stored identity, logo included', async () => {
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    expect(await screen.findByDisplayValue('OpenLDR')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', LOGO);
  });

  // ⛔ THE reported defect, 2026-08-21: saving threw "Cannot read properties of undefined (reading
  // 'lab.logo')" into the error boundary while the save itself SUCCEEDED, so the operator saw a
  // crash page over a write that had already landed.
  //
  // PUT /api/settings/lab answers with the values map BARE (`return after`, settings-routes.ts),
  // where GET wraps it as `{ fields, values, logo }`. The client declared the PUT response as
  // `{ values }` and did `setValues(r.values)`, which is `undefined` for that body. Nothing caught
  // it: `okJson<T>` casts, so the lie type-checks, and this page had no test at all.
  //
  // ⚠ The mock returns the BARE map on purpose. Wrapping it here would make this pass against the
  // very shape the server does not send.
  it('survives a save, because the PUT answers with the values map itself', async () => {
    vi.mocked(api.saveLabIdentity).mockResolvedValue({
      'lab.name': 'OpenLDR', 'lab.address': 'PO Box xxxx', 'lab.contact': 'support@example.org', 'lab.logo': LOGO,
    } as never);

    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    await save();

    await waitFor(() => expect(api.saveLabIdentity).toHaveBeenCalled());
    // The page is still standing, still holding the identity, and the logo did not vanish.
    expect(await screen.findByDisplayValue('OpenLDR')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', LOGO);
  });

  it('sends every declared field, filling an absent one with an empty string', async () => {
    // The patch is built from the SERVER's field list, so a field the operator never touched is
    // still sent. Without that, clearing a value by emptying it would be indistinguishable from
    // leaving it alone.
    vi.mocked(api.saveLabIdentity).mockResolvedValue(META.values as never);
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    await save();

    await waitFor(() => expect(api.saveLabIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ 'lab.name': 'OpenLDR', 'lab.timezone': '' }),
    ));
  });

  // ⛔ Transient feedback is a TOAST, matching Connectors and DataExposure. It used to be a line of
  // grey text at the foot of the form, below the fold on a short window, which is what the operator
  // was looking at when they asked for a toast instead.
  it('toasts on a successful save rather than printing a line under the form', async () => {
    vi.mocked(api.saveLabIdentity).mockResolvedValue(META.values as never);
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    await save();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByText(/^saved\.$/i), 'the inline Saved. line is gone').not.toBeInTheDocument();
  });

  // ⛔ REGRESSION, reported 2026-08-21 from a phone: Settings ▸ Laboratory would not scroll, so the
  // Logo row sat half off the bottom edge and could not be reached.
  //
  // SettingsShell's outlet is deliberately `overflow-hidden` (SettingsShell.tsx) because a scroller
  // there plus one on the page gave two nested scrollers — the Distributed-sync defect. The contract
  // that pays for it is that EVERY settings page owns its own scroll region. This one never did:
  // its root was a bare `flex flex-col gap-4 p-4`, so it neither scrolled nor joined the flex height
  // chain, and the outlet just clipped it. Measured on a real Chromium at 360x640 before the fix:
  // outlet scrollHeight 569 vs clientHeight 539, with zero scrollable elements anywhere on the page.
  //
  // ⚠ HONEST NON-PROOF: jsdom has no layout engine, so this asserts the CLASSES, not that a pixel
  // ever scrolled. Only the browser probe above measures the real thing.
  it('owns a scroll region, because the settings outlet clips instead of scrolling', async () => {
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    const root = screen.getByTestId('laboratory-page');
    expect(root.className, 'must scroll its own body').toMatch(/overflow-y-auto/);
    // Without these the page cannot shrink to the outlet, so it overflows instead of scrolling.
    expect(root.className, 'must join the flex height chain').toMatch(/min-h-0/);
    expect(root.className, 'must fill the outlet').toMatch(/flex-1/);
  });

  // ⛔ REGRESSION, same 2026-08-21 phone report as above: the form ran off the RIGHT edge too, so
  // the Facility register value and the Choose file button were cut in half with no horizontal
  // scroller to reach them.
  //
  // The grid was `grid-cols-[10rem_1fr]`. A bare `1fr` is `minmax(auto,1fr)`, and that auto floor is
  // the control's own min-content — Input, Textarea and SelectTrigger all refuse to go under ~236px.
  // 10rem label + 236px control + p-4 pinned the form at a 428px intrinsic width. Measured on a real
  // Chromium at 360x640 before the fix: scrollWidth 428 vs clientWidth 360, 15 elements past the
  // right padding. After: 360 vs 360, zero. Also checked at 320x568 and 375x812.
  //
  // ⚠ HONEST NON-PROOF: jsdom has no layout engine and computes no grid tracks, so this asserts the
  // CLASSES only. It cannot fail if someone reintroduces the overflow some other way.
  it('lets the form controls shrink, so the grid does not force a width no phone has', async () => {
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    const grid = screen.getByTestId('laboratory-page').querySelector('.grid');
    // `minmax(0,...)` is the whole fix. `1fr` alone reintroduces the 428px floor.
    expect(grid?.className, 'control column must be allowed to shrink to 0').toMatch(/minmax\(0,1fr\)/);
    // AGENTS.md section 5 shape: label left, control right, label column sized to the label.
    expect(grid?.className).toMatch(/grid-cols-\[auto_/);

    // The logo row is three fixed-width things that together outrun the column on a 320px phone.
    const logoRow = screen.getByRole('img').parentElement;
    expect(logoRow?.className, 'logo row must wrap rather than push past the padding').toMatch(/flex-wrap/);
  });

  it('toasts the failure and keeps the page usable when the write fails', async () => {
    vi.mocked(api.saveLabIdentity).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    await save();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Still standing, still holding what the operator typed.
    expect(screen.getByDisplayValue('OpenLDR')).toBeInTheDocument();
  });
});

/** Open a ⋯ menu by its accessible name and pick an item. Radix opens on pointerdown. */
async function pick(menu: RegExp | string, item: RegExp): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: menu }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

const SELF = /^allow a person to authorise results they entered$/i;

describe('Settings → Laboratory: lab-wide settings', () => {
  it('shows the stored self-authorisation switch and saves a change at once, with a toast', async () => {
    vi.mocked(api.fetchAllowSelfAuthorise).mockResolvedValue({ value: true });
    vi.mocked(api.setAllowSelfAuthorise).mockResolvedValue({ value: false });
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    const sw = await screen.findByRole('switch', { name: SELF });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(api.setAllowSelfAuthorise).toHaveBeenCalledWith(false));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(api.saveLabIdentity).not.toHaveBeenCalled();
  });

  it('puts the switch back and toasts the error when the save is refused', async () => {
    vi.mocked(api.setAllowSelfAuthorise).mockRejectedValue(new Error('save self-authorisation failed: insufficient capability'));
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    const sw = await screen.findByRole('switch', { name: SELF });
    fireEvent.click(sw);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('insufficient capability')));
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('without lab.settings: the switch is read-only, and no section list or Add section is offered', async () => {
    auth.lacking.add('lab.settings');
    vi.mocked(api.fetchLabIdentity).mockResolvedValue({ ...META, allowSelfAuthorise: true } as never);
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    const sw = await screen.findByRole('switch', { name: SELF });
    expect(sw).toBeDisabled();
    // Read from the letterhead GET, since this account cannot call the lab.settings route.
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(api.fetchAllowSelfAuthorise).not.toHaveBeenCalled();
    expect(screen.queryByTestId('lab-sections')).not.toBeInTheDocument();
    expect(api.listLabSections).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: /^actions$/i }), { button: 0, ctrlKey: false });
    await screen.findByRole('menuitem', { name: /^save$/i });
    expect(screen.queryByRole('menuitem', { name: /^add section$/i })).not.toBeInTheDocument();
  });

  it('shows the striped empty state and pagination when the lab has no sections', async () => {
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    expect(await screen.findByText('No sections yet. Add one from the actions menu.')).toBeInTheDocument();
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists the sections in a paginated table', async () => {
    vi.mocked(api.listLabSections).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ code: `s${String(i).padStart(2, '0')}`, name: `Section ${i}` })),
    );
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    expect(await screen.findByTestId('section-row-s00')).toBeInTheDocument();
    expect(screen.getByTestId('section-row-s09')).toBeInTheDocument();
    expect(screen.queryByTestId('section-row-s10'), 'page size 10').not.toBeInTheDocument();
    expect(screen.getByText('12 sections')).toBeInTheDocument();
  });

  it('adds a section from the page menu through a Sheet, and reloads the list', async () => {
    vi.mocked(api.addLabSection).mockResolvedValue({ code: 'haem', name: 'Haematology' });
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByText('No sections yet. Add one from the actions menu.');
    await pick(/^actions$/i, /^add section$/i);
    const sheet = await screen.findByRole('dialog', { name: /^add a section$/i });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'haem' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Haematology' } });
    vi.mocked(api.listLabSections).mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
    fireEvent.pointerDown(sheet.querySelector('button[aria-label="Actions"]')!, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /^save$/i }));
    await waitFor(() => expect(api.addLabSection).toHaveBeenCalledWith({ code: 'haem', name: 'Haematology' }));
    expect(await screen.findByTestId('section-row-haem')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Section haem added.');
  });

  it('toasts the server words when an add is refused, and keeps the Sheet open', async () => {
    vi.mocked(api.addLabSection).mockRejectedValue(new Error('add section failed: section haem already exists'));
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByText('No sections yet. Add one from the actions menu.');
    await pick(/^actions$/i, /^add section$/i);
    const sheet = await screen.findByRole('dialog', { name: /^add a section$/i });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'haem' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Haematology' } });
    fireEvent.pointerDown(sheet.querySelector('button[aria-label="Actions"]')!, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /^save$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('section haem already exists')));
    expect(screen.getByRole('dialog', { name: /^add a section$/i })).toBeInTheDocument();
  });

  it('removes a section from its row menu only after a destructive confirm', async () => {
    vi.mocked(api.listLabSections).mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
    vi.mocked(api.removeLabSection).mockResolvedValue(undefined);
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByTestId('section-row-haem');
    await pick('Actions for Haematology', /^remove$/i);
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove section haem?' });
    expect(api.removeLabSection).not.toHaveBeenCalled();
    vi.mocked(api.listLabSections).mockResolvedValue([]);
    fireEvent.click(within(confirm).getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(api.removeLabSection).toHaveBeenCalledWith('haem'));
    expect(await screen.findByText('No sections yet. Add one from the actions menu.')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Section haem removed.');
  });

  it('toasts the refusal when a test still uses the section, and keeps the row', async () => {
    vi.mocked(api.listLabSections).mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
    vi.mocked(api.removeLabSection).mockRejectedValue(new Error('remove section failed: section haem is used by 3 tests'));
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByTestId('section-row-haem');
    await pick('Actions for Haematology', /^remove$/i);
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('section haem is used by 3 tests')));
    expect(screen.getByTestId('section-row-haem')).toBeInTheDocument();
  });
});

// Controller ruling, 2026-11-22: the Lab Manager holds lab.settings and no settings.view or the
// letterhead read, and must still reach the switch and the sections here.
describe('Settings → Laboratory: an account with lab.settings only', () => {
  it('is listed in the settings nav for lab.settings as well as settings.view', () => {
    const item = SUB_NAV.find((i) => i.to === '/settings/laboratory');
    expect(item?.caps).toEqual(['settings.view', 'lab.settings']);
  });

  it('shows the switch and the Sections table, and leaves the letterhead out when its read is refused', async () => {
    for (const c of ['settings.view', 'settings.edit_general', 'reports.view']) auth.lacking.add(c);
    vi.mocked(api.fetchLabIdentity).mockRejectedValue(new Error('load lab identity failed: insufficient capability'));
    vi.mocked(api.fetchAllowSelfAuthorise).mockResolvedValue({ value: true });
    vi.mocked(api.listLabSections).mockResolvedValue([{ code: 'haem', name: 'Haematology' }]);
    render(<MemoryRouter><Laboratory /></MemoryRouter>);

    const sw = await screen.findByRole('switch', { name: SELF });
    expect(sw).toBeEnabled();
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByTestId('section-row-haem')).toBeInTheDocument();
    expect(screen.getByText('Laboratory settings')).toBeInTheDocument();
    // No letterhead fields, no logo, no load error, and no Save for fields it cannot read.
    expect(screen.queryByLabelText('Laboratory name')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load the laboratory identity.')).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /^actions$/i }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitem', { name: /^add section$/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('still shows the load error to an account with neither the letterhead read nor lab.settings', async () => {
    auth.lacking.add('lab.settings');
    vi.mocked(api.fetchLabIdentity).mockRejectedValue(new Error('nope'));
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    expect(await screen.findByText('Could not load the laboratory identity.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
