import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';
import { PluginContainer } from './PluginContainer';
import * as api from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPluginUis: vi.fn() };
});
let caps: string[] = [];
let roles: string[] = [];
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'amina', displayName: null, roles }, loading: false, signOut: vi.fn(), authEnforced: true,
    hasCapability: (c: string) => caps.includes(c), capabilities: caps,
  }),
}));
vi.mock('./PluginFrame', () => ({
  PluginFrame: ({ pluginId, context }: { pluginId: string; context: { capabilities: string[] } }) => <div data-testid="frame" data-caps={context.capabilities.join(',')}>{pluginId}</div>,
  pluginFrameContext: (pluginId: string, site: string, capabilities: readonly string[]) => ({ pluginId, site, capabilities: [...capabilities] }),
}));
vi.mock('./DeclarativeForm', () => ({ DeclarativeForm: ({ pluginId }: { pluginId: string }) => <div data-testid="declform">{pluginId}</div> }));

function renderAt(id: string) {
  return render(<MemoryRouter initialEntries={[`/x/${id}`]}><Routes><Route path="/x/:pluginId" element={<PluginContainer />} /></Routes></MemoryRouter>);
}

const lab = { id: 'lab', version: '1', nav: { label: 'Lab', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: true, hasDeclarative: false, declarative: null };

describe('PluginContainer', () => {
  beforeEach(() => { caps = []; roles = []; vi.mocked(api.listPluginUis).mockReset(); });
  it('renders PluginFrame for a webview plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([{ id: 'web', version: '1', nav: { label: 'W', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: true, hasDeclarative: false, declarative: null }]);
    renderAt('web');
    await waitFor(() => expect(screen.getByTestId('frame')).toHaveTextContent('web'));
  });
  it('renders DeclarativeForm for a declarative-only plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([{ id: 'cfg', version: '1', nav: { label: 'C', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: false, hasDeclarative: true, declarative: { type: 'object', properties: {} } }]);
    renderAt('cfg');
    await waitFor(() => expect(screen.getByTestId('declform')).toHaveTextContent('cfg'));
  });
  it('shows not-found for an unknown plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([]);
    renderAt('ghost');
    await waitFor(() => expect(screen.getByText(/not found|not installed/i)).toBeInTheDocument());
  });

  it("passes the signed-in user's capabilities to the page", async () => {
    caps = ['lab.receive', 'patients.find'];
    vi.mocked(api.listPluginUis).mockResolvedValue([{ ...lab, requiredCapabilities: ['lab.receive'] }]);
    renderAt('lab');
    const frame = await screen.findByTestId('frame');
    expect(frame.getAttribute('data-caps')).toBe('lab.receive,patients.find');
  });

  it('a typed /x/<id> for a plugin the user may not open never draws the page (review focus 5)', async () => {
    caps = ['reports.view'];
    // The server would leave it out; if an entry still arrives, studio refuses it too.
    vi.mocked(api.listPluginUis).mockResolvedValue([{ ...lab, requiredCapabilities: ['lab.receive'] }]);
    renderAt('lab');
    expect(await screen.findByText(/not found|not installed/i)).toBeInTheDocument();
    expect(screen.queryByTestId('frame')).toBeNull();
  });

  it('a plugin the user may not open looks the same as one that is not installed', async () => {
    caps = ['reports.view'];
    vi.mocked(api.listPluginUis).mockResolvedValue([{ ...lab, requiredCapabilities: ['lab.receive'] }]);
    const denied = renderAt('lab');
    const deniedText = (await screen.findByText(/not found|not installed/i)).textContent;
    denied.unmount();
    vi.mocked(api.listPluginUis).mockResolvedValue([]);
    renderAt('ghost');
    expect((await screen.findByText(/not found|not installed/i)).textContent).toBe(deniedText);
  });

  it('a holder of one listed role opens it without the capabilities', async () => {
    roles = ['lab_admin'];
    vi.mocked(api.listPluginUis).mockResolvedValue([{ ...lab, requiredRoles: ['lab_admin'], requiredCapabilities: ['lab.receive'] }]);
    renderAt('lab');
    expect(await screen.findByTestId('frame')).toBeInTheDocument();
  });

  it('shows the spinner while loading, never the striped empty state', () => {
    vi.mocked(api.listPluginUis).mockReturnValue(new Promise(() => {}));
    const { container } = renderAt('lab');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // StripedEmpty draws its hatch as an absolutely placed svg; none may show while loading.
    expect(container.querySelector('svg.absolute.inset-0')).toBeNull();
    expect(screen.queryByTestId('frame')).toBeNull();
  });

  it('a failed list load shows muted words and no page', async () => {
    vi.mocked(api.listPluginUis).mockRejectedValue(new Error('boom'));
    renderAt('lab');
    expect(await screen.findByText(/could not load this plugin page/i)).toBeInTheDocument();
    expect(screen.queryByTestId('frame')).toBeNull();
  });
});
