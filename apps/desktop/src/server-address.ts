// The address of the OpenLDR this app shows in connect mode, as a person types it.

export type ParsedAddress =
  | { ok: true; address: string; origin: string; host: string; port: number }
  | { ok: false; reason: 'empty' | 'not-https' | 'unreadable' };

/**
 * What a person typed, as the address the window loads. `address` always ends in '/studio/'.
 *
 * No scheme means https. The host is lower-cased, and the path, query and hash are dropped, so one
 * server typed in many shapes gives one address. Plain http is refused, because sign-in and
 * patient data would cross the network unencrypted. The one exception is 127.0.0.1, this same PC.
 */
export function parseServerAddress(input: string): ParsedAddress {
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  // The URL parser would turn a space into %20 and carry on.
  if (/\s/.test(text)) return { ok: false, reason: 'unreadable' };
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'unreadable' };
  if (url.username !== '' || url.password !== '' || url.hostname === '' || url.port === '0') return { ok: false, reason: 'unreadable' };
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (url.protocol === 'http:' && host !== '127.0.0.1') return { ok: false, reason: 'not-https' };
  const port = url.port !== '' ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  return { ok: true, address: `${url.origin}/studio/`, origin: url.origin, host, port };
}
