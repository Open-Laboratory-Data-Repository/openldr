import { useEffect, useMemo, useRef, useState } from 'react';
import { SDK_BOOTSTRAP_V1, type PluginInitContext, type PluginSiteName } from '@openldr/plugin-ui-sdk';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { LoadingState } from '@/components/ui/spinner';
import { LoadFailed, useLoadErrorToast } from '@/components/ui/load-failed';
import { authFetch, listPluginUis, pluginUiAssetUrl, pluginBrokerCall } from '@/api';
import { createDownloadGate, wireHostPort, type DownloadGate, type HostPortLike } from './host-bridge';
import { createPrintGate, type PrintGate } from './print-frame';
import { createSerialGate, type SerialGate, type SerialPortLike } from './serial-gate';
import { nativeSerial } from './serial-native';
import { isOpenElsewhere, registerOpenPorts } from './serial-registry';
import { watchGrant } from './serial-grant-watch';
import { useSerialPrompt } from './SerialPrompt';
import { hostThemeTokens, themeStyleTag } from './plugin-theme';
import { randomId } from '@/lib/random-id';
import { CAPABILITY_KEYS } from '@openldr/rbac';

const CE_KEYS: ReadonlySet<string> = new Set(CAPABILITY_KEYS);

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** The host's current theme (the app sets data-theme on <html> via useTheme; dark default). */
function hostTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** The init context for one drawing of a plugin's page. `site` tells the page where it is:
 *  its own page, a dashboard card, or the side panel. `capabilities` are the signed-in user's CE
 *  capabilities plus those of `ownKeys` (the plugin's declared permission keys) the user holds.
 *  Another plugin's keys are left out. The page uses them only to show or hide its own tabs; the
 *  broker on the server is the real gate. */
export function pluginFrameContext(
  pluginId: string, site: PluginSiteName, capabilities: readonly string[], ownKeys: readonly string[] = [],
): PluginInitContext {
  const own = new Set(ownKeys);
  const passed = capabilities.filter((k) => CE_KEYS.has(k) || own.has(k));
  return { pluginId, capabilities: passed, theme: hostTheme(), locale: i18n.language, sessionId: randomId(), site };
}

/** Wrap the plugin's body HTML in a host-controlled document: strict CSP + the injected SDK
 *  bootstrap as the FIRST script, then the plugin content. No same-origin, no network. The
 *  theme is stamped on <html>, and the studio's theme tokens go in a <style> in <head>, so the
 *  page's first paint already has the host's colours. */
function buildSrcdoc(pluginBodyHtml: string, theme: 'light' | 'dark', tokens: Record<string, string>): string {
  return `<!doctype html><html data-openldr-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${themeStyleTag(tokens)}</head><body><script>${SDK_BOOTSTRAP_V1}</script>${pluginBodyHtml}</body></html>`;
}

export interface PluginFrameProps {
  pluginId: string;
  context: PluginInitContext;
  /** Whether the plugin's active version holds host:serial, from the server's listing. Undefined
   *  while the listing loads: every serial call is then refused. */
  serialGranted: boolean | undefined;
  /** The plugin's name from the server's listing. The serial question shows this, never anything
   *  the plugin's page sent. */
  pluginLabel: string;
  /** The listing's version. A change of version closes the ports. */
  pluginVersion: string;
}

/** How often a frame that has gone looks whether its last ports are closed. */
const RETIRE_CHECK_MS = 250;

export function PluginFrame({ pluginId, context, serialGranted, pluginLabel, pluginVersion }: PluginFrameProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  // The reason goes in a toast; the frame keeps only muted words in its place.
  useLoadErrorToast(error, t('plugins.loadFailed'));
  // One download limit per mounted frame. A page can reload itself, which fires load again; the
  // limit must hold across that, so it lives here and not in one wiring.
  const gateRef = useRef<DownloadGate | null>(null);
  // The live port. A reload gets a new one, and the old one is closed.
  const portRef = useRef<MessagePort | null>(null);
  // One print at a time per mounted frame, across its reloads. Leaving the page removes an open print frame.
  const printRef = useRef<PrintGate | null>(null);

  // Serial ports. Unlike the download and print limits, the gate is NOT kept across a reload: a
  // port must not outlive the page that was given it. Every load gets a fresh gate.
  const serial = useMemo(() => nativeSerial(navigator, window.isSecureContext === true), []);
  const prompt = useSerialPrompt(pluginLabel, serial);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const serialRef = useRef<SerialGate | null>(null);
  /** Gates of earlier loads. One stays here until its last port is really closed, so another frame
   *  cannot open that port meanwhile. */
  const retiredRef = useRef<SerialGate[]>([]);
  const grantedRef = useRef(serialGranted);
  grantedRef.current = serialGranted;
  /** Set when the once-a-minute check found the grant gone. It holds until the listing is read again. */
  const lostRef = useRef(false);
  /** Every port this frame holds, in the live gate and in the retired ones. */
  const heldPorts = useRef((): readonly SerialPortLike[] => {
    retiredRef.current = retiredRef.current.filter((g) => g.open().length > 0);
    return [...(serialRef.current?.open() ?? []), ...retiredRef.current.flatMap((g) => g.open())];
  }).current;
  /** Closes the live gate's ports and kills its handles. The gate stays in view until they are closed. */
  const retire = useRef((): void => {
    const gate = serialRef.current;
    if (gate === null) return;
    serialRef.current = null;
    retiredRef.current.push(gate);
    void gate.closeAll();
  }).current;

  useEffect(() => {
    const remove = registerOpenPorts(heldPorts);
    return () => {
      retire();
      // The list stays registered until the last port is closed, also one that was still opening.
      const check = (): void => { if (heldPorts().length === 0) remove(); else setTimeout(check, RETIRE_CHECK_MS); };
      check();
    };
  }, [heldPorts, retire]);

  // The grant was taken away, or another version of the plugin is active now: the ports close.
  const seen = useRef({ granted: serialGranted, version: pluginVersion });
  useEffect(() => {
    const before = seen.current;
    seen.current = { granted: serialGranted, version: pluginVersion };
    // What the listing says now replaces what the check found.
    lostRef.current = false;
    if ((before.granted === true && serialGranted !== true) || before.version !== pluginVersion) void serialRef.current?.closeAll();
  }, [serialGranted, pluginVersion]);

  // The studio reads the listing once. While a port is open, ask the server once a minute.
  useEffect(() => watchGrant({
    pluginId,
    version: pluginVersion,
    hasOpenPorts: () => heldPorts().length > 0,
    fetchListing: listPluginUis,
    onLost: () => {
      lostRef.current = true;
      void serialRef.current?.closeAll();
    },
  }), [pluginId, pluginVersion, heldPorts]);

  useEffect(() => () => {
    portRef.current?.close(); portRef.current = null;
    printRef.current?.dispose(); printRef.current = null;
  }, []);

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
    portRef.current?.close();
    // Before the new channel is attached: the old page's ports close and its handles die.
    retire();
    const gate = createSerialGate({
      serial,
      granted: () => (lostRef.current ? false : grantedRef.current),
      pick: () => promptRef.current.pick(),
      openElsewhere: (p) => isOpenElsewhere(p, heldPorts) || retiredRef.current.some((g) => g.open().includes(p)),
      cancelPick: () => promptRef.current.cancel(),
    });
    serialRef.current = gate;
    const channel = new MessageChannel();
    portRef.current = channel.port1;
    gateRef.current ??= createDownloadGate();
    printRef.current ??= createPrintGate();
    wireHostPort(channel.port1 as unknown as HostPortLike, { call: (op) => pluginBrokerCall(pluginId, op), gate: gateRef.current, print: printRef.current, serial: gate,
      edition: async (key, open) => {
        if (context.site !== 'page') return false;
        const path = '/reports/issued/' + encodeURIComponent(pluginId) + '/' + encodeURIComponent(key);
        const response = await authFetch('/api' + path, {method:'HEAD'});
        if ([401,403,404].includes(response.status)) return false;
        if (!response.ok) throw Error('Report lookup failed');
        if (open) {
          history.replaceState(history.state, '', '/studio/x/' + encodeURIComponent(pluginId) + '?edition=' + encodeURIComponent(key));
          window.location.assign('/studio' + path);
        }
        return true;
      },
    });
    channel.port1.start();
    win.postMessage({ type: 'openldr:init', context: { ...context, edition: context.site === 'page' ? new URLSearchParams(window.location.search).get('edition') ?? undefined : undefined, theme: hostTheme(), themeTokens: hostThemeTokens() } }, '*', [channel.port2]);
  }

  if (error) return <LoadFailed className="min-h-0 h-full" message={t('plugins.loadFailed')} />;
  if (!srcdoc) return <LoadingState />;
  return (
    <>
      <iframe
        ref={iframeRef}
        title={`plugin-${pluginId}`}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        onLoad={onLoad}
        className="block h-full w-full border-0"
      />
      {prompt.element}
    </>
  );
}
