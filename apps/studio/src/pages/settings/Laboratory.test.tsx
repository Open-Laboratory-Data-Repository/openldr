import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
import { toast } from 'sonner';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }),
}));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchLabIdentity: vi.fn(),
    saveLabIdentity: vi.fn(),
    listFacilityImportSources: vi.fn(),
  };
});
import * as api from '@/api';
import { Laboratory } from './Laboratory';

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
};

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(api.fetchLabIdentity).mockResolvedValue(META as never);
  vi.mocked(api.listFacilityImportSources).mockResolvedValue([] as never);
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
