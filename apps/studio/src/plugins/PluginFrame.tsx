import { useEffect, useRef, useState } from 'react';
import { SDK_BOOTSTRAP_V1, type PluginInitContext, type PluginSiteName } from '@openldr/plugin-ui-sdk';
import i18n from '@/i18n';
import { authFetch, pluginUiAssetUrl, pluginBrokerCall } from '@/api';
import { wireHostPort, type HostPortLike } from './host-bridge';
import { hostThemeTokens, themeStyleTag } from './plugin-theme';

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** The host's current theme (the app sets data-theme on <html> via useTheme; dark default). */
function hostTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** The init context for one drawing of a plugin's page. `site` tells the page where it is:
 *  its own page, a dashboard card, or the side panel. */
export function pluginFrameContext(pluginId: string, site: PluginSiteName): PluginInitContext {
  return { pluginId, capabilities: [], theme: hostTheme(), locale: i18n.language, sessionId: crypto.randomUUID(), site };
}

/** Wrap the plugin's body HTML in a host-controlled document: strict CSP + the injected SDK
 *  bootstrap as the FIRST script, then the plugin content. No same-origin, no network. The
 *  theme is stamped on <html>, and the studio's theme tokens go in a <style> in <head>, so the
 *  page's first paint already has the host's colours. */
function buildSrcdoc(pluginBodyHtml: string, theme: 'light' | 'dark', tokens: Record<string, string>): string {
  return `<!doctype html><html data-openldr-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${themeStyleTag(tokens)}</head><body><script>${SDK_BOOTSTRAP_V1}</script>${pluginBodyHtml}</body></html>`;
}

export function PluginFrame({ pluginId, context }: { pluginId: string; context: PluginInitContext }): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(pluginUiAssetUrl(pluginId))
      .then(async (r) => { if (!r.ok) throw new Error(`asset ${r.status}`); return r.text(); })
      // Stamp the host theme at mount; later changes are pushed via postMessage below.
      .then((html) => { if (!cancelled) setSrcdoc(buildSrcdoc(html, hostTheme(), hostThemeTokens())); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [pluginId]);

  // The sandboxed iframe can't see host CSS, so push host theme changes into it. The studio
  // switches light and dark with data-theme on <html>. A change to the root's style or class
  // can also change its colours, so watch those too. Send only when something changed.
  useEffect(() => {
    let last = '';
    const observer = new MutationObserver(() => {
      const theme = hostTheme();
      const tokens = hostThemeTokens();
      const key = JSON.stringify([theme, tokens]);
      if (key === last) return;
      last = key;
      iframeRef.current?.contentWindow?.postMessage({ type: 'openldr:theme', theme, tokens }, '*');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => observer.disconnect();
  }, []);

  function onLoad() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    wireHostPort(channel.port1 as unknown as HostPortLike, { call: (op) => pluginBrokerCall(pluginId, op) });
    channel.port1.start();
    win.postMessage({ type: 'openldr:init', context: { ...context, theme: hostTheme(), themeTokens: hostThemeTokens() } }, '*', [channel.port2]);
  }

  if (error) return <div className="p-6 text-sm text-destructive">Failed to load plugin UI: {error}</div>;
  if (!srcdoc) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return (
    <iframe
      ref={iframeRef}
      title={`plugin-${pluginId}`}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      onLoad={onLoad}
      className="block h-full w-full border-0"
    />
  );
}
