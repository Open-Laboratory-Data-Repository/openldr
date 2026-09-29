import { str } from './extract';

type Json = Record<string, unknown>;

export interface RequesterFacility {
  code: string | null;
  system: string | null;
  display: string | null;
}

const NONE: RequesterFacility = { code: null, system: null, display: null };

/**
 * The requesting facility of a ServiceRequest, or all nulls.
 *
 * 1. `requester.reference` is `#<id>`: the contained resource with that id must be a
 *    `PractitionerRole`; its `organization` is the facility (cdr-toolchain's shape: the doctor and
 *    the clinic travel together).
 * 2. Otherwise `requester` itself must carry an `identifier` (corlix's shape: a logical reference
 *    to the facility).
 * 3. Anything else, such as CE's own lab-order form's free-text clinician, names no facility.
 */
export function requesterFacility(r: Json): RequesterFacility {
  const requester = r['requester'];
  if (typeof requester !== 'object' || requester === null) return NONE;
  const ref = str((requester as Json)['reference']);
  if (ref !== null && ref.startsWith('#')) {
    const role = containedRequesterRole(r);
    if (!role) return NONE;
    return fromFacilityReference(role['organization']);
  }
  return fromFacilityReference(requester);
}

/** The requesting practitioner's display name, read from the same contained `PractitionerRole`
 *  that `requesterFacility` follows, so both share the one `#`-reference lookup. Null when the
 *  requester is not a `#` reference to a contained `PractitionerRole`, or that role names no
 *  practitioner. */
export function requesterPractitionerDisplay(r: Json): string | null {
  const role = containedRequesterRole(r);
  if (!role) return null;
  const practitioner = role['practitioner'];
  if (typeof practitioner !== 'object' || practitioner === null) return null;
  return str((practitioner as Json)['display']);
}

function containedRequesterRole(r: Json): Json | null {
  const requester = r['requester'];
  if (typeof requester !== 'object' || requester === null) return null;
  const ref = str((requester as Json)['reference']);
  if (ref === null || !ref.startsWith('#')) return null;
  const id = ref.slice(1);
  const contained = Array.isArray(r['contained']) ? (r['contained'] as unknown[]) : [];
  const role = contained.find((c) => typeof c === 'object' && c !== null && (c as Json)['id'] === id) as Json | undefined;
  if (!role || role['resourceType'] !== 'PractitionerRole') return null;
  return role;
}

function fromFacilityReference(v: unknown): RequesterFacility {
  if (typeof v !== 'object' || v === null) return NONE;
  const identifier = (v as Json)['identifier'];
  if (typeof identifier !== 'object' || identifier === null) return NONE;
  const code = str((identifier as Json)['value']);
  if (code === null || code === '') return NONE;
  return { code, system: str((identifier as Json)['system']), display: str((v as Json)['display']) };
}
