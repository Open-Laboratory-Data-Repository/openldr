import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { fakePort } from './serial-test-fakes';
import { PluginFrame, pluginFrameContext } from './PluginFrame';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    pluginUiAssetUrl: (id: string, version?: string) => `/api/plugins/${id}/ui/asset${version ? `?version=${version}` : ''}`,
    pluginBrokerCall: vi.fn(async () => ({ ok: true, data: null })),
  };
});

describe('PluginFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<div id="panel">hi</div>' })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders a sandboxed iframe (allow-scripts, NOT allow-same-origin) with the wrapped doc', async () => {
    const { container } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    // The plugin frame never opens a dialog of its own; the studio prints for it.
    expect(sandbox).not.toContain('allow-modals');
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<div id="panel">hi</div>');
    expect(srcdoc).toContain('openldr:init');
    expect(srcdoc).toContain('Content-Security-Policy');
  });

  it('puts the studio theme in a style element in <head>, before the plugin body', async () => {
    document.documentElement.style.setProperty('--bg', 'rgb(1, 2, 3)');
    try {
      const { container } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
      const iframe = await waitFor(() => {
        const f = container.querySelector('iframe');
        if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
        return f as HTMLIFrameElement;
      });
      const srcdoc = iframe.getAttribute('srcdoc') ?? '';
      const style = srcdoc.indexOf('<style');
      expect(style).toBeGreaterThan(-1);
      expect(srcdoc).toContain('--openldr-bg:rgb(1, 2, 3)');
      expect(style).toBeGreaterThan(srcdoc.indexOf('Content-Security-Policy'));
      expect(style).toBeLessThan(srcdoc.indexOf('</head>'));
      expect(srcdoc.indexOf('</head>')).toBeLessThan(srcdoc.indexOf('<div id="panel">hi</div>'));
      // The host's style is the first style in the frame, and it names the first layer, so
      // that layer is the lowest. The plugin's own layers (Tailwind's) come later and win.
      expect(srcdoc.indexOf('<style')).toBe(srcdoc.indexOf('<style data-openldr-host-theme'));
      expect(srcdoc.indexOf('@layer')).toBe(srcdoc.indexOf('@layer openldr-host{'));
      expect(srcdoc.indexOf('@layer')).toBeGreaterThan(style);
    } finally {
      document.documentElement.style.removeProperty('--bg');
    }
  });

  it('posts the theme and its tokens to the page when data-theme changes, and on init', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.setProperty('--bg', 'rgb(1, 2, 3)');
    try {
      const { container } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'dark', locale: 'en', sessionId: 's1' }} />);
      const iframe = await waitFor(() => {
        const f = container.querySelector('iframe');
        if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
        return f as HTMLIFrameElement;
      });
      const posted: unknown[] = [];
      Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: (m: unknown) => posted.push(m) } });

      iframe.dispatchEvent(new Event('load'));
      const init = posted[0] as { type: string; context: { theme: string; themeTokens: Record<string, string> } };
      expect(init.type).toBe('openldr:init');
      expect(init.context.themeTokens['--openldr-bg']).toBe('rgb(1, 2, 3)');

      document.documentElement.style.setProperty('--bg', 'rgb(9, 9, 9)');
      document.documentElement.setAttribute('data-theme', 'light');
      await waitFor(() => { if (posted.length < 2) throw new Error('no theme message'); });
      expect(posted[posted.length - 1]).toMatchObject({ type: 'openldr:theme', theme: 'light', tokens: { '--openldr-bg': 'rgb(9, 9, 9)' } });
    } finally {
      document.documentElement.style.removeProperty('--bg');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  });

  it('posts new tokens when the root style changes without a theme switch', async () => {
    document.documentElement.style.setProperty('--brand', 'rgb(1, 1, 1)');
    try {
      const { container } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'dark', locale: 'en', sessionId: 's1' }} />);
      const iframe = await waitFor(() => {
        const f = container.querySelector('iframe');
        if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
        return f as HTMLIFrameElement;
      });
      const posted: Array<{ type: string; tokens?: Record<string, string> }> = [];
      Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: (m: { type: string }) => posted.push(m) } });
      document.documentElement.style.setProperty('--brand', 'rgb(2, 2, 2)');
      await waitFor(() => { if (!posted.some((m) => m.type === 'openldr:theme')) throw new Error('no theme message'); });
      expect(posted.find((m) => m.type === 'openldr:theme')?.tokens?.['--openldr-primary']).toBe('rgb(2, 2, 2)');
    } finally {
      document.documentElement.style.removeProperty('--brand');
    }
  });

  it('keeps its download limit when the page reloads, and closes the old port', async () => {
    Object.assign(URL, { createObjectURL: () => 'blob:frame', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const close = vi.spyOn(MessagePort.prototype, 'close');
    try {
      const { container, unmount } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
      const iframe = await waitFor(() => {
        const f = container.querySelector('iframe');
        if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
        return f as HTMLIFrameElement;
      });
      const ports: MessagePort[] = [];
      Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: (_m: unknown, _o: string, t?: MessagePort[]) => { if (t?.[0]) ports.push(t[0]); } } });
      const ask = (port: MessagePort, id: number) => new Promise<unknown>((resolve) => {
        port.onmessage = (e) => resolve(e.data);
        port.postMessage({ id, op: { kind: 'host.download', filename: 'held.csv', mime: 'text/csv', text: 'a' } });
      });

      iframe.dispatchEvent(new Event('load'));
      expect(await ask(ports[0]!, 1)).toEqual({ id: 1, result: { ok: true, data: null } });
      // jsdom may fire a load of its own first, so count closes from here.
      const base = close.mock.calls.length;
      // The page reloads itself: load fires again and a new port is sent.
      iframe.dispatchEvent(new Event('load'));
      expect(close.mock.calls.length).toBe(base + 1);
      expect(ports).toHaveLength(2);
      expect(await ask(ports[1]!, 2)).toEqual({ id: 2, result: { ok: false, error: 'download refused: one download per second' } });
      // The old port is closed: a message on it gets no answer.
      let answered = false;
      ports[0]!.onmessage = () => { answered = true; };
      ports[0]!.postMessage({ id: 3, op: { kind: 'host.download', filename: 'held.csv', mime: 'text/csv', text: 'a' } });
      await new Promise((r) => setTimeout(r, 50));
      expect(answered).toBe(false);
      expect(click).toHaveBeenCalledTimes(1);
      // Unmounting closes the live port too.
      unmount();
      expect(close.mock.calls.length).toBe(base + 2);
      for (const p of ports) p.close();
    } finally {
      click.mockRestore();
      close.mockRestore();
    }
  });

  it('uses a hardened CSP: no remote (https) images, plus base-uri/form-action lockdown', async () => {
    const { container } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    // The CSP content lives in the <meta http-equiv="Content-Security-Policy" content="..."> tag.
    const m = /Content-Security-Policy"\s+content="([^"]*)"/.exec(srcdoc);
    expect(m).not.toBeNull();
    const csp = m![1];
    // SEC-02: data: images only — remote https images would be an exfiltration channel.
    expect(csp).toContain('img-src data:');
    const imgSrc = /img-src[^;]*/.exec(csp)?.[0] ?? '';
    expect(imgSrc).not.toContain('https:');
    // SEC-02: close base-tag + form-post exfil/navigation paths.
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    // Unchanged hardening still present.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
  });
});

describe('pluginFrameContext', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<div>hi</div>' })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("carries the user's CE capabilities and the plugin's own keys, as a copy", () => {
    const caps = ['lab.receive', 'patients.find', 'reports.view'];
    const ctx = pluginFrameContext('lab', 'page', caps, ['lab.receive', 'lab.worklist.view']);
    expect(ctx).toMatchObject({ pluginId: 'lab', site: 'page', capabilities: caps });
    expect(ctx.capabilities).not.toBe(caps);
  });
  it("leaves out another plugin's keys the user holds", () => {
    const caps = ['lab.receive', 'whonet.review', 'patients.find'];
    expect(pluginFrameContext('lab', 'page', caps, ['lab.receive']).capabilities).toEqual(['lab.receive', 'patients.find']);
    expect(pluginFrameContext('whonet', 'page', caps, ['whonet.review']).capabilities).toEqual(['whonet.review', 'patients.find']);
    // A plugin that declares no keys sees only CE capabilities.
    expect(pluginFrameContext('demo', 'page', caps).capabilities).toEqual(['patients.find']);
  });
  it('sends those capabilities to the page in the init message', async () => {
    const context = pluginFrameContext('ui-demo', 'page', ['lab.receive'], ['lab.receive']);
    const { container } = render(<PluginFrame serialGranted={false} pluginLabel="Demo" pluginVersion="1.0.0" pluginId="ui-demo" context={context} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const posted: unknown[] = [];
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: (m: unknown) => posted.push(m) } });
    iframe.dispatchEvent(new Event('load'));
    expect(posted[0]).toMatchObject({ type: 'openldr:init', context: { capabilities: ['lab.receive'] } });
  });
});

describe('pluginFrameContext on a plain HTTP page', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('makes a sessionId when crypto.randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const ctx = pluginFrameContext('p1', 'page', []);
    expect(ctx.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('PluginFrame, serial ports', () => {
  const realSerial = Object.getOwnPropertyDescriptor(navigator, 'serial');
  const realSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  /** The port the browser's list gives next. */
  let next: ReturnType<typeof fakePort>;
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<div id="panel">hi</div>' })));
    next = fakePort();
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => next.port, addEventListener() {}, removeEventListener() {} } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (realSerial) Object.defineProperty(navigator, 'serial', realSerial); else delete (navigator as unknown as { serial?: unknown }).serial;
    if (realSecure) Object.defineProperty(window, 'isSecureContext', realSecure); else delete (window as unknown as { isSecureContext?: unknown }).isSecureContext;
  });

  const settle = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise<void>((r) => setImmediate(r)); }); };

  /** Draws a frame, fires its load, and gives a way to call the host as the plugin page does. */
  async function mount(props: { serialGranted: boolean | undefined; pluginVersion?: string }) {
    const ui = (p: { serialGranted: boolean | undefined; pluginVersion?: string }) => (
      <PluginFrame pluginId="analyzer" pluginLabel="Analyzer interface" pluginVersion={p.pluginVersion ?? '1.0.0'} serialGranted={p.serialGranted}
        context={{ pluginId: 'analyzer', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />
    );
    const view = render(ui(props));
    const iframe = await waitFor(() => {
      const f = view.container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const ports: MessagePort[] = [];
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage: (_m: unknown, _o: string, t?: MessagePort[]) => { if (t?.[0]) ports.push(t[0]); } } });
    let seq = 0;
    const waiting = new Map<number, (r: { ok: boolean; data?: unknown; error?: string }) => void>();
    const load = () => {
      act(() => { iframe.dispatchEvent(new Event('load')); });
      const port = ports.at(-1)!;
      port.onmessage = (e) => { const m = e.data as { id: number; result: { ok: boolean } }; waiting.get(m.id)?.(m.result); waiting.delete(m.id); };
    };
    const call = (op: Record<string, unknown>) => new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      ports.at(-1)!.postMessage({ id, op });
    });
    /** Chooses the next fake port through the studio's question, and opens it. */
    const openPort = async (): Promise<string> => {
      const chosen = call({ kind: 'host.serial.choose' });
      const button = await screen.findByRole('button', { name: 'Choose port' });
      await act(async () => { fireEvent.click(button); });
      const picked = await chosen;
      if (!picked.ok) throw new Error(`choose refused: ${picked.error}`);
      const handle = (picked.data as { port: string }).port;
      const opened = await call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } });
      if (!opened.ok) throw new Error(`open refused: ${opened.error}`);
      return handle;
    };
    load();
    return { ...view, load, call, openPort, rerender: (p: { serialGranted: boolean | undefined; pluginVersion?: string }) => view.rerender(ui(p)), closePorts: () => { for (const p of ports) p.close(); } };
  }

  it('refuses serial calls while the grant is not known', async () => {
    const f = await mount({ serialGranted: undefined });
    expect(await f.call({ kind: 'host.serial.ports' })).toEqual({ ok: false, error: 'serial-not-granted' });
    expect(await f.call({ kind: 'host.serial.choose' })).toEqual({ ok: false, error: 'serial-not-granted' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    f.closePorts();
  });

  it('refuses serial calls for a plugin without the grant', async () => {
    const f = await mount({ serialGranted: false });
    expect(await f.call({ kind: 'host.serial.choose' })).toEqual({ ok: false, error: 'serial-not-granted' });
    f.closePorts();
  });

  it('asks with the plugin\'s label from the listing, then gives the page a port it can open', async () => {
    const f = await mount({ serialGranted: true });
    const chosen = f.call({ kind: 'host.serial.choose' });
    expect(await screen.findByText('Analyzer interface wants to use a serial port')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose port' })); });
    const picked = await chosen;
    expect(picked.ok).toBe(true);
    const handle = (picked.data as { port: string }).port;
    expect(await f.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual({ ok: true, data: null });
    next.push([1, 2, 3]);
    await settle();
    const read = await f.call({ kind: 'host.serial.read', port: handle, waitMs: 0 });
    expect(Array.from((read.data as { bytes: Uint8Array }).bytes)).toEqual([1, 2, 3]);
    f.closePorts();
  });

  it('closes the ports when the grant is taken away', async () => {
    const f = await mount({ serialGranted: true });
    const port = next;
    const handle = await f.openPort();
    f.rerender({ serialGranted: false });
    await settle();
    expect(port.events).toContain('port.closed');
    expect(await f.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual({ ok: false, error: 'serial-not-granted' });
    f.closePorts();
  });

  it('closes the ports when the plugin version changes, though serial stays true', async () => {
    const f = await mount({ serialGranted: true });
    const port = next;
    await f.openPort();
    f.rerender({ serialGranted: true, pluginVersion: '1.1.0' });
    await settle();
    expect(port.events).toContain('port.closed');
    f.closePorts();
  });

  it('gives the new version a fresh page, and the old page nothing', async () => {
    // The page's HTML is the same in both versions. The old document must still go.
    let release: () => void = () => {};
    const f = await mount({ serialGranted: true });
    const oldFrame = f.container.querySelector('iframe');
    const handle = await f.openPort();
    const fetches = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    // The new version's page is slow to arrive.
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = () => resolve({ ok: true, text: async () => '<div id="panel">hi</div>' }); })));
    f.rerender({ serialGranted: true, pluginVersion: '1.1.0' });
    await settle();
    expect(fetches).toBeGreaterThan(0);
    // While it loads there is no page, and the old page's channel is dead: no answer at all.
    expect(f.container.querySelector('iframe')).toBeNull();
    let answered = false;
    void f.call({ kind: 'host.serial.choose' }).then(() => { answered = true; });
    void f.call({ kind: 'host.serial.read', port: handle, waitMs: 0 }).then(() => { answered = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(answered).toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () => { release(); });
    const fresh = await waitFor(() => {
      const el = f.container.querySelector('iframe');
      if (!el) throw new Error('not ready');
      return el;
    });
    expect(fresh).not.toBe(oldFrame);
    f.closePorts();
  });

  it('shows no page when the new version\'s page cannot be loaded, and leaves the old one dead', async () => {
    const f = await mount({ serialGranted: true });
    const port = next;
    await f.openPort();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));
    f.rerender({ serialGranted: true, pluginVersion: '1.1.0' });
    await settle();
    expect(f.container.querySelector('iframe')).toBeNull();
    expect(port.events).toContain('port.closed');
    let answered = false;
    void f.call({ kind: 'host.serial.choose' }).then(() => { answered = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(answered).toBe(false);
    f.closePorts();
  });

  it('asks the server for the page of the version the listing named', async () => {
    const f = await mount({ serialGranted: true, pluginVersion: '1.4.2' });
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/api/plugins/analyzer/ui/asset?version=1.4.2'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/ui/asset'))).toBe(false);
    f.closePorts();
  });

  it('draws no page when the server says another version is active now', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, text: async () => '{"error":"plugin version changed"}' })));
    const view = render(
      <PluginFrame pluginId="analyzer" pluginLabel="Analyzer interface" pluginVersion="1.0.0" serialGranted
        context={{ pluginId: 'analyzer', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />,
    );
    await settle();
    expect(view.container.querySelector('iframe')).toBeNull();
  });

  it('closes the ports when the frame unmounts', async () => {
    const f = await mount({ serialGranted: true });
    const port = next;
    await f.openPort();
    f.unmount();
    await settle();
    expect(port.events).toContain('port.closed');
    f.closePorts();
  });

  it('closes the ports and forgets the handles when the frame loads again', async () => {
    const f = await mount({ serialGranted: true });
    const port = next;
    const handle = await f.openPort();
    f.load();
    await settle();
    expect(port.events).toContain('port.closed');
    expect(await f.call({ kind: 'host.serial.ports' })).toEqual({ ok: true, data: [] });
    expect(await f.call({ kind: 'host.serial.read', port: handle, waitMs: 0 })).toEqual({ ok: false, error: 'serial-unknown-port' });
    f.closePorts();
  });

  it('ends a call that was waiting when the frame loaded again', async () => {
    const f = await mount({ serialGranted: true });
    const port = next;
    const handle = await f.openPort();
    void f.call({ kind: 'host.serial.read', port: handle, waitMs: 30_000 });
    await settle();
    f.load();
    await settle();
    // The waiting read no longer holds the port: its reader was cancelled and the port closed.
    expect(port.events).toEqual(['open', 'reader.cancel', 'writer.abort', 'port.close', 'port.closed']);
    f.closePorts();
  });

  it('closes the question when the frame loads again', async () => {
    const f = await mount({ serialGranted: true });
    void f.call({ kind: 'host.serial.choose' });
    await screen.findByRole('button', { name: 'Choose port' });
    f.load();
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    f.closePorts();
  });

  it('will not open a port that another frame on the page holds', async () => {
    const first = await mount({ serialGranted: true });
    const shared = next;
    await first.openPort();
    const second = await mount({ serialGranted: true });
    next = shared;
    const chosen = second.call({ kind: 'host.serial.choose' });
    const button = await screen.findByRole('button', { name: 'Choose port' });
    await act(async () => { fireEvent.click(button); });
    const handle = ((await chosen).data as { port: string }).port;
    expect(await second.call({ kind: 'host.serial.open', port: handle, settings: { baudRate: 9600 } })).toEqual({ ok: false, error: 'serial-busy' });
    expect(shared.events.filter((e) => e === 'open')).toHaveLength(1);
    first.closePorts(); second.closePorts();
  });
});
