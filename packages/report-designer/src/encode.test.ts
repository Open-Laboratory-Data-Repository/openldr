import { describe, it, expect } from 'vitest';
import { encodeCode128, encodeQr, QR_QUIET_ZONE, MIN_MODULE_MM, moduleWidthMm, maxCode128Chars, minWidthPxFor } from './encode';

const bits = (bars: boolean[] | null): string => (bars ?? []).map((b) => (b ? '1' : '0')).join('');

describe('encodeCode128', () => {
  /**
   * ⛔ THESE GOLDEN VECTORS ARE THE WHOLE MITIGATION for importing jsbarcode by a private subpath.
   *
   * A moved or renamed encoder file fails the import loudly, which is easy. The dangerous failure is
   * a jsbarcode bump that keeps the path and changes the ENCODING — a barcode that still scans, as a
   * different string. Nothing else in this repo would notice: the type checker sees a string, the
   * renderer draws whatever bars it is given, and the PDF looks correct to a human. Pinning the exact
   * bytes is the only thing standing between that and a mis-identified specimen.
   *
   * Measured from `jsbarcode@3.12.3` CODE128_AUTO. If a bump changes these, do NOT re-bless them
   * without decoding the new output with an independent decoder first.
   */
  it('encodes a numeric lab number to the pinned Code C bitstring', () => {
    expect(bits(encodeCode128('1234567890'))).toBe(
      '110100111001011001110010001011000111000101101100001010011011110110100111100101100011101011');
  });

  it('encodes an alphanumeric lab number to the pinned bitstring', () => {
    expect(bits(encodeCode128('TZ00123/26'))).toBe(
      '1101001000011011100010111011000101001110110010111011110110011011001110110111011101011110101110011001100111001011001110100100011001001100011101011');
  });

  it('uses Code C for digit runs — a 10-digit value is far narrower than an alphanumeric one', () => {
    // 90 vs 145 modules. This is the property that makes the barcode fit the header band, so it is
    // asserted as behaviour rather than left implicit in the vectors above: a silent regression to
    // CODE128B keeps every barcode scannable and makes them all ~60% wider.
    expect(encodeCode128('1234567890')).toHaveLength(90);
    expect(encodeCode128('TZ00123/26')).toHaveLength(145);
  });

  it('starts and ends with a bar, as every Code 128 symbol must', () => {
    const bars = encodeCode128('TZ00123/26')!;
    expect(bars[0]).toBe(true);
    expect(bars[bars.length - 1]).toBe(true);
  });

  it('returns null rather than throwing for empty or unencodable input', () => {
    expect(encodeCode128('')).toBeNull();
    // Outside Code 128's ASCII repertoire — e.g. the mojibake units CE carries at the FHIR layer.
    expect(encodeCode128('æmol/l  あ')).toBeNull();
  });
});

describe('encodeQr', () => {
  it('encodes to the pinned smallest-version matrix', () => {
    const m = encodeQr('TZ00123/26')!;
    expect(m).toHaveLength(21);            // version 1
    expect(m.every((row) => row.length === 21)).toBe(true);
    expect(m[0].map((d) => (d ? '1' : '0')).join('')).toBe('111111101100101111111');
  });

  it('places the three finder patterns, which is what a scanner locks onto first', () => {
    const m = encodeQr('TZ00123/26')!;
    const n = m.length;
    // A finder is a 7x7 ring: dark border, light inner ring, 3x3 dark core.
    const finderAt = (r0: number, c0: number): boolean =>
      m[r0][c0] && m[r0 + 6][c0 + 6] && !m[r0 + 1][c0 + 1] && m[r0 + 3][c0 + 3];
    expect(finderAt(0, 0)).toBe(true);           // top-left
    expect(finderAt(0, n - 7)).toBe(true);       // top-right
    expect(finderAt(n - 7, 0)).toBe(true);       // bottom-left
  });

  it('grows the version for a longer payload instead of failing', () => {
    expect(encodeQr('x'.repeat(200))!.length).toBeGreaterThan(21);
  });

  it('returns null rather than throwing for empty input or a payload past capacity', () => {
    expect(encodeQr('')).toBeNull();
    expect(encodeQr('x'.repeat(10000))).toBeNull();
  });

  it('does NOT bake the quiet zone into the matrix — that is the renderer\'s to draw', () => {
    // If the encoder ever started padding, the renderer's own 4-module margin would double it and
    // the code would shrink for no visible reason.
    const m = encodeQr('TZ00123/26')!;
    expect(m[0][0]).toBe(true); // a finder corner sits at 0,0 — no padding ahead of it
    expect(QR_QUIET_ZONE).toBe(4);
  });
});

describe('scannability helpers', () => {
  it('measures the module width of the shipped clinical-report barcode above the floor', () => {
    // rt-clinical-micro's barcode box is 184px and a 10-char alphanumeric lab number is 145
    // modules. Pinned because it is the ONE place the built-in's scannability is asserted at all.
    const mm = moduleWidthMm(184, 145);
    expect(mm).toBeCloseTo(0.336, 3);
    expect(mm).toBeGreaterThan(MIN_MODULE_MM);
  });

  it('reports the character budget for a box, conservatively', () => {
    // 184px = 48.7mm; at 0.25mm that is 194 modules => floor((194-35)/11) = 14 characters.
    expect(maxCode128Chars(184)).toBe(14);
    // Under-promises for digits: AUTO packs 2 per symbol, so 20 digits actually fit in 14 slots.
    expect(encodeCode128('1'.repeat(20))!.length).toBeLessThanOrEqual(Math.floor((184 * 25.4 / 96) / MIN_MODULE_MM));
  });

  it('never returns a negative budget for a box too small to hold even the fixed patterns', () => {
    expect(maxCode128Chars(1)).toBe(0);
    expect(maxCode128Chars(0)).toBe(0);
  });

  it('round-trips: the minimum width it recommends actually clears the floor', () => {
    for (const modules of [90, 145, 200, 313]) {
      expect(moduleWidthMm(minWidthPxFor(modules), modules)).toBeGreaterThanOrEqual(MIN_MODULE_MM);
    }
  });

  it('returns 0 rather than Infinity or NaN for a degenerate box', () => {
    expect(moduleWidthMm(0, 145)).toBe(0);
    expect(moduleWidthMm(184, 0)).toBe(0);
  });
});
