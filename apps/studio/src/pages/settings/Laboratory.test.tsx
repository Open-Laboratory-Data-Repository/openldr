import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
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

  it('shows the save error and keeps the page usable when the write fails', async () => {
    vi.mocked(api.saveLabIdentity).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Laboratory /></MemoryRouter>);
    await screen.findByDisplayValue('OpenLDR');
    await save();

    expect(await screen.findByText(/could not save|impossible d|não foi poss/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('OpenLDR')).toBeInTheDocument();
  });
});
