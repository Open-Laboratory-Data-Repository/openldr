// ⚠ Triple-slash, not just a sibling .d.ts. This module is compiled by CONSUMERS too — `apps/studio`
// imports it through `@openldr/report-designer/pure` — and their tsconfig `include` covers only
// their own `src`, so an ambient declaration sitting beside this file is invisible to them and the
// private jsbarcode import fails as an implicit `any` in every consumer. The reference travels with
// the importer.
/// <reference path="./jsbarcode-code128.d.ts" />
import qrcode from 'qrcode-generator';
// ⛔ PRIVATE SUBPATH. `jsbarcode` ships no `exports` map (verified, 3.12.3), so this import is legal
// and Node will not start refusing it — but the path is not part of any published API, which is why
// the dependency is pinned to an EXACT version and `encode.test.ts` asserts golden bitstrings. If a
// bump moves this file the tests fail loudly; the failure mode we are buying insurance against is a
// silently DIFFERENT barcode, which no type check and no smoke test would catch.
//
// Only the encoder is imported, never `jsbarcode` itself: the package root pulls in canvas/SVG
// renderers that assume a DOM, and this module has to run in Node (PDF) and the browser (canvas).
import CODE128_AUTO from 'jsbarcode/bin/barcodes/CODE128/CODE128_AUTO.js';

/** Interop shim: the encoder files are CJS with a `default` export under ESM. */
const Code128 = ((CODE128_AUTO as unknown as { default?: unknown }).default ?? CODE128_AUTO) as new (
  data: string, options: Record<string, unknown>,
) => { valid(): boolean; encode(): { data: string; text: string } };

/**
 * Code 128 bars for `value` — `true` is a bar, `false` a space, one entry per module.
 *
 * AUTO mode, not Code B: auto switches into Code C across digit runs, so a 10-digit lab number is
 * 90 modules instead of 145 (~38% narrower for identical data at identical module width). For a
 * barcode that has to fit a header band next to patient details, that is the difference between
 * fitting and not.
 *
 * ⚠ Returns `null` — never throws — for an empty value or one the encoder rejects. A report is a
 * page of many elements, and a value that cannot be encoded is no reason to deny the reader all the
 * others; the caller draws a placeholder instead. Code 128 covers all of ASCII, so in practice a
 * rejection means a non-ASCII character (an accented patient name, a mojibake unit).
 */
export function encodeCode128(value: string): boolean[] | null {
  if (!value) return null;
  try {
    const enc = new Code128(value, {});
    if (!enc.valid()) return null;
    const bits = enc.encode().data;
    if (!bits) return null;
    return Array.from(bits, (c) => c === '1');
  } catch {
    return null;
  }
}

/**
 * QR modules for `value` as `[row][col]`, `true` = dark. Square; `result.length` is the module count.
 *
 * Type number 0 = "smallest version that fits", error correction M = the usual print default. The
 * QUIET ZONE IS NOT INCLUDED — it is the renderer's, because it is drawn as empty space rather than
 * as modules. See `drawQrCode`.
 *
 * Same never-throws contract as `encodeCode128`: `null` for empty input or a value too long for the
 * largest version at this ECC level.
 */
export function encodeQr(value: string): boolean[][] | null {
  if (!value) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  } catch {
    return null;
  }
}

/** Quiet zone the QR spec requires on every side, in modules. Four is the minimum; scanners fail
 *  below it, and the omission is invisible on a white page — which is exactly why it is a constant
 *  with a test rather than a number inlined in the drawer. */
export const QR_QUIET_ZONE = 4;
