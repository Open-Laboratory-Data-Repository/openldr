import { randomBytes } from 'node:crypto';
import { open, seal } from '@openldr/core';

// Masking for the patient index (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 2).
// Every patient response is built in patient-index.ts, which calls these, so an identifier never
// leaves the server for a caller without patients.view_identifiers.

/** First character then `***`. Array.from keeps a character outside the BMP whole. */
export function maskName(s: string | null): string | null {
  const t = s?.trim();
  if (!t) return null;
  return `${Array.from(t)[0]}***`;
}

/** `•••` plus the last four characters. Four or fewer would show the whole value, so they show none. */
export function maskValue(v: string | null): string | null {
  if (v === null) return null;
  return v.length <= 4 ? '•••' : `•••${v.slice(-4)}`;
}

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/;

export function birthYear(dob: string | null): string | null {
  return dob ? (DATE.exec(dob)?.[1] ?? null) : null;
}

/** Whole years on `now`. A year-only or year-month date counts from its first day. */
export function ageInYears(dob: string | null, now: Date): number | null {
  const m = dob ? DATE.exec(dob) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age < 0 ? null : age;
}

export interface RefCodec { encode(id: string): string; decode(ref: string): string | null }

/** A patient's resource id can carry an identifier (`Patient/hl7-{PID-3}`), so responses carry this
 *  opaque ref instead. AES-256-GCM under a key made when the process starts: a ref stops working on
 *  restart, and the page then reloads its list. base64url, so it fits a URL path. */
export function createRefCodec(key: Buffer = randomBytes(32)): RefCodec {
  return {
    encode(id) {
      return seal(id, key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(ref) {
      if (!/^[A-Za-z0-9_-]+$/.test(ref)) return null;
      const b64 = ref.replace(/-/g, '+').replace(/_/g, '/');
      try {
        return open(b64 + '='.repeat((4 - (b64.length % 4)) % 4), key);
      } catch {
        return null;
      }
    },
  };
}
