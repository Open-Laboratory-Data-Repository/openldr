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

// ⛔ ONE copy of the IANA rule, not two. It used to be a private `isValidIanaZone` in this file,
// guarding the lab.timezone SETTING. The monthly transmission grid's `tz` RUN PARAMETER asks the
// same question at a different moment — and, per that report's own help text, a scheduled run does
// NOT read this setting, so the run parameter is the path that can go wrong unattended. The rule
// moved to `@openldr/core/pure` so both sides judge a zone identically; the reasoning that shapes
// it (the `/^[+-]/` guard, and what Postgres does with a bare `+3`) travelled with it.
import { isValidIanaZone } from '@openldr/core/pure';

export interface LabIdentityFieldDefinition {
  /** Stable key stored in app_settings.key. */
  id: string;
  /** i18n key for the human label (resolved in apps/studio). */
  labelKey: string;
  /** Longest accepted value. For `lab.logo` this bounds the whole data URI. */
  maxLength: number;
  /** Rendered as a multi-line block (address), not a single line. */
  multiline?: boolean;
  /**
   * Render as a PICKER over this source rather than a free-text box.
   *
   * ⛔ `facility-registers` is not cosmetic. `idFor` (packages/terminology/src/facility-csv.ts)
   * hashes a register's URI into every facility's permanent id WITHOUT normalising it, so a typed
   * label mints a second identity for one register — the defect migration 082 had to clean up. A
   * value here must be a register that already exists on the install, never something typed.
   */
  source?: 'facility-registers';
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
  /**
   * The register this installation's facilities belong to, by canonical URI.
   *
   * Lives beside the letterhead because it is the same KIND of fact: something an operator states
   * once about their installation rather than re-entering per record. The Facility form's System
   * field defaults from it.
   *
   * A URI is well under this bound; the length exists only so a paste cannot store something absurd.
   */
  { id: 'lab.facilitySystem', labelKey: 'settings.laboratory.facilitySystem', maxLength: 500, source: 'facility-registers' },
  /**
   * The civil timezone this installation's days are bucketed in. NOT decoration: the monthly
   * transmission grid asks "did data arrive on this day", and an arrival at 21:00Z is 00:00 the
   * NEXT day at +03. Bucketing in UTC moves a whole evening's arrivals to the previous day — an
   * off-by-one-day on every cell, with nothing on the page to show it happened.
   *
   * ⛔ IANA ONLY, and that makes this setting UNUSABLE on a SQL Server warehouse. `AT TIME ZONE`
   * there takes a WINDOWS zone name ('E. Africa Standard Time'), which `isValidIanaZone` rejects,
   * so no single value can be right on all three engines. Deliberately NOT loosened: accepting a
   * Windows name would break the Postgres and MySQL warehouses, which are the common case, and a
   * validator that took both could not tell the operator which one they had typed. On SQL Server
   * the operator leaves this empty and types the Windows zone into the report run's own Time zone
   * filter, which is a free-text parameter and passes whatever it is given straight through.
   * The field's help text and docs/reports.md say so; see `settings.laboratory.timezoneHint`.
   */
  { id: 'lab.timezone', labelKey: 'settings.laboratory.timezone', maxLength: 100 },
];

export const LAB_IDENTITY_KEYS = LAB_IDENTITY_FIELDS.map((f) => f.id);

/** The identity as the renderer consumes it: bare keys (`name`, `address`, …) → value. */
export type LabIdentity = Record<string, string>;

export interface LabIdentityValidationError {
  key: string;
  reason: 'too-long' | 'not-a-data-uri' | 'unsupported-image-type' | 'unknown-key' | 'invalid-timezone';
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
 *
 * ⛔ `lab.timezone` is rejected at write time for the same reason: a bad zone does not error at
 * query time (Postgres `AT TIME ZONE` raises, but only when a report actually runs), so a typo
 * would only surface a month later as a whole day bucketed on the wrong side of midnight.
 */
export function validateLabIdentityValue(key: string, value: string): LabIdentityValidationError | null {
  const def = LAB_IDENTITY_FIELDS.find((f) => f.id === key);
  if (!def) return { key, reason: 'unknown-key' };
  if (value.length > def.maxLength) return { key, reason: 'too-long' };

  if (key === 'lab.timezone') {
    if (value === '') return null;
    return isValidIanaZone(value) ? null : { key, reason: 'invalid-timezone' };
  }

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
