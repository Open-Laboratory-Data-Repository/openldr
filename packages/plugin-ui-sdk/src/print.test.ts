import { describe, it, expect } from 'vitest';
import { checkPrint, pngSize, PRINT_MAX_PAGES, PRINT_MAX_CHARS } from './print';

// Layer: the pure check the host runs on a page's print request. Not covered: the browser's
// print dialog, which only a real browser shows.

/** A PNG data URL whose header says width by height. Only the header is real; the check reads
 *  no further, and the browser's decode is the print frame's own check. */
function pngUrl(width: number, height: number, tail = 'AAAA'): string {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255,
    (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255];
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes)) + tail;
}

describe('pngSize', () => {
  it('reads the width and height from the header', () => {
    expect(pngSize(pngUrl(2480, 3508))).toEqual({ width: 2480, height: 3508 });
    expect(pngSize(pngUrl(1, 1))).toEqual({ width: 1, height: 1 });
    expect(pngSize(pngUrl(0x80000000, 5))).toEqual({ width: 0x80000000, height: 5 });
  });

  it('refuses another type, a bad signature, no IHDR, bad base64 or a short body', () => {
    expect(pngSize(pngUrl(10, 10).replace('image/png', 'image/jpeg'))).toBeNull();
    expect(pngSize(pngUrl(10, 10).replace('data:', 'DATA:'))).toBeNull();
    expect(pngSize('data:image/png;base64,' + btoa('GIF89a' + '\0'.repeat(18)))).toBeNull();
    expect(pngSize(pngUrl(10, 10).replace('SUhEUg', 'SUhEVg'))).toBeNull();
    expect(pngSize(pngUrl(10, 10, 'AA"><'))).toBeNull();
    expect(pngSize(pngUrl(10, 10, 'AAA'))).toBeNull();
    expect(pngSize('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });
});

describe('checkPrint', () => {
  const ok = { title: 'Shipment SHP-0042', paper: 'A4', pages: [pngUrl(2480, 3508)] };

  it('accepts one page and many pages', () => {
    expect(checkPrint(ok)).toBeNull();
    expect(checkPrint({ ...ok, pages: Array.from({ length: PRINT_MAX_PAGES }, () => pngUrl(2480, 3508)) })).toBeNull();
  });

  it('refuses a missing, blank or long title', () => {
    for (const title of [undefined, null, 3, '', '   ', 'x'.repeat(121)]) {
      expect(checkPrint({ ...ok, title })).toBe('print refused: bad title');
    }
    expect(checkPrint({ ...ok, title: 'x'.repeat(120) })).toBeNull();
  });

  it('refuses any paper but A4', () => {
    for (const paper of [undefined, 'a4', 'Letter', 'A3', 4]) expect(checkPrint({ ...ok, paper })).toBe('print refused: bad paper');
  });

  it('refuses no pages and too many', () => {
    for (const pages of [undefined, null, 'x', {}, []]) expect(checkPrint({ ...ok, pages })).toBe('print refused: no pages');
    expect(checkPrint({ ...ok, pages: Array.from({ length: PRINT_MAX_PAGES + 1 }, () => pngUrl(1, 1)) })).toBe('print refused: over 100 pages');
  });

  it('refuses a page that is not a PNG data URL', () => {
    for (const page of [5, null, 'https://example.org/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', pngUrl(1, 1, '<script>')]) {
      expect(checkPrint({ ...ok, pages: [pngUrl(1, 1), page] })).toBe('print refused: a page is not a PNG');
    }
  });

  it('refuses a page of no size or over 10,000 pixels a side', () => {
    for (const [w, h] of [[0, 10], [10, 0], [10_001, 10], [10, 10_001], [0x80000000, 1]]) {
      expect(checkPrint({ ...ok, pages: [pngUrl(w, h)] })).toBe('print refused: a page is too large');
    }
    expect(checkPrint({ ...ok, pages: [pngUrl(10_000, 10_000)] })).toBeNull();
  });

  it('refuses pages over 64 MB together, before reading any header', () => {
    const half = pngUrl(1, 1, 'A'.repeat(PRINT_MAX_CHARS / 2));
    expect(checkPrint({ ...ok, pages: [half, half] })).toBe('print refused: the pages are over 64 MB');
  });
});
