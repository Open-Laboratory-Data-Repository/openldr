import type { TerminologyAdminStore } from '@openldr/db';
import {
  CONTROLLED_VALUE_SETS, normaliseControlledValue, registerSlug, registerValueSetUrl,
  valueSetForField,
} from './facility-controlled-fields';

// FAC-P1-B (Slice B, Task 1): lets an operator add a facility type the vocabulary does not have
// yet, scoped to the register it came from. The shared `urn:openldr:valueset:facility-type` is
// never touched — a register that adds a type gets its own system and its own value set, which
// imports the shared one so the register's pick list still shows all 63 seeded concepts plus its
// own additions.

// `registerValueSetUrl` and `valueSetForField` are declared in `facility-controlled-fields.ts`,
// not here. `addRegisterFacilityType` below needs `valueSetForField`, and a later task needs
// `facility-controlled-fields.ts` to call it too — this module imports that file, so declaring
// either one here would be an import cycle. Re-exported so callers and this module's own tests can
// import both from this one module.
export { registerValueSetUrl, valueSetForField };

/** Where a register's OWN facility types live.
 *
 *  ⛔ THE `local` SEGMENT IS LOAD-BEARING. Raw source values already live in
 *  `urn:openldr:cs:facility-level:<slug>`, which holds the opposite side of every mapping. A
 *  canonical system named `urn:openldr:cs:facility-type:<slug>` would sit one word from it. */
export const registerLocalSystem = (nationalSystem: string): string =>
  `urn:openldr:cs:facility-type:local:${registerSlug(nationalSystem)}`;

/** A display whose normalised form already names a concept in the list. Adding it would poison that
 *  key and BOTH values would stop resolving, with no error anywhere. Carries what it hit so the
 *  operator can be offered that concept instead. */
export class FacilityTypeCollisionError extends Error {
  constructor(public readonly collidesWith: { code: string; display: string | null }) {
    super(`"${collidesWith.display ?? collidesWith.code}" is already in this list`);
    this.name = 'FacilityTypeCollisionError';
  }
}

/** The code for a display: lowercase, non-alphanumeric runs to single hyphens, ends trimmed. */
function codeFor(display: string): string {
  return display.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Add one facility type to a register's own list, creating the system and the value set the first
 *  time. Returns the code it minted.
 *
 *  ⛔ THE SHARED VALUE SET IS NEVER TOUCHED. Migration 072 seeded
 *  `urn:openldr:valueset:facility-type` enumerating its 63 concepts and it stays that way. The
 *  register's set IMPORTS it and adds its own system beside it.
 *
 *  ⛔ TWO INCLUDE CLAUSES, NOT ONE. Within a single clause the sets INTERSECT and only separate
 *  clauses union (`packages/db/src/value-set-expander.ts:69-73`), so one clause naming both the
 *  imported set and this system would expand to their intersection, which is empty. The second
 *  clause names the system with no `concept` and no `filter`, which expands to everything in it
 *  (`value-set-expander.ts:62`), so a later add is one insert and this compose never changes again. */
export async function addRegisterFacilityType(
  admin: TerminologyAdminStore,
  input: { nationalSystem: string; display: string },
): Promise<{ code: string; system: string; valueSetUrl: string }> {
  const display = input.display.trim();
  const base = codeFor(display);
  if (!base) throw new Error('a facility type needs at least one letter or digit');

  const system = registerLocalSystem(input.nationalSystem);
  const valueSetUrl = registerValueSetUrl(input.nationalSystem);

  // Read the list the operator is actually looking at, which is the register's own once it exists.
  const currentUrl = await valueSetForField(admin, 'level', input.nationalSystem);
  const current = await admin.valueSets.getByUrl(currentUrl);
  const codes = current ? (await admin.valueSets.expand(current.id)).codes : [];

  // ⛔ BOTH TOKENS, CODE AND DISPLAY. `resolveControlledFields` folds its lookup index from both the
  // code and the display of every concept (facility-controlled-fields.ts:181); a key claimed by two
  // different codes is poisoned and deleted, so both values silently stop resolving. A new display
  // that normalises onto an existing CODE poisons that key exactly as surely as matching its display,
  // so both comparisons must refuse here, before the register ever holds the poisoning pair.
  const key = normaliseControlledValue(display);
  for (const c of codes) {
    if (normaliseControlledValue(c.code) === key
      || (c.display && normaliseControlledValue(c.display) === key)) {
      throw new FacilityTypeCollisionError({ code: c.code, display: c.display ?? null });
    }
  }

  // A code already taken is not a collision: two different types can share a slug without their
  // displays normalising alike. Suffix rather than refuse.
  const taken = new Set(codes.map((c) => c.code));
  let code = base;
  for (let n = 2; taken.has(code); n += 1) code = `${base}-${n}`;

  if (!(await admin.valueSets.getByUrl(valueSetUrl))) {
    await admin.codingSystems.upsertByUrl({
      systemCode: `FAC-TYPE-LOCAL-${registerSlug(input.nationalSystem).toUpperCase()}`,
      systemName: `Facility types added for ${input.nationalSystem}`,
      url: system,
      systemVersion: null,
      publisherId: 'pub-system',
    });
    await admin.valueSets.save({
      url: valueSetUrl,
      name: `facility-type-${registerSlug(input.nationalSystem)}`,
      title: `Facility Type (${input.nationalSystem})`,
      status: 'active',
      compose: { include: [{ valueSet: [CONTROLLED_VALUE_SETS.level] }, { system }] },
    });
  }

  await admin.terms.create({ system, code, display, status: 'ACTIVE' });
  return { code, system, valueSetUrl };
}
