import type { ReportDesign } from './schema';

/**
 * The element-image source rule.
 *
 * ⚠ Deliberately NOT a zod refinement on `DesignElementSchema`. `fromRow` (`./store.ts`) parses
 * every stored design through `ReportDesignSchema`, so a refinement would also run on READ and make
 * an existing design holding an `https://` image permanently unopenable — including inside the boot
 * seed's own `get`. This is a WRITE-time rule, enforced at the API boundary, exactly as
 * `validateLabIdentityValue` (`packages/config/src/lab-identity.ts`) is for the letterhead logo.
 *
 * The rule itself mirrors that function; the constants are restated here rather than imported
 * because `@openldr/report-designer` does not depend on `@openldr/config`, and adding a package
 * dependency to share two numbers is the worse trade. If one side changes, change both.
 */

/** Decoded-image ceiling, per image. Matches `LAB_LOGO_MAX_BYTES`: the value is embedded in the
 *  design's `pages` jsonb, which is read on every render and shipped over reference sync, so an
 *  unbounded image becomes a multi-megabyte row on a hot path. */
export const ELEMENT_IMAGE_MAX_BYTES = 256 * 1024;

/** base64 carries 3 bytes per 4 characters, so the encoded form is ~4/3 the decoded size. The
 *  prefix (`data:image/jpeg;base64,`) is short enough to absorb into the rounding. */
export const ELEMENT_IMAGE_MAX_CHARS = Math.ceil((ELEMENT_IMAGE_MAX_BYTES * 4) / 3) + 64;

/**
 * ⛔ SVG is deliberately absent, for the same reason it is absent from the lab logo's allowlist: an
 * SVG is a script-bearing document, and this value is rendered into an `<img>` on the designer
 * canvas.
 */
export const ELEMENT_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type ImageSrcReason = 'not-a-data-uri' | 'unsupported-image-type' | 'too-large';

export interface InvalidImageSource {
  elementId: string;
  reason: ImageSrcReason;
}

const DATA_URI = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** `{{lab.logo}}`, `{{param.crest}}` — resolved by the renderer, not a literal source. */
const TOKEN = /\{\{[^}]+\}\}/;

/**
 * Validate one image element's `src`. Returns `null` when acceptable.
 *
 * ⚠ An `https://` source is REJECTED here rather than accepted and left to fail at render.
 * Measured (`./render/draw.ts`): pdfkit treats a URL image source as a FILE PATH and throws, so a
 * URL image renders correctly on the studio canvas — `<img>` is perfectly happy — and silently
 * becomes a dashed placeholder in the PDF. Nobody sees it until a report is printed. Failing at
 * write is the only point where the author can still do something about it.
 */
export function validateImageSrc(src: string): ImageSrcReason | null {
  if (src === '') return null;
  // Tokens are the seeded shape (`{{lab.logo}}`) and resolve at render; nothing to check here.
  if (TOKEN.test(src)) return null;
  // Length first: cheaper than running the pattern over a multi-megabyte string.
  if (src.length > ELEMENT_IMAGE_MAX_CHARS) return 'too-large';

  const m = DATA_URI.exec(src);
  if (!m) return 'not-a-data-uri';
  if (!(ELEMENT_IMAGE_MIME as readonly string[]).includes(m[1])) return 'unsupported-image-type';
  return null;
}

/** Every offending `image` element in the design, across all pages. Empty when the design is fine. */
export function findInvalidImageSources(design: ReportDesign): InvalidImageSource[] {
  const bad: InvalidImageSource[] = [];
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind !== 'image') continue;
      const reason = validateImageSrc(el.src ?? '');
      if (reason) bad.push({ elementId: el.id, reason });
    }
  }
  return bad;
}
