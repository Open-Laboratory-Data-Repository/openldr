import { describe, it, expect } from 'vitest';
import { checkDownload, utf8ByteLength, DOWNLOAD_MAX_BYTES } from './files';

// Layer: the pure check the host runs on a page's download request. Not covered: the browser's
// own download, which only a real browser shows.
describe('checkDownload', () => {
  const ok = { filename: 'held-requests.csv', mime: 'text/csv', text: 'a,b\n' };

  it('accepts each of the three types with its own extension', () => {
    expect(checkDownload(ok)).toBeNull();
    expect(checkDownload({ filename: 'report_2026-11-16.json', mime: 'application/json', text: '{}' })).toBeNull();
    expect(checkDownload({ filename: 'Notes.v2.txt', mime: 'text/plain', text: '' })).toBeNull();
    expect(checkDownload({ filename: `${'a'.repeat(81)}.csv`, mime: 'text/csv', text: '' })).toBeNull();
  });

  it('refuses a name with a path part, a bad start, a bad character, no extension or too long', () => {
    for (const filename of [
      '../held.csv', 'dir/held.csv', 'dir\\held.csv', '/held.csv', 'C:held.csv', '.held.csv', '-held.csv', '_held.csv',
      'held .csv', 'held%2F.csv', 'héld.csv', 'held.csv\n', 'held.csv ', 'held', 'held.', '.csv', 'held.exe', 'held.CSV', 'held.csv.exe',
      `${'a'.repeat(82)}.csv`, '',
    ]) {
      expect(checkDownload({ ...ok, filename })).toBe('download refused: bad file name');
    }
    for (const filename of [undefined, null, 5, {}, ['held.csv']]) {
      expect(checkDownload({ ...ok, filename })).toBe('download refused: bad file name');
    }
  });

  it('refuses a type outside the three', () => {
    for (const mime of ['text/html', 'application/octet-stream', 'image/svg+xml', 'text/csv; charset=utf-8', 'TEXT/CSV', '', undefined, 3]) {
      expect(checkDownload({ ...ok, mime })).toBe('download refused: bad type');
    }
  });

  it('refuses an extension that does not fit the type', () => {
    expect(checkDownload({ filename: 'held.csv', mime: 'application/json', text: '' })).toBe('download refused: the name does not fit the type');
    expect(checkDownload({ filename: 'held.json', mime: 'text/csv', text: '' })).toBe('download refused: the name does not fit the type');
    expect(checkDownload({ filename: 'held.txt', mime: 'text/csv', text: '' })).toBe('download refused: the name does not fit the type');
    expect(checkDownload({ filename: 'held.csv', mime: 'text/plain', text: '' })).toBe('download refused: the name does not fit the type');
  });

  it('refuses text that is not a string', () => {
    for (const text of [undefined, null, 5, { a: 1 }, ['a']]) {
      expect(checkDownload({ ...ok, text })).toBe('download refused: bad text');
    }
    expect(checkDownload(null)).toBe('download refused: bad file name');
  });

  it('refuses text over 64 MB counted in UTF-8 bytes, not in characters', () => {
    expect(DOWNLOAD_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(checkDownload({ ...ok, text: 'a'.repeat(DOWNLOAD_MAX_BYTES) })).toBeNull();
    expect(checkDownload({ ...ok, text: 'a'.repeat(DOWNLOAD_MAX_BYTES + 1) })).toBe('download refused: the text is over 64 MB');
    // Two bytes each: half as many characters reach the limit.
    expect(checkDownload({ ...ok, text: 'é'.repeat(DOWNLOAD_MAX_BYTES / 2) })).toBeNull();
    expect(checkDownload({ ...ok, text: 'é'.repeat(DOWNLOAD_MAX_BYTES / 2 + 1) })).toBe('download refused: the text is over 64 MB');
  });
});

describe('utf8ByteLength', () => {
  it('matches TextEncoder for ASCII, two-, three- and four-byte characters and lone surrogates', () => {
    for (const s of ['', 'abc', 'é', 'Maria Gonçalves', '€', '日本語', '😀', 'a😀b', '\ud800', '\udc00x', 'x\ud800', '\ud800𐀀']) {
      expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
    }
  });
});
