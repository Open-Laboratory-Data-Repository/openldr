import { describe, it, expect } from 'vitest';
import {
  LAB_IDENTITY_FIELDS, LAB_IDENTITY_KEYS, LAB_LOGO_MAX_BYTES, LAB_LOGO_MAX_CHARS,
  validateLabIdentityValue, toIdentityTokens,
} from './lab-identity';

const dataUri = (mime: string, bytes: number): string =>
  `data:${mime};base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`;

describe('LAB_IDENTITY_FIELDS', () => {
  it('declares exactly the installation-identity keys, all namespaced', () => {
    // `lab.facilitySystem` joined the four letterhead keys: it is the same kind of fact — something
    // stated once about this installation rather than re-entered per record.
    expect(LAB_IDENTITY_KEYS).toEqual([
      'lab.name', 'lab.address', 'lab.contact', 'lab.logo', 'lab.facilitySystem',
    ]);
    expect(LAB_IDENTITY_FIELDS.every((f) => f.id.startsWith('lab.'))).toBe(true);
  });

  it('marks only the address multi-line', () => {
    expect(LAB_IDENTITY_FIELDS.filter((f) => f.multiline).map((f) => f.id)).toEqual(['lab.address']);
  });

  it('⛔ marks the facility system as a PICKER, never a free-text box', () => {
    // `idFor` hashes the register URI into every facility's permanent id without normalising it, so
    // a typed label mints a second identity for one register — migration 082's defect.
    expect(LAB_IDENTITY_FIELDS.filter((f) => f.source).map((f) => [f.id, f.source]))
      .toEqual([['lab.facilitySystem', 'facility-registers']]);
  });
});

describe('validateLabIdentityValue', () => {
  it('accepts ordinary text within the length cap', () => {
    expect(validateLabIdentityValue('lab.name', 'Muhimbili National Referral Laboratory')).toBeNull();
    expect(validateLabIdentityValue('lab.address', 'PO Box 65000\nDar es Salaam\nTanzania')).toBeNull();
  });

  it('rejects an over-long value', () => {
    expect(validateLabIdentityValue('lab.name', 'x'.repeat(201))).toEqual({ key: 'lab.name', reason: 'too-long' });
  });

  it('rejects an unknown key rather than silently storing it', () => {
    expect(validateLabIdentityValue('lab.motto', 'x')).toEqual({ key: 'lab.motto', reason: 'unknown-key' });
  });

  it('accepts each supported image type as a data URI', () => {
    for (const mime of ['image/png', 'image/jpeg']) {
      expect(validateLabIdentityValue('lab.logo', dataUri(mime, 100))).toBeNull();
    }
  });

  // Measured: pdfkit 0.15.2 (js/pdfkit.js:3957-3962) sniffs magic bytes and draws exactly JPEG and
  // PNG, throwing `Unknown image format.` for anything else — a WebP logo previews fine (both the
  // Settings preview and the designer canvas go through `<img>`) and then prints as a blank
  // letterhead. Do not re-add WebP to LAB_LOGO_MIME without re-measuring pdfkit's format support.
  it('rejects WebP, which pdfkit cannot draw', () => {
    expect(validateLabIdentityValue('lab.logo', 'data:image/webp;base64,UklGRg=='))
      .toEqual({ key: 'lab.logo', reason: 'unsupported-image-type' });
  });

  it('⛔ REJECTS an https logo URL at WRITE time', () => {
    // Measured: pdfkit treats a URL image source as a FILE PATH and throws ENOENT, so a URL logo
    // renders fine on the designer canvas and silently becomes a dashed placeholder in the PDF.
    // Write time is the only moment the operator can still act on it.
    expect(validateLabIdentityValue('lab.logo', 'https://example.org/logo.png'))
      .toEqual({ key: 'lab.logo', reason: 'not-a-data-uri' });
  });

  it('rejects SVG, which is a script-bearing document rendered into an <img>', () => {
    expect(validateLabIdentityValue('lab.logo', dataUri('image/svg+xml', 100)))
      .toEqual({ key: 'lab.logo', reason: 'unsupported-image-type' });
  });

  it('rejects a non-image data URI', () => {
    expect(validateLabIdentityValue('lab.logo', dataUri('text/html', 100)))
      .toEqual({ key: 'lab.logo', reason: 'unsupported-image-type' });
  });

  it('rejects a logo past the size ceiling, and accepts one just under it', () => {
    expect(validateLabIdentityValue('lab.logo', dataUri('image/png', LAB_LOGO_MAX_BYTES * 2)))
      .toEqual({ key: 'lab.logo', reason: 'too-long' });
    expect(validateLabIdentityValue('lab.logo', dataUri('image/png', LAB_LOGO_MAX_BYTES - 1024))).toBeNull();
  });

  it('allows clearing the logo', () => {
    expect(validateLabIdentityValue('lab.logo', '')).toBeNull();
  });

  it('sizes the character cap above the byte cap, since base64 inflates by 4/3', () => {
    expect(LAB_LOGO_MAX_CHARS).toBeGreaterThan(LAB_LOGO_MAX_BYTES);
  });
});

describe('toIdentityTokens', () => {
  it('strips the lab. prefix so a template writes {{lab.name}} against a `name` token', () => {
    expect(toIdentityTokens({ 'lab.name': 'Muhimbili', 'lab.contact': '+255 22 215 0302' }))
      .toEqual({ name: 'Muhimbili', contact: '+255 22 215 0302' });
  });

  it('omits unset, empty and null values so they resolve to empty like an unknown param', () => {
    expect(toIdentityTokens({ 'lab.name': '', 'lab.address': null, 'lab.contact': undefined })).toEqual({});
  });

  it('ignores keys that are not identity fields', () => {
    expect(toIdentityTokens({ 'sync.client_secret': 'nope', 'lab.name': 'X' })).toEqual({ name: 'X' });
  });
});
