import type { PluginDownloadMime } from './types';

/** The most a page may save in one file, counted in UTF-8 bytes. */
export const DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;

/** A file name with no path part: a letter or digit first, then letters, digits, dot, dash or
 *  underscore, then one of the three extensions. */
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(csv|json|txt)$/;

const EXTENSION_OF: Record<PluginDownloadMime, string> = {
  'text/csv': 'csv',
  'application/json': 'json',
  'text/plain': 'txt',
};

/** The UTF-8 length of a string, counted without making a copy of it. A lone surrogate counts
 *  as 3 bytes, as TextEncoder writes it as U+FFFD. */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
    } else n += 3;
  }
  return n;
}

/** The host's check of a page's request to save a file. Null means it may be saved. Otherwise a
 *  short fixed error that never quotes the name or the text. A page is less trusted than the
 *  studio, so every field is checked as if it were not typed. */
export function checkDownload(input: unknown): string | null {
  const { filename, mime, text } = (input ?? {}) as { filename?: unknown; mime?: unknown; text?: unknown };
  if (typeof filename !== 'string' || !FILENAME.test(filename)) return 'download refused: bad file name';
  if (typeof mime !== 'string' || !Object.prototype.hasOwnProperty.call(EXTENSION_OF, mime)) return 'download refused: bad type';
  if (!filename.endsWith(`.${EXTENSION_OF[mime as PluginDownloadMime]}`)) return 'download refused: the name does not fit the type';
  if (typeof text !== 'string') return 'download refused: bad text';
  // Each UTF-16 unit is at least one UTF-8 byte and at most three, so only the middle needs a count.
  if (text.length > DOWNLOAD_MAX_BYTES) return 'download refused: the text is over 64 MB';
  if (text.length * 3 > DOWNLOAD_MAX_BYTES && utf8ByteLength(text) > DOWNLOAD_MAX_BYTES) return 'download refused: the text is over 64 MB';
  return null;
}
