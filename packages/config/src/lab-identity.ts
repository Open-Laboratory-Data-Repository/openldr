/**
 * The issuing laboratory's own identity — what goes on a report's letterhead.
 *
 * Deliberately CONFIGURATION, not ingested data. CE has no record of the lab it is installed in:
 * `sync.site_id` is an opaque id, `sync_sites.name` names *other* labs from a central's point of
 * view, and `facilities` holds the facilities that SEND work. "Who am I" and "who sent this" are
 * different questions, and only the second one is answerable from the data.
 *
 * Values live in `app_settings` like FEATURE_FLAGS / NUMBER_SETTINGS. None are secrets, so unlike
 * the neighbouring `sync.*` keys they are neither encrypted nor masked on read.
 */

export interface LabIdentityFieldDefinition {
  /** Stable key stored in app_settings.key. */
  id: string;
  /** i18n key for the human label (resolved in apps/studio). */
  labelKey: string;
  /** Longest accepted value. For `lab.logo` this bounds the whole data URI. */
  maxLength: number;
  /** Rendered as a multi-line block (address), not a single line. */
  multiline?: boolean;
}

/** Decoded-image ceiling for `lab.logo`. Generous for a letterhead mark at print resolution.
 *
 *  ⚠ Enforced ON WRITE, on purpose. The logo is read on EVERY report render, so an unbounded value
 *  becomes a multi-megabyte settings row on a hot path. A rejected upload is an error the operator
 *  can act on immediately; slow PDFs six months later are not. */
export const LAB_LOGO_MAX_BYTES = 256 * 1024;

/** base64 carries 3 bytes per 4 characters, so the encoded form is ~4/3 the decoded size. The
 *  prefix (`data:image/jpeg;base64,`) is short enough to absorb into the rounding. */
export const LAB_LOGO_MAX_CHARS = Math.ceil((LAB_LOGO_MAX_BYTES * 4) / 3) + 64;

/**
 * Image types accepted for the logo.
 *
 * ⛔ SVG is deliberately absent. An SVG is a script-bearing document, and this value is rendered
 * into an `<img>` in the designer canvas; the same reasoning already excluded SVG from the
 * marketplace readme's image allowlist. PNG covers logos with transparency, which is what a
 * letterhead mark needs.
 *
 * ⛔ WebP is deliberately absent too. Measured: `pdfkit` (0.15.2, `js/pdfkit.js:3957-3962`) sniffs
 * the image's magic bytes and draws exactly two formats — JPEG and PNG — throwing
 * `Unknown image format.` for anything else. A WebP logo is accepted here, renders fine in the
 * Settings preview and the designer canvas (both go through `<img>`), and then prints as a blank
 * letterhead on every report, because the renderer catches that throw and draws its placeholder.
 * Same defect class as the SVG exclusion above, just discovered later.
 */
export const LAB_LOGO_MIME = ['image/png', 'image/jpeg'] as const;

export const LAB_IDENTITY_FIELDS: readonly LabIdentityFieldDefinition[] = [
  { id: 'lab.name', labelKey: 'settings.laboratory.name', maxLength: 200 },
  { id: 'lab.address', labelKey: 'settings.laboratory.address', maxLength: 500, multiline: true },
  { id: 'lab.contact', labelKey: 'settings.laboratory.contact', maxLength: 200 },
  { id: 'lab.logo', labelKey: 'settings.laboratory.logo', maxLength: LAB_LOGO_MAX_CHARS },
];

export const LAB_IDENTITY_KEYS = LAB_IDENTITY_FIELDS.map((f) => f.id);

/** The identity as the renderer consumes it: bare keys (`name`, `address`, …) → value. */
export type LabIdentity = Record<string, string>;

export interface LabIdentityValidationError {
  key: string;
  reason: 'too-long' | 'not-a-data-uri' | 'unsupported-image-type' | 'unknown-key';
}

const DATA_URI = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Validate one identity value. Returns `null` when acceptable.
 *
 * ⚠ The logo must be a `data:` URI, and an `https://` URL is REJECTED here rather than accepted and
 * left to fail at render. Measured: pdfkit treats a URL image source as a FILE PATH and throws
 * ENOENT, so a URL logo renders fine in the designer canvas (`<img>` is happy) and silently becomes
 * a dashed placeholder in the PDF — a failure nobody sees until they open a printed report. Failing
 * at write is the only point where the operator can still do something about it.
 */
export function validateLabIdentityValue(key: string, value: string): LabIdentityValidationError | null {
  const def = LAB_IDENTITY_FIELDS.find((f) => f.id === key);
  if (!def) return { key, reason: 'unknown-key' };
  if (value.length > def.maxLength) return { key, reason: 'too-long' };
  if (key !== 'lab.logo' || value === '') return null;

  const m = DATA_URI.exec(value);
  if (!m) return { key, reason: 'not-a-data-uri' };
  if (!(LAB_LOGO_MIME as readonly string[]).includes(m[1])) return { key, reason: 'unsupported-image-type' };
  return null;
}

/** Strip the `lab.` prefix so templates write `{{lab.name}}` while the store keys stay namespaced. */
export function toIdentityTokens(stored: Record<string, string | null | undefined>): LabIdentity {
  const out: LabIdentity = {};
  for (const f of LAB_IDENTITY_FIELDS) {
    const v = stored[f.id];
    if (typeof v === 'string' && v !== '') out[f.id.slice('lab.'.length)] = v;
  }
  return out;
}
