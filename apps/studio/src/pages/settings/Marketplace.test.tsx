import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listInstalledArtifacts: vi.fn(), listAvailableArtifacts: vi.fn(), getAvailableArtifact: vi.fn(), getRemovalPlan: vi.fn(), removePlugin: vi.fn(),
    installArtifact: vi.fn(), setArtifactEnabled: vi.fn(), rollbackArtifact: vi.fn(), removeArtifact: vi.fn(), detachArtifact: vi.fn(), refreshRegistry: vi.fn(), getPackRemoval: vi.fn(), removePack: vi.fn(),
    getPublishStatus: vi.fn(), publishArtifact: vi.fn(), getRoleCatalog: vi.fn(async () => ({ groups: [] })),
    // Registries is a real tab now that the page's ⋯ reaches into it.
    listRegistries: vi.fn(), createRegistry: vi.fn(), updateRegistry: vi.fn(), deleteRegistry: vi.fn() };
});
// Records the props the remove-pack prompt gets on every render, then renders the real prompt.
const packDialogProps = vi.hoisted(() => [] as { packId: string; open: boolean }[]);
vi.mock('./marketplace/RemovePackDialog', async (orig) => {
  const actual = await orig<typeof import('./marketplace/RemovePackDialog')>();
  const { createElement } = await import('react');
  return { RemovePackDialog: (p: Parameters<typeof actual.RemovePackDialog>[0]) => {
    packDialogProps.push({ packId: p.packId, open: p.open });
    return createElement(actual.RemovePackDialog, p);
  } };
});
import * as api from '@/api';
import { toast } from 'sonner';
import { Marketplace } from './Marketplace';
import { onPluginsChanged } from '@/plugins/pluginEvents';

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
  if (!screen.queryByRole('menu')) {
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

  it('an installed plugin with a newer bundle says Update on its Browse card', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([
      { id: 'whonet-sqlite', version: '0.9.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false },
    ]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    const card = await screen.findByTestId('card-whonet-narrow');
    expect(card.textContent).toContain('Update to 1.0.0');
  });

  it('Remove on a plugin opens the remove sheet, not the plain confirm', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([
      { id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false },
    ]);
    (api.getRemovalPlan as any).mockResolvedValue({ running: [], copies: 0, copiedBytes: 0 });
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    await openDetailMenu();
    fireEvent.click(await screen.findByText('Remove'));
    expect(await screen.findByTestId('remove-plugin-sheet')).toBeTruthy();
    await waitFor(() => expect(api.getRemovalPlan).toHaveBeenCalledWith('whonet-sqlite'));
  });

  // Two installed versions after an Update: 1.0.0 active, 0.9.0 kept. Found on Windows, 2026-11-20:
  // Remove on the older card removed the whole plugin, both versions and its data.
  const twoVersions = [
    { id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false },
    { id: 'whonet-sqlite', version: '0.9.0', active: false, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false },
  ];
  async function openInstalledCard(version: string): Promise<void> {
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed/ }), { button: 0 });
    const cards = await screen.findAllByTestId(/^card-/);
    const card = cards.find((c) => c.textContent?.includes(`v${version}`));
    if (!card) throw new Error(`no installed card for ${version}`);
    fireEvent.click(card);
  }

  it('Remove on an older installed version removes only that version, after a confirm naming it', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue(twoVersions);
    (api.removeArtifact as any).mockResolvedValue(undefined);
    (api.getRemovalPlan as any).mockResolvedValue({ running: [], copies: 0, copiedBytes: 0 });
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // One card for the plugin, the active 1.0.0. The older version is removed from its history row.
    await openInstalledCard('1.0.0');
    const trigger = await screen.findByRole('button', { name: 'Actions for 0.9.0' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (screen.queryAllByRole('menuitem').length === 0) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('remove-version-0.9.0'));
    expect(await screen.findByText(/Remove whonet-sqlite 0\.9\.0\?/)).toBeTruthy();
    expect(screen.queryByTestId('remove-plugin-sheet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeArtifact).toHaveBeenCalledWith('whonet-sqlite', '0.9.0'));
    expect(api.removePlugin).not.toHaveBeenCalled();
  }, 20000);

  it('shows one card per plugin, counts plugins in the badge, and rolls back from the version history', async () => {
    const row = (version: string, active: boolean, publisher: unknown) => ({ id: 'analyzer-interface', version, active, enabled: true, approvedBy: 'admin', type: 'plugin', publisher, capabilities: [], legacy: false });
    const before = [row('0.4.1', true, { name: 'OpenLDR test' }), row('0.4.0', false, { name: 'OpenLDR test' }), row('0.3.9', false, { name: 'Other Publisher' })];
    const after = [row('0.4.1', false, { name: 'OpenLDR test' }), row('0.4.0', true, { name: 'OpenLDR test' }), row('0.3.9', false, { name: 'Other Publisher' })];
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue(before);
    (api.rollbackArtifact as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    const tab = await screen.findByRole('tab', { name: /Installed/ });
    await waitFor(() => expect(tab.textContent).toContain('(1)'));
    fireEvent.mouseDown(tab, { button: 0 });
    const cards = await screen.findAllByTestId(/^card-/);
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('v0.4.1');
    fireEvent.click(cards[0]);
    const history = await screen.findByTestId('installed-versions');
    expect(history.textContent).toContain('Other Publisher');
    (api.listInstalledArtifacts as any).mockResolvedValue(after);
    const trigger = await screen.findByRole('button', { name: 'Actions for 0.4.0' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (screen.queryAllByRole('menuitem').length === 0) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('rollback-0.4.0'));
    await waitFor(() => expect(api.rollbackArtifact).toHaveBeenCalledWith('analyzer-interface', '0.4.0'));
    // The same detail now follows the active version, 0.4.0, and 0.4.1 stays in the history with its menu.
    await waitFor(() => expect(screen.getByTestId('installed-version-0.4.0').textContent).toContain('Active'));
    expect(screen.getByRole('button', { name: 'Actions for 0.4.1' })).toBeTruthy();
  }, 20000);

  it('the active version\'s detail shows the new version once the update installs', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([{ ...twoVersions[1], active: true }]);
    (api.installArtifact as any).mockResolvedValue({ id: 'whonet-sqlite', version: '1.0.0' });
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    await openInstalledCard('0.9.0');
    await openDetailMenu();
    // The update lands: 1.0.0 is installed and active, 0.9.0 is kept.
    (api.listInstalledArtifacts as any).mockResolvedValue(twoVersions);
    fireEvent.click(await screen.findByTestId('detail-update'));
    fireEvent.click(await screen.findByTestId('approve-install'));
    await waitFor(() => expect(api.installArtifact).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/v1\.0\.0/)).toBeTruthy());
    expect(screen.queryByText(/v0\.9\.0/)).toBeNull();
  }, 20000);

  it('the consent lists a plugin\'s declared permissions and the actions that need them', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    mockDetail();
    const d = await (api.getAvailableArtifact as any)();
    (api.getAvailableArtifact as any).mockResolvedValue({ ...d, payload: { ...d.payload,
      permissions: [{ key: 'whonet.review', label: 'Review isolates', description: 'See held isolates.' }],
      actionPermissions: { review: ['whonet.review'] } } });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    const list = await screen.findByTestId('plugin-permissions');
    expect(list.textContent).toBe('Review isolates (whonet.review): See held isolates. Needed to run: review.');
  });

  it('the update consent lists the new version\'s declared permissions', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([{ ...twoVersions[1], active: true }]);
    mockDetail();
    const d = await (api.getAvailableArtifact as any)();
    (api.getAvailableArtifact as any).mockResolvedValue({ ...d, payload: { ...d.payload,
      permissions: [{ key: 'whonet.export', label: 'Export', description: 'Download the file.' }] } });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    await openInstalledCard('0.9.0');
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-update'));
    expect((await screen.findByTestId('plugin-permissions')).textContent).toBe('Export (whonet.export): Download the file.');
  }, 20000);

  it('the consent shows no plugin permission list when the plugin declares none', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    await screen.findByTestId('approve-install');
    expect(screen.queryByTestId('plugin-permissions')).toBeNull();
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

  it('the install confirm for a content pack lists its steps, not capabilities', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [{ ref: 'reg/pack-1', id: 'pack-1', version: '1.0.0', type: 'content-pack', publisher: { id: 'p', name: 'P' }, valid: true }] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.getAvailableArtifact as any).mockResolvedValue({ ref: 'reg/pack-1', id: 'pack-1', version: '1.0.0', type: 'content-pack', description: 'd', publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0', payload: { kind: 'content-pack', packSha256: 'a'.repeat(64), steps: [{ kind: 'value-set', label: 'Specimen types', count: 12 }] }, valid: true });
    (api.installArtifact as any).mockResolvedValue({ id: 'pack-1', version: '1.0.0', status: 'failed', failedStep: 1, error: 'boom' });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-reg/pack-1'));
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Specimen types');
    expect(dialog.textContent).not.toContain('Requested permissions');
    fireEvent.click(screen.getByTestId('approve-install'));
    await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('reg/pack-1', []));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Failed at step 1: boom')));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('the install confirm for a pack that makes a role lists every capability without a click', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [{ ref: 'reg/pack-1', id: 'pack-1', version: '1.0.0', type: 'content-pack', publisher: { id: 'p', name: 'P' }, valid: true }] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.getAvailableArtifact as any).mockResolvedValue({
      ref: 'reg/pack-1', id: 'pack-1', version: '1.0.0', type: 'content-pack', description: 'd', publisher: { id: 'p', name: 'P' }, capabilities: [],
      compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
      payload: { kind: 'content-pack', packSha256: 'a'.repeat(64), steps: [{ kind: 'role', label: 'Sample Clerk', count: 2 }] },
      roles: [{ slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit'] }],
      valid: true,
    });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-reg/pack-1'));
    // The detail page keeps the list folded until the admin opens it.
    await screen.findByTestId('pack-role-toggle');
    expect(screen.queryByTestId('pack-role-capabilities')).toBeNull();
    await openDetailMenu();
    fireEvent.click(await screen.findByTestId('detail-install'));
    const dialog = await screen.findByRole('dialog');
    const caps = within(dialog).getByTestId('pack-role-capabilities');
    expect(caps.textContent).toContain('forms.view');
    expect(caps.textContent).toContain('forms.submit');
  });

  it('the type filter offers Content pack', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('combobox', { name: /filter by type/i }));
    expect(await screen.findByRole('option', { name: 'Content pack' })).toBeTruthy();
  });

  it('shows the unconfigured empty state', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: false, source: null, host: null, bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    expect(await screen.findByText(/No marketplace registry yet. Open the Registries tab/i)).toBeTruthy();
  });

  it('keeps the selected installed version while refreshed flags change', async () => {
    let enabled = true;
    vi.mocked(api.listAvailableArtifacts).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    vi.mocked(api.listInstalledArtifacts).mockImplementation(async () => [
      { id: 'versioned-plugin', version: '2.0.0', type: 'plugin', active: true, enabled, capabilities: [], legacy: false, publisher: null, approvedBy: null },
      { id: 'versioned-plugin', version: '1.0.0', type: 'plugin', active: false, enabled, capabilities: [], legacy: false, publisher: null, approvedBy: null },
    ]);
    vi.mocked(api.setArtifactEnabled).mockImplementation(async (_id, value) => { enabled = value; });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // One card for the plugin: two installed versions count once.
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    const cards = await screen.findAllByTestId('card-versioned-plugin');
    expect(cards).toHaveLength(1);
    fireEvent.click(cards[0]);
    expect(await screen.findByText(/v2\.0\.0/)).toBeInTheDocument();
    await openDetailMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(api.listInstalledArtifacts).toHaveBeenCalledTimes(2));
    await openDetailMenu();
    expect(await screen.findByRole('menuitem', { name: 'Enable' })).toBeInTheDocument();
    expect(screen.getByText(/v2\.0\.0/)).toBeInTheDocument();
    expect(screen.getByTestId('installed-version-1.0.0')).toBeInTheDocument();
  });

  it.each(['Browse', 'Installed'] as const)('updates detail actions after toggling from %s without reopening', async (tab) => {
    let enabled = true;
    const installed = () => [{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }];
    vi.mocked(api.listAvailableArtifacts).mockResolvedValue(oneBundle as any);
    vi.mocked(api.listInstalledArtifacts).mockImplementation(async () => installed() as any);
    vi.mocked(api.setArtifactEnabled).mockImplementation(async (_id, value) => { enabled = value; });
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    if (tab === 'Installed') fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId(tab === 'Browse' ? 'card-whonet-narrow' : 'card-whonet-sqlite'));
    await openDetailMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(api.listInstalledArtifacts).toHaveBeenCalledTimes(2));
    await openDetailMenu();
    const enable = await screen.findByRole('menuitem', { name: 'Enable' }, { timeout: 1000 });
    fireEvent.click(enable);
    await waitFor(() => expect(api.setArtifactEnabled).toHaveBeenLastCalledWith('whonet-sqlite', true));
    await waitFor(() => expect(api.listInstalledArtifacts).toHaveBeenCalledTimes(3));
    await openDetailMenu();
    expect(await screen.findByRole('menuitem', { name: 'Disable' }, { timeout: 1000 })).toBeInTheDocument();
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

  // Settings keeps one AppShell, so its plugin list (sidebar entries, open side panel) is only as
  // fresh as the last signal. A disable must send one.
  it('tells the shell the plugins changed after a disable', async () => {
    const heard = vi.fn();
    const off = onPluginsChanged(heard);
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }]);
    (api.setArtifactEnabled as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId('card-whonet-sqlite'));
    const menuTrigger = await screen.findByTestId('detail-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Disable')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Disable'));
    await waitFor(() => expect(heard).toHaveBeenCalled());
    off();
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

  it('removes an installed content pack through its prompt, then toasts and reloads the list', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'collection-site', version: '0.1.0', active: true, enabled: true, approvedBy: 'admin', type: 'content-pack', publisher: { name: 'Acme' }, capabilities: [], legacy: false, status: 'installed', failedStep: null, error: null }]);
    (api.getPackRemoval as any).mockResolvedValue({ roles: ['Sample Clerk'], layouts: ['Collection site'], formsKept: ['Lab request'], holders: [] });
    (api.removePack as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId('card-collection-site'));
    const menuTrigger = await screen.findByTestId('detail-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByTestId('detail-remove-pack')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('detail-remove-pack'));
    expect((await screen.findByTestId('remove-pack-roles')).textContent).toContain('Sample Clerk');
    // The plugin prompts stay shut for a pack.
    expect(screen.queryByTestId('remove-plugin-sheet')).toBeNull();
    const loadsBefore = (api.listInstalledArtifacts as any).mock.calls.length;
    fireEvent.click(screen.getByTestId('remove-pack-confirm'));
    await waitFor(() => expect(api.removePack).toHaveBeenCalledWith('collection-site'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Removed collection-site'));
    await waitFor(() => expect((api.listInstalledArtifacts as any).mock.calls.length).toBeGreaterThan(loadsBefore));
    await waitFor(() => expect(screen.queryByTestId('remove-pack-dialog')).toBeNull());
    expect(api.detachArtifact).not.toHaveBeenCalled();
    // While it closes, the prompt keeps the pack id, so its title never reads "Remove ".
    const opened = packDialogProps.findIndex((p) => p.open);
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(packDialogProps.slice(opened).filter((p) => !p.open).length).toBeGreaterThan(0);
    expect(packDialogProps.slice(opened).every((p) => p.packId === 'collection-site')).toBe(true);
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
  it('toasts the reason the registry failed, not just the generic headline', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({
      configured: true, source: 'local', host: 'Documentation samples', bundles: [],
      error: "Documentation samples: ENOENT: no such file or directory, scandir '/srv/.docs-marketplace/bundles'",
    });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // The reason, with its path, is the toast's description. The browse area says the list failed.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Registry unreachable.', {
      description: "Documentation samples: ENOENT: no such file or directory, scandir '/srv/.docs-marketplace/bundles'",
    }));
    expect(await screen.findByText('Could not load this list. Reload the page to try again.')).toBeTruthy();
    expect(screen.queryByText('No artifacts available.')).toBeNull();
    // The toast may close, so the reason stays as a muted line under the text, with its path.
    const reason = screen.getByText(/ENOENT/);
    expect(reason.textContent).toContain('.docs-marketplace');
    expect(reason.className).toContain('text-[11px]');
    expect(reason.closest('.bg-destructive\\/10'), 'no red box').toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
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
  it('confirms the saved registry name without a Refresh notification', async () => {
    let finishRefresh!: () => void;
    vi.mocked(api.refreshRegistry).mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.listRegistries as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Registries/i }), { button: 0 });
    await openTabActions();
    fireEvent.click(await screen.findByTestId('add-registry'));
    expect(await screen.findByTestId('registry-name'), 'the create dialog is open').toBeTruthy();
    vi.mocked(api.createRegistry).mockResolvedValue({ id: 'r-new', name: 'Review registry', kind: 'http', location: 'https://example.org', enabled: true, createdAt: '', updatedAt: '' });
    fireEvent.change(screen.getByTestId('registry-name'), { target: { value: 'Review registry' } });
    fireEvent.change(screen.getByTestId('registry-location'), { target: { value: 'https://example.org' } });
    fireEvent.keyDown(screen.getByTestId('registry-sheet-menu'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Review registry')));
    await waitFor(() => expect(api.refreshRegistry).toHaveBeenCalled());
    await act(async () => { finishRefresh(); });
    expect(toast.success).not.toHaveBeenCalledWith('Refresh');
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

  // ⛔ REGRESSION, 2026-08-21: the type filter's label wrapped to two lines inside a one-line
  // control on a phone, so "All types" read as "All / types" and overflowed the 36px trigger.
  //
  // `w-36` is a PREFERRED width, not a floor. A flex item shrinks by default, and this row wanted
  // 320 (search) + 144 (select) + 8 (gap) inside 328, so both were squeezed proportionally and the
  // trigger landed at 101px. Measured before the fix: trigger 101px wide, its label span 40px tall
  // in a 36px box. `shrink-0` makes the 144 a floor and the search box gives up the difference.
  //
  // ⚠ `truncate` matters for fr and pt: "Tous les types" and "Todos os tipos" are longer than the
  // English, and an ellipsis is the correct failure, not a second line.
  it('keeps the type filter on one line, so its label cannot wrap inside the control', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    const trigger = await screen.findByRole('combobox', { name: /filter by type/i });
    expect(trigger.className, 'w-36 is only a floor if the item cannot shrink').toMatch(/shrink-0/);
    expect(trigger.className, 'a longer locale must ellipsize, not wrap').toMatch(/truncate|whitespace-nowrap/);
    const search = screen.getByLabelText(/search/i);
    expect(search.className, 'the search box absorbs the shortfall instead').toMatch(/min-w-0/);
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
