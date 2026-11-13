// Which addresses the app trusts. Studio gets an answer only from a page on the launcher's own
// origin, and only when that origin is this computer. Links decide where they open.

/**
 * URL host names that reach only this computer. The URL parser writes the IPv6 loopback in
 * brackets. `localhost` is not one: Chromium tries ::1 first for it, and another program may
 * listen there while the launcher listens on 127.0.0.1.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', '[::1]']);

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** True for an http address on 127.0.0.1 or [::1]. */
export function isLocalAddress(url: string): boolean {
  const u = parse(url);
  return u !== undefined && u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname);
}

/**
 * The address the window loads. The launcher prints `localhost`, but it listens only on the host
 * it was given. A `localhost` address becomes that host: 127.0.0.1, or [::1] for ::1. Any other
 * host, no host, or an address not on `localhost` gives the address unchanged.
 */
export function windowAddress(address: string, host: string | undefined): string {
  const literal = host === '127.0.0.1' ? '127.0.0.1' : host === '::1' ? '[::1]' : undefined;
  const u = parse(address);
  if (literal === undefined || u === undefined || u.hostname !== 'localhost') return address;
  u.hostname = literal;
  return u.href;
}

/** True when both are URLs with the same scheme, host and port. A URL with no origin, such as file:, matches nothing. */
export function sameOrigin(a: string, b: string): boolean {
  const ua = parse(a);
  const ub = parse(b);
  if (ua === undefined || ub === undefined || ua.origin === 'null') return false;
  return ua.origin === ub.origin;
}

/** True only for a sender on the launcher's origin, when the launcher's address is this computer. */
export function mayAnswerStudio(senderUrl: string, launcherAddress: string | undefined): boolean {
  if (launcherAddress === undefined || !isLocalAddress(launcherAddress)) return false;
  return sameOrigin(senderUrl, launcherAddress);
}

/** The URL without its query and hash. */
function page(u: URL): string {
  return `${u.protocol}//${u.host}${u.pathname}`;
}

/**
 * Where a URL opens. The launcher's origin and the app's own pages stay `inside` the window.
 * Any other http, https or mailto URL goes to the person's `browser`. Everything else is refused.
 */
export function linkTarget(
  url: string,
  launcherAddress: string | undefined,
  ownPages: readonly string[],
): 'inside' | 'browser' | 'refuse' {
  const u = parse(url);
  if (u === undefined) return 'refuse';
  if (launcherAddress !== undefined && sameOrigin(url, launcherAddress)) return 'inside';
  for (const own of ownPages) {
    const o = parse(own);
    if (o !== undefined && page(o) === page(u)) return 'inside';
  }
  if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return 'browser';
  return 'refuse';
}

/**
 * Whether the window may grant a permission. Every request is refused, with one exception: a
 * sanitized clipboard write from a page on the window's own address, for Studio's copy buttons,
 * and only while that address is this computer.
 */
export function mayGrantPermission(permission: string, requestingUrl: string, shownAddress: string | undefined): boolean {
  if (permission !== 'clipboard-sanitized-write' || shownAddress === undefined) return false;
  return isLocalAddress(shownAddress) && sameOrigin(requestingUrl, shownAddress);
}

/** The two about: pages a frame may load. Studio's plugin frames load `about:srcdoc`. */
const FRAME_ABOUT_PAGES = new Set(['blank', 'srcdoc']);

/**
 * Whether a navigation inside a frame (not the main frame) may go ahead. A frame may stay on the
 * launcher's origin (a `blob:` URL of that origin counts), or load about:blank or about:srcdoc.
 * Anything else is refused, and is not opened in the browser either.
 */
export function frameTarget(url: string, launcherAddress: string | undefined): 'allow' | 'refuse' {
  const u = parse(url);
  if (u === undefined) return 'refuse';
  if (u.protocol === 'about:') return FRAME_ABOUT_PAGES.has(u.pathname) ? 'allow' : 'refuse';
  if (launcherAddress !== undefined && sameOrigin(url, launcherAddress)) return 'allow';
  return 'refuse';
}

/**
 * Whether the window must show the current screen again once a load has finished or failed: the
 * screen is not Studio, and the load was not the app's own page. A failed load of the app's own
 * page gives false, so it is not loaded again and again.
 */
export function renderAfterLoad(currentIsStudio: boolean, loadedUrl: string, ownPage: string): boolean {
  return !currentIsStudio && linkTarget(loadedUrl, undefined, [ownPage]) !== 'inside';
}

/** A URL for the log: its origin and path, never its query or fragment, which may hold a token. */
export function urlForLog(url: string): string {
  const u = parse(url);
  if (u === undefined) return '(unreadable address)';
  if (u.origin !== 'null') return `${u.origin}${u.pathname}`;
  return u.pathname.startsWith('/') ? `${u.protocol}//${u.host}${u.pathname}` : `${u.protocol}${u.pathname}`;
}
