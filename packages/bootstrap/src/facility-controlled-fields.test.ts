import { describe, it, expect } from 'vitest';
import {
  resolveControlledFields, applyControlledFields, observedFieldSystem, normaliseControlledValue,
} from './facility-controlled-fields';
import type { FacilityRecord } from '@openldr/db';

const rec = (over: Partial<FacilityRecord>): FacilityRecord =>
  ({ id: 'fac-1', name: 'A', source: 'import', ...over } as FacilityRecord);

/** A concept in a fixture value set: a bare code, or a code with the display an operator would
 *  actually pick. Both shapes accepted so the existing call sites below stay untouched. */
type ConceptFixture = string | { code: string; display: string | null };

function fakeAdmin(opts: {
  valueSets?: Record<string, ConceptFixture[]>;
  mappings?: Record<string, { toCode: string; isActive: boolean; mapType?: string }[]>;
}) {
  return {
    valueSets: {
      async getByUrl(url: string) { return opts.valueSets?.[url] ? { id: url } : null; },
      async expand(id: string) {
        // A bare string stays code-only, exactly as before — that is what every pre-existing call
        // site passes, and inventing a display for them would make those tests assert something
        // untrue about what the value set contains.
        const codes = (opts.valueSets?.[id] ?? []).map((c) => (
          typeof c === 'string' ? { code: c, display: null } : c
        ));
        return { codes, total: 0 };
      },
    },
    termMappings: {
      async listOutgoing(system: string, code: string) {
        return (opts.mappings?.[`${system}|${code}`] ?? []).map((m) => ({ ...m, toSystem: '', fromSystem: system, fromCode: code }));
      },
    },
  } as never;
}

describe('resolveControlledFields', () => {
  it('reports a value already canonical as neither mapped nor unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['dispensary'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'dispensary' })]);
    expect(res.unmapped.level).toEqual([]);
    expect(res.mapped.level.size).toBe(0);
  });

  it('reports a value with no canonical code and no mapping as unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.unmapped.level).toEqual(['health_center']);
  });

  it('resolves a mapped source value to its canonical code', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.mapped.level.get('health_center')).toBe('health-center');
    expect(res.unmapped.level).toEqual([]);
  });

  it('ignores a DEACTIVATED mapping', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: false }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.unmapped.level).toEqual(['health_center']);
  });

  it('reports a field whose value set is absent as notValidated, and never as unmapped', async () => {
    const admin = fakeAdmin({ valueSets: {} });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'anything' })]);
    expect(res.notValidated).toContain('level');
    expect(res.unmapped.level).toEqual([]);
  });
});

describe('applyControlledFields', () => {
  it('writes the canonical code and preserves the raw source value', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    const out = applyControlledFields(rec({ level: 'health_center' }), res);
    expect(out.level).toBe('health-center');
    expect(out.extras?.__source).toEqual({ level: 'health_center' });
  });

  it('leaves an UNMAPPED value exactly as it is rather than blanking it', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    const out = applyControlledFields(rec({ level: 'health_center' }), res);
    expect(out.level).toBe('health_center');
  });
});

// --- B1 Task 3: the first argument is a REGISTER'S CANONICAL URI ---------------------------------
//
// ⚠ The brief proposed `expect(observedFieldSystem('level','urn:tz:hfr')).toBe(observedFieldSystem(
// 'level','urn:tz:hfr'))` here. That assertion is INERT — identical arguments to a pure function are
// equal no matter what the body does, so it cannot fail and pins nothing. What is actually worth
// pinning is the two properties this function must keep now that its input is a URI: the suffix stays
// URL-SAFE (a URI carries `:` and `/`), and two DIFFERENT registers keep two DIFFERENT namespaces.
describe('observedFieldSystem under canonical-URI input', () => {
  it('⛔ slugifies the URI into a URL-safe suffix rather than embedding it raw', () => {
    expect(observedFieldSystem('level', 'urn:tz:hfr')).toBe('urn:openldr:cs:facility-level:urn_tz_hfr');
    // The `:` separators of the URI itself must not survive into the system url — deleting the
    // slugification (the brief's own ⛔) would leave `…:facility-level:urn:tz:hfr`.
    expect(observedFieldSystem('level', 'urn:tz:hfr').split(':').length).toBe(5);
  });

  it('⛔ keeps two different registers in two different namespaces', () => {
    expect(observedFieldSystem('level', 'urn:tz:mfl')).not.toBe(observedFieldSystem('level', 'urn:tz:hfr'));
  });

  it('⛔ still namespaces per FIELD, so one register\'s level and status never share mappings', () => {
    expect(observedFieldSystem('status', 'urn:tz:hfr')).not.toBe(observedFieldSystem('level', 'urn:tz:hfr'));
  });
});

describe('resolveControlledFields — a canonical DISPLAY is canonical', () => {
  const VS = 'urn:openldr:valueset:facility-type';

  it('accepts a canonical display, not only a canonical code', async () => {
    // `splitFacilityAnswers` flattens a picked answer to its display, so the column holds
    // 'Health Center' — never 'health-center'. Comparing against codes alone refused the value set's
    // own vocabulary: measured `level 'Health Center' is not a recognised canonical level value` on
    // a live create.
    const admin = fakeAdmin({ valueSets: { [VS]: [{ code: 'health-center', display: 'Health Center' }] } });
    const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: 'Health Center' })]);
    expect(res.unmapped.level).toEqual([]);
    // CHANGED by the controlled-value matching slice (2026-09-07): a display no longer passes
    // through as itself, it resolves to the concept's CODE, so every resolved value in the column is
    // one shape. This test's original point stands and is still what matters: the value set's OWN
    // vocabulary is accepted. A live create really did fail with
    // `level 'Health Center' is not a recognised canonical level value`.
    expect(res.mapped.level.get('Health Center')).toBe('health-center');
  });

  it('still accepts a canonical code', async () => {
    const admin = fakeAdmin({ valueSets: { [VS]: [{ code: 'health-center', display: 'Health Center' }] } });
    const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: 'health-center' })]);
    expect(res.unmapped.level).toEqual([]);
  });

  it('still reports a value that is NEITHER a code nor a display nor a fold of one', async () => {
    // ⛔ THE EXAMPLE CHANGED, AND THAT IS THE SLICE. This test used to use 'Health Centre' (British),
    // asserting it "must stay unmapped so the operator can map it". The operator decided on
    // 2026-09-07 that being asked about a spelling variant is busywork, so `Health Centre` now folds
    // onto `health-center` and no longer reaches them. '1st Level Hospital' replaces it: a genuinely
    // different NAME, which is exactly the kind of value that still belongs in front of a person.
    const admin = fakeAdmin({ valueSets: { [VS]: [{ code: 'health-center', display: 'Health Center' }] } });
    const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: '1st Level Hospital' })]);
    expect(res.unmapped.level).toEqual(['1st Level Hospital']);
  });

  it('ignores a null display rather than treating it as a matchable value', async () => {
    const admin = fakeAdmin({ valueSets: { [VS]: [{ code: 'health-center', display: null }] } });
    const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: '' }), rec({ level: 'x' })]);
    expect(res.unmapped.level).toEqual(['x']);
  });
});

describe('normaliseControlledValue', () => {
  it('folds case and surrounding whitespace', () => {
    expect(normaliseControlledValue('  Health Center ')).toBe('health center');
  });

  // The one spelling variant, and it is here because a real register needed it: the Zambia MFL
  // export writes `Health Centre` while the seeded concept reads `Health Center`.
  it('folds centre onto center', () => {
    expect(normaliseControlledValue('Diagnostic Centre')).toBe('diagnostic center');
    expect(normaliseControlledValue('Health Centre')).toBe(normaliseControlledValue('Health Center'));
  });

  // ⛔ TWO RULES, NOT A SIMILARITY SCORE. Anything that wants more tolerance than an enumerated
  // variant belongs in the ranked suggester, behind the operator's own confirmation.
  it('folds nothing else', () => {
    expect(normaliseControlledValue('Hospital')).not.toBe(normaliseControlledValue('Hospitals'));
    expect(normaliseControlledValue('Organisation')).not.toBe(normaliseControlledValue('Organization'));
    expect(normaliseControlledValue('health-center')).not.toBe(normaliseControlledValue('health center'));
  });
});

describe('resolveControlledFields: the four ordered steps', () => {
  const LEVEL = 'urn:openldr:valueset:facility-type';
  const concepts = [{ code: 'health-center', display: 'Health Center' }];

  it('1. a value that IS a code is left alone: neither mapped nor unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health-center' })]);
    expect(res.mapped.level.size).toBe(0);
    expect(res.unmapped.level).toEqual([]);
  });

  // ⛔ THE ORDER IS THE POINT. An operator who deliberately mapped their register's `Health Centre`
  // onto something else keeps that decision; an automatic fold must never overrule them.
  it('2. an active mapping BEATS a fold that would have said something different', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { [LEVEL]: [...concepts, { code: 'district-hospital', display: 'District Hospital' }] },
      mappings: { [`${from}|Health Centre`]: [{ toCode: 'district-hospital', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Centre' })]);
    expect(res.mapped.level.get('Health Centre')).toBe('district-hospital');
  });

  it('3. a case-only difference resolves to the CODE, not to the display', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health center' })]);
    expect(res.mapped.level.get('health center')).toBe('health-center');
    expect(res.unmapped.level).toEqual([]);
  });

  it('3. the Centre spelling resolves too, which is what the Zambia export needs', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Centre' })]);
    expect(res.mapped.level.get('Health Centre')).toBe('health-center');
  });

  it('3. an exact DISPLAY now resolves to the code as well', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Center' })]);
    expect(res.mapped.level.get('Health Center')).toBe('health-center');
  });

  it('4. anything else is still unmapped, and still never blocks', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Something Else' })]);
    expect(res.unmapped.level).toEqual(['Something Else']);
  });

  // ⛔ FAIL CLOSED. Two different concepts that normalise alike make the key USELESS, not ambiguous:
  // values matching it go to the operator rather than to a guess. Zero seeded keys collide today
  // (see facility-controlled-fields.seed.test.ts), so this exists for the concept added next year.
  it('discards a key two different concepts share, leaving those values unmapped', async () => {
    const admin = fakeAdmin({
      valueSets: {
        [LEVEL]: [
          { code: 'a-center', display: 'A Center' },
          { code: 'a-centre', display: 'A Centre' },
        ],
      },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'a center' })]);
    expect(res.mapped.level.size).toBe(0);
    expect(res.unmapped.level).toEqual(['a center']);
  });

  // ⛔ A CONCEPT WITH NO `display` KEY AT ALL, not a null one. `ExpandedConcept` says
  // `display: string | null`, so a real expansion always carries the key and the strict
  // `=== null` guard this replaced was true of every production path. A caller building the
  // shape by hand omits it, and the loop then handed `undefined` to `normaliseControlledValue`
  // and threw — reaching the facility EDIT route as a 500 where its own answer was a 400.
  // Found by `apps/server`'s "still refuses when the edit CHANGES the level", which had been
  // served from turbo's cache since the fold shipped.
  it('a concept with no display at all does not throw, and its code still matches', async () => {
    const admin = fakeAdmin({
      // ⛔ THE CAST IS THE SUBJECT, not a convenience. Both `ConceptFixture` and the real
      // `ExpandedConcept` require `display`, so this shape is one the types forbid and only a
      // hand-built caller can produce — which is exactly what the route test that found this does.
      // Written the type's own way it would not compile, and the bug would stay unreachable here.
      valueSets: { [LEVEL]: [{ code: 'health-center' } as unknown as ConceptFixture] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [
      rec({ level: 'HEALTH-CENTER' }),
      rec({ level: 'Health Center' }),
    ]);
    // The code still folds on case, which is the only thing a display-less concept can offer.
    expect(res.mapped.level.get('HEALTH-CENTER')).toBe('health-center');
    // And the display spelling has nothing to match against, so it goes to the operator. That is
    // the correct answer, not a defect: this test is here for the THROW, not for this value.
    expect(res.unmapped.level).toEqual(['Health Center']);
  });

  it('a collision does not stop other values resolving', async () => {
    const admin = fakeAdmin({
      valueSets: {
        [LEVEL]: [
          { code: 'a-center', display: 'A Center' },
          { code: 'a-centre', display: 'A Centre' },
          { code: 'health-center', display: 'Health Center' },
        ],
      },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health centre' })]);
    expect(res.mapped.level.get('health centre')).toBe('health-center');
  });
});

describe('an ignored value', () => {
  const LEVEL_VS = 'urn:openldr:valueset:facility-type';
  const FROM = observedFieldSystem('level', 'urn:tz:hfr');

  it('is neither mapped nor reported unmapped', async () => {
    const admin = fakeAdmin({
      valueSets: { [LEVEL_VS]: [{ code: 'health-center', display: 'Health Center' }] },
      mappings: { [`${FROM}|Others`]: [{ toCode: 'Others', isActive: true, mapType: 'UNMAPPED-FROM' }] },
    });

    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Others' })]);

    expect(res.mapped.level.size).toBe(0);
    expect(res.unmapped.level).toEqual([]);
  });

  // The whole point of the decision: it beats the automatic fold, which would otherwise rewrite
  // the value the operator asked to leave alone. `Health Centre` folds to `health-center` without
  // the ignore row, so this fails loudly if the check lands below the fold instead of above it.
  it('beats the normalised fold, so the value stays exactly as written', async () => {
    const admin = fakeAdmin({
      valueSets: { [LEVEL_VS]: [{ code: 'health-center', display: 'Health Center' }] },
      mappings: { [`${FROM}|Health Centre`]: [{ toCode: 'Health Centre', isActive: true, mapType: 'UNMAPPED-FROM' }] },
    });

    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Centre' })]);

    expect(res.mapped.level.size).toBe(0);
    expect(res.unmapped.level).toEqual([]);
  });

  // A SAME-AS row must still resolve. Without this the check could be written as "any active row
  // means leave it alone" and every existing mapping would silently stop working.
  it('does not change what an ordinary mapping does', async () => {
    const admin = fakeAdmin({
      valueSets: { [LEVEL_VS]: [{ code: 'health-center', display: 'Health Center' }] },
      mappings: { [`${FROM}|Others`]: [{ toCode: 'health-center', isActive: true, mapType: 'SAME-AS' }] },
    });

    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Others' })]);

    expect(res.mapped.level.get('Others')).toBe('health-center');
  });

  // An INACTIVE ignore row is a decision the operator took back.
  it('is ignored itself once deactivated', async () => {
    const admin = fakeAdmin({
      valueSets: { [LEVEL_VS]: [{ code: 'health-center', display: 'Health Center' }] },
      mappings: { [`${FROM}|Others`]: [{ toCode: 'Others', isActive: false, mapType: 'UNMAPPED-FROM' }] },
    });

    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Others' })]);

    expect(res.unmapped.level).toEqual(['Others']);
  });
});

describe('resolveControlledFields — the register\'s own facility-type list', () => {
  it('checks values against the register\'s own list once it has one', async () => {
    const admin = fakeAdmin({
      valueSets: {
        'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }],
        'urn:openldr:valueset:facility-type:urn_tz_hfr': [
          { code: 'health-center', display: 'Health Center' },
          { code: 'first-aid-stations', display: 'First-aid stations' },
        ],
      },
    });

    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'First-aid stations' })]);

    // Resolved through the register's own concept, so it is neither unmapped nor rewritten.
    expect(res.unmapped.level).toEqual([]);
  });

  it('falls back to the shared list for a register that has added nothing', async () => {
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }] },
    });

    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'First-aid stations' })]);

    expect(res.unmapped.level).toEqual(['First-aid stations']);
  });
});
