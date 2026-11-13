// Which addresses the app trusts. Studio gets an answer only from a page on the launcher's own
// origin, and only when that origin is this computer. Links decide where they open.

/** URL host names that reach only this computer. The URL parser writes the IPv6 loopback in brackets. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** True for an http address on 127.0.0.1, localhost or [::1]. */
export function isLocalAddress(url: string): boolean {
  const u = parse(url);
  return u !== undefined && u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname);
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
