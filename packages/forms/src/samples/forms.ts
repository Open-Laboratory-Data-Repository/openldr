import type { FormSchema } from '../schema/form-schema'

const NOW = '2026-01-01T00:00:00.000Z'

/** The site's OWN facility numbering — whatever the local LIS calls a facility. Always CE-local. */
export const LOCAL_FACILITY_SYSTEM = 'urn:openldr:facility:local'
/** The national facility register a local code maps TO. A PLACEHOLDER: every country has its own
 *  (Tanzania HFR, Kenya MFL, …), so the real value belongs in configuration, never in a shipped
 *  sample. See docs/superpowers/specs/2026-08-04-facility-registry-design.md. */
export const NATIONAL_FACILITY_SYSTEM = 'urn:openldr:facility:national'

/** Facility / Location form — drives the facilities management page. */
const facilityForm: FormSchema = {
  id: 'sample-facility',
  name: 'Facility',
  versionLabel: 'v1',
  fhirVersion: 'R4',
  fhirResourceType: 'Location',
  fhirProfileUrl: null,
  facilityId: null,
  targetPages: ['facilities'],
  sections: [],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: NOW,
  updatedAt: NOW,
  fields: [
    // THEIRS — the code the national/master facility list carries, and the row's key material:
    // `id = fac-sha256(nationalSystem|nationalCode)` (`idFor`, packages/terminology/src/facility-csv.ts).
    // OPTIONAL, because a lab-only facility never has one. Listed FIRST because on a registry row
    // this is the code that matters; `registryPreferredCode` (packages/db/src/facility-observed.ts)
    // and the Facilities table both fall back `localCode ?? nationalCode`, and until migration 085
    // no form field bound this column at all — so a nationally-imported facility showed a blank
    // code box beside a table cell that displayed one. Seeded by migration 085.
    {
      id: 'fld-fac-national-code', fhirPath: 'identifier.value',
      fhirDiscriminator: { system: NATIONAL_FACILITY_SYSTEM },
      displayLabel: 'National code', description: null, fieldType: 'identifier',
      required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
      apiProperty: 'nationalCode',
    },
    {
      // Names the register the national code belongs to, by CANONICAL URI. `suggest` (not a bound
      // ValueSet): the registers are per-install rows in `coding_systems`, not a shipped vocabulary,
      // and apps/studio feeds this field from /api/facilities/import/sources. Free entry is not the
      // gate — POST resolves it through `resolveFacilityRegisterForImport` and refuses an
      // unregistered or deactivated register, the same gate every import door applies.
      // `fhirPath: null` for the same reason council carries one; see that field's comment.
      id: 'fld-fac-national-system', fhirPath: null,
      displayLabel: 'Facility register', description: null, fieldType: 'suggest',
      required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' },
      apiProperty: 'nationalSystem',
    },
    {
      // OURS — the site's own numbering. OPTIONAL since migration 085, and relabelled from the
      // generic "Facility code": a CSV import never produces one (`parseFacilityCsv` refuses to
      // invent one — a national register has no concept of a local code), so requiring it made every
      // imported facility unsaveable from the Edit sheet.
      id: 'fld-fac-local-code', fhirPath: 'identifier.value',
      fhirDiscriminator: { system: LOCAL_FACILITY_SYSTEM },
      displayLabel: 'Local code', description: null, fieldType: 'identifier',
      required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' },
      apiProperty: 'localCode',
    },
    {
      id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
      fieldType: 'text', required: true, enabled: true, order: 3,
      cardinality: { min: 1, max: '1' }, apiProperty: 'name',
    },
    // Bound to the seeded ISO 3166 ValueSet rather than free text — same reasoning as status/level
    // below: a picker over an enumerated vocabulary instead of hand-typed strings. `valueSetUrl`
    // wins over `referenceTarget`, and the form linter warns when both are set, so `referenceTarget`
    // is deliberately absent. Seeded by migration 073, which also repoints any already-migrated
    // install's Facility form (see migrations 071/072) to this exact shape.
    {
      id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
      fieldType: 'reference', required: true, enabled: true, order: 4,
      cardinality: { min: 1, max: '1' }, apiProperty: 'country',
      valueSetUrl: 'urn:openldr:valueset:country',
    },
    // zone/region/district/council are NOT ValueSets — see migration 073's file comment and
    // docs/superpowers/specs/2026-08-05-facility-country-and-admin-hierarchy-design.md §2: they are
    // per-country and unbounded (Tanzania alone has ~5 zones / 31 regions / ~184 districts), so
    // authoring a vocabulary for each would be a vocabulary maintained forever, for values the
    // facility register already contains. `fieldType: 'suggest'` proposes values derived from
    // `facility_registry` itself (via /api/facilities/admin-values, cascading on the parent levels
    // already chosen — apps/studio wires that fetch) but never blocks a value that isn't suggested
    // yet, since a newly gazetted district must be enterable on day one.
    {
      id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
      fieldType: 'suggest', required: true, enabled: true, order: 5,
      cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
    },
    {
      // OPTIONAL since migration 085, unlike its zone/district siblings. Not every national register
      // has a tier here: Zambia's has nothing between Province and District, so 3788 of 3788 rows in
      // its MFL export carry no region at all. A required marker on a column the import path cannot
      // fill is a promise the data can never keep.
      id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
      fieldType: 'suggest', required: false, enabled: true, order: 6,
      cardinality: { min: 0, max: '1' }, apiProperty: 'region',
    },
    {
      id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
      fieldType: 'suggest', required: true, enabled: true, order: 7,
      cardinality: { min: 1, max: '1' }, apiProperty: 'district',
    },
    {
      // OPTIONAL — nobody may be blocked from saving a facility when council data is unknown.
      // `fhirPath: null`, not `address.line`: no standard R4 Address element remains for a fourth
      // admin tier once country/district/region/state are already bound to the four real Address
      // elements above (`address.country`/`.district`/`.state`/`.city`), and `address.line` is the
      // STREET-ADDRESS element — binding an administrative tier to it would corrupt any future
      // Location export. `FormField.fhirPath` is `z.string().nullable()`, and the
      // `ambiguous-fhir-path` lint rule skips falsy paths
      // (`if (!field.enabled || !field.fhirPath) continue`), so `null` is valid and lint-clean.
      // council is FACILITY_ADMIN_LEVELS' fourth column (packages/db/src/facility-answers.ts).
      id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
      fieldType: 'suggest', required: false, enabled: true, order: 8,
      cardinality: { min: 0, max: '1' }, apiProperty: 'council',
    },
    // Bound to seeded ValueSets rather than free text, same reasoning as the specimen-type field
    // below: a picker over an enumerated vocabulary instead of hand-typed strings. `valueSetUrl`
    // wins over `referenceTarget`, and the form linter warns when both are set, so `referenceTarget`
    // is deliberately absent. Both ValueSets are seeded by migration 072, which also repoints any
    // already-migrated install's Facility form (see migration 071) to these exact shapes; migration
    // 073 repoints the same form again afterwards, shifting status/level's `order` from 6/7 to 7/8
    // to make room for the new council field, without touching either binding itself.
    {
      id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
      fieldType: 'reference', required: true, enabled: true, order: 9,
      cardinality: { min: 1, max: '1' }, apiProperty: 'status',
      valueSetUrl: 'urn:openldr:valueset:location-status',
    },
    {
      id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
      fieldType: 'reference', required: true, enabled: true, order: 10,
      cardinality: { min: 1, max: '1' }, apiProperty: 'level',
      valueSetUrl: 'urn:openldr:valueset:facility-type',
    },
  ],
}

/** Users / Practitioner form — drives the users management page. */
const usersForm: FormSchema = {
  id: 'sample-users',
  name: 'Users',
  versionLabel: 'v1',
  fhirVersion: 'R4',
  fhirResourceType: 'Practitioner',
  fhirProfileUrl: null,
  facilityId: null,
  targetPages: ['users'],
  sections: [],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: NOW,
  updatedAt: NOW,
  fields: [
    {
      id: 'fld-usr-first-name',
      fhirPath: 'name.given',
      displayLabel: 'First name',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 0, max: '1' },
      apiProperty: 'firstName',
    },
    {
      id: 'fld-usr-last-name',
      fhirPath: 'name.family',
      displayLabel: 'Last name',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
      apiProperty: 'lastName',
    },
    {
      id: 'fld-usr-email',
      fhirPath: 'telecom.value',
      displayLabel: 'Email',
      description: null,
      fieldType: 'email',
      required: true,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
      apiProperty: 'email',
    },
    // Role assignment is NOT a form field: the Users page renders a dedicated OpenLDR role
    // multi-select (backed by /api/users/:id/roles) alongside this template, independent of
    // whatever fields the template defines. See apps/studio/src/users/UserDialog.tsx.
  ],
}

/** Patient / demographics form — drives the patients management page. */
const patientForm: FormSchema = {
  id: 'sample-patient',
  name: 'Patient',
  versionLabel: 'v1',
  fhirVersion: 'R4',
  fhirResourceType: 'Patient',
  fhirProfileUrl: null,
  facilityId: null,
  targetPages: ['forms'],
  sections: [{ id: 'demographics', label: 'Demographics', order: 0 }],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: NOW,
  updatedAt: NOW,
  fields: [
    {
      id: 'fld-pat-first-name',
      fhirPath: 'Patient.name.given',
      displayLabel: 'First name',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 0, max: '1' },
      section: 'demographics',
      apiProperty: 'firstName',
    },
    {
      id: 'fld-pat-last-name',
      fhirPath: 'Patient.name.family',
      displayLabel: 'Last name',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
      section: 'demographics',
      apiProperty: 'lastName',
    },
    {
      id: 'fld-pat-dob',
      fhirPath: 'Patient.birthDate',
      displayLabel: 'Date of birth',
      description: null,
      fieldType: 'date',
      required: true,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
      section: 'demographics',
      apiProperty: 'dateOfBirth',
    },
    {
      id: 'fld-pat-sex',
      fhirPath: 'Patient.gender',
      displayLabel: 'Sex',
      description: null,
      fieldType: 'select',
      required: true,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
      section: 'demographics',
      apiProperty: 'sex',
      valueSetOptions: [
        { code: 'male', display: 'Male' },
        { code: 'female', display: 'Female' },
        { code: 'other', display: 'Other' },
        { code: 'unknown', display: 'Unknown' },
      ],
    },
    {
      id: 'fld-pat-phone',
      fhirPath: 'Patient.telecom.value',
      displayLabel: 'Phone',
      description: null,
      fieldType: 'phone',
      required: false,
      enabled: true,
      order: 4,
      cardinality: { min: 0, max: '1' },
      section: 'demographics',
      placeholder: '+254…',
    },
  ],
}

/** Lab order / ServiceRequest form — drives the orders management page. */
const orderForm: FormSchema = {
  id: 'sample-order',
  name: 'Lab order',
  versionLabel: 'v1',
  fhirVersion: 'R4',
  fhirResourceType: 'ServiceRequest',
  fhirProfileUrl: null,
  facilityId: null,
  targetPages: ['forms'],
  sections: [
    { id: 'patient', label: 'Patient', order: 0 },
    { id: 'order', label: 'Order Details', order: 1 },
    { id: 'specimen', label: 'Specimen Collection', order: 2 },
  ],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: NOW,
  updatedAt: NOW,
  fields: [
    {
      id: 'patient',
      fhirPath: 'ServiceRequest.subject',
      displayLabel: 'Patient',
      description: null,
      fieldType: 'reference',
      required: true,
      enabled: true,
      order: 0,
      cardinality: { min: 0, max: '1' },
      section: 'patient',
      referenceTarget: 'Patient',
      placeholder: 'Search by name, ID, or phone…',
    },
    {
      id: 'tests',
      fhirPath: 'ServiceRequest.code',
      displayLabel: 'Tests',
      description: null,
      fieldType: 'reference',
      required: true,
      enabled: true,
      order: 1,
      // A lab order carries several tests. LOINC is the orderable vocabulary; a site with a
      // curated panel list can point this field at a ValueSet instead, which wins over
      // referenceTarget.
      cardinality: { min: 1, max: '*' },
      referenceMultiple: true,
      section: 'order',
      referenceTarget: 'http://loinc.org',
      placeholder: 'Search tests…',
    },
    {
      id: 'fld-ord-priority',
      fhirPath: 'ServiceRequest.priority',
      displayLabel: 'Priority',
      description: null,
      fieldType: 'select',
      required: true,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
      section: 'order',
      valueSetOptions: [
        { code: 'routine', display: 'Routine' },
        { code: 'urgent', display: 'Urgent' },
        { code: 'asap', display: 'ASAP' },
        { code: 'stat', display: 'STAT' },
      ],
    },
    {
      id: 'fld-ord-ward',
      fhirPath: 'ServiceRequest.locationCode',
      displayLabel: 'Ward / Department',
      description: null,
      fieldType: 'select',
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
      section: 'order',
      valueSetOptions: [
        { code: 'opd', display: 'OPD' },
        { code: 'ipd', display: 'IPD' },
        { code: 'icu', display: 'ICU' },
      ],
    },
    {
      id: 'fld-ord-clinician',
      fhirPath: 'ServiceRequest.requester',
      displayLabel: 'Requesting Clinician',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 4,
      cardinality: { min: 0, max: '1' },
      section: 'order',
      placeholder: 'Dr. …',
    },
    {
      id: 'fld-ord-ref-number',
      fhirPath: 'ServiceRequest.identifier',
      displayLabel: 'Reference Number',
      description: 'External requisition number',
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 5,
      cardinality: { min: 0, max: '1' },
      section: 'order',
      placeholder: 'REF-…',
    },
    {
      id: 'fld-ord-notes',
      fhirPath: 'ServiceRequest.note',
      displayLabel: 'Clinical Notes',
      description: 'Clinical context, suspected diagnosis…',
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 6,
      cardinality: { min: 0, max: '1' },
      section: 'order',
    },
    {
      id: 'fld-ord-ref-facility',
      fhirPath: 'ServiceRequest.performer',
      displayLabel: 'Referring Facility',
      description: null,
      fieldType: 'facility',
      required: false,
      enabled: true,
      order: 7,
      cardinality: { min: 0, max: '1' },
      section: 'order',
      placeholder: 'Search facilities by name or MFL ID…',
    },
    {
      id: 'fld-ord-specimen-type',
      fhirPath: 'Specimen.type',
      displayLabel: 'Specimen Type',
      description: null,
      fieldType: 'reference',
      required: true,
      enabled: true,
      order: 8,
      cardinality: { min: 1, max: '1' },
      section: 'specimen',
      // Bound to the SEEDED ValueSet, NOT to the whole SNOMED CodeSystem.
      //
      // This previously targeted `http://snomed.info/sct`, which was broken two ways. SNOMED is
      // not shipped — it needs an affiliate licence — so on a normal install the picker searched
      // an empty vocabulary and answered "No matches" for every term. And on an install that HAD
      // imported SNOMED, searching the whole CodeSystem ranked by code across 532k concepts, so
      // "serum" returned "BOVI-SERA ANTISERUM (product)" and friends while "Serum specimen"
      // never surfaced. Loading the vocabulary alone did not fix it; the binding was the defect.
      //
      // `urn:openldr:valueset:specimen-type` is seeded by migration 014, so it exists and is
      // populated on EVERY install — which is what makes `required: true` above safe. Required
      // against an empty vocabulary would make the whole form unsubmittable.
      //
      // ⚠ That seed carries only four LOCAL codes (Blood, Urine, CSF, Sputum) — no serum or
      // plasma — so the default HIV viral-load test ("…in Serum or Plasma") cannot yet be given
      // its true specimen out of the box. A site that imports SNOMED should repoint this
      // ValueSet at the specimen hierarchy (`properties.semanticTag = 'specimen'`, ~2k concepts);
      // that needs no change to this form. `valueSetUrl` wins over `referenceTarget`, and the
      // form linter warns when both are set, so `referenceTarget` is deliberately absent.
      valueSetUrl: 'urn:openldr:valueset:specimen-type',
      placeholder: 'Search specimen types…',
    },
  ],
}

/** All canonical sample forms (constant array, not a function). */
export const sampleForms: FormSchema[] = [facilityForm, usersForm, patientForm, orderForm]
