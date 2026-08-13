import { describe, expect, it } from 'vitest';
import { sampleForms } from './forms';
import { FormSchema } from '../schema/form-schema';
import { toQuestionnaire } from '../to-questionnaire';
import { resolveReferenceSource } from '../reference-source';
import { PAGE_TARGETS } from '../page-targets';
import { CORE_FACILITY_KEYS, FACILITY_FORM_MIGRATION_BOUND_FIELDS } from '@openldr/db';

describe('sample forms', () => {
  it('parse against the schema and export to Questionnaire', () => {
    expect(sampleForms.length).toBeGreaterThanOrEqual(4);
    for (const form of sampleForms) {
      const parsed = FormSchema.parse(form);
      const q = toQuestionnaire(parsed);
      expect(q.resourceType).toBe('Questionnaire');
    }
  });
  it('includes all four canonical sample form ids', () => {
    const ids = sampleForms.map((f) => f.id);
    expect(ids).toContain('sample-facility');
    expect(ids).toContain('sample-users');
    expect(ids).toContain('sample-patient');
    expect(ids).toContain('sample-order');
  });
  it('includes a Facility (Location) form, targeting the facilities page', () => {
    const facility = sampleForms.find((f) => f.fhirResourceType === 'Location');
    expect(facility?.targetPages).toEqual(['facilities']);
    expect(facility?.fields.some((x) => x.apiProperty === 'name')).toBe(true);
  });
  it('patient form targets the forms page and has a firstName apiProperty field', () => {
    const patient = sampleForms.find((f) => f.id === 'sample-patient');
    expect(patient?.targetPages).toEqual(['forms']);
    expect(patient?.fields.some((x) => x.apiProperty === 'firstName')).toBe(true);
  });
  it('order form has fields with id "patient" and "tests"', () => {
    const order = sampleForms.find((f) => f.id === 'sample-order');
    const fieldIds = order?.fields.map((f) => f.id) ?? [];
    expect(fieldIds).toContain('patient');
    expect(fieldIds).toContain('tests');
  });
  it('users form has no roles field — role assignment is a dedicated control outside the template', () => {
    const users = sampleForms.find((f) => f.id === 'sample-users');
    expect(users?.fields.some((x) => x.apiProperty === 'roles')).toBe(false);
  });
});

describe('Lab order reference fields', () => {
  const labOrder = sampleForms.find((f) => f.name === 'Lab order')!;
  const field = (id: string) => labOrder.fields.find((f) => f.id === id)!;

  it('binds patient to the Patient entity', () => {
    expect(resolveReferenceSource(field('patient')))
      .toEqual({ ok: true, source: { kind: 'entity', target: 'Patient' } });
  });

  it('binds tests to a coding system rather than an unregistered entity', () => {
    const r = resolveReferenceSource(field('tests'));
    expect(r.ok).toBe(true);
    expect(r.ok && r.source.kind).toBe('coding');
  });

  // Binds to the SEEDED ValueSet, not to the whole SNOMED CodeSystem.
  //
  // Targeting `http://snomed.info/sct` was broken two ways on a fresh install. SNOMED is not
  // shipped (it needs an affiliate licence), so the picker searched an empty vocabulary and
  // returned "No matches" for every term. And where SNOMED HAD been imported, searching the
  // whole CodeSystem ranked by code across 532k concepts, so "serum" surfaced
  // "BOVI-SERA ANTISERUM (product)" while "Serum specimen" never appeared.
  //
  // `urn:openldr:valueset:specimen-type` is seeded by migration 014, so it is present and
  // populated on EVERY install — which is what makes `required` below safe. A site that
  // imports SNOMED can repoint that ValueSet at the specimen hierarchy without touching this form.
  it('binds specimen type to the seeded specimen ValueSet', () => {
    const r = resolveReferenceSource(field('fld-ord-specimen-type'));
    expect(r).toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'urn:openldr:valueset:specimen-type' } });
  });

  // A lab order without a specimen type is not actionable in the lab. Only safe because the
  // binding above resolves against a seeded ValueSet — required against an empty vocabulary
  // would make the form unsubmittable.
  it('requires a specimen type', () => {
    const f = field('fld-ord-specimen-type');
    expect(f.required).toBe(true);
    expect(f.cardinality.min).toBe(1);
  });

  it('allows more than one test per order', () => {
    expect(field('tests').cardinality.max).not.toBe('1');
  });
});

const facility = () => sampleForms.find((f) => f.name === 'Facility')!;

describe('the seeded Facility form', () => {
  it('targets the facilities page', () => {
    expect(facility().targetPages).toEqual(['facilities']);
  });

  it('⛔ gives EVERY field an apiProperty', () => {
    // Under the Users pattern a field with no apiProperty falls into `extras`. Several fields
    // shipped without one, which would have put region/district/status/level in a jsonb bag —
    // unindexed and unjoinable, defeating the reason they are columns.
    const missing = facility().fields.filter((f) => !f.apiProperty).map((f) => f.id);
    expect(missing, `fields with no apiProperty: ${missing.join(', ')}`).toEqual([]);
  });

  it('carries exactly the agreed OPTIONAL set — council alone', () => {
    // The complement of 'marks the required fields required' below. The FULL 9-field apiProperty
    // set is already pinned by 'every field carries an apiProperty from the full set...' below, so
    // re-deriving that same array here (filtered by `.required` or not) would just duplicate it —
    // this used to be an unfiltered full-set check itself, before council's addition made that
    // collide with the required-set check below (both ended up comparing the same filtered
    // 8-element array). Pinning the NOT-required side instead is genuinely new coverage: it catches
    // a field silently losing its `required: true` from the opposite direction — council quietly
    // gaining company, or a required field quietly becoming optional and this test not noticing
    // because it only ever asserted equality on the required side.
    // Migration 085 widened this set from council alone to five. Each addition has its own reason,
    // and none of them is "required felt too strict":
    //   nationalCode/nationalSystem — a lab-only facility genuinely has neither.
    //   localCode                   — a CSV import never produces one, by design.
    //   region                      — not every register has a tier there (Zambia's has none).
    expect(facility().fields.filter((f) => !f.required).map((f) => f.apiProperty).sort()).toEqual(
      ['council', 'localCode', 'nationalCode', 'nationalSystem', 'region'].sort(),
    );
  });

  it('every field carries an apiProperty from the full set, including the optional council', () => {
    expect(facility().fields.map((f) => f.apiProperty).sort()).toEqual(
      ['council', 'country', 'district', 'level', 'localCode', 'name', 'nationalCode', 'nationalSystem', 'region', 'status', 'zone'].sort(),
    );
  });

  it('⛔ every apiProperty is a REAL facility_registry column, not just a string that happens to match', () => {
    // packages/db/src/facility-answers.ts's CORE_FACILITY_KEYS is what actually routes an answer
    // to an indexed column vs the `extras` jsonb bag. This file used to hand-duplicate the eight
    // names as a plain array — renaming a key in facility-answers.ts would silently start routing
    // answers into extras with BOTH suites green, since neither one cross-checked the other.
    // Importing the real set closes that gap.
    for (const field of facility().fields) {
      expect(CORE_FACILITY_KEYS.has(field.apiProperty!), `"${field.apiProperty}" is not in CORE_FACILITY_KEYS`).toBe(true);
    }
  });

  it('marks the required fields required', () => {
    // The optional five are excluded — see the OPTIONAL-set test above, which pins the complementary
    // side instead of re-deriving this same set. ⛔ A facility's IDENTITY is deliberately absent
    // here: neither code is required, because `facility_registry_has_a_code` (migration 070) asks
    // only that at least ONE of them be present, and no single form field can express "or". The
    // route enforces that pair rule directly.
    const required = facility().fields.filter((f) => f.required).map((f) => f.apiProperty).sort();
    expect(required).toEqual(['country', 'district', 'level', 'name', 'status', 'zone'].sort());
  });

  it('binds status and level to their ValueSets as searchable reference fields, not free text', () => {
    const status = facility().fields.find((f) => f.id === 'fld-fac-status')!;
    const level = facility().fields.find((f) => f.id === 'fld-fac-level')!;

    expect(status.fieldType).toBe('reference');
    expect(status.valueSetUrl).toBe('urn:openldr:valueset:location-status');
    expect(status.required).toBe(true);
    expect(status.apiProperty).toBe('status');

    expect(level.fieldType).toBe('reference');
    expect(level.valueSetUrl).toBe('urn:openldr:valueset:facility-type');
    expect(level.required).toBe(true);
    expect(level.apiProperty).toBe('level');
  });

  it('binds country to the seeded ISO 3166 ValueSet as a searchable reference field, not free text', () => {
    const country = facility().fields.find((f) => f.id === 'fld-fac-country')!;
    expect(country.fieldType).toBe('reference');
    expect(country.valueSetUrl).toBe('urn:openldr:valueset:country');
    expect(country.required).toBe(true);
    expect(country.apiProperty).toBe('country');
  });

  it('binds the four admin-chain fields (zone/region/district/council) to `suggest`, not free text or a ValueSet', () => {
    for (const id of ['fld-fac-zone', 'fld-fac-region', 'fld-fac-district']) {
      const f = facility().fields.find((x) => x.id === id)!;
      expect(f.fieldType, `${id}.fieldType`).toBe('suggest');
      expect(f.valueSetUrl, `${id}.valueSetUrl`).toBeUndefined();
    }
  });

  it('requires zone and district but NOT region — a register with no tier there cannot fill it', () => {
    // Split out of the binding test above by migration 085. Zambia's national list has nothing
    // between Province and District: 3788 of 3788 rows in its MFL export carry no region, so a
    // required marker there blocked every one of them from being edited at all. zone/district stay
    // required so this relaxation cannot be mistaken for the admin chain going soft.
    expect(facility().fields.find((f) => f.id === 'fld-fac-region')!.required).toBe(false);
    for (const id of ['fld-fac-zone', 'fld-fac-district']) {
      expect(facility().fields.find((f) => f.id === id)!.required, `${id}.required`).toBe(true);
    }
  });

  it('offers both codes — the national one first, neither required', () => {
    const fields = facility().fields;
    const national = fields.find((f) => f.id === 'fld-fac-national-code')!;
    const register = fields.find((f) => f.id === 'fld-fac-national-system')!;
    const local = fields.find((f) => f.id === 'fld-fac-local-code')!;

    // Until migration 085 no field bound `nationalCode` at all, so a nationally-imported facility
    // showed an empty code box in the Edit sheet beside a table cell that displayed its code.
    expect(national.apiProperty).toBe('nationalCode');
    expect(national.displayLabel).toBe('National code');
    expect(national.required).toBe(false);
    expect(register.apiProperty).toBe('nationalSystem');
    expect(register.fieldType).toBe('suggest');

    // Relabelled from the generic "Facility code", which read as the same thing the Facilities
    // table's CODE column shows — that column falls back `localCode ?? nationalCode`.
    expect(local.apiProperty).toBe('localCode');
    expect(local.displayLabel).toBe('Local code');
    expect(local.required).toBe(false);

    expect(national.order).toBeLessThan(local.order);
  });

  it('binds council to `suggest` too, but — unlike zone/region/district — it is OPTIONAL with no FHIR path', () => {
    // Nobody may be blocked from saving a facility when council data is unknown. `fhirPath: null`
    // because no standard R4 Address element remains for a fourth admin tier below the four already
    // bound above (address.country/.district/.state/.city) — see forms.ts's comment on this field.
    const council = facility().fields.find((x) => x.id === 'fld-fac-council')!;
    expect(council.fieldType).toBe('suggest');
    expect(council.valueSetUrl).toBeUndefined();
    expect(council.required).toBe(false);
    expect(council.fhirPath).toBeNull();
    expect(council.cardinality).toEqual({ min: 0, max: '1' });
  });

  it('offers facilities as a page target, requiring name plus the only code a template can supply', () => {
    const t = PAGE_TARGETS.find((p) => p.id === 'facilities')!;
    expect(t.available).toBe(true);
    expect(t.requiredKeys.sort()).toEqual(['localCode', 'name']);
  });

  // Migration 085_facility_national_code_field rewrites an already-migrated install's persisted
  // Facility form to a frozen BOUND_FIELDS snapshot copied (not imported) from this sample, because
  // a migration must not live-track a file that keeps changing. (071 pinned this same way against
  // its own NEW_FIELDS snapshot before level/status were bound to ValueSets; 072 pinned against ITS
  // OWN once they were; 073 against its own once country and the suggest-typed admin chain shipped;
  // 085 is now the frozen snapshot that reflects the CURRENT sample, since it is 085 — not 073 —
  // that ships the national code/register fields and the relaxed local-code and region markers to
  // already-migrated installs.) That snapshot
  // is a duplicate by construction, so nothing stops the two silently drifting apart: edit a field
  // here without also updating the migration and BOTH suites stay green — the migration's own test
  // only ever compares the migration's output to the migration's own constant. Pinning FROM THIS SIDE
  // against the db-exported snapshot is what actually catches that drift.
  it('⛔ matches migration 085\'s frozen BOUND_FIELDS snapshot exactly, so a future edit here cannot silently desynchronise an already-migrated install from what the migration thinks "bound" looks like', () => {
    expect(facility().fields).toEqual(FACILITY_FORM_MIGRATION_BOUND_FIELDS);
  });
});
