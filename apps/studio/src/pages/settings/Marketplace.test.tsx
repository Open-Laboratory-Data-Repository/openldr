import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listInstalledArtifacts: vi.fn(), listAvailableArtifacts: vi.fn(), getAvailableArtifact: vi.fn(),
    installArtifact: vi.fn(), setArtifactEnabled: vi.fn(), rollbackArtifact: vi.fn(), removeArtifact: vi.fn(), detachArtifact: vi.fn(), refreshRegistry: vi.fn(),
    getPublishStatus: vi.fn(), publishArtifact: vi.fn(),
    // Registries is a real tab now that the page's ⋯ reaches into it.
    listRegistries: vi.fn(), createRegistry: vi.fn(), updateRegistry: vi.fn(), deleteRegistry: vi.fn() };
});
import * as api from '@/api';
import { Marketplace } from './Marketplace';

beforeEach(() => {
  vi.clearAllMocks();
  (api.getPublishStatus as any).mockResolvedValue({ configured: false, repo: null });
  (api.listRegistries as any).mockResolvedValue([]);
});

const oneBundle = {
  configured: true,
  source: 'local', host: 'local',
  // The real /available (list) endpoint does NOT carry capabilities — they live only in the
  // signed per-bundle DETAIL. Mirror that here so the test exercises the detail-gated install.
  bundles: [{ ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, compatibility: { ceVersion: '*' }, valid: true }],
};

function mockDetail() {
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin',
    description: 'desc', license: 'Apache-2.0', publisher: { id: 'p', name: 'P' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } },
    valid: true,
  });
}

/** Open the detail pane's ⋯ menu. AGENTS.md section 5 moved Install and Publish into it on
 *  2026-08-21, so every action there is now reached this way. Radix opens on pointerDown in jsdom,
 *  with a keyboard fallback, matching the pattern already used further down this file. */
async function openDetailMenu(): Promise<void> {
  const trigger = await screen.findByTestId('detail-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByTestId('detail-install') && !screen.queryByTestId('detail-publish')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

/** Open the page's single ⋯, which lives on the tab strip. Radix opens on pointerDown in jsdom,
 *  with a keyboard fallback.
 *
 *  ⚠ The guard must name EVERY item the menu can hold. It is a toggle: if the fallback fires after
 *  the pointerDown already opened the menu, it closes it again. That is what the Registries item
 *  did before `add-registry` was listed here — the menu opened and immediately shut, and the test
 *  hung on findBy until it timed out rather than failing on the real assertion. */
async function openTabActions(): Promise<void> {
  const triggers = await screen.findAllByRole('button', { name: /^(actions|aktionen|ações)$/i });
  const trigger = triggers[triggers.length - 1];
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const open = ['refresh-registry', 'refresh-installed', 'add-registry'].some((id) => screen.queryByTestId(id));
  if (!open) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('Marketplace', () => {
  it('browses a bundle, opens detail, installs after consent', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.installArtifact as any).mockResolvedValue({ id: 'whonet-sqlite', version: '1.0.0' });
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    expect((await screen.findAllByText(/Patient/)).length).toBeGreaterThan(0); // consent dialog
    fireEvent.click(screen.getByTestId('approve-install'));
    await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('whonet-narrow', [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]));
  });

  it('installs a form-template bundle from Browse after consent', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [{ ref: 'demo-form-1', id: 'demo-form', version: '1.0.0', type: 'form-template', publisher: { id: 'p', name: 'P' }, valid: true }] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.getAvailableArtifact as any).mockResolvedValue({ ref: 'demo-form-1', id: 'demo-form', version: '1.0.0', type: 'form-template', description: 'd', license: 'L', publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0', payload: { kind: 'form-template' }, valid: true });
    (api.installArtifact as any).mockResolvedValue({ id: 'demo-form', version: '1.0.0' });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-demo-form-1'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    fireEvent.click(await screen.findByTestId('approve-install'));
    await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('demo-form-1', []));
  });

  it('shows the unconfigured empty state', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: false, source: null, host: null, bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    expect(await screen.findByText(/No marketplace registry configured/i)).toBeTruthy();
  });

  it('installed tab lists installed artifacts and toggles enabled from detail', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }]);
    (api.setArtifactEnabled as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // Radix Tabs activate on mouseDown in jsdom (matches the repo's tabs.test pattern).
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId('card-whonet-sqlite'));
    // Radix DropdownMenu opens on pointerDown in jsdom, with a keyboard fallback (matches the repo's BuilderHeader test pattern).
    const menuTrigger = await screen.findByTestId('detail-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Disable')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Disable'));
    await waitFor(() => expect(api.setArtifactEnabled).toHaveBeenCalledWith('whonet-sqlite', false));
  });

  it('detaches an installed form-template from its detail menu', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'demo-form', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'form-template', publisher: { name: 'Acme' }, capabilities: [], legacy: false, drifted: false, targetFormId: 'form-9' }]);
    (api.detachArtifact as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // Radix Tabs activate on mouseDown in jsdom (matches the installed-tab test above).
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId('card-demo-form'));
    // Radix DropdownMenu opens on pointerDown in jsdom, with a keyboard fallback.
    const menuTrigger = await screen.findByTestId('detail-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Detach')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Detach'));
    // Confirm in the AlertDialog (its action button is also labelled "Detach").
    fireEvent.click(await screen.findByRole('button', { name: 'Detach' }));
    await waitFor(() => expect(api.detachArtifact).toHaveBeenCalledWith('demo-form'));
  });

  it('publishes a staged bundle and shows the PR toast', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ ...oneBundle });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.getPublishStatus as any).mockResolvedValue({ configured: true, repo: 'o/r' });
    (api.getAvailableArtifact as any).mockResolvedValue({
      ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', description: 'd', license: 'L',
      publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
      payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } }, valid: true,
    });
    (api.publishArtifact as any).mockResolvedValue({ prUrl: 'https://gh/pr/9', prNumber: 9 });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-publish'));
    await waitFor(() => expect(api.publishArtifact).toHaveBeenCalledWith('whonet-narrow'));
  });

  // ⛔ REGRESSION, reported 2026-08-21 from a phone: the Registries table stopped short and left
  // dead background under its pagination row.
  //
  // RegistriesTab itself is correct — `flex min-h-0 flex-1 flex-col`, and the Table carries
  // `wrapperClassName="min-h-0 flex-1"`. The break was one level up: this TabsContent had
  // `min-h-0 flex-1` but no `display: flex`, so it was a BLOCK box and `flex-1` on its child did
  // nothing. Measured on a real Chromium at 360x640 before the fix: the panel was 455px tall and
  // registries-tab sat at 349px inside it, 106px short.
  //
  // This is the same trap as Terminology's tables (mobile pass, 2026-07-31): a fill child needs a
  // FLEX COLUMN parent. Adding `flex` here is only safe because ui/tabs.tsx already ships
  // `data-[state=inactive]:hidden` — without it a `display` utility ties the UA `[hidden]` rule on
  // specificity and the inactive panel keeps stealing space.
  //
  // ⚠ HONEST NON-PROOF: jsdom computes no layout, so this asserts the CLASSES. Only the browser
  // measurement above shows the pixels.
  it('gives the registries panel a flex column, so its table can fill the height', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Registries/i }), { button: 0 });
    const panel = await screen.findByRole('tabpanel');
    expect(panel.className, 'a block panel makes flex-1 on the tab body a no-op').toMatch(/(^|\s)flex(\s|$)/);
    expect(panel.className, 'the tab body stacks vertically').toMatch(/flex-col/);
    expect(panel.className, 'and must still be able to shrink').toMatch(/min-h-0/);
  });

  // ⛔ The operator saw only "Registry unreachable." and had no way to act on it. The server had
  // already sent the reason ("Documentation samples: ENOENT ... apps\server\.docs-marketplace"),
  // Marketplace.tsx put it in state as `loadError`, and this banner then rendered a translated
  // headline INSTEAD of it. The detail is deliberately NOT translated: it is a server message and a
  // filesystem path, and inventing an i18n key for it would ship two of the three locales broken.
  it('shows the reason the registry failed, not just the generic headline', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({
      configured: true, source: 'local', host: 'Documentation samples', bundles: [],
      error: "Documentation samples: ENOENT: no such file or directory, scandir '/srv/.docs-marketplace/bundles'",
    });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    expect(await screen.findByText(/Registry unreachable/i)).toBeTruthy();
    expect(screen.getByText(/ENOENT/), 'the actual reason must reach the screen').toBeTruthy();
    expect(screen.getByText(/\.docs-marketplace/), 'including the path that did not resolve').toBeTruthy();
  });

  // ⛔ Same clipping defect as Settings ▸ Laboratory, found while fixing the Registries panel.
  // `marketplace-page` is `overflow-hidden`, and neither card panel owned a scroll region, so a
  // registry with more bundles than fit was simply unreachable. Measured on a real Chromium at
  // 360x340 with ONE card: panel scrollHeight 202 vs clientHeight 155, and zero scrollable elements
  // anywhere under `marketplace-page`.
  //
  // ⚠ The Divider stays OUTSIDE the new scroller on purpose. It bleeds edge-to-edge with negative
  // margins, and AGENTS.md section 5 says an `overflow-auto` ancestor clips a bleeding element.
  it.each(['Browse', 'Installed'])('%s scrolls its card grid instead of clipping it', async (tab) => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: new RegExp(tab, 'i') }), { button: 0 });
    const panel = await screen.findByRole('tabpanel');
    expect(panel.className, 'a block panel cannot lay out a fill child').toMatch(/(^|\s)flex(\s|$)/);
    expect(panel.className).toMatch(/flex-col/);
    expect(panel.querySelector('.overflow-y-auto'), 'the card list needs its own scroller').toBeTruthy();
  });

  // The page has ONE ⋯ and it sits on the tab strip, beside Browse / Installed / Registries.
  // Requested by the operator on 2026-08-21: three separate menus (two in the filter bar, one in the
  // table toolbar) became one that follows the active tab. AGENTS.md section 5 asks for exactly one
  // MoreHorizontal DropdownMenu per page header.
  //
  // One tab per case, deliberately. Driving all three in a single test means opening and closing a
  // Radix menu across tab switches, and a menu left half-open turns a real failure into a timeout.
  it.each([
    ['Browse', 'refresh-registry', 'add-registry'],
    ['Installed', 'refresh-installed', 'add-registry'],
    ['Registries', 'add-registry', 'refresh-registry'],
  ])('the tab-strip menu on %s offers %s and not %s', async (tab, wanted, unwanted) => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    if (tab !== 'Browse') fireEvent.mouseDown(await screen.findByRole('tab', { name: new RegExp(tab, 'i') }), { button: 0 });
    await openTabActions();
    expect(await screen.findByTestId(wanted)).toBeTruthy();
    expect(screen.queryByTestId(unwanted), 'the action belonging to another tab must not be offered').toBeNull();
  });

  // ⛔ The item must actually reach RegistriesTab's dialog. The opener is handed up through
  // `onReady`, so a broken wire would leave a menu item that silently does nothing — exactly the
  // failure a class-level assertion cannot see.
  it("the Registries item opens that tab's create dialog", async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.listRegistries as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Registries/i }), { button: 0 });
    await openTabActions();
    fireEvent.click(await screen.findByTestId('add-registry'));
    expect(await screen.findByTestId('registry-name'), 'the create dialog is open').toBeTruthy();
  });

  // The source label moved onto the tab strip with the ⋯, and belongs to Browse only — it names
  // where the BROWSE listing came from, which says nothing about Installed or Registries.
  it('shows the registry source on the tab strip, and only on Browse', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.listRegistries as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    expect(await screen.findByTestId('registry-source')).toBeTruthy();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Registries/i }), { button: 0 });
    await waitFor(() => expect(screen.queryByTestId('registry-source')).toBeNull());
  });

  it('refreshes the registry', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.refreshRegistry as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // Refresh moved into the tab's ⋯ menu on 2026-08-21 (AGENTS.md section 5), so it is reached the
    // same way every other action on this page is.
    await openTabActions();
    fireEvent.click(await screen.findByTestId('refresh-registry'));
    await waitFor(() => expect(api.refreshRegistry).toHaveBeenCalled());
  });
});
