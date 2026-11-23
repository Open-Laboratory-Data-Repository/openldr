import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PluginFrame, pluginFrameContext } from './PluginFrame';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    pluginUiAssetUrl: (id: string) => `/api/plugins/${id}/ui/asset`,
    pluginBrokerCall: vi.fn(async () => ({ ok: true, data: null })),
  };
});

describe('PluginFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<div id="panel">hi</div>' })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders a sandboxed iframe (allow-scripts, NOT allow-same-origin) with the wrapped doc', async () => {
    const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<div id="panel">hi</div>');
    expect(srcdoc).toContain('openldr:init');
    expect(srcdoc).toContain('Content-Security-Policy');
  });

  it('puts the studio theme in a style element in <head>, before the plugin body', async () => {
    document.documentElement.style.setProperty('--bg', 'rgb(1, 2, 3)');
    try {
      const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
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
      const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'dark', locale: 'en', sessionId: 's1' }} />);
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
      const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'dark', locale: 'en', sessionId: 's1' }} />);
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
      const { container, unmount } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
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
    const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
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
  it("carries the user's capabilities, the plugin's own keys included, as a copy", () => {
    const caps = ['lab.receive', 'patients.find', 'reports.view'];
    const ctx = pluginFrameContext('lab', 'page', caps);
    expect(ctx).toMatchObject({ pluginId: 'lab', site: 'page', capabilities: caps });
    expect(ctx.capabilities).not.toBe(caps);
  });
  it('sends those capabilities to the page in the init message', async () => {
    const context = pluginFrameContext('ui-demo', 'page', ['lab.receive']);
    const { container } = render(<PluginFrame pluginId="ui-demo" context={context} />);
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
