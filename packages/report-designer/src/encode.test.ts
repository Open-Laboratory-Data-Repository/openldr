import { describe, it, expect } from 'vitest';
import { encodeCode128, encodeQr, QR_QUIET_ZONE } from './encode';

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
