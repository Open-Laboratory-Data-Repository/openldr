import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    getNetworkTrust: vi.fn(), previewTrustCertificate: vi.fn(), addTrustCertificate: vi.fn(), removeTrustCertificate: vi.fn(), unlockTrust: vi.fn(),
    getWorkflowHosts: vi.fn(), addWorkflowHost: vi.fn(), removeWorkflowHost: vi.fn(), setWorkflowSelf: vi.fn() };
});
import * as api from '@/api';
import { NetworkError } from '@/api';
import { toast } from 'sonner';
import { Network } from './Network';
import { SUB_NAV } from './settingsNav';

const FP = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const cert = (over: Partial<api.TrustedCertificate> = {}): api.TrustedCertificate => ({
  fingerprint: FP, subject: 'hub.district', validTo: '2030-05-01T00:00:00.000Z', expired: false, state: 'in-use', ...over,
});
const PEM = '-----BEGIN CERTIFICATE-----\nPEM-X\n-----END CERTIFICATE-----\n';
const preview = { pem: PEM, fingerprint: FP, subject: 'hub.district', validTo: '2030-05-01T00:00:00.000Z', expired: false };

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}
async function pick(menu: string, item: string) {
  openMenu(menu);
  const el = await screen.findByTestId(item);
  await act(async () => { fireEvent.click(el); });
}
async function showHosts() {
  const tab = await screen.findByRole('tab', { name: 'Workflow hosts' });
  // Radix tabs change on mouse down.
  await act(async () => { fireEvent.mouseDown(tab, { button: 0 }); });
}
const mount = () => render(<MemoryRouter><Network /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', certificates: [cert()] });
  vi.mocked(api.getWorkflowHosts).mockResolvedValue({
    self: { on: false, origin: 'http://127.0.0.1:3000' },
    hosts: [{ host: 'z.example', source: 'server' }, { host: 'a.example', source: 'setting' }],
  });
});

describe('the Network settings page', () => {
  it('is in the settings nav after Connectors, behind network.manage', () => {
    const i = SUB_NAV.findIndex((n) => n.to === '/settings/network');
    expect(SUB_NAV[i]).toEqual({ labelKey: 'settings.subNav.network', to: '/settings/network', caps: ['network.manage'] });
    expect(SUB_NAV[i - 1]!.to).toBe('/settings/connectors');
  });

  it('lists certificates with their state words', async () => {
    vi.mocked(api.getNetworkTrust).mockResolvedValue({
      mode: 'editable',
      certificates: [
        cert({ fingerprint: 'F1', subject: 'one', state: 'in-use' }),
        cert({ fingerprint: 'F2', subject: 'two', state: 'added' }),
        cert({ fingerprint: 'F3', subject: 'three', state: 'removed' }),
        cert({ fingerprint: 'F4', subject: 'four', state: 'outside' }),
        cert({ fingerprint: 'F5', subject: 'five', state: 'unknown', expired: true }),
      ],
    });
    mount();
    expect(await screen.findByTestId('trust-row-F1')).toHaveTextContent('In use');
    expect(screen.getByTestId('trust-row-F2')).toHaveTextContent('After restart');
    expect(screen.getByTestId('trust-row-F3')).toHaveTextContent('Removed after restart');
    expect(screen.getByTestId('trust-row-F4')).toHaveTextContent('Set outside OpenLDR');
    expect(screen.getByTestId('trust-row-F1')).toHaveTextContent('one');
    expect(screen.getByTestId('trust-row-F1')).toHaveTextContent('2030-05-01');
  });

  it('keeps each table to three columns, so it fits a phone without scrolling sideways', async () => {
    // Four columns with a 95 character fingerprint were 560 px wide on a 375 px phone. The
    // fingerprint now sits under the name, and the date under the state.
    mount();
    const row = await screen.findByTestId(`trust-row-${FP}`);
    expect(row.querySelectorAll('td')).toHaveLength(3);
    expect(row.closest('table')!.querySelectorAll('th')).toHaveLength(3);
    const [certificate, state] = row.querySelectorAll('td');
    expect(certificate).toHaveTextContent('hub.district');
    expect(certificate).toHaveTextContent(FP);
    expect(state).toHaveTextContent('In use');
    expect(state).toHaveTextContent('Valid until 2030-05-01');
    // The name wraps between words, never inside one. Only the fingerprint may break anywhere.
    expect(within(row).getByTestId(`trust-name-${FP}`).className).not.toContain('break-all');
    expect(within(row).getByTestId(`trust-fingerprint-${FP}`).className).toContain('break-all');
    await showHosts();
    const host = await screen.findByTestId('host-row-a.example');
    expect(host.querySelectorAll('td')).toHaveLength(3);
  });

  it('counts one certificate and one host in the singular', async () => {
    vi.mocked(api.getWorkflowHosts).mockResolvedValue({ self: { on: false, origin: 'http://127.0.0.1:3000' }, hosts: [{ host: 'a.example', source: 'setting' }] });
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    expect(screen.getByTestId('trust-count')).toHaveTextContent(/^1 certificate$/);
    await showHosts();
    expect(await screen.findByTestId('hosts-count')).toHaveTextContent(/^1 host$/);
  });

  it('shows Not known for a certificate whose state is unknown, and Expired beside its date', async () => {
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', certificates: [cert({ state: 'unknown', expired: true })] });
    mount();
    const row = await screen.findByTestId(`trust-row-${FP}`);
    expect(row).toHaveTextContent('Not known');
    expect(row).toHaveTextContent('Expired');
  });

  it.each([
    ['not-configured', 'This install was set up before trusted certificates could be managed here. See the guide to turn it on.'],
    ['set-outside', 'Trusted certificates are set outside OpenLDR, in NODE_EXTRA_CA_CERTS. They are shown here and cannot be changed here.'],
    ['damaged', 'The trust file holds text that is not a certificate. Fix the file, then manage it here.'],
  ] as const)('shows the reason and turns the actions off when the mode is %s', async (mode, line) => {
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode, certificates: [cert({ state: 'outside' })] });
    mount();
    expect(await screen.findByTestId('trust-mode-note')).toHaveTextContent(line);
    openMenu('network-menu');
    expect(await screen.findByTestId('trust-add')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    openMenu(`trust-actions-${FP}`);
    expect(await screen.findByTestId(`trust-remove-${FP}`)).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the spinner while loading, and never the stripes', async () => {
    let done: (v: api.NetworkTrust) => void = () => {};
    vi.mocked(api.getNetworkTrust).mockReturnValue(new Promise((r) => { done = r; }));
    mount();
    expect(screen.getByTestId('network-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('trust-empty')).toBeNull();
    await act(async () => { done({ mode: 'editable', certificates: [] }); });
    expect(await screen.findByTestId('trust-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('network-loading')).toBeNull();
  });

  it('renders no table element when a tab has no rows', async () => {
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', certificates: [] });
    vi.mocked(api.getWorkflowHosts).mockResolvedValue({ self: { on: false, origin: 'http://127.0.0.1:3000' }, hosts: [] });
    mount();
    expect(await screen.findByTestId('trust-empty')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
    await showHosts();
    expect(await screen.findByTestId('hosts-empty')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('hides the inactive tab panel', async () => {
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    const panels = document.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(2);
    for (const p of panels) expect(p.className).toContain('data-[state=inactive]:hidden');
    expect(document.querySelector('[role="tabpanel"][data-state="inactive"]')).not.toBeNull();
  });

  it('paginates both tables', async () => {
    vi.mocked(api.getNetworkTrust).mockResolvedValue({
      mode: 'editable',
      certificates: Array.from({ length: 30 }, (_, i) => cert({ fingerprint: `F${i}`, subject: `host-${String(i).padStart(2, '0')}` })),
    });
    vi.mocked(api.getWorkflowHosts).mockResolvedValue({
      self: { on: false, origin: 'http://127.0.0.1:3000' },
      hosts: Array.from({ length: 30 }, (_, i) => ({ host: `h${String(i).padStart(2, '0')}.example`, source: 'setting' as const })),
    });
    mount();
    await screen.findByTestId('trust-row-F0');
    expect(document.querySelectorAll('[data-testid^="trust-row-"]')).toHaveLength(25);
    expect(screen.getByTestId('trust-count')).toHaveTextContent('30');
    await showHosts();
    await screen.findByTestId('host-row-h00.example');
    expect(document.querySelectorAll('[data-testid^="host-row-"]')).toHaveLength(25);
    expect(screen.getByTestId('hosts-count')).toHaveTextContent('30');
  });

  it('keeps Save off until a certificate is shown', async () => {
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    openMenu('trust-sheet-menu');
    expect(await screen.findByTestId('trust-save')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('trust-preview')).toBeNull();
  });

  it('reads a certificate from an address, shows its fingerprint, and saves that PEM', async () => {
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    vi.mocked(api.addTrustCertificate).mockResolvedValue(cert({ state: 'added' }));
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'hub.district:8443' } });
    await pick('trust-sheet-menu', 'trust-read');
    expect(api.previewTrustCertificate).toHaveBeenCalledWith({ address: 'hub.district:8443' });
    const shown = await screen.findByTestId('trust-preview');
    expect(shown).toHaveTextContent(FP);
    expect(shown).toHaveTextContent('hub.district');
    expect(shown).toHaveTextContent('2030-05-01');
    await pick('trust-sheet-menu', 'trust-save');
    expect(api.addTrustCertificate).toHaveBeenCalledWith(PEM);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved. Restart OpenLDR to use it.'));
    expect(screen.queryByTestId('trust-address')).toBeNull();
    expect(api.getNetworkTrust).toHaveBeenCalledTimes(2);
  });

  it('reads a pasted certificate', async () => {
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-text'), { target: { value: PEM } });
    await pick('trust-sheet-menu', 'trust-read');
    expect(api.previewTrustCertificate).toHaveBeenCalledWith({ text: PEM });
    expect(await screen.findByTestId('trust-preview')).toHaveTextContent(FP);
  });

  it('says so when pasted text holds more than one certificate, and keeps Save off', async () => {
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview, { ...preview, fingerprint: 'F2' }] });
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-text'), { target: { value: PEM + PEM } });
    await pick('trust-sheet-menu', 'trust-read');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That text holds 2 certificates. Add them one at a time.'));
    expect(screen.queryByTestId('trust-preview')).toBeNull();
  });

  it('drops the shown certificate when the address or the text changes', async () => {
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'hub.district' } });
    await pick('trust-sheet-menu', 'trust-read');
    await screen.findByTestId('trust-preview');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'other.district' } });
    expect(screen.queryByTestId('trust-preview')).toBeNull();
  });

  it('shows the private key line and saves nothing', async () => {
    vi.mocked(api.previewTrustCertificate).mockRejectedValue(new NetworkError('private-key', 400, false));
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-text'), { target: { value: 'a key' } });
    await pick('trust-sheet-menu', 'trust-read');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That text holds a private key. Never paste a key. Nothing was saved.'));
    expect(api.addTrustCertificate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('trust-preview')).toBeNull();
  });

  it.each([
    ['not-a-certificate', 'That is not a certificate.'],
    ['duplicate', 'That certificate is already trusted.'],
    ['no-answer', 'Nothing answered at that address.'],
    ['busy', 'The list is being changed. Try again in a moment.'],
  ])('shows the plain line for %s', async (code, line) => {
    vi.mocked(api.previewTrustCertificate).mockRejectedValue(new NetworkError(code, 400, false));
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'x' } });
    await pick('trust-sheet-menu', 'trust-read');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(line));
  });

  it('says a certificate the server already uses needs no restart', async () => {
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    vi.mocked(api.addTrustCertificate).mockResolvedValue(cert({ state: 'in-use' }));
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'x' } });
    await pick('trust-sheet-menu', 'trust-read');
    await screen.findByTestId('trust-preview');
    await pick('trust-sheet-menu', 'trust-save');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved. OpenLDR already uses it.'));
  });

  it('says the change was made when only its audit record failed, and reloads', async () => {
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    vi.mocked(api.addTrustCertificate).mockRejectedValue(new NetworkError('audit-failed', 500, true));
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'x' } });
    await pick('trust-sheet-menu', 'trust-read');
    await screen.findByTestId('trust-preview');
    await pick('trust-sheet-menu', 'trust-save');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The change was made, but its audit record could not be written.'));
    expect(api.getNetworkTrust).toHaveBeenCalledTimes(2);
  });

  it('removes a certificate after the confirm', async () => {
    vi.mocked(api.removeTrustCertificate).mockResolvedValue(undefined);
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick(`trust-actions-${FP}`, `trust-remove-${FP}`);
    expect(api.removeTrustCertificate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('hub.district');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' })); });
    expect(api.removeTrustCertificate).toHaveBeenCalledWith(FP);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Removed. Restart OpenLDR to stop trusting it.'));
  });

  it('copies a fingerprint from the row menu', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick(`trust-actions-${FP}`, `trust-copy-${FP}`);
    expect(writeText).toHaveBeenCalledWith(FP);
  });

  it('offers Unlock only for a lock left behind, says what its age does not prove, and unlocks after the confirm', async () => {
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', lock: { since: '2026-11-27T08:00:00.000Z', stuck: false }, certificates: [cert()] });
    const first = mount();
    expect(await screen.findByTestId('trust-lock-note')).toHaveTextContent('A change to the list is in progress.');
    openMenu('network-menu');
    await screen.findByTestId('trust-add');
    expect(screen.queryByTestId('trust-unlock')).toBeNull();
    first.unmount();

    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', lock: { since: '2026-11-27T08:00:00.000Z', stuck: true }, certificates: [cert()] });
    vi.mocked(api.unlockTrust).mockResolvedValue({ removed: true });
    mount();
    expect(await screen.findByTestId('trust-lock-note')).toHaveTextContent('A change to the list was interrupted and left a lock.');
    await pick('network-menu', 'trust-unlock');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('That age does not prove the change has stopped');
    expect(api.unlockTrust).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock' })); });
    expect(api.unlockTrust).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Unlocked.'));
  });

  it('turns the switch on and shows the origin', async () => {
    vi.mocked(api.setWorkflowSelf).mockResolvedValue({ on: true, origin: 'http://127.0.0.1:3000' });
    mount();
    await showHosts();
    const sw = await screen.findByTestId('hosts-self');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('hosts-self-origin')).toHaveTextContent('http://127.0.0.1:3000 only');
    await act(async () => { fireEvent.click(sw); });
    expect(api.setWorkflowSelf).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByTestId('hosts-self')).toHaveAttribute('aria-checked', 'true'));
  });

  it('adds a host and shows it as Set here', async () => {
    vi.mocked(api.addWorkflowHost).mockResolvedValue(undefined);
    mount();
    await showHosts();
    expect(await screen.findByTestId('host-row-a.example')).toHaveTextContent('Set here');
    expect(screen.getByTestId('host-row-z.example')).toHaveTextContent('Server setting');
    expect(screen.getByTestId('hosts-note')).toHaveTextContent('A host here covers every web service on that host.');
    await pick('network-menu', 'host-add');
    openMenu('host-sheet-menu');
    expect(await screen.findByTestId('host-save')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.change(screen.getByTestId('host-name'), { target: { value: 'hub.district' } });
    await pick('host-sheet-menu', 'host-save');
    expect(api.addWorkflowHost).toHaveBeenCalledWith('hub.district');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved.'));
    expect(api.getWorkflowHosts).toHaveBeenCalledTimes(2);
  });

  it("shows the server's own line for a host it refuses", async () => {
    vi.mocked(api.addWorkflowHost).mockRejectedValue(new NetworkError('Type a host name or an IP address, with no port and no path.', 400, false));
    mount();
    await showHosts();
    await pick('network-menu', 'host-add');
    fireEvent.change(screen.getByTestId('host-name'), { target: { value: 'http://x' } });
    await pick('host-sheet-menu', 'host-save');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Type a host name or an IP address, with no port and no path.'));
    expect(screen.getByTestId('host-name')).toBeInTheDocument();
  });

  it('gives a server host no Remove action, and removes a host set here after the confirm', async () => {
    vi.mocked(api.removeWorkflowHost).mockResolvedValue(undefined);
    mount();
    await showHosts();
    await screen.findByTestId('host-row-z.example');
    expect(screen.queryByTestId('host-actions-z.example')).toBeNull();
    await pick('host-actions-a.example', 'host-remove-a.example');
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' })); });
    expect(api.removeWorkflowHost).toHaveBeenCalledWith('a.example');
  });

  it('shows the header menu items of the tab that is open', async () => {
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    openMenu('network-menu');
    await screen.findByTestId('trust-add');
    expect(screen.queryByTestId('host-add')).toBeNull();
  });

  it('says so when the page cannot be loaded', async () => {
    vi.mocked(api.getNetworkTrust).mockRejectedValue(new Error('list trusted certificates failed: 500'));
    mount();
    expect(await screen.findByTestId('network-error')).toHaveTextContent('500');
  });

  /** A promise the test settles when it chooses. */
  function later<T>() {
    let resolve: (v: T) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const closeSheet = async () => { await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); }); };

  it('ignores a certificate that arrives after the address was changed', async () => {
    const slow = later<{ certificates: api.CertificatePreview[] }>();
    vi.mocked(api.previewTrustCertificate).mockReturnValue(slow.promise);
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'a.district' } });
    await pick('trust-sheet-menu', 'trust-read');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'b.district' } });
    await act(async () => { slow.resolve({ certificates: [preview] }); });
    // The field says b.district. A's certificate must not be shown, and Save stays off.
    expect(screen.queryByTestId('trust-preview')).toBeNull();
    openMenu('trust-sheet-menu');
    expect(await screen.findByTestId('trust-save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('ignores a certificate that arrives after the sheet was closed and opened again', async () => {
    const slow = later<{ certificates: api.CertificatePreview[] }>();
    vi.mocked(api.previewTrustCertificate).mockReturnValue(slow.promise);
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'a.district' } });
    await pick('trust-sheet-menu', 'trust-read');
    await closeSheet();
    await waitFor(() => expect(screen.queryByTestId('trust-address')).toBeNull());
    await pick('network-menu', 'trust-add');
    await act(async () => { slow.resolve({ certificates: [preview] }); });
    expect(screen.getByTestId('trust-address')).toHaveValue('');
    expect(screen.queryByTestId('trust-preview')).toBeNull();
  });

  it('a save that finishes late does not close a sheet that was opened again', async () => {
    const slow = later<api.TrustedCertificate>();
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    vi.mocked(api.addTrustCertificate).mockReturnValue(slow.promise);
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'a.district' } });
    await pick('trust-sheet-menu', 'trust-read');
    await screen.findByTestId('trust-preview');
    await pick('trust-sheet-menu', 'trust-save');
    await closeSheet();
    await waitFor(() => expect(screen.queryByTestId('trust-address')).toBeNull());
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'second.district' } });
    await act(async () => { slow.resolve(cert({ state: 'added' })); });
    // The first save is reported and the list reloads. The sheet the person now has open stays.
    expect(toast.success).toHaveBeenCalledWith('Saved. Restart OpenLDR to use it.');
    expect(screen.getByTestId('trust-address')).toHaveValue('second.district');
  });

  it('a host save that finishes late does not close a sheet that was opened again', async () => {
    const slow = later<void>();
    vi.mocked(api.addWorkflowHost).mockReturnValue(slow.promise);
    mount();
    await showHosts();
    await pick('network-menu', 'host-add');
    fireEvent.change(screen.getByTestId('host-name'), { target: { value: 'a.example.org' } });
    await pick('host-sheet-menu', 'host-save');
    await closeSheet();
    await waitFor(() => expect(screen.queryByTestId('host-name')).toBeNull());
    await pick('network-menu', 'host-add');
    fireEvent.change(screen.getByTestId('host-name'), { target: { value: 'second.example.org' } });
    await act(async () => { slow.resolve(); });
    expect(screen.getByTestId('host-name')).toHaveValue('second.example.org');
  });

  it('locks the address and the paste box while a save is on its way', async () => {
    const slow = later<api.TrustedCertificate>();
    vi.mocked(api.previewTrustCertificate).mockResolvedValue({ certificates: [preview] });
    vi.mocked(api.addTrustCertificate).mockReturnValue(slow.promise);
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick('network-menu', 'trust-add');
    fireEvent.change(screen.getByTestId('trust-address'), { target: { value: 'a.district' } });
    await pick('trust-sheet-menu', 'trust-read');
    await screen.findByTestId('trust-preview');
    expect(screen.getByTestId('trust-address')).not.toBeDisabled();
    await pick('trust-sheet-menu', 'trust-save');
    // Nothing may be typed or read for another certificate while this one is being saved.
    expect(screen.getByTestId('trust-address')).toBeDisabled();
    expect(screen.getByTestId('trust-text')).toBeDisabled();
    openMenu('trust-sheet-menu');
    expect(await screen.findByTestId('trust-read')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('trust-save')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await act(async () => { slow.resolve(cert({ state: 'added' })); });
    await waitFor(() => expect(screen.queryByTestId('trust-address')).toBeNull());
    expect(api.addTrustCertificate).toHaveBeenCalledTimes(1);
  });

  it('locks the host field while a save is on its way', async () => {
    const slow = later<void>();
    vi.mocked(api.addWorkflowHost).mockReturnValue(slow.promise);
    mount();
    await showHosts();
    await pick('network-menu', 'host-add');
    fireEvent.change(screen.getByTestId('host-name'), { target: { value: 'a.example.org' } });
    await pick('host-sheet-menu', 'host-save');
    expect(screen.getByTestId('host-name')).toBeDisabled();
    await act(async () => { slow.resolve(); });
    await waitFor(() => expect(screen.queryByTestId('host-name')).toBeNull());
  });

  it('keeps the switch as it was just set when an older refresh ends after it', async () => {
    vi.mocked(api.setWorkflowSelf).mockResolvedValue({ on: true, origin: 'http://127.0.0.1:3000' });
    mount();
    await showHosts();
    await screen.findByTestId('hosts-self');
    const old = later<api.WorkflowHostsView>();
    vi.mocked(api.getWorkflowHosts).mockReturnValueOnce(old.promise);
    await pick('network-menu', 'network-refresh');
    await act(async () => { fireEvent.click(screen.getByTestId('hosts-self')); });
    await waitFor(() => expect(screen.getByTestId('hosts-self')).toHaveAttribute('aria-checked', 'true'));
    // The refresh was asked for before the switch changed, so it still says off.
    await act(async () => { old.resolve({ self: { on: false, origin: 'http://127.0.0.1:3000' }, hosts: [] }); });
    expect(screen.getByTestId('hosts-self')).toHaveAttribute('aria-checked', 'true');
  });

  it('says so when a refresh fails, keeps what it had, and refreshes again from the menu', async () => {
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    vi.mocked(api.getNetworkTrust).mockRejectedValueOnce(new Error('list trusted certificates failed: 500'));
    await pick('network-menu', 'network-refresh');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('list trusted certificates failed: 500'));
    expect(screen.getByTestId(`trust-row-${FP}`)).toBeInTheDocument();
    expect(screen.getByTestId('network-refresh-failed')).toHaveTextContent('The page could not be refreshed. What you see may be out of date.');
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', certificates: [cert({ fingerprint: 'NEW', subject: 'new.district' })] });
    await pick('network-menu', 'network-refresh');
    expect(await screen.findByTestId('trust-row-NEW')).toBeInTheDocument();
    expect(screen.queryByTestId('network-refresh-failed')).toBeNull();
  });

  it('keeps the newest answer when an older refresh finishes after it', async () => {
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    const old = later<api.NetworkTrust>();
    vi.mocked(api.getNetworkTrust).mockReturnValueOnce(old.promise);
    await pick('network-menu', 'network-refresh');
    vi.mocked(api.getNetworkTrust).mockResolvedValueOnce({ mode: 'editable', certificates: [cert({ fingerprint: 'NEWEST', subject: 'newest' })] });
    await pick('network-menu', 'network-refresh');
    await screen.findByTestId('trust-row-NEWEST');
    await act(async () => { old.resolve({ mode: 'editable', certificates: [cert({ fingerprint: 'STALE', subject: 'stale' })] }); });
    expect(screen.getByTestId('trust-row-NEWEST')).toBeInTheDocument();
    expect(screen.queryByTestId('trust-row-STALE')).toBeNull();
  });

  it('looks again when a lock in progress becomes old enough to unlock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const since = new Date(Date.now() - 5_000).toISOString();
      vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', lock: { since, stuck: false }, certificates: [cert()] });
      mount();
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(screen.getByTestId('trust-lock-note')).toHaveTextContent('A change to the list is in progress.');
      expect(api.getNetworkTrust).toHaveBeenCalledTimes(1);
      vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', lock: { since, stuck: true }, certificates: [cert()] });
      // 30 seconds after the lock was made, plus a little.
      await act(async () => { await vi.advanceTimersByTimeAsync(27_000); });
      expect(api.getNetworkTrust).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('trust-lock-note')).toHaveTextContent('A change to the list was interrupted and left a lock.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes back to the last page that has rows when the list gets shorter', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => cert({ fingerprint: `F${String(i).padStart(2, '0')}`, subject: `host-${String(i).padStart(2, '0')}` }));
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', certificates: many(26) });
    vi.mocked(api.removeTrustCertificate).mockResolvedValue(undefined);
    mount();
    await screen.findByTestId('trust-row-F00');
    const panel = screen.getByTestId('trust-row-F00').closest('[role="tabpanel"]') as HTMLElement;
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Next page' })); });
    expect(await screen.findByTestId('trust-row-F25')).toBeInTheDocument();
    vi.mocked(api.getNetworkTrust).mockResolvedValue({ mode: 'editable', certificates: many(25) });
    await pick('trust-actions-F25', 'trust-remove-F25');
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' })); });
    // 25 certificates are left, all on the first page. The page must not show "none".
    expect(await screen.findByTestId('trust-row-F00')).toBeInTheDocument();
    expect(screen.queryByTestId('trust-empty')).toBeNull();
  });

  it('says how to copy by hand when the browser will not copy', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('not allowed'); }) } });
    mount();
    await screen.findByTestId(`trust-row-${FP}`);
    await pick(`trust-actions-${FP}`, `trust-copy-${FP}`);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This browser did not copy it. Select the fingerprint in the list and copy it yourself.'));
    Object.assign(navigator, { clipboard: undefined });
    await pick(`trust-actions-${FP}`, `trust-copy-${FP}`);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  });
});
