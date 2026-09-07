import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { normaliseControlledValue } from './facility-controlled-fields';

/** The two coding systems migration 072 seeds (`072_facility_level_status_valuesets.ts:27`, `:57`). */
const SYSTEMS: [string, string][] = [
  ['level', 'urn:openldr:cs:facility-type'],
  ['status', 'http://hl7.org/fhir/location-status'],
];

/**
 * ⛔ READS THE MIGRATED DATABASE, NOT A COPY OF THE CONCEPT LIST. `LEVEL_CONCEPTS` and
 * `STATUS_CONCEPTS` are plain `const`s inside migration 072 and are deliberately not exported, so a
 * fixture here would be a second copy free to drift from the one that actually ships. This asserts
 * what an install really contains.
 *
 * ⛔ THIS IS THE TEST THAT LICENSES THE FOLD. `normaliseControlledValue` sits in a path that writes
 * without asking, and it is only safe there because no two DIFFERENT concepts read alike once case
 * and the Centre/Center variant are folded. That is a property of the shipped vocabulary, not of the
 * function, so it has to be asserted against the vocabulary.
 */
describe('the seeded controlled vocabularies collide nowhere under the normalisation', () => {
  it.each(SYSTEMS)('%s', async (_field, system) => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts')
      .select(['code', 'display'])
      .where('system', '=', system)
      .execute() as unknown as { code: string; display: string | null }[];

    // The premise, asserted rather than assumed: a seed that stopped seeding would make every
    // assertion below pass for the uninteresting reason that there is nothing left to collide.
    // MEASURED 2026-09-07 against the migrated database: 63 facility-type concepts, 3 location-status.
    expect(rows.length).toBeGreaterThan(2);

    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const r of rows) {
      for (const token of [r.code, r.display]) {
        if (!token) continue;
        const key = normaliseControlledValue(token);
        const seen = owner.get(key);
        // A concept's own code and display legitimately share a key ('active' / 'Active'). Only two
        // DIFFERENT concepts sharing one is a problem.
        if (seen !== undefined && seen !== r.code) collisions.push(`${key}: ${seen} vs ${r.code}`);
        else owner.set(key, r.code);
      }
    }

    // ⛔ IF THIS FAILS, DO NOT LOOSEN IT. It means a concept was added whose code or display reads
    // the same as another's once case and the Centre/Center variant are folded. Two different
    // concepts cannot share a key, so either rename the new concept, or accept that values matching
    // that key go to the operator instead (which the resolver already does: see its `poisoned` set).
    expect(collisions).toEqual([]);
  });
});
