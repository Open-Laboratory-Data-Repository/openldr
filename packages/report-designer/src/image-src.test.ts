import { describe, it, expect } from 'vitest';
import {
  validateImageSrc,
  findInvalidImageSources,
  ELEMENT_IMAGE_MAX_CHARS,
} from './image-src';
import type { ReportDesign } from './schema';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('validateImageSrc', () => {
  it('accepts an empty source — an unfilled image element is not an error', () => {
    expect(validateImageSrc('')).toBeNull();
  });

  it('accepts an interpolation token, deferring it to render', () => {
    // ⛔ All nine built-in designs ship `{{lab.logo}}`. A data-URI-only rule rejects every one.
    expect(validateImageSrc('{{lab.logo}}')).toBeNull();
    expect(validateImageSrc('{{param.crest}}')).toBeNull();
  });

  it('accepts png and jpeg data URIs', () => {
    expect(validateImageSrc(PNG)).toBeNull();
    expect(validateImageSrc('data:image/jpeg;base64,/9j/4AAQ')).toBeNull();
  });

  it('rejects webp — measured: pdfkit sniffs magic bytes and draws JPEG/PNG only, throwing on ' +
    'anything else, so a WebP would render fine on the canvas and silently vanish from the PDF', () => {
    expect(validateImageSrc('data:image/webp;base64,UklGRg==')).toBe('unsupported-image-type');
  });

  it('rejects an http(s) URL — pdfkit reads it as a file path and silently draws a placeholder', () => {
    expect(validateImageSrc('https://example.org/logo.png')).toBe('not-a-data-uri');
    expect(validateImageSrc('http://example.org/logo.png')).toBe('not-a-data-uri');
    expect(validateImageSrc('/var/logo.png')).toBe('not-a-data-uri');
  });

  it('rejects svg — it is script-bearing and the canvas renders it into an <img>', () => {
    expect(validateImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe('unsupported-image-type');
  });

  it('rejects an oversize image', () => {
    const huge = `data:image/png;base64,${'A'.repeat(ELEMENT_IMAGE_MAX_CHARS)}`;
    expect(validateImageSrc(huge)).toBe('too-large');
  });

  it('does not let a token embedded in a URL skip validation', () => {
    // ⛔ Regression guard: an unanchored token test made this return null, defeating the URL,
    // SVG and size checks at once — whatever the token interpolates to, the result is still a URL.
    expect(validateImageSrc('https://evil.example/logo.png?v={{n}}')).toBe('not-a-data-uri');
  });

  it('does not let a trailing token smuggle an svg past validation', () => {
    // ⚠ Not 'unsupported-image-type': DATA_URI is anchored at both ends (`^...$`), so a trailing
    // `{{n}}` breaks the base64-payload match before the MIME group is ever inspected. The result
    // is 'not-a-data-uri' instead — still correctly rejected, just caught one check earlier. Either
    // way the smuggling attempt fails; only the specific reason code differs from a naive guess.
    expect(validateImageSrc('data:image/svg+xml;base64,PHN2Zz4={{n}}')).toBe('not-a-data-uri');
  });

  it('does not let a trailing token smuggle an oversize value past the cap', () => {
    expect(validateImageSrc(`${'A'.repeat(ELEMENT_IMAGE_MAX_CHARS)}{{n}}`)).toBe('too-large');
  });

  it('still accepts a bare token, with or without surrounding whitespace', () => {
    expect(validateImageSrc('{{lab.logo}}')).toBeNull();
    expect(validateImageSrc('  {{lab.logo}}  ')).toBeNull();
  });
});

describe('findInvalidImageSources', () => {
  const design = (elements: unknown[]): ReportDesign => ({
    id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'draft',
    pages: [{ id: 'p1', elements: elements as never }], parameters: [],
  });

  it('reports each offending image element by id', () => {
    const d = design([
      { id: 'ok', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 1, h: 1 }, src: PNG },
      { id: 'bad', kind: 'image', name: 'Crest', rect: { x: 0, y: 0, w: 1, h: 1 }, src: 'https://x/y.png' },
    ]);
    expect(findInvalidImageSources(d)).toEqual([{ elementId: 'bad', reason: 'not-a-data-uri' }]);
  });

  it('ignores non-image elements that happen to carry a src-like value', () => {
    const d = design([
      { id: 't', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, text: 'https://example.org' },
    ]);
    expect(findInvalidImageSources(d)).toEqual([]);
  });

  it('returns empty for the seeded shape — an image bound to {{lab.logo}}', () => {
    const d = design([
      { id: 'logo', kind: 'image', name: 'Lab logo', rect: { x: 0, y: 0, w: 1, h: 1 }, src: '{{lab.logo}}' },
    ]);
    expect(findInvalidImageSources(d)).toEqual([]);
  });

  it('scans every page, not just the first', () => {
    const d: ReportDesign = {
      id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', parameters: [], status: 'draft',
      pages: [
        { id: 'p1', elements: [] },
        { id: 'p2', elements: [{ id: 'bad', kind: 'image', name: 'X', rect: { x: 0, y: 0, w: 1, h: 1 }, src: 'ftp://x' }] as never },
      ],
    };
    expect(findInvalidImageSources(d)).toEqual([{ elementId: 'bad', reason: 'not-a-data-uri' }]);
  });
});
